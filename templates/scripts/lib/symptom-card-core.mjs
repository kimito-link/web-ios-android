// @ts-check
/**
 * symptom-card-core.mjs — 自己改善ループの「症状カード」を検査する純関数（許可リスト方式・fail-closed）。
 *
 * 役割: アダプタ（プロジェクトごとの症状の入口）が作ったカードが、**AIに渡してよい形か**を判定する。
 *   通らなければカードを作らせない・AIへ渡さない。設計: _docs/DESIGN-self-improvement-loop-2026-10-18.md §4・§5。仕様: _docs/SPEC-symptom-card-v1.md。
 * なぜ「許可リスト」か: 禁止リストは、プロジェクトに新しいフィールドが増えたとき漏れる。ここでは
 *   (1) 出してよいフィールド名だけを列挙し、(2) 文字列は**短い・形の決まったもの**だけ許し、(3) 自由記述の文字列を構造的に持てなくする。
 *   コメント本文・名前・メール等は「文字列を持てる場所が無い」ので入りようがない（数値と短い識別子だけが通る）。
 * 守っていること（テストで固定）: 未知のキーは拒否／metrics は有限の数値と真偽値だけ／秘密・個人情報らしき形は拒否／
 *   エラーメッセージに**問題の値を載せない**（検査のログから漏れないように、パスと規則名だけ）。
 * 限界（過信しない）: 「数値が個人に結びつくか」（例: 数値のユーザーID）は形では決められない。metrics のキー名に
 *   個人情報を示す語で終わるキー名を禁じ、数値の上限(1e9)を置くのは**ヒューリスティック**で、アダプタ側で集計値だけを渡す責任は消えない。
 */

export const SCHEMA_VERSION = 1;
export const MAX_BYTES = 8 * 1024;
export const MAX_METRICS = 64;
/** 数値の絶対値の上限。数値のIDや電話番号が紛れ込むのを減らす粗い防壁（件数・ms・人数は十分収まる）。 */
export const MAX_ABS_NUMBER = 1e9;

export const VERDICTS = Object.freeze(['ok', 'warn', 'fail', 'unmeasured']);
/** カードの最上位で許すキー（これ以外は全部拒否）。 */
export const TOP_LEVEL_KEYS = Object.freeze(['schema', 'id', 'project', 'source', 'verdict', 'version', 'buildId', 'at', 'metrics']);

const ID_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/; // 症状ID・プロジェクト名・アダプタ名
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/; // 1.2.3 / 2026.10.18-rc1 など。@ / : を含められない
const BUILD_RE = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/; // ビルドID・コミットsha短縮など
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const METRIC_KEY_RE = /^[a-z][A-Za-z0-9_]{0,47}$/;

/**
 * metrics のキー名が「個人・秘密そのもの」を指す語で**終わる**ものを拒否する（camelCase / snake_case の最後の語で判定）。
 * 例: userId・displayName・avatarUrl・apiKey・commentText は拒否。commentCount・userCount・p95Ms は通す（集計値は正当）。
 * 部分一致にしない理由: 「commentCount」のような件数の指標を誤って落とすと、このループの主な指標が出せなくなる（実測で踏んだ）。
 * 値が数値/真偽値に限られるので、ここは「数値のID」を示すキー名を落とす補助の防壁にすぎない。
 */
