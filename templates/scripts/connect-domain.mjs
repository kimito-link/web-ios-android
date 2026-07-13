#!/usr/bin/env node
/**
 * connect-domain.mjs — 独自ドメインをCloudflare Pagesプロジェクトに接続する（web-ios-android キット）
 *
 * 背景（LP先行→ドメイン接続 MVP の一部）:
 *   Cloudflare REST API（POST /pages/projects/:name/domains）を直叩きしてカスタムドメインを紐付ける。
 *   ゾーンがCloudflare管理下ならCNAMEは自動生成される。冪等設計（既に紐付いていれば成功終了）。
 *   DNS反映・SSL発行はCloudflare側の非同期処理のため、完了をポーリングで待つ。
 *
 *   設計: _docs/DESIGN-lp-first-domain-connect-2026-07-13.md
 *
 * 認証:
 *   CLOUDFLARE_API_TOKEN 環境変数を使う（ローカルの wrangler login セッションはこのスクリプトの
 *   REST API直叩きには使えないため、ローカルでも一時的にトークンを環境変数へ設定して実行する）。
 *   実行冒頭で GET /user/tokens/verify によりトークンの有効性を確認し、無効ならその場で失敗する
 *   （fail-closed。空値トークンのまま進めて事故る過去事故と同型のミスを防ぐ）。
 *
 * 使い方:
 *   node templates/scripts/connect-domain.mjs --project <name> --domain <example.com>
 *   node templates/scripts/connect-domain.mjs --dry-run          # API呼び出しをせず設定確認のみ
 *
 * オプション:
 *   --project <name>   Cloudflare Pagesのプロジェクト名（既定: app.config.json の web.deploy.projectName）
 *   --domain <host>    接続するドメイン（既定: app.config.json の web.deploy.customDomain）
 *   --dry-run          実際にはAPIを呼ばない
 *   --timeout <sec>    SSL発行待ちポーリングの最大秒数（既定300）
 */
import { parseArgs } from 'node:util';
import { cfg } from './lib/app-config.mjs';

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    domain: { type: 'string' },
    'dry-run': { type: 'boolean' },
    timeout: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (values.help) {
  console.log(
    [
      'connect-domain: 独自ドメインをCloudflare Pagesプロジェクトに接続する（冪等）。',
      '',
      '  CLOUDFLARE_API_TOKEN 環境変数を使用。実行冒頭でトークンの有効性を確認する。',
      '',
      'オプション: --project <name> / --domain <host> / --dry-run / --timeout <sec>',
    ].join('\n'),
  );
  process.exit(0);
}

function header(t) { const b = '='.repeat(64); console.log(`\n${b}\n  ${t}\n${b}`); }

const API_BASE = 'https://api.cloudflare.com/client/v4';

async function main() {
  const projectName = values.project || cfg('web.deploy.projectName');
  const domain = values.domain || cfg('web.deploy.customDomain');
  const dryRun = !!values['dry-run'];
  const timeoutSec = Number(values.timeout || 300);

  header(`connect-domain ${dryRun ? '(DRY-RUN)' : ''}`);

  if (!domain) {
    // customDomainを使わない(=Cloudflare Pages既定のURLだけで良い)アプリの方が多い。
    // 明示指定が無ければ「独自ドメインは使わない」という正当な選択として黙ってスキップする。
    console.log('  --    独自ドメインは設定されていません（web.deploy.customDomain 未設定）。何もしません。');
    return;
  }
  if (!projectName) {
    console.error('  FAIL  Cloudflare Pagesのプロジェクト名が不明です。');
    console.error('        app.config.json の web.deploy.projectName を設定するか --project を指定してください。');
    process.exit(1);
  }

  console.log(`  プロジェクト: ${projectName}`);
  console.log(`  ドメイン: ${domain}`);

  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    console.error('  FAIL  CLOUDFLARE_API_TOKEN が未設定です。');
    process.exit(1);
  }

  if (dryRun) {
    console.log('  DRY   実際のAPI呼び出しは行いません（トークン検証も省略）。');
    return;
  }

  await verifyToken(token);

  const already = await isDomainAlreadyAttached(token, projectName, domain);
  if (already) {
    console.log('  OK    既にこのドメインは接続済みです（冪等・何もしません）。');
    return;
  }

  await attachDomain(token, projectName, domain);
  await pollUntilActive(token, projectName, domain, timeoutSec);
  console.log(`  OK    https://${domain} で公開されています。`);
}

/** トークンの有効性を確認する。無効ならその場で失敗（fail-closed）。 */
async function verifyToken(token) {
  const res = await fetch(`${API_BASE}/user/tokens/verify`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    console.error('  FAIL  CLOUDFLARE_API_TOKENが無効です。トークンを再発行してください。');
    console.error('        参照: _docs/cloudflare-workers-token-expiry-knowledge-base.md');
    process.exit(1);
  }
  console.log('  OK    トークンは有効です。');
}

/** 既にこのドメインがプロジェクトに接続済みか確認する（冪等性のため）。 */
async function isDomainAlreadyAttached(token, projectName, domain) {
  const res = await fetch(`${API_BASE}/pages/projects/${encodeURIComponent(projectName)}/domains`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return false;
  const body = await res.json().catch(() => null);
  const list = body?.result || [];
  return list.some((d) => d?.name === domain);
}

/** ドメインをプロジェクトに接続する。 */
async function attachDomain(token, projectName, domain) {
  const res = await fetch(`${API_BASE}/pages/projects/${encodeURIComponent(projectName)}/domains`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: domain }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const errText = body?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    console.error(`  FAIL  ドメイン接続に失敗しました: ${errText}`);
    process.exit(1);
  }
  console.log('  OK    ドメイン接続をリクエストしました。DNS反映・SSL発行を待ちます…');
}

/** SSL発行完了までポーリングする。タイムアウトしても再実行可能な冪等設計。 */
async function pollUntilActive(token, projectName, domain, timeoutSec) {
  const start = Date.now();
  const intervalMs = 5000;
  while ((Date.now() - start) / 1000 < timeoutSec) {
    const res = await fetch(
      `${API_BASE}/pages/projects/${encodeURIComponent(projectName)}/domains/${encodeURIComponent(domain)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = await res.json().catch(() => null);
    const status = body?.result?.status;
    if (status === 'active') {
      console.log('  OK    SSL証明書が発行され、有効になりました。');
      return;
    }
    console.log(`  ...   待機中（状態: ${status || '不明'}）`);
    await sleep(intervalMs);
  }
  console.error(`  FAIL  ${timeoutSec}秒待っても有効になりませんでした。`);
  console.error('        DNS反映には数分〜最大24時間かかることがあります。同じコマンドを再実行してください（冪等）。');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
