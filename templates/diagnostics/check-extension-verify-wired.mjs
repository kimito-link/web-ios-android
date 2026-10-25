#!/usr/bin/env node
/**
 * check-extension-verify-wired.mjs — ★Chrome拡張のリポに「本物のブラウザで自動検証」が入っているか。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか(2026-10-25・りんく「拡張関連全体のルールにしたい」)
 *   拡張は「単体テストは緑なのに、読み込むと動かない」で壊れる。AI が自分で読み込んで
 *   確かめずに「拡張を再読み込みして開き直してください」と人に頼む運用が続き、
 *   その回数がそのまま負担になっていた(Codex は Claude 側の設定を読まないので、
 *   Claude にだけ書いたルールは Codex に届かなかった)。
 *   ⟹ 共通の検証 templates/extension-verify/run.mjs を全拡張リポに配線させ、
 *     抜けているリポを機械で赤くする。
 *
 * ■ 何を見るか(拡張 manifest.json(manifest_version あり)を git 追跡しているリポだけ)
 *   1. 直下に extension-verify.json がある
 *   2. それが package.json の scripts か .github/workflows から呼ばれている(配線)
 *   3. AGENTS.md がそれに触れている(Codex/Cursor 等が読むのは AGENTS.md。CLAUDE.md だけでは届かない)
 *   4. 静的な網羅の門(未検証の画面・参照切れ)が通る ← run.mjs の staticPlan を流用
 *
 * ■ ★この検査が判定しないこと
 *   ブラウザを起動しての合否は見ない(重い・環境依存)。それは配線先(npm script / CI)の役目。
 *   ここは「入っているか・網羅されているか」だけ。
 *
 * 終了コード: 0 = 合格(拡張が無いリポも 0) / 1 = ★赤 / 2 = 測れなかった(git でない等)
 *
 * 使い方:
 *   node check-extension-verify-wired.mjs [対象ディレクトリ]
 *   node check-extension-verify-wired.mjs --selftest   ← ★自分自身を毒で試す
 * ───────────────────────────────────────────────────────────────────────────
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, staticPlan } from '../extension-verify/run.mjs';

const SKIP_DIR = /(^|\/)(node_modules|test|tests|fixtures|dist|build|vendor)\//;

function trackedFiles(dir) {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
  } catch { return null; }
}

/** 拡張の manifest(manifest_version を持つ manifest.json)の相対パス。PWA の manifest.json は除く。 */
export function findExtensionManifests(dir, files) {
  return files
    .filter((f) => /(^|\/)manifest\.json$/.test(f) && !SKIP_DIR.test(f))
    .filter((f) => { try { return Number.isInteger(JSON.parse(readFileSync(join(dir, f), 'utf8')).manifest_version); } catch { return false; } });
}

export function inspect(dir, files) {
  const manifests = findExtensionManifests(dir, files);
  if (!manifests.length) return { applicable: false, failures: [] };
  const failures = [];
  const cfgPath = join(dir, 'extension-verify.json');
  if (!existsSync(cfgPath)) {
    failures.push(`extension-verify.json が無い(拡張: ${manifests.join(', ')})。web-ios-android/templates/extension-verify/README.md の手順で入れる`);
    return { applicable: true, manifests, failures };
  }
  const cfg = loadConfig(dir);
  const extDirRel = resolve(dir, cfg.extensionDir);
  const covered = manifests.filter((m) => resolve(dir, dirname(m)) === extDirRel);
  if (!covered.length) failures.push(`extension-verify.json の extensionDir(${cfg.extensionDir}) がどの拡張 manifest とも一致しない: ${manifests.join(', ')}`);
  for (const m of manifests) if (!covered.includes(m)) failures.push(`検証されていない拡張がある: ${m}(拡張が複数あるなら、それぞれのリポ/設定に分ける)`);

  // 配線: package.json scripts か workflows のどこかが run.mjs(extension-verify)を呼ぶ
  const pkg = existsSync(join(dir, 'package.json')) ? JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) : {};
  const inScripts = Object.values(pkg.scripts || {}).some((s) => /extension-verify/.test(String(s)));
  const wfDir = join(dir, '.github', 'workflows');
  const inWorkflows = existsSync(wfDir) && readdirSync(wfDir).some((f) => /\.ya?ml$/.test(f) && /extension-verify/.test(readFileSync(join(wfDir, f), 'utf8')));
  if (!inScripts && !inWorkflows) failures.push('extension-verify をどこからも呼んでいない(package.json の scripts か .github/workflows に配線する)');

  const agents = join(dir, 'AGENTS.md');
  if (!existsSync(agents)) failures.push('AGENTS.md が無い(Codex 等は CLAUDE.md を読まない。拡張の自己検証ルールを AGENTS.md に書く)');
  else if (!/extension-verify|verify:extension/.test(readFileSync(agents, 'utf8'))) failures.push('AGENTS.md が拡張の自己検証(extension-verify)に触れていない');

  const plan = staticPlan(dir, cfg);
  for (const f of plan.failures) failures.push(`網羅の門: ${f}`);
  return { applicable: true, manifests, failures };
}

