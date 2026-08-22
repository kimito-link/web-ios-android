/**
 * improvement-ledger.mjs — ★版ごとの実測値を「改善/退化」で判定する土台（キット同梱・依存ゼロ・純Node）。
 *
 * ★このファイル1つをコピーすれば、web-ios-androidキットを使っていない
 *   他のプロジェクトでもそのまま動く（外部ライブラリへの依存なし）。
 *   取得先: https://github.com/kimito-link/web-ios-android/blob/main/templates/scripts/lib/improvement-ledger.mjs
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★何を解決するか
 *   バージョンを重ねても「良くなった」と★数字で言い切れない問題。
 *   さらに悪いのは★**静かに元へ戻る**こと。1版ごとの悪化は小さいので、
 *   隣同士を比べているかぎり誰も気づけない。
 *
 *   実データ（`tsuioku-no-kirameki.com` の changelog **1,349版**）:
 *     数字を含む版は 390(29%)、うち before→after の形は **18版**だけ。
 *     ＝ 文章しか無く、「軽くしました」を後から検算できなかった。
 *
 * ■ ★設計の要（実データが設計をひっくり返した）
 *   その18件のうち3件は★**小さいほど良い、ではなかった**:
 *     0.1.887  100% → 0%    ★改善（エラー率が消えた）
 *     0.1.1298 2回 → 13回    ★改善（描画が動くようになった）
 *     0.1.1102 3秒 → 12秒    ★改善（間引きを緩めて取りこぼしを無くした）
 *   ★「小さいほど良い」を既定にしていたら、この3件を全部「退化」と誤判定していた。
 *   ＝ ★**正しく直した人を止める**。検査への信頼は一度で消える。
 *   → 方向(better)は★指標ごとに宣言する。★数字から推測しない。
 *
 * ■ ★汎用とアプリ固有の境目（ここを間違えると死ぬ）
 *   ★汎用      … 判定のやり方（このファイル）
 *   ★アプリごと … ★どの指標を、どちらが良いとして測るか（呼び手が渡す）
 *   「バンドルの大きさ」は多くのアプリで意味を持つが、
 *   「コメントの遅れ」は特定のアプリだけのもの。★汎用にすべきは判定であって指標ではない。
 *
 * ■ ★指標テーブルは【引数で受け取る】（このファイルは表を持たない）
 *   ★収穫元 `tsuioku` では表がこのファイルに直書きされていた。それをキットへ
 *   そのまま持ってくると、★全アプリがニコ生の指標を配られることになる。
 *
 *   ★さらに実損として、**selftest が表に依存すると空の表で偽の緑になる**:
 *     未宣言の指標は判定対象外 → detectRegressions() が [] を返す
 *     → 「退化なし＝合格」と読めてしまうが、真実は★「一度も判定していない」
 *   ＝ 掟⑤「測れなかったを判定式に素通しさせない」と同型の穴。
 *   ★移植時に実測で確認済み（2026-08-22・未宣言の 5→900 で検知0件）。
 *   → ★表は必ず外から渡す。selftest は★自前の表を注入して自分を試す。
 *
 * ■ 掟
 *   ・★測れていないものを「改善」と言わない（根拠なき緑を作らない）
 *   ・★未宣言の指標は unknown。勝手に方向を決めない
 *   ・★申請文には根拠のある項目だけ載せる（載せると嘘になる）
 * ───────────────────────────────────────────────────────────────────────────
 */

/**
 * @typedef {object} MetricSpec
 * @property {string} id 指標のID(主キー)
 * @property {string} label 人が読む名前
 * @property {'lower'|'higher'} better ★どちらが良いか。数字から推測しない
 * @property {string} unit 単位
 * @property {string} [why] なぜこの指標を見るのか(実損の記録)
 */

