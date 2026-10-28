// @ts-check
/**
 * outcome-ledger-core.mjs — ブロッキング hook の「結末台帳」(hook-outcomes.jsonl・追記専用)の
 *   1行の形と冪等追記を判定する純関数。I/O は持たない(呼び出し側が読み書きする)。
 *
 * 役割: ブロッキング hook が deny を出した「結末」を1行として残せる形か、同じ結末を二重に
 *   数えないか(冪等)を判定する。設計: _docs/DESIGN-overall-design-council-2026-10-21.md §7 P3。
 * なぜ要るか(council §7): ブロッキング hook は「読んだ/守った」を強制するが、その deny が
 *   本当に正しかったか(偽陽性=FP でないか)を測る足場が無く、閾値も調整できないまま腐る、という
 *   ループ工学の穴(発散④)。deny の結末を少量ずつ台帳へ残し、人間が週次でラベル付けして FP 率を
 *   出す土台にする。これは観測であって強制ではない——記録に失敗しても hook の判定は変えない
 *   (呼び出し側が fail-open で握りつぶす。surechigai の「退行して続行」の姿勢)。
 * ★冪等キーの訂正(council §7 の前提を実測で訂正・2026-10-21): council は鍵を
 *   `(session_id, tooluse_idx)` としたが、これは「transcript 内の tool_use を数えた番号」を前提に
 *   していた。公式仕様(https://code.claude.com/docs/en/hooks)の確認で、(a) PreToolUse の stdin は
 *   ネイティブに `tool_use_id`(例 "toolu_01ABC...")を持つこと、(b) transcript は非同期で遅れて
 *   書かれ、hook 発火時点で現在の呼び出しが未記入のことがある(＝番号を数える方式は不安定)、が
 *   分かった。よって冪等キーは `(sessionId, toolUseId, hook)` にする。council の意図(同じツール
 *   呼び出しの結末を二重に数えない)はネイティブ id の方が確実に満たせる。
 * 限界(過信しない):
 *   ・記録するのは「deny が起きた事実」まで。その deny が FP か TP かは人間のラベル待ち(機械では決めない)。
 *   ・`toolUseId` が同一呼び出しを指すかはネイティブ id を信頼するまで。意味判断はしない。
 *   ・記録対象はブロッキング3本＋ratchet のみ(8本全部ではない。致命/退行可の区別・council §7)。
 */

export const SCHEMA_VERSION = 1;

/** 結末を記録してよい hook(ブロッキング3本＋ratchet のみ)。警告系は対象外。 */
export const HOOKS = Object.freeze([
  'require-claude-md-read',
  'guard-external-actions',
  'check-ask-preceded-by-research',
  'check-claude-md-budget-ratchet',
]);

export const DECISIONS = Object.freeze(['deny', 'allow', 'ask']);
export const MAX_REASON_CATEGORY = 48;

const KEYS = Object.freeze(['schema', 'hook', 'decision', 'sessionId', 'toolUseId', 'reasonCategory', 'at']);
// セッションID: Claude Code の session_... / UUID 等。安全な文字種だけ許す(秘密やパスが紛れないように)。
const SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
// tool_use_id: ネイティブは "toolu_..." だが、将来の形も壊さないよう安全なトークンとして受ける。
const TOOL_USE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
// 理由カテゴリは小文字・数字・ハイフンの短い語だけ(自由文を入れない＝秘密もメールもURLも構造上入らない)。
const REASON_CATEGORY_RE = /^[a-z][a-z0-9-]{0,47}$/;
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * 追記しようとする1行を検査する(既存の履歴には依存しない。形だけを見る)。
 * @param {Record<string, any>} entry
 * @returns {{ ok: boolean, violations: Array<{ path: string, rule: string }> }}
 */
