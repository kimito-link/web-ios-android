/**
 * usage-history.mjs — Claude の使用量（5時間枠・週間枠）の履歴を、ダッシュボード用の
 * JSON に畳み込む純関数の集合。
 *
 * 役割: get_usage の出力を正規化（normalizeUsage）し、呼び出し毎のスナップショットを
 *   間引き・保持期間付きで履歴に畳み込む（mergeSnapshot）。加えて、現在のペースで
 *   枠を使い切れるかを見積もる（paceOf / statusOf）。
 *
 * 使い方:
 *   import { normalizeUsage, mergeSnapshot, paceOf, statusOf, WINDOW_MS } from "./usage-history.mjs";
 *   const snap  = normalizeUsage(getUsageの生出力);      // plan.status が "ok" でなければ null
 *   const saved = mergeSnapshot(前回保存済み内容またはnull, snap, Date.now());
 *   const pace  = paceOf(saved.current.windows.five, WINDOW_MS.five, Date.now());
 *   const state = statusOf(saved.current.windows.five, WINDOW_MS.five, Date.now());
 *
 * なぜ要るか: ダッシュボードは「今だけ」ではなく「ここ数日間の推移」を見せる必要が
 * ある一方、get_usage は即値しか返さない。都度呼び出しては保存・間引きを繰り返す履歴を、
 * 呼び出し側（ダッシュボード生成）が毎回別のロジックで書くのを防ぐため、ここに1本に置く。
 * 依存ゼロ・fs/ネットワーク非依存の純関数のみなので、呼び出し側は保存先（ファイル等）を
 * 決めて from/to の受け渡しだけで使える。
 */

/** label→キーの対応。未知の label は無視される（normalizeUsage 内）。 */
export const WINDOW_KEYS = Object.freeze({
  "5-hour limit": "five",
  "Weekly · all models": "weekly",
  "Weekly · Fable": "fable",
});

/** 各枠の長さ（ミリ秒）。枠の始まり = resetsAt - WINDOW_MS[key]。 */
export const WINDOW_MS = Object.freeze({
  five: 5 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  fable: 7 * 24 * 60 * 60 * 1000,
});

const DEFAULT_MIN_INTERVAL_MS = 20 * 60 * 1000; // 値が変わらなくてもこれ以上開いたら1点足す
const DEFAULT_KEEP_MS = 14 * 24 * 60 * 60 * 1000; // これより古い点は捨てる
const POINT_KEYS = ["five", "weekly", "fable"];

/**
 * get_usage の生出力を正規化する。
 * @param {object} raw get_usage の出力そのもの（{plan:{status,plan,windows,extraUsage},context}）
 * @returns {{plan:string, windows:object, extra:object, context:object}|null}
 *   plan.status が "ok" でなければ null。windows の各キーは {percentUsed:number, resetsAt:string}。
 *   未知 label・percentUsed が数値でない window は含めない。
 */
export function normalizeUsage(raw) {
  const plan = raw && raw.plan;
  if (!plan || plan.status !== "ok") return null;

  const windows = {};
  for (const w of plan.windows || []) {
    const key = w && WINDOW_KEYS[w.label];
    if (key === undefined) continue; // 未知の label は無視
    if (typeof w.percentUsed !== "number" || !Number.isFinite(w.percentUsed)) continue; // 数値以外を除く
    windows[key] = { percentUsed: w.percentUsed, resetsAt: w.resetsAt };
  }

  return {
    plan: plan.plan,
    windows,
    extra: plan.extraUsage,
    context: raw.context,
  };
}

/** スナップショットから履歴点 {five?, weekly?, fable?} の数値部分を取り出す。 */
function pointValues(snap) {
  const point = {};
  for (const k of POINT_KEYS) {
    const w = snap.windows[k];
    if (w) point[k] = w.percentUsed;
  }
  return point;
}

/** 2つの履歴点で five/weekly/fable のいずれかが違えば true（片方だけ無いのも変更と数える）。 */
function valuesChanged(a, b) {
  return POINT_KEYS.some((k) => a[k] !== b[k]);
}

