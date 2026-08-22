#!/usr/bin/env node
/**
 * check-improvement.mjs — ★版ごとの実測値が【退化】していないか見張る門番。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ 何をするか
 *   台帳（improvement-history.mjs）の実測値を古い順に見て、
 *   ★**過去最良より悪い値**が現れたら赤にする。
 *   ★直前の版とだけ比べない（じわじわ悪化して元に戻るのを見逃すため）。
 *
 * ■ ★3値で答える（この土台の規約）
 *   0 = 合格 / 1 = 測れた上での赤 / ★2 = 測れなかった（緑ではない）
 *
 *   ★「いまの版が台帳に無い」は **2**（fail ではない）:
 *     記録し忘れは【測っていない】のであって【悪化した】のではない。
 *     ★ここを赤にすると、面倒なときに "とりあえずの嘘の数字" を入れる動機を作る。
 *     ★嘘の数字が入った台帳は、無い方がマシ。
 *
 * ■ ★この門番が死ぬのは「値が悪化したとき」ではなく「走らなかったとき」
 *   実損（soushin-suggest.link・2026-08）:
 *     8/8  実測25を24と書き、★8日間ラチェットが赤のまま
 *     8/17 コミット時に走らせ忘れ、★また赤のまま
 *   ★どちらも「退化」ではなく★**検査が走っていなかった**。
 *   → ★それを見る係は別にいる: `check-instrument-ran.mjs`（4つ目の状態）。
 *
 * ■ 使い方
 *   node scripts/check-improvement.mjs              一覧
 *   node scripts/check-improvement.mjs --check      ★退化があれば exit 1
 *   node scripts/check-improvement.mjs --selftest   ★毒を入れて赤くなるか確認
 *   node scripts/check-improvement.mjs --submission 申請用の1枚を出す
 *
 * ■ ★配線（新しいアプリに入れるとき）
 *   1. `improvement-history.mjs` と `improvement-metrics.mjs` を作る（雛形あり）
 *   2. package.json に:
 *        "improvement": "node scripts/check-improvement.mjs",
 *        "check:improvement": "node scripts/check-improvement.mjs --check",
 *        "check:improvement:selftest": "node scripts/check-improvement.mjs --selftest"
 *   3. ★指標テーブルは**空で始める**。実測してから足す。
 * ───────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  detectRegressions,
  buildSubmissionSummary,
  formatImprovementLine,
  undeclaredRows
} from './lib/improvement-ledger.mjs';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const CHECK = process.argv.includes('--check');
const SELFTEST = process.argv.includes('--selftest');
const SUBMISSION = process.argv.includes('--submission');

/* ── --selftest: ★自前の表を注入して自分を試す ──────────────────────
 *
 * ★なぜ自前の表を作るのか（★これが移植時に見つけた実損）
 *   収穫元 tsuioku の selftest は**アプリの指標名**（diag-ms 等）を直書きしていた。
 *   キットは指標テーブルを★空で配るので、そのまま持ってくると:
 *     未宣言の指標 → detectRegressions() は判定せず [] を返す
 *     → 3つ目のケース（改善を退化と誤判定しない＝length===0 で合格）が
 *       ★**一度も判定していないのに緑**になる。
 *   ＝ 掟⑤「測れなかったを判定式に素通しさせない」と同型。
 *   ★実測で確認済み（2026-08-22・未宣言の 5→900 で検知0件）。
 *   → ★selftest は自分の表を持つ。アプリの表が空でも検知器の生死を判定できる。
 * ─────────────────────────────────────────────────────────────── */