/**
 * ★あなたのアプリの指標テーブルの雛形。**空で始める**。
 *
 * ★実測してから足す。実測せずに方向を宣言すると、
 *   ★正しくない向きを機械で固定することになる。
 *   (`soushin-suggest.link` が boundaries.psd1 の Higher = @() を
 *    空で始めたのと同じ理由。★所有を先に宣言すると、後で人を止める。)
 *
 * @type {ReadonlyArray<MetricSpec>}
 */
export const EMPTY_METRICS = Object.freeze([]);

/**
 * ★渡された表を引く。表を持たないのがこのファイルの設計。
 * @param {ReadonlyArray<MetricSpec>|null|undefined} metrics
 * @param {string} id
 * @returns {MetricSpec|null}
 */
function specOf(metrics, id) {
  if (!Array.isArray(metrics)) return null;
  return metrics.find((m) => m && String(m.id) === id) || null;
}

/**
 * ★数値だけ受ける。Number(null)===0 の穴を塞ぐ。
 *
 * ★収穫元 tsuioku はこの穴を**1日に4回**踏んだ（毎回テストが先に発見）。
 * ★逆向きの穴も実在する（soushin: -1(測れなかった) が -le 0 を通り★偽の赤）。
 *   ＝ 同じ穴が「偽の緑」と「偽の赤」の両方向に開く。
 *
 * @param {unknown} v @returns {number|null}
 */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * @typedef {object} ImprovementVerdict
 * @property {'improved'|'regressed'|'same'|'unknown'} direction
 * @property {string} line 人が読む1行
 * @property {MetricSpec|null} spec
 */

/**
 * before→after が改善か退化かを判定する。
 * ★方向は必ず渡された宣言テーブルから取る（数字から推測しない）。
 *
 * @param {{ metric?: string, before?: unknown, after?: unknown }} input
 * @param {ReadonlyArray<MetricSpec>} metrics ★アプリごとの宣言テーブル
 * @returns {ImprovementVerdict}
 */
export function judgeImprovement(input, metrics) {
  const spec = specOf(metrics, String(input?.metric || ''));
  if (!spec) {
    return {
      direction: 'unknown',
      spec: null,
      line: `⚪ ${String(input?.metric || '(無名)')}: 未宣言の指標(改善か退化か判定できません)`
    };
  }
  const before = num(input?.before);
  const after = num(input?.after);
  if (before === null || after === null) {
    // ★測れていないものを改善と言わない。
    return { direction: 'unknown', spec, line: `⚪ ${spec.label}: 測れていません(改善とも退化とも言えません)` };
  }
  if (before === after) {
    return { direction: 'same', spec, line: `⚪ ${spec.label}: 変化なし(${after}${spec.unit})` };
  }
  const wentDown = after < before;
  const improved = spec.better === 'lower' ? wentDown : !wentDown;
  const arrow = `${before}${spec.unit} → ${after}${spec.unit}`;
  return improved
    ? { direction: 'improved', spec, line: `✅ ${spec.label}: ${arrow} 改善` }
    : { direction: 'regressed', spec, line: `🔴 ${spec.label}: ${arrow} ★退化` };
}

/**
 * 人が読む1行。
 * @param {{ metric?: string, before?: unknown, after?: unknown }} input
 * @param {ReadonlyArray<MetricSpec>} metrics
 * @returns {string}
 */
export function formatImprovementLine(input, metrics) {
  return judgeImprovement(input, metrics).line;
}

/**
 * ★版をまたいで「過去最良より悪くなった版」を名指しする。
 *
 * ★これが「退化させない」の芯。★直前の版とだけ比べない:
 *     1 → 2 → 3 → 4   隣同士は毎回「+1」なので小さく見える
 *                     ★過去最良(1)と比べれば 4 は明確に退化
 *
 * ★note で「なぜ悪化してよいか」を書いた行は退化として数えない。
 *   ★ただし過去最良は更新しない（悪い方を新しい基準にしない）＝ラチェットは緩まない。
 *   ★このキットで生き残った仕掛けは全部この形（ベースライン＋ラチェット）。
 *   ★数字を消させるのではなく【理由を書かせる】のが要。台帳に事実は残る。
 *
 * @param {ReadonlyArray<{version?:string, metric?:string, value?:unknown, note?:string}>|null|undefined} history
 * @param {ReadonlyArray<MetricSpec>} metrics
 * @returns {{version:string, metric:string, label:string, value:number, best:number, bestVersion:string}[]}
 */
