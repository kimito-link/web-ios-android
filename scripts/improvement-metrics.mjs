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
  /*
   * ★2026-08-28 の教訓（★一度「母集団が失われた」と誤判断しかけた）:
   *
   *   この指標を畳もうとした。理由は「8本という値を再現できない」——
   *   当時のファイルを★自分の素朴な数え方で数えたら 35本 になったから。
   *
   *   ★誤りだった。履歴の `source` に数え方が書いてあった:
   *     `check-selftest-coverage.mjs templates/scripts`
   *   そのとおりに走らせたら 8本 → 現在 1本。★7本の改善だった。
   *
   *   ⟹ ★source を読む前に「再現できない」と判断してはいけない。
   *     畳んでいたら、7本ぶんの改善の記録を自分の手で消していた。
   *   ⟹ だから ★auto を付ける。人が数え方を思い出さなくても機械が同じ物差しで測る。
   */
  Object.freeze({
    id: 'selftest-missing-scripts',
    label: 'selftest を持たない配布スクリプト',
    better: 'lower',
    unit: '本',
    why: '★毒を入れても赤くならない検査は、静かに全部通す。'
       + '2026-08-23 に 8本（上限3を超過）→ 減らしてきた対象。'
       + '★数え方の正本は check-selftest-coverage.mjs（母集団＝templates/scripts）。',
    auto: {
      kind: 'command-number',
      cmd: ['node', 'templates/diagnostics/check-selftest-coverage.mjs', 'templates/scripts', '--count']
    }
  }),
  Object.freeze({
    id: 'selftest-missing-diagnostics',
    label: 'selftest を持たない診断キットの検査',
    better: 'lower',
    unit: '本',
    why: '★毒を入れても赤くならない検査は、静かに全部通す。'
       + '★数え方の正本は check-selftest-coverage.mjs（ラチェット上限3）。'
       + '手で数えた値は母集団が再現できず比較不能になるため、必ず機械に数えさせる。',
    auto: {
      kind: 'command-number',
      cmd: ['node', 'templates/diagnostics/check-selftest-coverage.mjs', 'templates/diagnostics', '--count']
    }
  }),
  Object.freeze({
    id: 'drift-unregistered',
    label: '割れ検査に登録されていない実体',
    better: 'lower',
    unit: '本',
    why: '★配ったのに割れ検査の表に無い実体は、割れても永久に鳴らない。'
       + '2026-08-28 実測で 22本が未登録だった（手作業の調査では3本しか見つけられなかった）。'
       + '★うちキット自身のコピーが古い土台のまま止まり、それを4本の検査が使っていた。'
       + '数え方の正本は check-drift-coverage.mjs。',
    auto: {
      kind: 'command-number',
      cmd: ['node', '_docs/instruments/check-drift-coverage.mjs', '--count']
    }
  })
]);
