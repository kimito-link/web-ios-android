#!/usr/bin/env node
// 役割: Vercel の「Ignored Build Step」(vercel.json の ignoreCommand)から呼ばれ、ビルドが要るかを決める。
//   終了コード 0 = このビルドを作らない / 1 = いつもどおり作る(Vercel の決まり。逆に見えるので注意)。
// なぜ要るか: 2026-10-20〜11-23 の Vercel 請求 $99.58 のうち $77.70(78%)がビルド代だった。
//   ビルド代は「1回ごとに分を切り上げ × 4 vCPU」で、数秒で終わる静的サイトでも1回約 $0.014 かかる＝**回数**で決まる。
//   拡張機能やアプリのリポに LP を同居させたプロジェクトでは、サイトに関係ない変更(拡張のコード・docs・dependabot)の
//   PR でも毎回プレビューが作られ、reply-suggest-link だけで1か月1401回・$17.82 になっていた。
//   ルール本文: docs/ai-rules/16_VERCEL_BUILD_COST.md
// 使い方(各リポ。手で実行しない。Vercel がビルドの前に自動で実行する):
//   vercel.json に "ignoreCommand": "node scripts/vercel-ignore-build.mjs"                  # docs だけの変更・dependabot・古いブランチを省く
//   vercel.json に "ignoreCommand": "node scripts/vercel-ignore-build.mjs site/ package.json" # 引数=サイトに効くパス。ここが変わらない変更は本番もプレビューも省く
//   Root Directory を設定したプロジェクトで引数を省くと、その Root Directory をサイトのパスとみなす。
//   ★自己点検: node templates/vercel/vercel-ignore-build.mjs --selftest
// ★分からないとき(前回の SHA が無い・git が使えない)は必ず「作る」に倒す。省きすぎて本番が古いままになる方が損が大きい。

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const STALE_DAYS = 14;

/** これだけが変わったなら、サイトの中身は変わらない(リポ直下からのパス)。 */
const DOC_ONLY = [
  /^[^/]+\.md$/i,            // README.md・handoff.md・CLAUDE.md など直下の md
  /^(docs|_docs)\//,
  /^\.github\//,
  /^\.claude\//,
  /^\.agent\//,
  /^AGENTS\.md$/,
  /^LICENSE/i,
];

/** どのパスを見張っていても、これが変わったらビルドする(ビルドの決まりそのものが変わった)。 */
const ALWAYS_BUILD = [/^vercel\.json$/, /(^|\/)vercel\.json$/, /(^|\/)vercel-ignore-build\.mjs$/];

const BOT_BRANCH = /^(dependabot|renovate)\//;

const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * ビルドを作るかを決める(副作用なし)。
 * @param {object} o
 * @param {string} [o.env] VERCEL_ENV(production / preview)
 * @param {string} [o.ref] VERCEL_GIT_COMMIT_REF(ブランチ名)
 * @param {string[]|null} o.changed 前回のデプロイから変わったファイル(リポ直下から)。分からなければ null
 * @param {number|null} [o.ageDays] 最後のコミットから何日たったか。分からなければ null
 * @param {string[]} [o.watch] サイトに効くパス(前方一致)。空なら「docs だけの変更」だけを省く
 * @returns {{build: boolean, reason: string}}
 */
export function decide({ env = '', ref = '', changed = null, ageDays = null, watch = [] }) {
  const production = env === 'production';
  if (!production && BOT_BRANCH.test(ref)) return { build: false, reason: `bot branch (${ref})` };
  if (!production && ageDays != null && ageDays > STALE_DAYS) {
    return { build: false, reason: `last commit is ${Math.floor(ageDays)} days old (${ref})` };
  }
  if (changed == null) return { build: true, reason: 'changed files unknown (no previous deploy sha) -> build' };
  const files = changed.map(norm).filter(Boolean);
  if (files.length === 0) return { build: true, reason: 'no diff info -> build' };
  if (files.some((f) => ALWAYS_BUILD.some((re) => re.test(f)))) return { build: true, reason: 'vercel config changed' };
  const w = watch.map(norm).filter(Boolean);
  if (w.length > 0) {
    const hit = files.find((f) => w.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p || f.startsWith(`${p}/`))));
    return hit
      ? { build: true, reason: `site file changed (${hit})` }
      : { build: false, reason: `no change under ${w.join(', ')} (${files.length} files changed elsewhere)` };
  }
  if (files.every((f) => DOC_ONLY.some((re) => re.test(f)))) return { build: false, reason: `docs only (${files.length} files)` };
  return { build: true, reason: 'site may be affected' };
}

function git(args, timeout = 20000) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout }).trim();
  } catch {
    return null;
  }
}

