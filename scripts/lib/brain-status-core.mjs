// 役割: 作業を任せる「頭脳」(無料API・従量API・ローカルLLM)の「いま使えるか」を、
//   確認の結果(HTTP応答・実行ログのファイル名・ログ本文・成否履歴)から人が読める状態へ
//   分類する純関数の集合。scripts/record-brain-status.mjs がbrains.jsonへ保存する判定の核。
// 使い方:
//   import { classifyHttp, parseRunLogName, logLooksFailed, summarizeRuns, statusOfBrain } from './lib/brain-status-core.mjs';
//   classifyHttp({ status, bodyText, error })   → "ok"|"quota"|"rate"|"badkey"|"down"
//   parseRunLogName("20261019-192245-cf.log")   → { at: "2026-10-19T10:22:45.000Z", brain: "cf" } | null
//   logLooksFailed(text, failMarks)             → boolean
//   summarizeRuns([{ at, ok }], 5)              → { last, recent, okCount, failCount, streak }
//   statusOfBrain({ hasKey, probe, recent })    → { status, label }
// なぜ要るか: 無料枠切れ・残高切れ・鍵の拒否・通信不能は対処がそれぞれ違う(切り替え先・待った方がいい・
//   鍵を入れ直す)。症状ごとに分けないと同じ失敗した頭脳に仕事を投げ続ける。依存ゼロ・fs/ネットワークに
//   触れない純関数にしているので、単体テストで全分岐を実際に確認でき、将来の別エントリから再利用できる。
//   鍵などの秘密は引数に渡らず、結果にも載せない設計。
const QUOTA_WORDS = /insufficient_quota|Free quota|exhausted|Payment Required|quota exceeded|RESOURCE_EXHAUSTED/i;
const QUOTA_STATUSES = new Set([402, 403, 429]);
const RUN_LOG_NAME = /^(\d{8})-(\d{6})-([A-Za-z0-9-]+)\.log$/;
const PROBE_STATUS = {
  ok: { status: 'ok', label: '使える' },
  quota: { status: 'quota', label: '無料枠が切れている' },
  rate: { status: 'rate', label: '混み合っている(少し待てば使える)' },
  badkey: { status: 'badkey', label: '鍵が通らない' },
  down: { status: 'down', label: 'つながらない' },
};

/** 1トークンの探りリクエストの結果を分類する。error(通信失敗・タイムアウト)が最優先で "down"。 */
export function classifyHttp({ status, bodyText, error } = {}) {
  if (error) return 'down';
  const s = Number(status);
  if (Number.isInteger(s) && s >= 200 && s <= 299) return 'ok';
  const hasQuotaWords = typeof bodyText === 'string' && QUOTA_WORDS.test(bodyText);
  if (hasQuotaWords && QUOTA_STATUSES.has(s)) return 'quota';
  if (s === 429) return 'rate';
  if (s === 401 || s === 403) return 'badkey';
  return 'down';
}

/** 実行ログ名 `YYYYMMDD-HHMMSS-<brain>.log`(時刻はローカル)を { at: ISO(UTC), brain } へ。形式違い・暦として成立しない日は null。 */
export function parseRunLogName(name, tzOffsetMin = 540) {
  if (typeof name !== 'string') return null;
  const m = RUN_LOG_NAME.exec(name);
  if (!m) return null;
  const y = Number(m[1].slice(0, 4));
  const mo = Number(m[1].slice(4, 6));
  const da = Number(m[1].slice(6, 8));
  const h = Number(m[2].slice(0, 2));
  const mi = Number(m[2].slice(2, 4));
  const se = Number(m[2].slice(4, 6));
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59 || se > 59) return null;
  if (Date.UTC(y, mo - 1, da) >= Date.UTC(y, mo, 1)) return null; // 2/31 等の実在しない日
  const at = new Date(Date.UTC(y, mo - 1, da, h, mi, se) - tzOffsetMin * 60000).toISOString();
  return { at, brain: m[3] };
}

/** 実行ログ本文に失敗の合図(failMarks)が1つでも含まれていれば true。大文字小文字を区別する。 */
export function logLooksFailed(text, failMarks) {
  if (typeof text !== 'string' || text.length === 0) return false;
  if (!Array.isArray(failMarks)) return false;
  return failMarks.some((mark) => typeof mark === 'string' && mark.length > 0 && text.includes(mark));
}

/** 成否履歴(at 昇順/順不同)を新しい順に整えてまとめる。failCount は recent の中での数。okCount は全件。 */
export function summarizeRuns(entries, max = 5) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { last: null, recent: [], okCount: 0, failCount: 0, streak: null };
  }
  const sorted = [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const last = sorted[0];
  const recent = sorted.slice(0, max);
  const okCount = entries.filter((e) => e.ok === true).length;
  const failCount = recent.filter((e) => e.ok === false).length;
  const streak = { ok: last.ok, count: 0 };
  for (const e of sorted) {
    if (e.ok === last.ok) streak.count += 1;
    else break;
  }
  return { last, recent, okCount, failCount, streak };
}

/** 頭脳1つ分の「いま使えるか」を { status, label } で返す。優先順: 鍵未設定 → 探り結果 → 直近の実行履歴。 */
export function statusOfBrain({ hasKey, probe, recent } = {}) {
  if (!hasKey) return { status: 'nokey', label: '鍵が未設定' };
  if (probe && PROBE_STATUS[probe]) return { ...PROBE_STATUS[probe] };
  if (recent && recent.last) {
    return recent.last.ok
      ? { status: 'ok', label: '直近の実行は成功' }
      : { status: 'degraded', label: '直近の実行は失敗' };
  }
  return { status: 'unknown', label: 'まだ実行の記録がない' };
}
