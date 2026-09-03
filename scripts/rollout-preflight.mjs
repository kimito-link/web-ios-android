#!/usr/bin/env node
/**
 * rollout-preflight.mjs — apply直前のDelivery Preflight（read-only）。
 *
 * Applicability（「このページにsite-chromeを持つ意味があるか」）と、
 * Delivery（「現在のページへこの方式で安全に配れるか」）は別軸である
 * （2026-09-03、GPT相談。soushin-suggest.link実applyで4ページがstrict CSPにより
 * site-chromeの外部JS/CSSを全ブロックし、旧UI削除後に新UIも表示されない事故を
 * 実際に起こした反省から追加）。
 *
 * v1.1（2026-09-03追記）: meta CSPが無いことは「CSPが無い」ことを意味しない。
 * HTTPレスポンスヘッダー側のCSP（_headers=Cloudflare Pages形式、vercel.json=Vercel形式）が
 * 別に存在しうる。meta無しを無条件ALLOWにすると、Mass Rolloutでfalse READYになるため、
 * hosting設定を確認できない場合はUNKNOWNへ倒す。metaとhosting両方がある場合は両方を
 * 満たす場合のみREADY。
 *
 * ★観測専用。書き込みは一切しない。CSP変更もこのスクリプトは行わない
 *   （CSP変更はrolloutが自動で行わず、別の明示判断とする）。
 * ★UNKNOWNをREADYへ丸めない。1ページでもBLOCKがあればverdict=BLOCKED。
 *
 * 使い方: node scripts/rollout-preflight.mjs --project <name> --site-root <相対パス> --pages <path1,path2,...> [--repo-root <相対パス>]
 *   --repo-root省略時はprojectディレクトリ直下をvercel.json探索先とする。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkCspDeliveryPreflight } from './lib/component-rollout.mjs';

function main() {
  const args = process.argv.slice(2);
  const projectIdx = args.indexOf('--project');
  const siteRootIdx = args.indexOf('--site-root');
  const pagesIdx = args.indexOf('--pages');

  if (projectIdx < 0 || siteRootIdx < 0 || pagesIdx < 0) {
    console.error('使い方: node scripts/rollout-preflight.mjs --project <name> --site-root <相対パス> --pages <相対パス1,相対パス2,...>');
    process.exit(1);
  }

  const repoRootIdx = args.indexOf('--repo-root');
  const project = args[projectIdx + 1];
  const siteRoot = args[siteRootIdx + 1];
  const pagesArg = args[pagesIdx + 1];
  const githubRoot = resolve(import.meta.dirname, '..', '..');
  const siteRootDir = resolve(githubRoot, project, siteRoot);
  const repoRootDir = repoRootIdx >= 0 ? resolve(githubRoot, project, args[repoRootIdx + 1]) : resolve(githubRoot, project);

  const relativePaths = pagesArg.split(',').map((p) => p.trim()).filter(Boolean);
  const pages = relativePaths.map((relPath) => {
    const fullPath = join(siteRootDir, relPath);
    if (!existsSync(fullPath)) {
      console.error(`[rollout-preflight] ファイルが存在しません: ${fullPath}`);
      process.exit(1);
    }
    return { path: relPath, content: readFileSync(fullPath, 'utf8') };
  });

  const result = checkCspDeliveryPreflight(pages, { siteRootDir, repoRootDir });

  console.log(`[rollout-preflight] ${project}::${siteRoot} verdict=${result.verdict}`);
  console.log(`  hosting: present=${result.hosting.present} source=${result.hosting.source} script=${result.hosting.externalScript} style=${result.hosting.externalStyle}`);
  for (const p of result.perPage) {
    console.log(`  ${p.path}: meta.present=${p.meta.present} combined.script=${p.externalScript} combined.style=${p.externalStyle}`);
  }

  if (result.verdict === 'BLOCKED') {
    console.error('[rollout-preflight] 🔴 BLOCKED: 1ページ以上でsite-chromeの外部JS/CSSがCSPによりブロックされます。applyを実行しないでください。');
    process.exit(1);
  }
  if (result.verdict === 'UNKNOWN') {
    console.error('[rollout-preflight] 🟡 UNKNOWN: CSP判定不能なページがあります。UNKNOWNをREADYへ丸めていません。個別確認してください。');
    process.exit(2);
  }
  console.log('[rollout-preflight] ✅ READY: 全ページでsite-chromeの外部JS/CSSが許可されます。');
  process.exit(0);
}

main();
