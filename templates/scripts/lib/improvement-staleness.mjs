/**
 * improvement-staleness.mjs — ★「その指標、いつから測っていないか」を数える（キット同梱・依存ゼロ・純Node）。
 *
 * ★このファイル1つをコピーすれば、web-ios-androidキットを使っていない
 *   他のプロジェクトでもそのまま動く（外部ライブラリへの依存なし）。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★何を解決するか（2026-08-22・実損から）
 *
 *   台帳(improvement-ledger)を入れても、★**手で書く指標は書き忘れた瞬間に死ぬ**。
 *
 *   実測（`tsuioku-no-kirameki.com`・台帳を入れて8日後）:
 *     診断の所要   … 最終記録が ★62版前
 *     パネル停止   … 最終記録が ★24版前
 *     他6種        … ★一度も記録が無い
 *     自動の2種    … 毎版（機械が書くので死なない）
 *   ⟹ ★10指標のうち【自動の2つしか動いていなかった】。
 *     その間に診断の所要は 29,303ms → 19ms と★1,500倍動いたのに、
 *     台帳には1件も残っていなかった。
 *
 *   ＝ 台帳は「改善している」と表示しながら、★**ほとんど何も測っていなかった**。
 *
 * ■ ★これは「オプトインの台帳は死ぬ」の再来
 *   人が書く前提の登録簿は、例外なく風化する
 *   （同リポの diagChannelRegistry は3ヶ月で登録1件のまま死んだ）。
 *
 * ■ ★どう解くか（強制しない・気づけるようにする）
 *   「書かないと赤」にすると★**嘘の数字が入る**（規約③と同じ理由。
 *   記録が面倒なときに「とりあえず埋める」動機を作ってしまう）。
 *   → ★**何版ぶん測っていないかを数えて見せるだけ**にする。
 *     数が増えるのが見えれば、忘れたことを忘れられない。
 *
 * ■ ★なぜ「一度も無い」と「古い」を分けるか
 *   一度も無い … まだ測る手段が無い/対象外かもしれない（★まだ分からない）
 *   古い       … ★測れるのに測っていない（放置されている）
 *   混ぜると優先順位が付けられない。
 *   ＝「無い」と「まだ分からない」を同じ扱いにしない、という同じ掟。
 * ───────────────────────────────────────────────────────────────────────────
 */

/**
 * ここを超えて記録が無ければ「放置されている」とみなす版数。
 *
 * ★調整してよい。目安は「自分たちが1〜2日で出す版数」。
 *   毎日5〜8版出すリポなら 10 前後、週1リリースなら 2〜3 が妥当。
 */
export const IMPROVEMENT_STALE_VERSIONS = 10;

/** @param {string} v @returns {number[]} */
function parseVersion(v) {
  return String(v || '')
    .split('.')
    .map((p) => Number(p))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

/**
 * 版の距離（何版ぶん離れているか）。
 * ★major/minor が違うときは patch 差で測れないので null（＝測れなかった）。
 *
 * @param {string} from @param {string} to
 * @returns {number|null}
 */
export function versionDistance(from, to) {
  const a = parseVersion(from);
  const b = parseVersion(to);
  if (a.length < 3 || b.length < 3) return null;
  if (a[0] !== b[0] || a[1] !== b[1]) return null;
  return Math.abs(b[2] - a[2]);
}

/**
 * @typedef {object} StalenessRow
 * @property {string} metric 指標ID
 * @property {string} label 人が読む名前
 * @property {'fresh'|'stale'|'never'} state ★never と stale を混ぜない
 * @property {string} lastVersion 最後に記録された版（'' なら一度も無い）
 * @property {number|null} behind 何版ぶん測っていないか（測れなければ null）
 */

/**
 * 指標ごとに「いつから測っていないか」を出す。
 *
 * ★fresh も返す。全体像（測れている数 / 全体）が見えないと判断できないため。
 *
 * @param {object} input
 * @param {readonly {id:string,label?:string}[]} input.metrics 宣言テーブル
 * @param {readonly {version:string,metric:string}[]} input.history 実測値の台帳
 * @param {string} input.currentVersion いまの版
 * @param {number} [input.staleAfter] 何版空いたら stale とするか
 * @returns {StalenessRow[]}
 */
export function analyzeImprovementStaleness(input) {
  const metrics = Array.isArray(input?.metrics) ? input.metrics : [];
  const history = Array.isArray(input?.history) ? input.history : [];
  const current = String(input?.currentVersion || '');
  const staleAfter =
    typeof input?.staleAfter === 'number'
    && Number.isFinite(input.staleAfter)
    && input.staleAfter > 0
      ? input.staleAfter
      : IMPROVEMENT_STALE_VERSIONS;

  return metrics.map((m) => {
    const id = String(m?.id || '');
    const label = String(m?.label || id);
    const rows = history.filter((r) => String(r?.metric || '') === id);
    if (rows.length === 0) {
      // ★「一度も無い」は放置とは限らない（まだ測る手段が無いかもしれない）
      return /** @type {StalenessRow} */ ({
        metric: id,
        label,
        state: 'never',
        lastVersion: '',
        behind: /** @type {number|null} */ (null)
      });
    }
    const lastVersion = String(rows[rows.length - 1]?.version || '');
    const behind = versionDistance(lastVersion, current);
    const state = behind !== null && behind > staleAfter ? 'stale' : 'fresh';
    return /** @type {StalenessRow} */ ({ metric: id, label, state, lastVersion, behind });
  });
}

/**
 * 人が読む形にする。★数を見せるだけで、書くことは強制しない。
 *
 * @param {StalenessRow[]} rows
 * @returns {string}
 */
export function formatImprovementStalenessLine(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return '改善記録の鮮度: 指標がまだ宣言されていません(空で始めるのが既定です)';

  const stale = list.filter((r) => r.state === 'stale');
  const never = list.filter((r) => r.state === 'never');
  const fresh = list.filter((r) => r.state === 'fresh');

  const head = `改善記録の鮮度: 測れている ${fresh.length} / ${list.length} 種`;
  if (stale.length === 0 && never.length === 0) return `${head} ✅`;

  const lines = [head];
  if (stale.length) {
    lines.push(
      `  🟡 ${stale.length}種が放置されています(測れるのに測っていない): `
      + stale.map((r) => `${r.label}(${r.behind}版前)`).join(' / ')
    );
  }
  if (never.length) {
    lines.push(
      `  ⚪ ${never.length}種は一度も記録がありません(★測る手段が無いだけかもしれません): `
      + never.map((r) => r.label).join(' / ')
    );
  }
  return lines.join('\n');
}
