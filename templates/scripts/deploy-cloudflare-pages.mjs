#!/usr/bin/env node
/**
 * deploy-cloudflare-pages.mjs — Cloudflare Pagesへデプロイする（web-ios-android キット）
 *
 * 背景（LP先行→ドメイン接続 MVP の一部）:
 *   `npx wrangler pages deploy` の薄いラップ。認証は先に cloudflare-auth.mjs で確立済みの
 *   Wranglerセッション（ローカル）または CLOUDFLARE_API_TOKEN 環境変数（CI）に委ねる。
 *   このスクリプト自身は認証を行わない（責務を分離する）。
 *
 *   設計: _docs/DESIGN-lp-first-domain-connect-2026-07-13.md
 *
 * 使い方:
 *   node templates/scripts/deploy-cloudflare-pages.mjs --dir <出力ディレクトリ>
 *   node templates/scripts/deploy-cloudflare-pages.mjs --dry-run   # 何もしない・設定確認のみ
 *
 * オプション:
 *   --dir <path>          デプロイするビルド出力ディレクトリ（既定: './dist'）
 *   --project <name>      Cloudflare Pagesのプロジェクト名（既定: app.config.json の web.deploy.projectName）
 *   --dry-run             実際にはデプロイしない（コマンドの組み立てだけ確認）
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { cfg, getProjectRoot } from './lib/app-config.mjs';

const ROOT = getProjectRoot();

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    project: { type: 'string' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (values.help) {
  console.log(
    [
      'deploy-cloudflare-pages: `npx wrangler pages deploy` のラップ。',
      '',
      '  認証はしない（先に cloudflare-auth.mjs を実行しておくこと）。',
      '',
      'オプション: --dir <path> / --project <name> / --dry-run',
    ].join('\n'),
  );
  process.exit(0);
}

function header(t) { const b = '='.repeat(64); console.log(`\n${b}\n  ${t}\n${b}`); }

async function main() {
  const projectName = values.project || cfg('web.deploy.projectName');
  const dir = path.resolve(ROOT, values.dir || './dist');
  const dryRun = !!values['dry-run'];

  header(`deploy-cloudflare-pages ${dryRun ? '(DRY-RUN)' : ''}`);

  if (!projectName) {
    console.error('  FAIL  Cloudflare Pagesのプロジェクト名が不明です。');
    console.error('        app.config.json の web.deploy.projectName を設定するか --project を指定してください。');
    process.exit(1);
  }

  console.log(`  プロジェクト: ${projectName}`);
  console.log(`  出力ディレクトリ: ${dir}`);

  if (!dryRun && !fs.existsSync(dir)) {
    console.error(`  FAIL  出力ディレクトリが存在しません: ${dir}`);
    console.error('        先にビルドを実行してください。');
    process.exit(1);
  }

  const args = ['wrangler', 'pages', 'deploy', dir, '--project-name', projectName];
  console.log(`  実行コマンド: npx ${args.join(' ')}`);

  if (dryRun) {
    console.log('  DRY   実際のデプロイは行いません。');
    return;
  }

  const ok = await runWrangler(args);
  if (!ok) {
    console.error('  FAIL  デプロイに失敗しました。');
    console.error('        認証切れの場合は cloudflare-auth.mjs を再実行してください。');
    process.exit(1);
  }
  console.log('  OK    デプロイが完了しました。');
}

function runWrangler(args) {
  return new Promise((resolve) => {
    const child = spawn('npx', args, { stdio: 'inherit' });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

main();
