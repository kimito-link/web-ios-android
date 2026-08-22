/**
 * improvement-metrics.mjs — ★このキット自身が見る指標の宣言。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜキット自身に入れるのか（2026-08-23）
 *   台帳を「配る」だけで「自分では使わない」と、★入口が無いまま死ぬ。
 *   このリポには前科がある:
 *     instrument-core.mjs … ★同梱済みだったのに入口が表の1行だけだった
 *     diagChannelRegistry … 配った → ★3ヶ月で登録1件のまま死んだ
 *   ★配る側が自分で使っていない仕組みは、渡された側も使わない。
 *
 * ■ ★ここに書いてよいのは【実測した】指標だけ
 *   下の3つは 2026-08-23 に実際にコマンドを走らせて数えた値のみ。
 *   ★実測せずに方向(better)を宣言すると、正しくない向きを機械で固定し、
 *     ★正しく直した人を「退化させた」と誤判定して止めることになる。
 *
 * ■ ★自動で測ってよいのは「リポの中だけで完結する」指標だけ
 *   ✅ ファイル数・検査の本数 … 毎回同じ条件で測れる
 *   ★実機の速度・通信          … 版ごとに条件が変わる ＝ 比べてはいけない
 * ───────────────────────────────────────────────────────────────────────────
 */

/**
 * @typedef {object} MetricSpec
 * @property {string} id
 * @property {string} label
 * @property {'lower'|'higher'} better ★どちらが良いか。数字から推測しない
 * @property {string} unit
 * @property {string} [why]
 * @property {object} [auto] リポ内だけで機械が測れるときの測り方
 */

/** @type {ReadonlyArray<MetricSpec>} */
export const IMPROVEMENT_METRICS = Object.freeze([
  Object.freeze({
    id: 'diagnostics-checks',
    label: '診断キットの検査本数',
    better: 'higher',
    unit: '本',
    why: '★0本でも「全チェック緑」と言えてしまう時期があった（run.mjs が skip を緑に数えていた）。'
       + '本数が減ったら、配っている検査が静かに消えたということ。',
    auto: { kind: 'file-count', glob: 'templates/diagnostics/check-*.mjs' }
  }),
  Object.freeze({
    id: 'selftest-missing-scripts',
    label: 'selftest を持たない配布スクリプト',
    better: 'lower',
    unit: '本',
    why: '★毒を入れても赤くならない検査は、静かに全部通す。'
       + '2026-08-23 実測で templates/scripts に 8本（上限3を超過）。減らしていく対象。'
  }),
  Object.freeze({
    id: 'selftest-missing-diagnostics',
    label: 'selftest を持たない診断キットの検査',
    better: 'lower',
    unit: '本',
    why: '同上。診断キット側は 2026-08-23 実測で 3本（上限3・ちょうど）。'
       + '★新しい検査に selftest を付け忘れると、ここが増えて気づける。'
  })
]);