/**
 * スナップショットを履歴に畳み込む。
 * @param {{updatedAt:string, current:object, history:object[]}|null} prev 前回の保存内容
 * @param {object|null} snap normalizeUsage の結果（null なら prev をそのまま返す）
 * @param {number} nowMs 現在時刻（ミリ秒）
 * @param {{minIntervalMs?:number, keepMs?:number}} [opts]
 *   minIntervalMs: 値が変わらなくてもこの間隔以上開いたら1点足す（既定 20分）
 *   keepMs: これより古い点を捨てる（既定 14日）
 * @returns {{updatedAt:string, current:object, history:object[]}}
 *   点 = {t:ISO, five?, weekly?, fable?}。t 昇順。
 */
export function mergeSnapshot(prev, snap, nowMs, opts = {}) {
  if (snap === null) return prev; // null のままなら null

  const minIntervalMs = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const keepMs = opts.keepMs ?? DEFAULT_KEEP_MS;
  const iso = new Date(nowMs).toISOString();
  const point = { t: iso, ...pointValues(snap) };

  let history = prev && Array.isArray(prev.history) ? prev.history.slice() : [];
  const last = history[history.length - 1];

  const changed = last === undefined || valuesChanged(last, point);
  const intervalElapsed = last === undefined || nowMs - Date.parse(last.t) >= minIntervalMs;
  if (changed || intervalElapsed) history.push(point);

  history = history
    .filter((p) => nowMs - Date.parse(p.t) <= keepMs)
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));

  return { updatedAt: iso, current: snap, history };
}

/**
 * 現在のペースでの枠残りの見積もり。
 * @param {{percentUsed:number, resetsAt:string}} window 正規化済みの1枠
 * @param {number} windowMs 枠の長さ（WINDOW_MS の値）
 * @param {number} nowMs 現在時刻（ミリ秒）
 * @returns {{elapsedPct:number, ratio:(number|null), projectedHitAt:(string|null)}}
 *   elapsedPct: 枠のうち経過した割合(%)。0〜100 に丸める。
 *   ratio: percentUsed / elapsedPct（elapsedPct が 1 未満なら null）。1 を超えると時間の割に使いすぎ。
 *   projectedHitAt: このペースで 100% に達する時刻(ISO)。
 *     ratio が null/0 以下、または枠の終わりより後に達するなら null。
 */
export function paceOf(window, windowMs, nowMs) {
  const resetsAtMs = Date.parse(window.resetsAt);
  const startMs = resetsAtMs - windowMs;
  const elapsedPct = Math.min(100, Math.max(0, ((nowMs - startMs) / windowMs) * 100));

  const ratio = elapsedPct >= 1 ? window.percentUsed / elapsedPct : null;

  let projectedHitAt = null;
  if (ratio !== null && ratio > 0) {
    const hitMs = startMs + (nowMs - startMs) * (100 / window.percentUsed);
    if (hitMs <= resetsAtMs) projectedHitAt = new Date(Math.round(hitMs)).toISOString();
  }

  return { elapsedPct, ratio, projectedHitAt };
}

/**
 * 枠の危険度を3分類する。
 * @param {{percentUsed:number, resetsAt:string}|null|undefined} window 正規化済みの1枠（無ければ "unknown"）
 * @param {number} windowMs 枠の長さ（WINDOW_MS の値）
 * @param {number} nowMs 現在時刻（ミリ秒）
 * @returns {"safe"|"watch"|"danger"|"unknown"}
 *   safe: ratio<=0.9 または projectedHitAt が null（＝このペースでは枠の終わりまでに届かない）
 *   watch: 0.9<ratio<=1.2
 *   danger: projectedHitAt が枠の終わりより前に来る かつ ratio>1.2
 */
export function statusOf(window, windowMs, nowMs) {
  if (!window) return "unknown";
  const { ratio, projectedHitAt } = paceOf(window, windowMs, nowMs);
  if (ratio === null || ratio <= 0.9 || projectedHitAt === null) return "safe";
  if (ratio <= 1.2) return "watch";
  return Date.parse(projectedHitAt) < Date.parse(window.resetsAt) ? "danger" : "safe";
}
