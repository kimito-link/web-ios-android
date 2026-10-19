// 役割: App Store Connect の審査状態が「前回確認したときから変わったか」を調べる純関数(asc-review-poll の P5)。
// なぜ要るか: 既存の poll は却下系の4状態しか見なかったため、「審査に入った」「承認された」「公開された」は通知されず、
//   2026-10-18 は人が2時間おきに同じ確認を繰り返す定期確認を手で組んだ。機械が知っていることを人・AIに再計算させない。
// 使い方: workflow(asc-review-poll.yml)が前回の状態(issue 本文の目印ブロック)と今の状態を渡し、返った events をコメントにする。
// 却下系(REJECTED 等)は既存の issue 作成の流れが担当するので、ここでは通知対象にしない(二重通知を避ける)。

const BLOCK_START = '<!-- asc-status:';
const BLOCK_END = ':asc-status -->';

// 通知する状態と、人間向けの言い方。
export const NOTIFY_STATES = Object.freeze({
  IN_REVIEW: { kind: 'in_review', label: '審査が始まりました' },
  PENDING_APPLE_RELEASE: { kind: 'approved', label: '承認されました（Apple のリリース待ち）' },
  PENDING_DEVELOPER_RELEASE: { kind: 'approved', label: '承認されました（開発者の手動リリース待ち）' },
  PROCESSING_FOR_APP_STORE: { kind: 'approved', label: '承認され、App Store へ反映中です' },
  READY_FOR_SALE: { kind: 'live', label: '公開されました（App Store で入手できます）' },
});

// 却下系・取り下げ系は既存の流れが扱う。
const HANDLED_ELSEWHERE = new Set(['REJECTED', 'METADATA_REJECTED', 'DEVELOPER_REJECTED', 'INVALID_BINARY']);

// issue 本文に埋め込む、前回の状態の目印ブロックを作る。states: [{ versionString, state, platform }]
export function renderStateBlock(states) {
  const map = {};
  for (const s of states) map[`${s.platform || 'IOS'}:${s.versionString}`] = s.state;
  return `${BLOCK_START}${JSON.stringify(map)}${BLOCK_END}`;
}

// issue 本文から前回の状態を取り出す。無い・壊れていれば null(=初回。通知せず基準だけ記録する)。
export function parseStateBlock(body) {
  const text = String(body ?? '');
  const a = text.indexOf(BLOCK_START);
  if (a < 0) return null;
  const b = text.indexOf(BLOCK_END, a);
  if (b < 0) return null;
  try {
    const v = JSON.parse(text.slice(a + BLOCK_START.length, b));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// prev: parseStateBlock の結果(null なら初回)。current: [{ versionString, state, platform }]。
// 返り値: events [{ key, versionString, platform, from, to, kind, label }]。
export function diffStates(prev, current) {
  if (prev === null) return [];
  const events = [];
  for (const s of current) {
    const key = `${s.platform || 'IOS'}:${s.versionString}`;
    const from = prev[key];
    if (from === s.state) continue;
    if (HANDLED_ELSEWHERE.has(s.state)) continue;
    const meta = NOTIFY_STATES[s.state];
    if (!meta) continue; // WAITING_FOR_REVIEW 等、通知するほどでない遷移は黙って状態だけ更新する
    events.push({ key, versionString: s.versionString, platform: s.platform || 'IOS', from: from ?? null, to: s.state, kind: meta.kind, label: meta.label });
  }
  return events;
}

// 終端か。全ての対象版が公開済み(READY_FOR_SALE)なら、監視用 issue を閉じてよい。
export function isSettled(current) {
  return current.length > 0 && current.every((s) => s.state === 'READY_FOR_SALE');
}