function main(dir) {
  const files = trackedFiles(dir);
  if (!files) { console.log('skip: git リポジトリではない'); return 2; }
  const r = inspect(dir, files);
  if (!r.applicable) { console.log('pass: Chrome拡張の manifest が無い(対象外)'); return 0; }
  if (!r.failures.length) { console.log(`pass: 拡張の自動検証が配線済み(${r.manifests.join(', ')})`); return 0; }
  console.log(`FAIL: 拡張の自動検証が足りない(${r.failures.length}件)`);
  for (const f of r.failures) console.log('  - ' + f);
  return 1;
}

function selftest() {
  let fails = 0;
  const check = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails++; };
  const mk = (files) => {
    const d = mkdtempSync(join(tmpdir(), 'ext-wired-selftest-'));
    for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c); }
    return { d, files: Object.keys(files) };
  };
  const manifest = JSON.stringify({ manifest_version: 3, name: 't', version: '1', action: { default_popup: 'popup.html' } });
  const good = {
    'manifest.json': manifest,
    'popup.html': '<html><body>x</body></html>',
    'extension-verify.json': '{}',
    'package.json': JSON.stringify({ scripts: { 'verify:extension': 'node ../web-ios-android/templates/extension-verify/run.mjs .' } }),
    'AGENTS.md': '拡張は npm run verify:extension で自分で確かめる',
  };
  let t = mk(good); check('配線済みの拡張は合格', inspect(t.d, t.files).failures.length === 0); rmSync(t.d, { recursive: true, force: true });
  t = mk({ 'manifest.json': JSON.stringify({ name: 'pwa', icons: [] }), 'index.html': '' });
  check('PWA の manifest.json は対象外', inspect(t.d, t.files).applicable === false); rmSync(t.d, { recursive: true, force: true });
  t = mk({ 'manifest.json': manifest, 'popup.html': '' });
  check('★設定が無い拡張を赤にする', inspect(t.d, t.files).failures.some((f) => f.includes('extension-verify.json が無い'))); rmSync(t.d, { recursive: true, force: true });
  t = mk({ ...good, 'package.json': '{}' });
  check('★どこからも呼ばれていないと赤', inspect(t.d, t.files).failures.some((f) => f.includes('どこからも呼んでいない'))); rmSync(t.d, { recursive: true, force: true });
  t = mk({ ...good, 'AGENTS.md': '何も書いていない' });
  check('★AGENTS.md が触れていないと赤(Codex に届かない)', inspect(t.d, t.files).failures.some((f) => f.includes('AGENTS.md が拡張の自己検証'))); rmSync(t.d, { recursive: true, force: true });
  t = mk({ ...good, 'options.html': '<html></html>' });
  check('★未検証の画面があると赤(網羅の門)', inspect(t.d, t.files).failures.some((f) => f.includes('未検証の画面: options.html'))); rmSync(t.d, { recursive: true, force: true });
  t = mk({ ...good, 'test/fixtures/manifest.json': manifest });
  check('fixtures 内の manifest は数えない', inspect(t.d, t.files).failures.length === 0); rmSync(t.d, { recursive: true, force: true });
  console.log(fails ? `\n自己検査: ★${fails}件失敗` : '\n自己検査: 全部合格');
  return fails ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  process.exit(args.includes('--selftest') ? selftest() : main(resolve(args.find((a) => !a.startsWith('--')) || process.cwd())));
}