export function detectRegressions(history, metrics) {
  if (!Array.isArray(history)) return [];
  /** @type {Map<string, {best:number, version:string}>} */
  const best = new Map();
  /** @type {{version:string, metric:string, label:string, value:number, best:number, bestVersion:string}[]} */
  const out = [];

  for (const raw of history) {
    const row = raw && typeof raw === 'object' ? raw : {};
    const spec = specOf(metrics, String(row.metric || ''));
    const value = num(row.value);
    if (!spec || value === null) continue; // ★測れていない行は判定しない
    const version = String(row.version || '');
    const prev = best.get(spec.id);
    if (!prev) { best.set(spec.id, { best: value, version }); continue; }

    const accepted = typeof row.note === 'string' && row.note.trim() !== '';
    const isBetter = spec.better === 'lower' ? value < prev.best : value > prev.best;
    if (isBetter) { best.set(spec.id, { best: value, version }); continue; }
    if (value !== prev.best && !accepted) {
      out.push({ version, metric: spec.id, label: spec.label, value, best: prev.best, bestVersion: prev.version });
    }
  }
  return out;
}

/**
 * ★宣言に無い指標を使っている行を返す（＝方向が決まらない＝判定不能）。
 *
 * ★これが無いと、指標名を打ち間違えた行が★黙って判定対象外になる。
 *   ＝ 掟①「名前だけを見る検査は、名前を変えて黙らせることを誘う」の裏返し。
 *
 * @param {ReadonlyArray<{metric?:string}>|null|undefined} history
 * @param {ReadonlyArray<MetricSpec>} metrics
 * @returns {{metric?:string}[]}
 */
export function undeclaredRows(history, metrics) {
  if (!Array.isArray(history)) return [];
  const known = new Set((Array.isArray(metrics) ? metrics : []).map((m) => String(m?.id)));
  return history.filter((r) => !known.has(String(r?.metric || '')));
}

/**
 * ★申請(ストア審査)に出せる1枚を作る。
 * ★根拠のある項目だけ載せる。測っていないものを「良くなりました」と書くと嘘になる。
 *
 * @param {ReadonlyArray<{version?:string, metric?:string, before?:unknown, after?:unknown, note?:string}>|null|undefined} entries
 * @param {ReadonlyArray<MetricSpec>} metrics
 * @returns {string}
 */
export function buildSubmissionSummary(entries, metrics) {
  const rows = Array.isArray(entries) ? entries : [];
  const lines = [];
  lines.push('# 改善の記録（実測値）');
  lines.push('');
  lines.push('> 各行は「何を・どこから・どこまで」測った実測値です。');
  lines.push('> ★測れていない項目は載せていません（推定値・体感は含みません）。');
  lines.push('');

  /** @type {string[]} */
  const body = [];
  for (const raw of rows) {
    const row = raw && typeof raw === 'object' ? raw : {};
    const v = judgeImprovement(row, metrics);
    // ★根拠が無い/退化している項目は申請文に載せない。
    if (v.direction !== 'improved' || !v.spec) continue;
    const before = num(row.before);
    const after = num(row.after);
    const note = row.note ? String(row.note) : '';
    body.push(`| ${String(row.version || '')} | ${v.spec.label} | ${before}${v.spec.unit} | ${after}${v.spec.unit} | ${note} |`);
  }

  if (body.length === 0) {
    lines.push('まだ実測値つきの改善記録がありません。');
    return lines.join('\n');
  }
  lines.push('| 版 | 何を測ったか | 前 | 後 | 内容 |');
  lines.push('|---|---|---|---|---|');
  lines.push(...body);
  return lines.join('\n');
}