export function validateRecord(entry) {
  /** @type {Array<{path:string,rule:string}>} */
  const v = [];
  const bad = (/** @type {string} */ path, /** @type {string} */ rule) => v.push({ path, rule });
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return { ok: false, violations: [{ path: '$', rule: 'not-an-object' }] };
  }
  for (const k of Object.keys(entry)) {
    if (!KEYS.includes(k)) bad(`$.${/^[A-Za-z0-9_.-]{1,32}$/.test(k) ? k : '<unprintable-key>'}`, 'unknown-key');
  }
  if (entry.schema !== SCHEMA_VERSION) bad('$.schema', `schema-must-be-${SCHEMA_VERSION}`);
  if (typeof entry.hook !== 'string' || !HOOKS.includes(entry.hook)) bad('$.hook', 'hook-not-allowed');
  if (typeof entry.decision !== 'string' || !DECISIONS.includes(entry.decision)) bad('$.decision', 'decision-not-allowed');
  if (typeof entry.sessionId !== 'string' || !SESSION_RE.test(entry.sessionId)) bad('$.sessionId', 'format');
  if (typeof entry.toolUseId !== 'string' || !TOOL_USE_ID_RE.test(entry.toolUseId)) bad('$.toolUseId', 'format');
  if (typeof entry.reasonCategory !== 'string' || !REASON_CATEGORY_RE.test(entry.reasonCategory)) {
    bad('$.reasonCategory', `format([a-z][a-z0-9-]{0,${MAX_REASON_CATEGORY - 1}})`);
  }
  if (typeof entry.at !== 'string' || !AT_RE.test(entry.at)) bad('$.at', 'format');
  return { ok: v.length === 0, violations: v };
}

/**
 * 冪等キー。同じ hook が「同じセッションの同じツール呼び出し(toolUseId)」を二重に記録しても1件に畳む。
 * @param {Record<string, any>} entry
 */
export function dedupKey(entry) {
  return `${entry.sessionId}\u0000${entry.toolUseId}\u0000${entry.hook}`;
}

/**
 * 既存の台帳(行の配列)に照らして、この1行を追記してよいか。
 * @param {Array<Record<string, any>>} existing
 * @param {Record<string, any>} entry
 * @returns {{ added: boolean, key: string|null, reason: 'ok'|'invalid'|'duplicate' }}
 */
export function appendIfNew(existing, entry) {
  const check = validateRecord(entry);
  if (!check.ok) return { added: false, key: null, reason: 'invalid' };
  const key = dedupKey(entry);
  for (const e of existing) {
    // 既存行が壊れていても落ちないよう、鍵作成は検査を通った形だけで行う。
    if (validateRecord(e).ok && dedupKey(e) === key) return { added: false, key, reason: 'duplicate' };
  }
  return { added: true, key, reason: 'ok' };
}

/**
 * JSON Lines の本文を行ごとに entry 配列へ(壊れた行・空行は飛ばす)。純関数。
 * @param {string} text
 * @returns {Array<Record<string, any>>}
 */
export function parseLedger(text) {
  if (typeof text !== 'string' || text.trim() === '') return [];
  /** @type {Array<Record<string, any>>} */
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t);
      if (e && typeof e === 'object' && !Array.isArray(e)) out.push(e);
    } catch {
      // 壊れた行は無視(台帳は追記専用。読み取りで落とさない)
    }
  }
  return out;
}

/**
 * 記録用の1行を組み立てる(検査付き)。呼び出し側はこの結果を appendIfNew に渡す。
 * @param {{ hook: string, decision?: string, sessionId: string, toolUseId: string, reasonCategory: string, at?: string }} fields
 * @returns {{ ok: boolean, record: Record<string, any>|null, violations: Array<{path:string,rule:string}> }}
 */
export function makeRecord(fields) {
  const record = {
    schema: SCHEMA_VERSION,
    hook: fields.hook,
    decision: fields.decision || 'deny',
    sessionId: fields.sessionId,
    toolUseId: fields.toolUseId,
    reasonCategory: fields.reasonCategory,
    at: fields.at || new Date().toISOString(),
  };
  const check = validateRecord(record);
  return { ok: check.ok, record: check.ok ? record : null, violations: check.violations };
}
