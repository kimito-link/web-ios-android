#!/usr/bin/env node
/**
 * run-instruments.mjs — 計器の「入口」を1本にまとめ、途中が黄/赤でも最後まで測る。
 *
 *   node scripts/run-instruments.mjs [対象リポ]
 *   node scripts/run-instruments.mjs --deep [対象リポ]  # 各計器のselftestも実行
 *
 * 0=全て測れて緑 / 1=赤あり / 2=測れなかった項目あり。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const DEEP = argv.includes('--deep');
const SELFTEST = argv.includes('--selftest');
function option(name, fallback = null) {
  const at = argv.lastIndexOf(name);
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : fallback;
}
const positional = argv.find((arg, index) => !arg.startsWith('-') && argv[index - 1] !== '--report');
const ROOT = resolve(positional || join(HERE, '..'));
const REPORT = option('--report');
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
  if (!script) {
    console.log(`\n[instruments] 🟡 ${label}: 実体がありません（測れませんでした）`);
    return { label, verdict: 'inconclusive', code: EXIT.INCONCLUSIVE };
  }
  console.log(`\n[instruments] ▶ ${label}`);
  try {
    execFileSync(process.execPath, [script, ...args], {
      cwd: ROOT, encoding: 'utf8', stdio: 'inherit', timeout: 10 * 60 * 1000
    });
    return { label, verdict: 'pass', code: EXIT.PASS };
  } catch (error) {
    const code = Number.isInteger(error.status) ? error.status : EXIT.FAIL;
    return { label, verdict: classifyExit(code), code };
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
const shindanPage = firstExisting(['scripts/generate-shindan-version.mjs', 'templates/scripts/generate-shindan-version.mjs']);

const results = [];
results.push(run('全文脈パケット', context, ['--write', '.instrument-context.md', ROOT]));
results.push(run('汎用診断', diagnostics, [ROOT]));
results.push(run('進化台帳', improvement, ['--check']));
results.push(run('計器が走ったか', ran, ['--check']));
if (drift) results.push(run('配布コードのドリフト', drift));

if (DEEP) {
  results.push(run('全文脈パケット selftest', context, ['--selftest']));
  results.push(run('進化台帳 selftest', improvement, ['--selftest']));
  results.push(run('実行記録 selftest', ran, ['--selftest']));
  results.push(run('統合入口 selftest', fileURLToPath(import.meta.url), ['--selftest']));
  if (drift) results.push(run('ドリフト検知 selftest', drift, ['--selftest']));
  if (security) results.push(run('セキュリティ計器 selftest', security, ['--selftest']));
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
}
if (code === EXIT.INCONCLUSIVE) console.log('\n[instruments] 🟡 測れなかった項目があります。緑とは数えません。');
if (code === EXIT.FAIL) console.log('\n[instruments] 🔴 赤があります。上の「直し方」から直してください。');
process.exit(code);
