#!/usr/bin/env node
/**
 * improvement-timeline.mjs — ★「何が起きて・何をして・数字がどう動いたか」を時系列で出す。
 *
 * ─────────────────────────────────────────────────
 * ■ 何をするか
 *   実測値の台帳（scripts/improvement-history.mjs）の各行について、
 *     ① その行を台帳に書き足したコミット（= その数字を測ったときの変更）を git から逆引きし、
 *     ② 前回の測定〜今回の測定の間にやったこと（コミットの題）を並べ、
 *     ③ 前後の数字を、宣言された「どちらが良いか」で 改善／悪化／変化なし に判定する。
 *   ★台帳のスキーマは変えない（配布先のコピーを更新しなくて済む）。純ロジックは
 *     lib/improvement-timeline.mjs（依存ゼロ・improvement-ledger.mjs だけに依存）。
 *
 * ■ ★言わないこと（過信を防ぐ）
 *   ・「やったこと」の全部が原因とは限らない（★相関であって因果の証明ではない）。
 *   ・コミットを特定できない行（未コミット・git なし）は、変更を推測で割り当てず理由を出す。
 *   ・指標が未宣言／測れていない行は「改善」とも「悪化」とも言わない。
 *
 * ■ 使い方
 *   node scripts/improvement-timeline.mjs                 # Markdown を標準出力へ
 *   node scripts/improvement-timeline.mjs --metric <id>   # 1指標だけ
 *   node scripts/improvement-timeline.mjs --limit 10      # 各指標の直近10件
 *   node scripts/improvement-timeline.mjs --json          # 機械可読
 *   node scripts/improvement-timeline.mjs --selftest      # 毒→赤／正→緑
 *
 * ■ 終了コード（3値の掟）: 0 = 出せた / 1 = selftest 失敗 / 2 = 測れなかった（台帳が無い等）
 *   ★「悪化があった」では赤にしない。これは見せる道具で、止める門番は check-improvement.mjs。
 * ─────────────────────────────────────────────────
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXIT, runSelfTest } from './lib/instrument-core.mjs';
import { buildTimeline, parseIntroducedRows, renderTimelineMarkdown } from './lib/improvement-timeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const HISTORY = join(ROOT, 'scripts/improvement-history.mjs');
const METRICS = join(ROOT, 'scripts/improvement-metrics.mjs');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };

function gitText(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

/** 台帳の各行を最初に書き足したコミット。git が使えなければ null（★推測しない）。 */
function loadIntroduced() {
  try {
    const rel = relative(ROOT, HISTORY).split('\\').join('/');
    return parseIntroducedRows(gitText(['log', '--reverse', '--format=%x1e%H%x1f%aI%x1f%s', '-p', '--', rel]));
  } catch {
    return null;
  }
}