/**
 * ブランチの最初のデプロイ(VERCEL_GIT_PREVIOUS_SHA が空)で、比べる相手=本番ブランチの先頭を探す。
 * なぜ要るか: Vercel の docs で PREVIOUS_SHA は「It's empty on a branch's first deployment」
 *   (https://vercel.com/docs/environment-variables/system-environment-variables)。
 *   2026-10-25〜11-24 の実測で、プレビューの3〜6割がブランチの最初のデプロイだった(claude/ は1PR1ブランチのため)。
 *   ここで比べられないと、その全部が「分からない→作る」に倒れて省けない。
 * 本番ブランチ(先頭か merge-base)と比べた差分は、ブランチで変えたファイルを必ず含む(=省きすぎる側には倒れない)。
 * 見つからなければ null(=作る)。本番ブランチ名が main/master 以外なら引数 --base=<名前> で渡す。
 */
function firstDeployBase(baseArg) {
  const names = baseArg ? [baseArg] : ['main', 'master'];
  for (const name of names) {
    for (const r of [`origin/${name}`, name]) {
      if (git(['rev-parse', '--verify', '--quiet', `${r}^{commit}`])) return { sha: r, label: r };
    }
  }
  // Vercel は depth=10 の浅い clone で、本番ブランチを持っていないことがある。先頭だけ取ってくる。
  for (const name of names) {
    if (git(['fetch', '--quiet', '--no-tags', '--depth=1', 'origin', name]) != null) {
      const sha = git(['rev-parse', '--verify', '--quiet', 'FETCH_HEAD^{commit}']);
      if (sha) return { sha, label: `origin/${name} (fetched)` };
    }
  }
  return null;
}

function main(argv) {
  const env = process.env.VERCEL_ENV || '';
  const ref = process.env.VERCEL_GIT_COMMIT_REF || '';
  const prev = process.env.VERCEL_GIT_PREVIOUS_SHA || '';
  const baseArg = (argv.find((a) => a.startsWith('--base=')) || '').slice('--base='.length);
  let watch = argv.filter((a) => !a.startsWith('--'));
  if (watch.length === 0) {
    const prefix = git(['rev-parse', '--show-prefix']);
    if (prefix) watch = [prefix];
  }
  let changed = null;
  let from = 'no base';
  if (prev) {
    const out = git(['diff', '--name-only', prev, 'HEAD']);
    if (out != null) { changed = out.split('\n').filter(Boolean); from = `vs previous deploy ${prev.slice(0, 7)}`; }
  } else if (env !== 'production') {
    const base = firstDeployBase(baseArg);
    if (base) {
      const mb = git(['merge-base', base.sha, 'HEAD']);
      const out = git(['diff', '--name-only', mb || base.sha, 'HEAD']);
      if (out != null) { changed = out.split('\n').filter(Boolean); from = `first deploy of branch, vs ${base.label} ${mb ? 'merge-base' : 'tip'}`; }
    }
  }
  const ct = Number(git(['log', '-1', '--format=%ct']));
  const ageDays = Number.isFinite(ct) && ct > 0 ? (Date.now() / 1000 - ct) / 86400 : null;
  const r = decide({ env, ref, changed, ageDays, watch });
  console.log(`[vercel-ignore-build] ${r.build ? 'BUILD' : 'SKIP'}: ${r.reason} [${from}]`);
  return r.build ? 1 : 0;
}

function selftest() {
  const cases = [
    [{ env: 'production', ref: 'dependabot/npm/x', changed: ['package.json'] }, true],
    [{ env: 'preview', ref: 'dependabot/npm/x', changed: ['package.json'] }, false],
    [{ env: 'preview', ref: 'claude/x', changed: ['README.md', 'docs/a.md'] }, false],
    [{ env: 'production', ref: 'main', changed: ['README.md'] }, false],
    [{ env: 'preview', ref: 'claude/x', changed: null }, true],
    [{ env: 'preview', ref: 'claude/x', changed: ['src/ext.js'], watch: ['site/'] }, false],
    [{ env: 'preview', ref: 'claude/x', changed: ['site/index.html'], watch: ['site/'] }, true],
    [{ env: 'preview', ref: 'claude/x', changed: ['vercel.json'], watch: ['site/'] }, true],
    [{ env: 'preview', ref: 'old', changed: ['a.js'], ageDays: 30 }, false],
    [{ env: 'production', ref: 'main', changed: ['a.js'], ageDays: 30 }, true],
  ];
  let ng = 0;
  for (const [input, want] of cases) {
    const got = decide(input).build;
    if (got !== want) { ng++; console.error('NG', JSON.stringify(input), 'want', want, 'got', got); }
  }
  console.log(ng ? `selftest: ${ng} NG` : `selftest: ${cases.length} ok`);
  return ng ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  process.exit(args.includes('--selftest') ? selftest() : main(args));
}
