#!/usr/bin/env node
/**
 * run-instruments.mjs — 計器の「入口」を1本にまとめ、途中が黄/赤でも最後まで測る。
 *
 *   node scripts/run-instruments.mjs [対象リポ]
 *   node scripts/run-instruments.mjs --deep [対象リポ]  # 各計器のselftestも実行
 *   node scripts/run-instruments.mjs --security-url https://example.com [対象リポ]
 *
 * 0=全て測れて緑 / 1=赤あり / 2=測れなかった項目あり。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const DEEP = argv.includes('--deep');
const SELFTEST = argv.includes('--selftest');
function option(name, fallback = null) {
  const at = argv.lastIndexOf(name);
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : fallback;
}
const VALUE_OPTIONS = new Set(['--report', '--security-url']);
const positional = argv.find((arg, index) => !arg.startsWith('-') && !VALUE_OPTIONS.has(argv[index - 1]));
const ROOT = resolve(positional || join(HERE, '..'));
const REPORT = option('--report');
const SECURITY_URL = option('--security-url');
const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });

function firstExisting(paths) {
  return paths.map((p) => join(ROOT, p)).find((p) => existsSync(p)) || null;
}

function classifyExit(code) {
  if (code === EXIT.PASS) return 'pass';
  if (code === EXIT.INCONCLUSIVE) return 'inconclusive';
  return 'fail';
}

function aggregate(results) {
  if (results.some((r) => r.verdict === 'fail')) return EXIT.FAIL;
  if (results.some((r) => r.verdict === 'inconclusive')) return EXIT.INCONCLUSIVE;
  return EXIT.PASS;
}

function run(label, script, args = []) {
  // ★scriptPath: 証明3点台帳(instrument-proof)がこの検査を再特定するためのキー。
  //   ROOTからの相対パスに揃える（絶対パスだと環境で変わり、台帳のキーとして不安定）。
  const scriptPath = script ? relative(ROOT, script).split('\\').join('/') : null;
  if (!script) {
    console.log(`\n[instruments] 🟡 ${label}: 実体がありません（測れませんでした）`);
    return { label, script: scriptPath, verdict: 'inconclusive', code: EXIT.INCONCLUSIVE };
  }
  console.log(`\n[instruments] ▶ ${label}`);
  try {
    execFileSync(process.execPath, [script, ...args], {
      cwd: ROOT, encoding: 'utf8', stdio: 'inherit', timeout: 10 * 60 * 1000
    });
    return { label, script: scriptPath, verdict: 'pass', code: EXIT.PASS };
  } catch (error) {
    const code = Number.isInteger(error.status) ? error.status : EXIT.FAIL;
    return { label, script: scriptPath, verdict: classifyExit(code), code };
  }
}

if (SELFTEST) {
  const fails = [];
  if (aggregate([{ verdict: 'pass' }, { verdict: 'inconclusive' }]) !== EXIT.INCONCLUSIVE) fails.push('黄を緑にした');
  if (aggregate([{ verdict: 'inconclusive' }, { verdict: 'fail' }]) !== EXIT.FAIL) fails.push('赤より黄を優先した');
  if (aggregate([{ verdict: 'pass' }]) !== EXIT.PASS) fails.push('全緑を緑にできない');
  if (classifyExit(2) !== 'inconclusive' || classifyExit(1) !== 'fail') fails.push('3値exitを壊した');
  if (fails.length) {
    console.error('[run-instruments] selftest 失敗: ' + fails.join(' / '));
    process.exit(EXIT.FAIL);
  }
  console.log('[run-instruments] selftest OK（全計器を最後まで実行 / 赤>黄>緑の3値集約）');
  process.exit(EXIT.PASS);
}

const context = firstExisting(['scripts/context-engine.mjs', 'templates/scripts/context-engine.mjs']);
const diagnostics = firstExisting(['diagnostics/run.mjs', 'templates/diagnostics/run.mjs']);
const improvement = firstExisting(['scripts/check-improvement.mjs']);
const ran = firstExisting(['scripts/check-instrument-ran.mjs']);
const drift = firstExisting(['_docs/instruments/check-drift.mjs']);
const security = firstExisting(['scripts/verify-security-score.mjs', 'templates/scripts/verify-security-score.mjs']);
const responsive = firstExisting(['scripts/verify-responsive-design.mjs', 'templates/scripts/verify-responsive-design.mjs']);
const claimsProvenance = firstExisting(['scripts/verify-numeric-claims-provenance.mjs']);
const appConfigSchema = firstExisting(['scripts/verify-app-config-schema.mjs', 'templates/scripts/verify-app-config-schema.mjs']);
const assetlinksPublished = firstExisting(['scripts/verify-assetlinks-published.mjs', 'templates/scripts/verify-assetlinks-published.mjs']);
const docImplCoverage = firstExisting(['scripts/verify-doc-impl-coverage.mjs']);
const splashConfig = firstExisting(['scripts/check-splash-config.mjs', 'templates/scripts/check-splash-config.mjs']);
const splashSafe = firstExisting(['scripts/check-splash-safe-circle.mjs', 'templates/scripts/check-splash-safe-circle.mjs']);
const splashDrift = firstExisting(['scripts/check-splash-template-drift.mjs', 'templates/scripts/check-splash-template-drift.mjs']);
const shindanPage = firstExisting(['scripts/generate-shindan-version.mjs', 'templates/scripts/generate-shindan-version.mjs']);
// ★2026-09-02発見: 他のverify-*検査はすべて firstExisting で配布先/金型の両方を探すのに
//   これだけが一覧に無かった＝作った・文書化した(templates/README.md)が、統合入口からは
//   一度も呼ばれていない孤児だった。check-gates-are-wired.mjs は templates/scripts/ を
//   意図的に対象外にしている（それ自体は正しい設計判断）ため、この孤児は検出されなかった
//   ＝「検査を作ったのに誰も呼んでいない」を検出する検査自身の死角。
const rootCauseClaim = firstExisting(['scripts/verify-root-cause-claim.mjs', 'templates/scripts/verify-root-cause-claim.mjs']);
const instrumentProofCheck = firstExisting(['scripts/check-instrument-proof.mjs', 'templates/scripts/check-instrument-proof.mjs']);
const instrumentProofRecord = firstExisting(['scripts/record-instrument-proof.mjs', 'templates/scripts/record-instrument-proof.mjs']);

const results = [];
results.push(run('全文脈パケット', context, ['--write', '.instrument-context.md', ROOT]));
results.push(run('汎用診断', diagnostics, [ROOT]));
results.push(run('進化台帳', improvement, ['--check']));
results.push(run('計器が走ったか', ran, ['--check', '--max-days', '14']));
if (drift) results.push(run('配布コードのドリフト', drift));
if (rootCauseClaim) results.push(run('直近コミットの根治宣言の根拠', rootCauseClaim));
results.push(run(
  '公開サイトのセキュリティ満点チェック',
  security,
  SECURITY_URL ? ['--url', SECURITY_URL] : [],
));
results.push(run('レスポンシブ設計の静的先取りチェック', responsive));
if (claimsProvenance) results.push(run('数値主張の出典スクリーニング', claimsProvenance));
if (appConfigSchema) results.push(run('app.config.jsonのスキーマ適合', appConfigSchema));
if (assetlinksPublished) results.push(run('assetlinks.jsonの公開疎通', assetlinksPublished));
// ★docImplCoverageはinstrument-core.mjsの3値exit規約に未対応（--selftest無し、2026-08-25時点）。
//   通常実行はしつつ、selftest呼び出しは追加しない（無い機能を呼ぶと誤った結果になる）。
if (docImplCoverage) results.push(run('ドキュメント⇔実装カバレッジ', docImplCoverage));

if (DEEP) {
  results.push(run('全文脈パケット selftest', context, ['--selftest']));
  results.push(run('進化台帳 selftest', improvement, ['--selftest']));
  results.push(run('実行記録 selftest', ran, ['--selftest']));
  results.push(run('統合入口 selftest', fileURLToPath(import.meta.url), ['--selftest']));
  if (drift) results.push(run('ドリフト検知 selftest', drift, ['--selftest']));
  if (rootCauseClaim) results.push(run('根治宣言の根拠 selftest', rootCauseClaim, ['--selftest']));
  if (instrumentProofCheck) results.push(run('証明3点台帳 selftest', instrumentProofCheck, ['--selftest']));
  if (security) results.push(run('セキュリティ計器 selftest', security, ['--selftest']));
  if (responsive) results.push(run('レスポンシブ計器 selftest', responsive, ['--selftest']));
  if (claimsProvenance) results.push(run('数値主張スクリーニング selftest', claimsProvenance, ['--selftest']));
  if (appConfigSchema) results.push(run('app.config.jsonスキーマ計器 selftest', appConfigSchema, ['--selftest']));
  if (assetlinksPublished) results.push(run('assetlinks疎通計器 selftest', assetlinksPublished, ['--selftest']));
  if (splashConfig) results.push(run('起動画面設定 selftest', splashConfig, ['--selftest']));
  if (splashSafe) results.push(run('起動画面安全円 selftest', splashSafe, ['--selftest']));
  if (splashDrift) results.push(run('起動画面の配布版 selftest', splashDrift, ['--selftest']));
  if (shindanPage) results.push(run('診断進捗ページ selftest', shindanPage, ['--selftest']));
}

let code = aggregate(results);
console.log('\n--- 完全版の計器まとめ ---');
for (const result of results) {
  const mark = result.verdict === 'pass' ? '✓' : result.verdict === 'fail' ? '✗' : '?';
  console.log(`${mark} ${result.label}: ${result.verdict}`);
}
if (code === EXIT.PASS && ran) {
  const stamp = run('完全版の計器が緑になった記録', ran, ['--stamp', 'complete-instrument']);
  results.push(stamp);
  code = aggregate(results);
}
if (REPORT) {
  const reportPath = resolve(ROOT, REPORT);
  mkdirSync(dirname(reportPath), { recursive: true });
  const summary = {
    pass: results.filter((result) => result.verdict === 'pass').length,
    fail: results.filter((result) => result.verdict === 'fail').length,
    inconclusive: results.filter((result) => result.verdict === 'inconclusive').length
  };
  writeFileSync(reportPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    exitCode: code,
    summary,
    results
  }, null, 2) + '\n');
  console.log(`\n[instruments] レポート: ${reportPath}`);
  // ★reportが書かれた直後に証明3点台帳へ反映する。record-instrument-proof.mjs自身は
  //   このスクリプトの集約exitに影響させない（記録の成否とrun-instruments全体の緑/赤は別軸）。
  if (instrumentProofRecord) run('証明3点台帳への記録', instrumentProofRecord, ['--report', REPORT, ROOT]);
}
if (code === EXIT.INCONCLUSIVE) console.log('\n[instruments] 🟡 測れなかった項目があります。緑とは数えません。');
if (code === EXIT.FAIL) console.log('\n[instruments] 🔴 赤があります。上の「直し方」から直してください。');
process.exit(code);