/** from の次〜to までのコミットの題（マージは除く）。 */
function changesBetween(from, to) {
  try {
    return gitText(['log', '--no-merges', '--format=%s', `${from}..${to}`]).split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/* ── --selftest: ★純ロジックに毒を入れ、検知が効くことを確認する ─────────── */
if (has('--selftest')) {
  const M = [
    { id: 'lo', label: '小さいほど良い', better: 'lower', unit: 'ms' },
    { id: 'hi', label: '大きいほど良い', better: 'higher', unit: '件' }
  ];
  const c = (n) => ({ sha: n.repeat(40).slice(0, 40), short: n.repeat(7), date: '2026-10-16T00:00:00+09:00', subject: 'コミット' + n });
  const commits = { 'v1\u0000lo': c('a'), 'v2\u0000lo': c('b'), 'v3\u0000lo': c('c') };
  const commitOf = (v, m) => commits[`${v}\u0000${m}`] || null;
  const between = (f, t) => ['変更:' + f.slice(0, 1) + '→' + t.slice(0, 1)];
  const hist = (rows) => rows.map(([version, metric, value, extra]) => ({ version, metric, value, source: 's', ...(extra || {}) }));
  const run = (rows, withCommits = true) => buildTimeline({
    history: hist(rows), metrics: M,
    commitOf: withCommits ? commitOf : undefined, changesBetween: withCommits ? between : undefined
  });
  const dir = (tl, i = 1) => tl.metrics[0].entries[i].direction;
  const noop = () => {};

  const { ok, fails } = runSelfTest([
    { name: '★小さいほど良い指標の増加を「悪化」と判定する', poison: noop, restore: noop,
      isRed: () => dir(run([['v1', 'lo', 5], ['v2', 'lo', 9]])) === 'regressed' },
    { name: '★「大きいほど良い」の増加を悪化と誤判定しない（宣言から向きを取る）', poison: noop, restore: noop,
      isRed: () => dir(run([['v1', 'hi', 5], ['v2', 'hi', 9]])) === 'improved' },
    { name: '★理由(note)つきの悪化は許容として印を付け、悪化は悪化のまま数える', poison: noop, restore: noop,
      isRed: () => { const tl = run([['v1', 'lo', 5], ['v2', 'lo', 9, { note: '機能を足したため' }]]); const e = tl.metrics[0].entries[1]; return e.direction === 'regressed' && e.accepted === true && tl.summary.accepted === 1; } },
    { name: '★コミットを特定できない行に、変更を推測で割り当てない', poison: noop, restore: noop,
      isRed: () => { const e = run([['v1', 'lo', 5], ['v9', 'lo', 4]], true).metrics[0].entries[1]; return e.traceable === false && e.changes.length === 0; } },
    { name: '★未宣言の指標は「判定できず」（勝手に方向を決めない）', poison: noop, restore: noop,
      isRed: () => { const tl = buildTimeline({ history: hist([['v1', 'zz', 1], ['v2', 'zz', 9]]), metrics: M }); return tl.metrics[0].entries[1].direction === 'unknown'; } },
    { name: '★測れていない(null)行は載せない（0として扱わない）', poison: noop, restore: noop,
      isRed: () => run([['v1', 'lo', 5], ['v2', 'lo', null], ['v3', 'lo', 7]]).metrics[0].entries.length === 2 },
    { name: '★前回の測定〜今回の測定の間の変更を、特定できた行にだけ付ける', poison: noop, restore: noop,
      isRed: () => { const e = run([['v1', 'lo', 5], ['v2', 'lo', 4]]).metrics[0].entries[1]; return e.traceable === true && e.changes.length === 1; } },
    { name: '★台帳を最初に書き足したコミットを採る（後から同じ行が出ても動かさない）', poison: noop, restore: noop,
      isRed: () => {
        const text = '\u001e' + 'a'.repeat(40) + '\u001f2026-10-01\u001f初回\n\n+    version: \'0.1.0\', metric: \'lo\', value: 5,\n'
          + '\u001e' + 'b'.repeat(40) + '\u001f2026-10-02\u001f書式直し\n\n+    version: \'0.1.0\', metric: \'lo\', value: 5,\n';
        const m = parseIntroducedRows(text);
        return m.get('0.1.0\u0000lo')?.subject === '初回' && m.size === 1;
      } },
    { name: '★削除行(-)・ファイル見出し(+++)は台帳の行として数えない', poison: noop, restore: noop,
      isRed: () => parseIntroducedRows('\u001e' + 'a'.repeat(40) + '\u001f d\u001fs\n\n-    version: \'0.1.0\', metric: \'lo\'\n+++ b/x\n').size === 0 }
  ]);

  if (!ok) {
    console.error('[improvement-timeline] ★selftest 失敗(検知器が効いていません):');
    for (const f of fails) console.error('  - ' + f);
    process.exit(EXIT.FAIL);
  }
  console.log('[improvement-timeline] selftest OK(向きは宣言から / 悪化は悪化のまま / 変更を推測で割り当てない / 測れない行を載せない)');
  process.exit(EXIT.PASS);
}

/* ── 本番 ───────────────────────────────────────────── */
if (!existsSync(METRICS) || !existsSync(HISTORY)) {
  console.log('[improvement-timeline] 🟡 台帳がありません（★測れませんでした）');
  console.log('  → 直し方: キットの improvement-metrics.mjs / improvement-history.mjs をコピーし、指標を宣言して record-improvement で記録する');
  process.exit(EXIT.INCONCLUSIVE);
}

const metricsMod = await import(pathToFileURL(METRICS).href);
const historyMod = await import(pathToFileURL(HISTORY).href);
const metrics = Array.isArray(metricsMod.IMPROVEMENT_METRICS) ? metricsMod.IMPROVEMENT_METRICS : [];
let history = Array.isArray(historyMod.IMPROVEMENT_HISTORY) ? historyMod.IMPROVEMENT_HISTORY : [];
const only = opt('--metric');
if (only) history = history.filter((r) => r && r.metric === only);

const introduced = loadIntroduced();
const tl = buildTimeline({
  history, metrics,
  commitOf: introduced ? (v, m) => introduced.get(`${v}\u0000${m}`) || null : undefined,
  changesBetween: introduced ? changesBetween : undefined
});

if (has('--json')) {
  console.log(JSON.stringify(tl, null, 2));
} else {
  const limit = Number(opt('--limit')) || 0;
  console.log(renderTimelineMarkdown(tl, { limit }));
  if (!introduced) {
    console.log('\n> ★git が使えないため、各測定のコミットを特定できていません（変更は空にしています）。');
  }
}
process.exit(EXIT.PASS);
