#!/usr/bin/env node
/**
 * cloudflare-auth.mjs — Cloudflareへの認証を確立する（web-ios-android キット）
 *
 * 背景（LP先行→ドメイン接続 MVP の一部）:
 *   独自ドメインをCloudflare Pagesに接続する（connect-domain.mjs / deploy-cloudflare-pages.mjs）には
 *   Cloudflareへの認証が要る。ローカルでの初回セットアップは `wrangler login` のブラウザOAuthを使う
 *   （Wranglerプロセス自身がlocalhostに一時HTTPサーバーを立ててコールバックを受ける方式で、外部の
 *   サーバー常駐は不要）。CI（GitHub Actions）はブラウザ操作ができないため `CLOUDFLARE_API_TOKEN`
 *   環境変数の存在確認のみ行う。
 *
 *   設計: _docs/DESIGN-lp-first-domain-connect-2026-07-13.md
 *
 * 使い方:
 *   node templates/scripts/cloudflare-auth.mjs              # ローカル: wrangler login を必要なら実行
 *   node templates/scripts/cloudflare-auth.mjs --dry-run    # 何もしない・分岐だけ確認
 *   node templates/scripts/cloudflare-auth.mjs --ci         # CI環境として扱う（CLOUDFLARE_API_TOKENの存在確認のみ）
 *
 * 安全方針:
 *   - トークンの値は一切標準出力・ログに出さない。出すのは「認証済み/未認証」だけ。
 *   - CI環境判定は env CI（GitHub Actions既定でtrue）または --ci フラグ。
 */
import { spawn, execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean' },
    ci: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (values.help) {
  console.log(
    [
      'cloudflare-auth: Cloudflareへの認証を確立する。',
      '',
      '  ローカル: 未ログインなら `wrangler login` のブラウザOAuthを起動する（既にログイン済みならスキップ）。',
      '  CI:      CLOUDFLARE_API_TOKEN 環境変数の存在確認のみ行う（ブラウザ操作はしない）。',
      '',
      'オプション: --dry-run（何もせず分岐だけ表示） / --ci（CI環境として強制扱い）',
    ].join('\n'),
  );
  process.exit(0);
}

function header(t) { const b = '='.repeat(64); console.log(`\n${b}\n  ${t}\n${b}`); }

const isCi = !!values.ci || process.env.CI === 'true' || process.env.CI === '1';
const dryRun = !!values['dry-run'];

async function main() {
  header(`cloudflare-auth ${dryRun ? '(DRY-RUN)' : ''} — 環境: ${isCi ? 'CI' : 'ローカル'}`);

  if (isCi) {
    await ensureCiToken();
    return;
  }
  await ensureLocalLogin();
}

/** CI環境: CLOUDFLARE_API_TOKEN の存在確認のみ（値は出力しない）。 */
async function ensureCiToken() {
  const has = !!process.env.CLOUDFLARE_API_TOKEN;
  if (!has) {
    console.error('  FAIL  CLOUDFLARE_API_TOKEN が未設定です。GitHub Secrets に登録してください。');
    console.error('        登録手順: templates/scripts/bootstrap-secrets.mjs（CI用のみ）');
    process.exit(1);
  }
  console.log('  OK    CLOUDFLARE_API_TOKEN が設定されています（値は表示しません）。');
  if (dryRun) {
    console.log('  DRY   実際のAPI呼び出しは行いません。');
    return;
  }
}

/** ローカル環境: 既にログイン済みなら何もしない。未ログインなら wrangler login を起動する。 */
async function ensureLocalLogin() {
  const already = isAlreadyLoggedIn();
  if (already) {
    console.log('  OK    既にCloudflareにログイン済みです（wrangler whoami で確認）。');
    return;
  }

  console.log('  --    未ログインです。');
  if (dryRun) {
    console.log('  DRY   実際には `wrangler login` を起動しません（--dry-run）。');
    return;
  }

  console.log('  ブラウザでCloudflareへのログイン画面を開きます。');
  console.log('  表示されたら、Cloudflareアカウントでログインし「Allow」を押してください。');

  const ok = await runWranglerLogin();
  if (!ok) {
    console.error('  FAIL  wrangler login が完了しませんでした。');
    console.error('        コンテナ/リモート開発環境（Codespaces・devcontainer等）では、');
    console.error('        localhostへのOAuthコールバックがホストブラウザから届かず失敗することがあります。');
    console.error('        その場合は CLOUDFLARE_API_TOKEN を環境変数に設定して再実行してください:');
    console.error('          node templates/scripts/cloudflare-auth.mjs --ci');
    process.exit(1);
  }
  console.log('  OK    ログインが完了しました。');
}

/** `wrangler whoami` の終了コードでログイン済みかを判定する。 */
function isAlreadyLoggedIn() {
  try {
    execFileSync('npx', ['wrangler', 'whoami'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** `wrangler login` を子プロセスとして起動し、終了コードで成否を返す。 */
function runWranglerLogin() {
  return new Promise((resolve) => {
    // ★2026-08-26修正: Windowsのnpxはnpx.cmdでありshell:true無しはENOENT
    // (deploy-cloudflare-pages.mjsと同型のバグ。実機で発見)。
    const child = spawn('npx', ['wrangler', 'login'], { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

main();