const FORBIDDEN_LAST_WORDS = [
  'id', 'name', 'mail', 'email', 'phone', 'tel', 'address', 'url', 'uri', 'token', 'key', 'secret', 'password', 'passwd',
  'auth', 'cookie', 'session', 'avatar', 'icon', 'text', 'body', 'message', 'comment', 'ip', 'device', 'card',
];
/** @param {string} k */
export function lastWord(k) {
  const parts = k.split(/_|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean);
  return (parts[parts.length - 1] || '').toLowerCase();
}
/** 識別子や文字列の値に現れてはいけない「秘密・個人情報らしき形」。 */
const SECRET_LIKE = /** @type {Array<[RegExp, string]>} */ ([
  [/sk-[A-Za-z0-9]{8,}/, 'secret-like(sk-)'],
  [/\bBearer\s+\S+/i, 'secret-like(bearer)'],
  [/[A-Za-z0-9+/=_-]{32,}/, 'long-opaque-string'],
  [/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(KEY|TOKEN|SECRET|PASSWORD)\b/, 'secret-variable-name'],
  [/[^\s@]+@[^\s@]+\.[^\s@]+/, 'email-like'],
  [/https?:\/\//i, 'url-like'],
]);

/**
 * @typedef {{ path: string, rule: string }} Violation  値そのものは載せない（ログから漏らさないため）
 * @param {unknown} card パース済みのカード
 * @param {{ byteLength?: number }} [opts] 元ファイルのバイト数（渡されたとき上限を検査）
 * @returns {{ ok: boolean, violations: Violation[] }}
 */
export function validateSymptomCard(card, opts = {}) {
  /** @type {Violation[]} */
  const v = [];
  /** @param {string} path @param {string} rule */
  const bad = (path, rule) => v.push({ path, rule });

  if (typeof opts.byteLength === 'number' && opts.byteLength > MAX_BYTES) bad('$', `too-large(>${MAX_BYTES}B)`);
  if (card === null || typeof card !== 'object' || Array.isArray(card)) {
    bad('$', 'not-an-object');
    return { ok: false, violations: v };
  }
  const obj = /** @type {Record<string, unknown>} */ (card);

  for (const k of Object.keys(obj)) if (!TOP_LEVEL_KEYS.includes(k)) bad(`$.${safeKey(k)}`, 'unknown-key');

  if (obj.schema !== SCHEMA_VERSION) bad('$.schema', `schema-must-be-${SCHEMA_VERSION}`);
  strField(obj, 'id', ID_RE, true, bad);
  strField(obj, 'project', ID_RE, true, bad);
  strField(obj, 'source', ID_RE, true, bad);
  strField(obj, 'version', VERSION_RE, true, bad);
  strField(obj, 'buildId', BUILD_RE, false, bad);
  strField(obj, 'at', AT_RE, true, bad);
  if (typeof obj.verdict !== 'string' || !VERDICTS.includes(obj.verdict)) bad('$.verdict', 'verdict-not-allowed');

  if (!('metrics' in obj)) {
    bad('$.metrics', 'missing');
  } else if (obj.metrics === null || typeof obj.metrics !== 'object' || Array.isArray(obj.metrics)) {
    bad('$.metrics', 'not-an-object');
  } else {
    const m = /** @type {Record<string, unknown>} */ (obj.metrics);
    const keys = Object.keys(m);
    if (keys.length > MAX_METRICS) bad('$.metrics', `too-many-metrics(>${MAX_METRICS})`);
    for (const k of keys) {
      const p = `$.metrics.${safeKey(k)}`;
      if (!METRIC_KEY_RE.test(k)) bad(p, 'metric-key-format');
      if (FORBIDDEN_LAST_WORDS.includes(lastWord(k))) bad(p, 'metric-key-forbidden-word');
      const val = m[k];
      if (typeof val === 'number') {
        if (!Number.isFinite(val)) bad(p, 'number-not-finite');
        else if (Math.abs(val) > MAX_ABS_NUMBER) bad(p, `number-too-large(>${MAX_ABS_NUMBER})`);
      } else if (typeof val !== 'boolean') {
        bad(p, 'metric-value-must-be-number-or-boolean'); // 文字列・配列・オブジェクトは持てない＝自由記述が入りようがない
      }
    }
  }

  // 秘密・個人情報らしき形（許可された文字列フィールドの値に対して。形式検査と二重に見る）
  for (const k of ['id', 'project', 'source', 'version', 'buildId']) {
    const val = obj[k];
    if (typeof val !== 'string') continue;
    for (const [re, name] of SECRET_LIKE) if (re.test(val)) bad(`$.${k}`, name);
  }
  return { ok: v.length === 0, violations: v };
}

/**
 * エラー表示用にキー名を安全化（変な長いキー名＝値が混ざった可能性があるので、ログに出さず丸める）。
 * @param {string} k
 */
function safeKey(k) {
  return /^[A-Za-z0-9_.-]{1,48}$/.test(k) ? k : '<unprintable-key>';
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string} key
 * @param {RegExp} re
 * @param {boolean} required
 * @param {(path: string, rule: string) => void} bad
 */
function strField(obj, key, re, required, bad) {
  if (!(key in obj)) {
    if (required) bad(`$.${key}`, 'missing');
    return;
  }
  const val = obj[key];
  if (typeof val !== 'string' || !re.test(val)) bad(`$.${key}`, 'format');
}