if (SELFTEST) {
  /** ★selftest 専用の表（アプリの表には一切依存しない）。 */
  const T = Object.freeze([
    Object.freeze({ id: 'sf-lower', label: '小さいほど良い指標', better: 'lower', unit: 'ms' }),
    Object.freeze({ id: 'sf-higher', label: '大きいほど良い指標', better: 'higher', unit: '回' })
  ]);

  const { ok, fails } = runSelfTest([
    {
      name: '退化の検知',
      poison: () => {}, restore: () => {},
      isRed: () => detectRegressions(
        [{ version: 'a', metric: 'sf-lower', value: 5 }, { version: 'b', metric: 'sf-lower', value: 900 }], T
      ).length > 0
    },
    {
      name: '方向の宣言(大きいほど良い指標)',
      // ★「小さいほど良い」と決め打っていたら、これが赤にならない。
      poison: () => {}, restore: () => {},
      isRed: () => detectRegressions(
        [{ version: 'a', metric: 'sf-higher', value: 13 }, { version: 'b', metric: 'sf-higher', value: 2 }], T
      ).length > 0
    },
    {
      name: '改善を退化と誤判定しない',
      poison: () => {}, restore: () => {},
      // ★ここだけ「赤にならないこと」が合格なので反転して渡す。
      // ★★ただし「判定した上で退化なし」であることを先に確かめる（未宣言で0件＝偽の緑を弾く）。
      isRed: () => {
        const judged = formatImprovementLine({ metric: 'sf-lower', before: 100, after: 0 }, T);
        if (!judged.includes('改善')) return false; // ★判定できていないなら合格を名乗らせない
        return detectRegressions(
          [{ version: 'a', metric: 'sf-lower', value: 100 }, { version: 'b', metric: 'sf-lower', value: 0 }], T
        ).length === 0;
      }
    },
    {
      name: '★未宣言の指標を「退化なし」と読まない',
      poison: () => {}, restore: () => {},
      // ★移植時に実際に踏んだ穴。表に無い指標は判定不能であって合格ではない。
      isRed: () => {
        const rows = [{ version: 'a', metric: 'nope', value: 5 }, { version: 'b', metric: 'nope', value: 900 }];
        return detectRegressions(rows, T).length === 0 && undeclaredRows(rows, T).length === 2;
      }
    },
    {
      name: '★理由を書いても過去最良は緩まない',
      poison: () => {}, restore: () => {},
      // ★規約④のC: 一度許した後にさらに悪化したら、比較対象は【許した値】ではなく【過去最良】。
      isRed: () => detectRegressions([
        { version: 'a', metric: 'sf-lower', value: 100 },
        { version: 'b', metric: 'sf-lower', value: 200, note: '機能を足したので許容' },
        { version: 'c', metric: 'sf-lower', value: 300 }
      ], T).some((r) => r.version === 'c' && r.best === 100)
    }
  ]);

  if (!ok) {
    console.error('[check-improvement] ★selftest 失敗(検知器が効いていません):');
    for (const f of fails) console.error('  - ' + f);
    process.exit(EXIT.FAIL);
  }
  console.log('[check-improvement] selftest OK(退化を検知 / 方向を取り違えない / ★未宣言を緑にしない / ★ラチェットが緩まない)');
  process.exit(EXIT.PASS);
}

/* ── 台帳とテーブルを読む（★無いなら「測れなかった」＝2） ────────────── */
async function load() {
  const histPath = join(ROOT, 'scripts/improvement-history.mjs');
  const metricsPath = join(ROOT, 'scripts/improvement-metrics.mjs');
  if (!existsSync(histPath) || !existsSync(metricsPath)) {
    return { missing: [histPath, metricsPath].filter((p) => !existsSync(p)) };
  }
  const h = await import('file://' + histPath.split('\\').join('/'));
  const m = await import('file://' + metricsPath.split('\\').join('/'));
  return {
    history: Array.isArray(h.IMPROVEMENT_HISTORY) ? h.IMPROVEMENT_HISTORY : [],
    metrics: Array.isArray(m.IMPROVEMENT_METRICS) ? m.IMPROVEMENT_METRICS : []
  };
}

const loaded = await load();

if (loaded.missing) {
  // ★測れなかった。緑にしない。
  console.log(formatProbeReport([{
    probe: '改善記録', verdict: 'inconclusive', evidence: null,
    detail: `台帳がありません: ${loaded.missing.map((p) => p.replace(ROOT, '').replace(/^[\\/]+/, '')).join(', ')}`,
    howToFix: 'キットの templates/scripts/improvement-history.mjs と improvement-metrics.mjs をコピーする'
  }], { label: 'check-improvement' }));
  process.exit(EXIT.INCONCLUSIVE);
}

const { history, metrics } = loaded;

