#!/usr/bin/env node
/**
 * generate-service-status-dashboard.mjs
 *
 * .service-status-snapshot.json を読み、site/hub/status/index.html を生成する
 * （公開リポには一切書かない出力先。LINEハーネスの複数アカウント生死監視と
 * 同じ発想を、GitHub Actions・Vercel・Cloudflare・Stripe・X・YouTubeへ適用した
 * 一元監視ページ）。
 *
 * ★スナップショットが無い/古い(3日超)ときはexit 0で赤い状態ページを出す
 * (generate-revenue-dashboard.mjsと同じ設計方針)。
 *
 * Usage:
 *   node scripts/generate-service-status-dashboard.mjs --root . --out site/hub/status
 *   node scripts/generate-service-status-dashboard.mjs --selftest
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRepoRoot } from './lib/repo-root.mjs';
import { MATRIX_TABLE_CSS } from './lib/matrix-table-component.mjs';

const argv = process.argv.slice(2);
function option(name, fallback = null) {
  const at = argv.lastIndexOf(name);
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : fallback;
}
function has(name) { return argv.includes(name); }
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const STALE_DAYS = 3;
const STATUS_SYMBOL = { normal: '🟢', warning: '🟡', danger: '🔴', unmeasured: '⚪' };
const STATUS_LABEL = { normal: '正常', warning: '要確認', danger: '異常', unmeasured: '未計測' };

function renderStatePage(reason) {
  return `<!-- 生成物・手編集禁止。正本は .service-status-snapshot.json。再生成は npm run status:page -->
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>サービス稼働状態（未収集）</title>
<link rel="stylesheet" href="../../assets/css/common.css?v=2" />
<link rel="stylesheet" href="../../scripts/site-chrome.css">
<link rel="stylesheet" href="../../scripts/site-chrome.theme.css">
<link rel="stylesheet" href="../../scripts/site-chrome.layout.css">
<link rel="stylesheet" href="../../scripts/site-chrome.local.css">
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #222; background: #fff; }
  .state-box { background: #ffebee; border: 1px solid #ef9a9a; border-radius: 8px; padding: 1.2rem 1.5rem; }
  .state-box h1 { margin-top: 0; font-size: 1.2rem; color: #b00020; }
  code { background: #f4f4f4; padding: 0.1rem 0.3rem; border-radius: 3px; }
</style>
</head>
<body>
<div id="site-header"></div>
<div class="state-box">
  <h1>🔴 まだ収集されていません</h1>
  <p>${escapeHtml(reason)}</p>
  <p>ローカルで <code>npm run status:collect</code> を実行してから、再度 <code>npm run deploy:site</code> してください。</p>
</div>
<div id="site-footer"></div>
<script src="../../scripts/site-chrome.config.js"></script>
<script src="../../scripts/site-chrome.js"></script>
<script src="../../scripts/site-chrome.local.js"></script>
</body>
</html>
`;
}

function renderGithubRows(list) {
  return (list || []).map((s) => `<tr>
    <td class="proj-col">${escapeHtml(s.repo)}</td>
    <td data-state="${s.status === 'normal' ? 'ok' : s.status === 'danger' ? 'missing' : 'unknown'}">${STATUS_SYMBOL[s.status] || '⚪'} ${escapeHtml(STATUS_LABEL[s.status] || s.status)}</td>
    <td>${escapeHtml(s.detail || '')}</td>
  </tr>`).join('\n');
}

function renderGenericRows(list, idLabel) {
  return (list || []).map((s) => `<tr>
    <td class="proj-col">${escapeHtml(s[idLabel] || s.id)}</td>
    <td data-state="${s.status === 'normal' ? 'ok' : s.status === 'danger' ? 'missing' : 'unknown'}">${STATUS_SYMBOL[s.status] || '⚪'} ${escapeHtml(STATUS_LABEL[s.status] || s.status)}</td>
    <td>${escapeHtml(s.detail || '')}</td>
  </tr>`).join('\n');
}

function renderDashboard(snapshot) {
  const generatedAt = new Date(snapshot.generatedAt);
  const ageDays = (Date.now() - generatedAt.getTime()) / 86400_000;
  const stale = ageDays > STALE_DAYS;
  const s = snapshot.services || {};

  const allDanger = [
    ...(s.github || []).filter((x) => x.status === 'danger').map((x) => `GitHub: ${x.repo}`),
    ...(s.vercel || []).filter((x) => x.status === 'danger').map((x) => `Vercel: ${x.id}`),
    ...(s.cloudflare || []).filter((x) => x.status === 'danger').map((x) => `Cloudflare: ${x.host}`),
    ...(s.stripe?.status === 'danger' ? ['Stripe'] : []),
    ...(s.social || []).filter((x) => x.status === 'danger').map((x) => x.id),
  ];

  return `<!-- 生成物・手編集禁止。正本は .service-status-snapshot.json。再生成は npm run status:page -->
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>サービス稼働状態</title>
<link rel="stylesheet" href="../../assets/css/common.css?v=2" />
<link rel="stylesheet" href="../../scripts/site-chrome.css">
<link rel="stylesheet" href="../../scripts/site-chrome.theme.css">
<link rel="stylesheet" href="../../scripts/site-chrome.layout.css">
<link rel="stylesheet" href="../../scripts/site-chrome.local.css">
<style>
${MATRIX_TABLE_CSS}
  body { font-family: system-ui, sans-serif; max-width: 1000px; margin: 2rem auto; padding: 0 1rem; color: #222; background: #fff; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.05rem; margin-top: 2rem; }
  .meta { color: #666; font-size: 0.9rem; margin-bottom: 1rem; }
  .stale-banner { background: #fff3e0; border: 1px solid #ffb74d; border-radius: 6px; padding: 0.6rem 1rem; margin-bottom: 1rem; color: #8a4b00; }
  .danger-line { background: #ffebee; border: 1px solid #ef9a9a; border-radius: 6px; padding: 0.8rem 1.2rem; margin-bottom: 1.5rem; font-weight: 600; color: #b00020; }
</style>
</head>
<body>
<div id="site-header"></div>
<h1>🩺 サービス稼働状態（一元監視）</h1>
<p class="meta">収集: ${escapeHtml(snapshot.generatedAt)}</p>
${stale ? `<div class="stale-banner">⏳ 収集から${Math.floor(ageDays)}日経過しています。npm run status:collect を再実行してください。</div>` : ''}
${allDanger.length > 0 ? `<div class="danger-line">🔴 異常あり: ${allDanger.map(escapeHtml).join(' / ')}</div>` : '<div class="danger-line" style="background:#e8f5e9;border-color:#a5d6a7;color:#1b5e20;">🟢 異常はありません</div>'}

<section class="matrix-section">
  <h2>GitHub Actions</h2>
  <div class="matrix-scroll"><table class="kit-matrix">
    <thead><tr><th class="proj-col">リポジトリ</th><th>状態</th><th>詳細</th></tr></thead>
    <tbody>${renderGithubRows(s.github)}</tbody>
  </table></div>
</section>

<section class="matrix-section">
  <h2>Vercel デプロイ</h2>
  <div class="matrix-scroll"><table class="kit-matrix">
    <thead><tr><th class="proj-col">プロダクト</th><th>状態</th><th>詳細</th></tr></thead>
    <tbody>${(s.vercel || []).length > 0 ? renderGenericRows(s.vercel, 'id') : '<tr><td colspan="3">未計測（VERCEL_TOKEN未設定）</td></tr>'}</tbody>
  </table></div>
</section>

<section class="matrix-section">
  <h2>Cloudflare ゾーン</h2>
  <div class="matrix-scroll"><table class="kit-matrix">
    <thead><tr><th class="proj-col">ドメイン</th><th>状態</th><th>詳細</th></tr></thead>
    <tbody>${(s.cloudflare || []).length > 0 ? renderGenericRows(s.cloudflare, 'host') : '<tr><td colspan="3">未計測</td></tr>'}</tbody>
  </table></div>
</section>

<section class="matrix-section">
  <h2>Stripe / SNS</h2>
  <div class="matrix-scroll"><table class="kit-matrix">
    <thead><tr><th class="proj-col">サービス</th><th>状態</th><th>詳細</th></tr></thead>
    <tbody>
      <tr><td class="proj-col">Stripe</td><td data-state="${s.stripe?.status === 'normal' ? 'ok' : s.stripe?.status === 'danger' ? 'missing' : 'unknown'}">${STATUS_SYMBOL[s.stripe?.status] || '⚪'} ${escapeHtml(STATUS_LABEL[s.stripe?.status] || '未計測')}</td><td>${escapeHtml(s.stripe?.detail || '')}</td></tr>
      ${renderGenericRows(s.social, 'id')}
    </tbody>
  </table></div>
</section>

<div id="site-footer"></div>
<script src="../../scripts/site-chrome.config.js"></script>
<script src="../../scripts/site-chrome.js"></script>
<script src="../../scripts/site-chrome.local.js"></script>
</body>
</html>
`;
}

function loadSnapshot(kitRoot) {
  const path = join(kitRoot, '.service-status-snapshot.json');
  if (!existsSync(path)) return { state: 'missing' };
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    return { state: 'broken', error: e.message };
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { state: 'broken', error: `JSON.parse失敗: ${e.message}` };
  }
  if (!json.generatedAt || !json.services) {
    return { state: 'broken', error: 'generatedAt または services が不正です' };
  }
  return { state: 'ok', snapshot: json };
}

function main() {
  if (has('--selftest')) {
    process.exit(runSelfTest());
  }

  const root = resolve(option('--root', '.'));
  const outDir = resolve(root, option('--out', 'site/hub/status'));
  const kitRoot = findRepoRoot(root);

  const result = loadSnapshot(kitRoot);
  mkdirSync(outDir, { recursive: true });

  if (result.state === 'broken') {
    console.error(`[generate-service-status-dashboard] FAIL  スナップショットが壊れています: ${result.error}`);
    process.exit(1);
  }
  if (result.state === 'missing') {
    writeFileSync(join(outDir, 'index.html'), renderStatePage('.service-status-snapshot.json がまだありません（一度も収集していません）。'), 'utf8');
    console.log('[generate-service-status-dashboard] OK    未収集の赤い状態ページを生成しました');
    process.exit(0);
  }

  writeFileSync(join(outDir, 'index.html'), renderDashboard(result.snapshot), 'utf8');
  console.log(`[generate-service-status-dashboard] OK    ${outDir} を生成しました`);
}

/** --selftest: 固定の疑似スナップショットからdanger/stale表示が出るか確認する。 */
function runSelfTest() {
  const fails = [];

  {
    const html = renderStatePage('テスト用理由');
    if (!html.includes('まだ収集されていません')) fails.push('missing: 赤い状態ページの文言が出ない');
  }

  {
    const fakeSnapshot = {
      generatedAt: new Date(Date.now() - 5 * 86400_000).toISOString(),
      services: {
        github: [{ id: 'p1', repo: 'kimito-link/p1', status: 'danger', detail: '直近5件中2件失敗' }],
        vercel: [{ id: 'p1', status: 'normal', detail: '最新デプロイREADY' }],
        cloudflare: [{ id: 'p1', host: 'p1.example.com', status: 'warning', detail: 'ゾーンstatus=pending' }],
        stripe: { status: 'normal', detail: 'API疎通OK' },
        social: [{ id: 'x:p1', status: 'danger', detail: '認証エラー' }],
      },
    };
    const html = renderDashboard(fakeSnapshot);
    if (!html.includes('異常あり')) fails.push('正常系: 異常ありの見出しが出ない');
    if (!html.includes('stale-banner')) fails.push('正常系: staleバナーが出ない');
    if (!html.includes('kimito-link/p1')) fails.push('正常系: GitHub行が出ない');
    if (!html.includes('x:p1')) fails.push('正常系: SNS行が出ない');
  }

  if (fails.length) {
    console.error('[generate-service-status-dashboard] --selftest FAIL');
    for (const f of fails) console.error(`  - ${f}`);
    return 1;
  }
  console.log('[generate-service-status-dashboard] --selftest OK');
  return 0;
}

main();
