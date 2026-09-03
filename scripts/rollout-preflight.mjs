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
 * ★観測専用。書き込みは一切しない。CSP変更もこのスクリプトは行わない
 *   （CSP変更はrolloutが自動で行わず、別の明示判断とする）。
 * ★UNKNOWNをREADYへ丸めない。1ページでもBLOCKがあればverdict=BLOCKED。
 *
 * 使い方: node scripts/rollout-preflight.mjs --project <name> --site-root <相対パス> [--pages <path1,path2,...>]
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

  const project = args[projectIdx + 1];
  const siteRoot = args[siteRootIdx + 1];
  const pagesArg = args[pagesIdx + 1];
  const githubRoot = resolve(import.meta.dirname, '..', '..');
  const siteRootDir = resolve(githubRoot, project, siteRoot);

  const relativePaths = pagesArg.split(',').map((p) => p.trim()).filter(Boolean);
  const pages = relativePaths.map((relPath) => {
    const fullPath = join(siteRootDir, relPath);
    if (!existsSync(fullPath)) {
      console.error(`[rollout-preflight] ファイルが存在しません: ${fullPath}`);
      process.exit(1);
    }
    return { path: relPath, content: readFileSync(fullPath, 'utf8') };
  });

  const result = checkCspDeliveryPreflight(pages);

  console.log(`[rollout-preflight] ${project}::${siteRoot} verdict=${result.verdict}`);
  for (const p of result.perPage) {
    console.log(`  ${p.path}: present=${p.present} script=${p.externalScript} style=${p.externalStyle}`);
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