if (SUBMISSION) {
  /* ★申請用: 同じ指標の連続する2点を before→after に組み立てる。 */
  const byMetric = new Map();
  const entries = [];
  for (const r of history) {
    const prev = byMetric.get(r.metric);
    if (prev) entries.push({ version: r.version, metric: r.metric, before: prev.value, after: r.value, note: r.note });
    byMetric.set(r.metric, r);
  }
  console.log(buildSubmissionSummary(entries, metrics));
  process.exit(EXIT.PASS);
}

/**
 * ★いまの版が台帳に1件も無いか。
 * ★fail ではなく inconclusive にする（記録し忘れは【測っていない】であって【悪化】ではない）。
 */
function currentVersionUnrecorded() {
  const pkgPath = join(ROOT, 'package.json');
  if (!existsSync(pkgPath)) return null; // ★版が分からないなら、この観点では判定しない
  const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  if (!version) return null;
  return history.some((r) => String(r?.version || '') === version) ? null : version;
}

const undeclared = undeclaredRows(history, metrics);
const unrecorded = currentVersionUnrecorded();
const regressions = detectRegressions(history, metrics);

if (!CHECK) {
  console.log(`[check-improvement] 実測値 ${history.length} 件 / 指標 ${metrics.length} 種`);
  const byMetric = new Map();
  for (const r of history) {
    const prev = byMetric.get(r.metric);
    if (prev) console.log('  ' + formatImprovementLine({ metric: r.metric, before: prev.value, after: r.value }, metrics) + `  (${r.version})`);
    byMetric.set(r.metric, r);
  }
  process.exit(EXIT.PASS);
}

/* ── --check: 3値で答える ────────────────────────────────────── */
const results = [];
if (metrics.length === 0) {
  // ★表が空＝まだ何も宣言していない。★緑にしない（一度も判定していないため）。
  results.push({
    probe: '改善記録', verdict: 'inconclusive', evidence: null,
    detail: '指標が1つも宣言されていません（★何も判定していません）',
    howToFix: 'scripts/improvement-metrics.mjs に、実測した指標と【どちらが良いか(better)】を宣言する',
    limitation: '★宣言が無い状態では、退化しているかどうかは分かりません'
  });
} else if (history.length === 0) {
  results.push({
    probe: '改善記録', verdict: 'inconclusive', evidence: { 指標: metrics.length },
    detail: '実測値が1件もありません',
    howToFix: 'node scripts/record-improvement.mjs --auto を実行する'
  });
} else if (undeclared.length) {
  results.push({
    probe: '改善記録', verdict: 'fail',
    evidence: { 件数: history.length },
    detail: `宣言に無い指標が使われています: ${[...new Set(undeclared.map((r) => r.metric))].join(', ')}`,
    howToFix: 'improvement-metrics.mjs に、その指標と【どちらが良いか】を先に宣言する',
    limitation: '数字が正しいかは判定しません。出所(source)は人が確かめてください'
  });
} else if (regressions.length) {
  results.push({
    probe: '改善記録', verdict: 'fail',
    evidence: { 件数: history.length, 退化: regressions.length },
    detail: regressions
      .map((r) => `${r.version} の ${r.label} が ${r.value}(過去最良 ${r.best} @${r.bestVersion})`)
      .join(' / '),
    howToFix:
      '直すか、意図した変更なら improvement-history.mjs に【なぜ悪化してよいか】を note に書く'
      + '(★数字を消して隠さないこと。隠すと台帳の意味が無くなります)',
    limitation: '設計の良し悪しは判定しません。過去最良より悪くなったことに気づかせるだけです'
  });
} else if (unrecorded) {
  results.push({
    probe: '改善記録', verdict: 'inconclusive',
    evidence: { 件数: history.length, 未記録の版: unrecorded },
    detail: `いまの版 ${unrecorded} の実測値が台帳にありません（★悪化ではなく【測っていない】）`,
    howToFix: 'node scripts/record-improvement.mjs --auto を実行する（自動で測れる指標だけ入ります）',
    limitation: '★記録の有無だけを見ます。数字が正しいかは見ません'
  });
} else {
  results.push({
    probe: '改善記録', verdict: 'pass',
    evidence: { 件数: history.length, 指標: metrics.length, 退化: 0 },
    limitation: '★過去最良との比較だけを見ます。数字の出所(source)が正しいかは見ません'
  });
}

console.log(formatProbeReport(results, { label: 'check-improvement' }));
process.exit(computeExitCode(results));
