// @ts-check
/**
 * loop-ledger-core.mjs — 自己改善ループの「承認台帳」(decisions.jsonl・追記専用)の検査と状態遷移（純関数）。
 *
 * 役割: 台帳の1行が正しい形か、いまの状態からその遷移が許されるかを判定する。設計: _docs/DESIGN-self-improvement-loop-2026-10-18.md §3-7・§4 部品4。
 * なぜ要るか: 「承認は人間が文字で出す。AIの提案・AI同士の合意は承認ではない」を、お願いではなく機械で守るため。
 *   (1) 承認・却下・保留・効果なしを書けるのは `human:` だけ（`ai:` が書けるのは proposed まで）
 *   (2) 状態遷移を固定（proposed → approved/rejected/deferred、approved → no_effect。rejected と no_effect は終端）
 *   (3) 理由（reason）を必須にし、秘密・メール・URL らしき形は拒否（台帳は残り続けるので漏らさない）
 * 限界（過信しない）: `by` が本当に人間かは、このコードでは証明できない。CLI（record-loop-decision.mjs）が
 *   「AIが走らせるシェルでは承認系を拒否する」補助の歯止めを持つが、環境変数を意図的に外せば回避できる（コマンド履歴には残る）。
 */

export const SCHEMA_VERSION = 1;
export const DECISIONS = Object.freeze(['proposed', 'approved', 'rejected', 'deferred', 'no_effect']);
/** AI が書いてよい決定。これ以外は human: のみ。 */
export const AI_ALLOWED = Object.freeze(['proposed']);
export const MAX_REASON = 500;

const ID_RE = /^D\d{4,}$/;
const PROPOSAL_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const BY_RE = /^(human|ai):[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const KEYS = Object.freeze(['schema', 'id', 'proposal', 'decision', 'by', 'at', 'reason']);
const REASON_BAD = /** @type {Array<[RegExp, string]>} */ ([
  [/sk-[A-Za-z0-9]{8,}/, 'secret-like(sk-)'],
  [/\bBearer\s+\S+/i, 'secret-like(bearer)'],
  [/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(KEY|TOKEN|SECRET|PASSWORD)\b/, 'secret-variable-name'],
  [/[^\s@]+@[^\s@]+\.[^\s@]+/, 'email-like'],
  [/https?:\/\//i, 'url-like'],
]);

/**
 * 1提案についての「いまの状態」。履歴が無ければ null。
 * @param {Array<Record<string, any>>} entries
 * @param {string} proposal
 */
export function stateOf(entries, proposal) {
  let s = null;
  for (const e of entries) if (e.proposal === proposal) s = e.decision;
  return s;
}

/** 現在の状態から許される次の決定。 */
const NEXT = {
  null: ['proposed'],
  proposed: ['approved', 'rejected', 'deferred'],
  deferred: ['approved', 'rejected', 'deferred'],
  approved: ['no_effect'],
  rejected: [],
  no_effect: [],
};

/**
 * 台帳に追記しようとする1行を、既存の履歴に照らして検査する。
 * @param {Record<string, any>} entry
 * @param {Array<Record<string, any>>} existing 既存の行（検査済みの前提）
 * @returns {{ ok: boolean, violations: Array<{ path: string, rule: string }> }}
 */
export function validateEntry(entry, existing) {
  const v = [];
  /** @param {string} path @param {string} rule */
  const bad = (path, rule) => v.push({ path, rule });
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return { ok: false, violations: [{ path: '$', rule: 'not-an-object' }] };

  for (const k of Object.keys(entry)) if (!KEYS.includes(k)) bad(`$.${/^[A-Za-z0-9_.-]{1,32}$/.test(k) ? k : '<unprintable-key>'}`, 'unknown-key');
  if (entry.schema !== SCHEMA_VERSION) bad('$.schema', `schema-must-be-${SCHEMA_VERSION}`);
  if (typeof entry.id !== 'string' || !ID_RE.test(entry.id)) bad('$.id', 'format');
  else if (existing.some((e) => e.id === entry.id)) bad('$.id', 'duplicate-id');
  if (typeof entry.proposal !== 'string' || !PROPOSAL_RE.test(entry.proposal)) bad('$.proposal', 'format');
  if (typeof entry.at !== 'string' || !AT_RE.test(entry.at)) bad('$.at', 'format');
  if (typeof entry.by !== 'string' || !BY_RE.test(entry.by)) bad('$.by', 'format(human:<name> | ai:<model>)');
  if (typeof entry.decision !== 'string' || !DECISIONS.includes(entry.decision)) bad('$.decision', 'decision-not-allowed');

  // AI は proposed まで。承認・却下・保留・効果なしは人間だけ。
  if (typeof entry.by === 'string' && entry.by.startsWith('ai:') && typeof entry.decision === 'string' && !AI_ALLOWED.includes(entry.decision)) {
    bad('$.by', 'ai-cannot-decide');
  }

  if (entry.decision !== 'proposed') {
    if (typeof entry.reason !== 'string' || entry.reason.trim().length === 0) bad('$.reason', 'required');
  }
  if (entry.reason !== undefined) {
    if (typeof entry.reason !== 'string') bad('$.reason', 'not-a-string');
    else {
      if (entry.reason.length > MAX_REASON) bad('$.reason', `too-long(>${MAX_REASON})`);
      for (const [re, name] of REASON_BAD) if (re.test(entry.reason)) bad('$.reason', name);
    }
  }

  // 状態遷移
  if (typeof entry.proposal === 'string' && typeof entry.decision === 'string' && DECISIONS.includes(entry.decision)) {
    const cur = stateOf(existing, entry.proposal);
    const allowed = NEXT[/** @type {keyof typeof NEXT} */ (String(cur))] || [];
    if (!allowed.includes(entry.decision)) bad('$.decision', `transition-not-allowed(${cur ?? 'none'}->${entry.decision})`);
  }
  return { ok: v.length === 0, violations: v };
}

/**
 * 既存の台帳全体を最初から再生して検査する（追記前に必ず通す。壊れた台帳には追記しない）。
 * @param {Array<Record<string, any>>} entries
 */
export function replayLedger(entries) {
  /** @type {Array<{ line: number, path: string, rule: string }>} */
  const out = [];
  /** @type {Array<Record<string, any>>} */
  const seen = [];
  entries.forEach((e, i) => {
    for (const x of validateEntry(e, seen).violations) out.push({ line: i + 1, ...x });
    seen.push(e);
  });
  return { ok: out.length === 0, violations: out };
}

/** 次の台帳ID（D0001 から連番）。 @param {Array<Record<string, any>>} entries */
export function nextId(entries) {
  let max = 0;
  for (const e of entries) {
    const m = /^D(\d+)$/.exec(String(e.id));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `D${String(max + 1).padStart(4, '0')}`;
}
