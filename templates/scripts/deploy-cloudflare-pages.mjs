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
    branch: { type: 'string' },
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
      'オプション: --dir <path> / --project <name> / --branch <name> / --dry-run',
      '',
      '  --branch は既定 main。Pages の本番ブランチと一致させること。',
      '  一致しないと preview 扱いになり、成功ログが出るのに本番が更新されない。',
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

  // ★--branch は必ず明示する（2026-09-09 追加）。
  //
  //   付けないと wrangler がローカルの git からブランチ名を推測する。
  //   CI では 'master' が送られることがあり、Cloudflare Pages の本番ブランチ
  //   （通常 main）と一致しないと **プレビュー扱い** になる。
  //
  //   このとき wrangler は成功終了するため、
  //   「デプロイは success なのに本番URLが更新されない」という、
  //   原因の分かりにくい形で現れる。
  //   実例: line-bot の管理画面が数時間これに費やした（本番は古いチャンクを
  //   配信し続け、新しいビルドは 404 だった）。
  //
  //   既定は 'main'。本番ブランチが違うプロジェクトは --branch で上書きする。
  const branch = values.branch || 'main';
  const args = [
    'wrangler', 'pages', 'deploy', dir,
    '--project-name', projectName,
    '--branch', branch,
  ];
  console.log(`  ブランチ: ${branch}`);
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
    // ★2026-08-26修正: Windowsでは npx は npx.cmd(バッチファイル)であり、
    //   shell:true 無しの spawn('npx', ...) は ENOENT で即失敗する(実機で発見。
    //   デプロイ失敗の実エラーではなく、コマンドが起動すらしていなかった)。
    //   argsは固定パターン(wrangler pages deploy <dir> --project-name <name>)のみで
    //   ユーザー入力を直接シェル解釈させる経路にはならないため、shell:trueで許容する。
    const child = spawn('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

main();
