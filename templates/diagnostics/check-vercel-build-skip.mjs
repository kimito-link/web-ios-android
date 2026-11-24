#!/usr/bin/env node
/**
 * check-vercel-build-skip.mjs — Vercel にビルドさせるリポが「要らないビルドを省く仕組み」を入れているか。
 *
 * ■ なぜ要るか(2026-11-24・りんく「Vercelのビルド費用を減らす」)
 *   2026-10-20〜11-23 の Vercel 請求 $99.58 のうち $77.70(78%)がビルド代。ビルド代は回数で決まり
 *   (1回ごとに分を切り上げ × 4 vCPU)、サイトに関係ない PR(拡張のコード・docs・dependabot)でも毎回プレビューが
 *   作られていた。省く仕組み(ignoreCommand)が入っていたのは 40 プロジェクト中 2 リポだけだった。
 *   ルール本文: docs/ai-rules/16_VERCEL_BUILD_COST.md ／ 共通の判定: templates/vercel/vercel-ignore-build.mjs
 *
 * ■ 何を見るか(git 追跡の vercel.json ごと。node_modules は見ない)
 *   1. "ignoreCommand" がある(または git.deploymentEnabled が false＝自動ビルド自体が無い)
 *   2. ignoreCommand が呼ぶスクリプト(scripts/… 等)がリポに実在する
 *   ★vercel.json が無いリポは pass(Vercel を使っていない／ダッシュボードだけで設定している)。
 *
 * ■ この検査が判定しないこと
 *   ダッシュボード側の設定・実際に省けた回数・見張るパスが正しいか。回数は Vercel の請求でしか分からない。
 *
 * 終了コード: 0 = 合格 / 1 = 赤 / 2 = 測れなかった(git でない)
 * 使い方:
 *   node check-vercel-build-skip.mjs [対象ディレクトリ]
 *   node check-vercel-build-skip.mjs --selftest
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 1つの vercel.json を見て、問題の文(無ければ null)を返す。 */
export function inspectVercelJson(text, { fileExists = () => true, baseDir = '.' } = {}) {
  let cfg;
  try { cfg = JSON.parse(text); } catch { return 'JSON として読めない'; }
  const git = cfg && cfg.git;
  if (git && git.deploymentEnabled === false) return null;
  const cmd = typeof cfg.ignoreCommand === 'string' ? cfg.ignoreCommand.trim() : '';
  if (!cmd) return 'ignoreCommand が無い(サイトに関係ない PR・docs・dependabot でも毎回ビルド代がかかる)';
  const m = cmd.match(/(?:^|\s)((?:\.\.?\/)?[\w./-]+\.(?:mjs|cjs|js|sh))\b/);
  if (m && !fileExists(join(baseDir, m[1]))) return `ignoreCommand が呼ぶ ${m[1]} がリポに無い`;
  return null;
}

function main(target) {
  let files;
  try {
    files = execFileSync('git', ['-C', target, 'ls-files', '--', '*vercel.json'], { encoding: 'utf8' })
      .split('\n').filter((f) => f && !f.includes('node_modules/'));
  } catch {
    console.log('check-vercel-build-skip: git でないため測れない');
    return 2;
  }
  if (files.length === 0) { console.log('check-vercel-build-skip: vercel.json なし → pass'); return 0; }
  let ng = 0;
  for (const f of files) {
    const abs = join(target, f);
    const problem = inspectVercelJson(readFileSync(abs, 'utf8'), { fileExists: existsSync, baseDir: dirname(abs) });
    if (problem) { ng++; console.log(`✗ ${f}: ${problem}`); } else console.log(`✓ ${f}`);
  }
  if (ng) console.log('直し方: templates/vercel/README.md(共通の vercel-ignore-build.mjs を置いて ignoreCommand で呼ぶ)');
  return ng ? 1 : 0;
}

function selftest() {
  const cases = [
    ['{}', true],
    ['{"ignoreCommand":"node scripts/vercel-ignore-build.mjs"}', false],
    ['{"git":{"deploymentEnabled":false}}', false],
    ['not json', true],
  ];
  let bad = 0;
  for (const [text, wantProblem] of cases) {
    if (Boolean(inspectVercelJson(text)) !== wantProblem) { bad++; console.error('NG', text); }
  }
  if (!inspectVercelJson('{"ignoreCommand":"node scripts/x.mjs"}', { fileExists: () => false })) { bad++; console.error('NG missing script'); }
  // 実ファイルで: 毒(ignoreCommand 無し)を入れると赤になるか
  const d = mkdtempSync(join(tmpdir(), 'vercel-skip-selftest-'));
  try {
    execFileSync('git', ['init', '-q', d]);
    mkdirSync(join(d, 'site'));
    writeFileSync(join(d, 'site', 'vercel.json'), '{"headers":[]}');
    execFileSync('git', ['-C', d, 'add', '.']);
    const log = console.log; console.log = () => {};
    const red = main(d);
    writeFileSync(join(d, 'site', 'vercel.json'), '{"ignoreCommand":"node vercel-ignore-build.mjs"}');
    writeFileSync(join(d, 'site', 'vercel-ignore-build.mjs'), '');
    const green = main(d);
    console.log = log;
    if (red !== 1 || green !== 0) { bad++; console.error('NG real files', red, green); }
  } finally { rmSync(d, { recursive: true, force: true }); }
  console.log(bad ? `selftest: ${bad} NG` : 'selftest: ok');
  return bad ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  process.exit(args.includes('--selftest') ? selftest() : main(resolve(args.find((a) => !a.startsWith('--')) || process.cwd())));
}
