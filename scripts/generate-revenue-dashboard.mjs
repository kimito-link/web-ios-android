#!/usr/bin/env node
/**
 * generate-revenue-dashboard.mjs
 *
 * .revenue-snapshot.json(+.social-snapshot.json)を読み、
 * site/hub/revenue/index.html を生成する(公開リポには一切書かない出力先)。
 *
 * 設計: _docs/DESIGN-revenue-bottleneck-dashboard-2026-09-08.md §B-7, B-8
 *
 * ★スナップショットが無い/古い(3日超)ときはexit 0で赤い状態ページを出す
 * (deploy:siteを認証情報の有無に人質にしない。ただし画面は決して緑にならない)。
 * 壊れたJSONはexit 1。
 *
 * Usage:
 *   node scripts/generate-revenue-dashboard.mjs --root . --out site/hub/revenue
 *   node scripts/generate-revenue-dashboard.mjs --selftest
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRepoRoot } from './lib/repo-root.mjs';
import { MATRIX_TABLE_CSS } from './lib/matrix-table-component.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
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
function fmtMoney(cents, currency) {
  if (cents === null || cents === undefined) return '—';
  // Stripeの最小単位そのまま。JPYはゼロ小数(設計B-3)なので割らない。通貨換算はしない。
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents).toLocaleString('ja-JP');
  const unit = currency ? currency.toUpperCase() : '';
  return `${sign}${abs} ${unit}`.trim();
}
function fmtDelta(cur, prev) {
  if (cur === null || cur === undefined || prev === null || prev === undefined || prev === 0) return '';
  const pct = Math.round(((cur - prev) / prev) * 100);
  const sign = pct >= 0 ? '+' : '';
  return ` (${sign}${pct}%)`;
}
function fmtNum(n) {
  return n === null || n === undefined ? '—' : n.toLocaleString('ja-JP');
}

const BOTTLENECK_LABEL = {
  unmeasured: { symbol: '🔴', text: '計測不能', cls: 'bn-red' },
  monetize: { symbol: '🔴', text: '課金導線', cls: 'bn-red' },
  acquire: { symbol: '🔴', text: '集客', cls: 'bn-red' },
  decline: { symbol: '🟡', text: '減速', cls: 'bn-yellow' },
  ok: { symbol: '🟢', text: '順調', cls: 'bn-green' },
};

const ACQUIRE_THRESHOLD = 10;
const DECLINE_THRESHOLD_PCT = 30;
const STALE_DAYS = 3;

function renderStatePage(reason) {
  return `<!-- 生成物・手編集禁止。正本は .revenue-snapshot.json。再生成は npm run revenue:page -->
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>売上・DLボトルネック（未収集）</title>
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
  <p>ローカルで <code>npm run revenue:collect</code> を実行してから、再度 <code>npm run deploy:site</code> してください。</p>
</div>
<div id="site-footer"></div>
<script src="../../scripts/site-chrome.config.js"></script>
<script src="../../scripts/site-chrome.js"></script>
<script src="../../scripts/site-chrome.local.js"></script>
</body>
</html>
`;
}

function renderSourceStatus(sources) {
  const rows = Object.entries(sources).map(([key, s]) => {
    if (s.ok) return `<li>✅ ${escapeHtml(key)}${s.lagDays != null ? `（${s.lagDays}日前まで反映）` : ''}</li>`;
    return `<li>🔴 ${escapeHtml(key)}: ${escapeHtml(s.error || '不明なエラー')}${s.howToFix ? `<br><span class="howtofix">→ 直し方: ${escapeHtml(s.howToFix)}</span>` : ''}</li>`;
  });
  return `<ul class="source-status">${rows.join('')}</ul>`;
}

function computeWorstLine(products, windowDays) {
  const reds = products.filter((p) => p.bottleneck?.stage === 'monetize' || p.bottleneck?.stage === 'acquire' || p.bottleneck?.stage === 'unmeasured');
  if (reds.length === 0) return null;
  reds.sort((a, b) => {
    const dlA = (a.store?.asc?.units30d ?? 0) + (a.store?.play?.installs30d ?? 0);
    const dlB = (b.store?.asc?.units30d ?? 0) + (b.store?.play?.installs30d ?? 0);
    return dlB - dlA;
  });
  const worst = reds[0];
  return `${worst.name}: ${worst.bottleneck.reason}`;
}

function renderProductRow(p) {
  const bn = BOTTLENECK_LABEL[p.bottleneck?.stage] || BOTTLENECK_LABEL.unmeasured;
  const asc = p.store?.asc;
  const play = p.store?.play;
  const stripe = p.stripe || {};
  return `<tr>
    <td class="proj-col">${asc?.appId || play?.package ? `<a href="${escapeHtml(p.url)}">${escapeHtml(p.name)}</a>` : escapeHtml(p.name)}</td>
    <td>${escapeHtml(p.brand || '—')}</td>
    <td>${asc ? '📱' : ''}${play ? '🤖' : ''}${!asc && !play ? '—' : ''}</td>
    <td>${asc ? `${fmtNum(asc.units30d)}${fmtDelta(asc.units30d, asc.unitsPrev30d)}` : '—'}</td>
    <td>${play ? `${fmtNum(play.installs30d)}${fmtDelta(play.installs30d, play.installsPrev30d)}` : '—'}</td>
    <td>${fmtMoney(stripe.gross30d, stripe.currency)}${fmtDelta(stripe.gross30d, stripe.grossPrev30d)}</td>
    <td>${fmtNum(stripe.activeSubs)}</td>
    <td>${asc?.proceeds30d != null ? fmtMoney(asc.proceeds30d, asc.currency) : '—'}</td>
    <td class="${bn.cls}">${bn.symbol} ${escapeHtml(bn.text)}</td>
  </tr>`;
}

function renderDashboard(snapshot, socialSnapshot) {
  const generatedAt = new Date(snapshot.generatedAt);
  const ageDays = (Date.now() - generatedAt.getTime()) / 86400_000;
  const stale = ageDays > STALE_DAYS;

  const products = [...snapshot.products].sort((a, b) => (b.stripe?.gross30d ?? 0) - (a.stripe?.gross30d ?? 0));
  const worstLine = computeWorstLine(products, snapshot.window.days);

  const rows = products.map(renderProductRow).join('\n');

  const unassignedRows = (snapshot.unassignedStripe || []).map((u) => `<tr class="unassigned-row">
    <td class="proj-col">🔴 未割当: ${escapeHtml(u.name)}</td>
    <td colspan="7"></td>
    <td>${fmtMoney(u.gross, '')}</td>
  </tr>`).join('\n');

  const socialSection = socialSnapshot
    ? `<section class="matrix-section">
  <h2>集客: フォロワー数（前月比）</h2>
  <div class="matrix-scroll"><table class="kit-matrix">
    <thead><tr><th class="proj-col">プロダクト</th><th>X フォロワー</th><th>YouTube 登録者</th></tr></thead>
    <tbody>
      ${socialSnapshot.products.map((p) => `<tr>
        <td class="proj-col">${escapeHtml(p.name)}</td>
        <td>${p.x?.ok ? fmtNum(p.x.followers) : (p.x ? `🔴 ${escapeHtml(p.x.error)}` : '未設定')}</td>
        <td>${p.youtube?.ok ? fmtNum(p.youtube.subscribers) : (p.youtube ? `🔴 ${escapeHtml(p.youtube.error)}` : '未設定')}</td>
      </tr>`).join('\n')}
    </tbody>
  </table></div>
</section>`
    : '';

  return `<!-- 生成物・手編集禁止。正本は .revenue-snapshot.json。再生成は npm run revenue:page -->
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>売上・DLボトルネック</title>
<link rel="stylesheet" href="../../assets/css/common.css?v=2" />
<link rel="stylesheet" href="../../scripts/site-chrome.css">
<link rel="stylesheet" href="../../scripts/site-chrome.theme.css">
<link rel="stylesheet" href="../../scripts/site-chrome.layout.css">
<link rel="stylesheet" href="../../scripts/site-chrome.local.css">
<style>
${MATRIX_TABLE_CSS}
  body { font-family: system-ui, sans-serif; max-width: 1200px; margin: 2rem auto; padding: 0 1rem; color: #222; background: #fff; }
  h1 { font-size: 1.4rem; }
  .meta { color: #666; font-size: 0.9rem; margin-bottom: 1rem; }
  .stale-banner { background: #fff3e0; border: 1px solid #ffb74d; border-radius: 6px; padding: 0.6rem 1rem; margin-bottom: 1rem; color: #8a4b00; }
  .worst-line { background: #ffebee; border: 1px solid #ef9a9a; border-radius: 6px; padding: 0.8rem 1.2rem; margin-bottom: 1.5rem; font-weight: 600; color: #b00020; }
  .source-status { list-style: none; padding: 0; font-size: 0.85rem; }
  .source-status li { margin-bottom: 0.3rem; }
  .howtofix { color: #666; }
  .bn-red { background: #ffebee; color: #b00020; }
  .bn-yellow { background: #fff8e1; color: #8a6d00; }
  .bn-green { background: #e8f5e9; color: #1b5e20; }
  .unassigned-row { background: #fff3e0; }
  .rule-list { font-size: 0.82rem; color: #555; }
</style>
</head>
<body>
<div id="site-header"></div>
<h1>💰 売上・DLボトルネック</h1>
<p class="meta">
  収集: ${escapeHtml(snapshot.generatedAt)}（${snapshot.window.from} 〜 ${snapshot.window.to}、${snapshot.window.days}日窓）
</p>
${stale ? `<div class="stale-banner">⏳ 収集から${Math.floor(ageDays)}日経過しています。npm run revenue:collect を再実行してください。</div>` : ''}
${renderSourceStatus(snapshot.sources)}
${worstLine ? `<div class="worst-line">🎯 一番弱いところ: ${escapeHtml(worstLine)}</div>` : ''}
<section class="matrix-section">
  <div class="matrix-scroll"><table class="kit-matrix">
    <thead><tr>
      <th class="proj-col">プロダクト</th><th>ブランド</th><th>掲載</th>
      <th>DL 30日(iOS)</th><th>installs 30日(Android)</th>
      <th>Stripe売上 30日</th><th>継続本数</th><th>ストア内課金</th><th>ボトルネック</th>
    </tr></thead>
    <tbody>
${rows}
${unassignedRows}
    </tbody>
  </table></div>
</section>
${!snapshot.reconcile.ok && snapshot.reconcile.ok !== null ? `<p class="worst-line">🔴 突合ズレ: プロダクト別合計 ${fmtMoney(snapshot.reconcile.sumOfProducts)} vs Stripe純額 ${fmtMoney(snapshot.reconcile.stripeNet30d)}（1%超のズレ）</p>` : ''}
${socialSection}
<section class="rule-list">
  <h3>ボトルネック判定ルール</h3>
  <ol>
    <li>計測できない列がある → 🔴 計測不能</li>
    <li>Stripe/ストア内課金 売上0 かつ DL&gt;0 → 🔴 課金導線</li>
    <li>ストア掲載済みでDL 30日 &lt; ${ACQUIRE_THRESHOLD} → 🔴 集客</li>
    <li>売上 前期比 −${DECLINE_THRESHOLD_PCT}%以下 → 🟡 減速</li>
    <li>それ以外 → 🟢 順調</li>
  </ol>
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
  const path = join(kitRoot, '.revenue-snapshot.json');
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
  if (!json.generatedAt || !Array.isArray(json.products)) {
    return { state: 'broken', error: 'generatedAt または products が不正です' };
  }
  return { state: 'ok', snapshot: json };
}

function loadSocialSnapshot(kitRoot) {
  const path = join(kitRoot, '.social-snapshot.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null; // 任意機能。壊れていても本体を止めない(設計F-3)。
  }
}

function main() {
  if (has('--selftest')) {
    process.exit(runSelfTest());
  }

  const root = resolve(option('--root', '.'));
  const outDir = resolve(root, option('--out', 'site/hub/revenue'));
  const kitRoot = findRepoRoot(root);

  const result = loadSnapshot(kitRoot);
  mkdirSync(outDir, { recursive: true });

  if (result.state === 'broken') {
    console.error(`[generate-revenue-dashboard] FAIL  スナップショットが壊れています: ${result.error}`);
    process.exit(1);
  }
  if (result.state === 'missing') {
    writeFileSync(join(outDir, 'index.html'), renderStatePage('.revenue-snapshot.json がまだありません（一度も収集していません）。'), 'utf8');
    console.log('[generate-revenue-dashboard] OK    未収集の赤い状態ページを生成しました');
    process.exit(0);
  }

  const socialSnapshot = loadSocialSnapshot(kitRoot);
  writeFileSync(join(outDir, 'index.html'), renderDashboard(result.snapshot, socialSnapshot), 'utf8');
  console.log(`[generate-revenue-dashboard] OK    ${outDir} を生成しました（products=${result.snapshot.products.length}）`);
}

/** --selftest: 固定の疑似スナップショットから赤/黄/緑・未割当・staleが出るか確認する(設計B-8)。 */
function runSelfTest() {
  const fails = [];

  // missingケース
  {
    const html = renderStatePage('テスト用理由');
    if (!html.includes('まだ収集されていません')) fails.push('missing: 赤い状態ページの文言が出ない');
  }

  // 正常系: 赤(monetize)/黄(decline)/緑(ok)/未割当/staleが全部出るか
  {
    const fakeSnapshot = {
      generatedAt: new Date(Date.now() - 5 * 86400_000).toISOString(), // 5日前 = stale
      window: { days: 30, from: '2026-08-09', to: '2026-09-07' },
      sources: { stripe: { ok: true }, asc: { ok: true }, play: { ok: true } },
      products: [
        { id: 'p-red-monetize', name: 'Red Monetize', brand: 'kimito-link', url: '', store: { asc: { appId: '1', units30d: 42, unitsPrev30d: 51, proceeds30d: 0 }, play: null }, stripe: { currency: 'jpy', gross30d: 0, grossPrev30d: 0, paidCount30d: 0, activeSubs: 0, mrr: 0 }, bottleneck: { stage: 'monetize', reason: 'DL 42/30日 に対し課金 0' } },
        { id: 'p-yellow-decline', name: 'Yellow Decline', brand: 'reverse-hack', url: '', store: { asc: null, play: { package: 'x', installs30d: 20, installsPrev30d: 10 } }, stripe: { currency: 'jpy', gross30d: 700, grossPrev30d: 1000, paidCount30d: 1, activeSubs: 1, mrr: 700 }, bottleneck: { stage: 'decline', reason: '売上が前期比 30% 減' } },
        { id: 'p-green-ok', name: 'Green OK', brand: 'corporate', url: '', store: { asc: { appId: '2', units30d: 100, unitsPrev30d: 80, proceeds30d: 500 }, play: null }, stripe: { currency: 'jpy', gross30d: 9800, grossPrev30d: 8000, paidCount30d: 5, activeSubs: 3, mrr: 9800 }, bottleneck: { stage: 'ok', reason: '' } },
      ],
      unassignedStripe: [{ productId: 'prod_x', name: 'Unassigned Thing', gross: 980 }],
      reconcile: { stripeNet30d: 10000, sumOfProducts: 10500, refunds30d: 0, fees30d: 0, ok: false },
    };
    const html = renderDashboard(fakeSnapshot, null);
    if (!html.includes('bn-red')) fails.push('正常系: 赤(monetize)の表示クラスが出ない');
    if (!html.includes('bn-yellow')) fails.push('正常系: 黄(decline)の表示クラスが出ない');
    if (!html.includes('bn-green')) fails.push('正常系: 緑(ok)の表示クラスが出ない');
    if (!html.includes('未割当')) fails.push('正常系: 未割当行が出ない');
    if (!html.includes('stale-banner') || !html.includes('経過しています')) fails.push('正常系: staleバナーが出ない');
    if (!html.includes('突合ズレ')) fails.push('正常系: reconcile.ok=falseで突合ズレ表示が出ない');
    if (!html.includes('一番弱いところ')) fails.push('正常系: 「一番弱いところ」1行が出ない');
  }

  if (fails.length) {
    console.error('[generate-revenue-dashboard] --selftest FAIL');
    for (const f of fails) console.error(`  - ${f}`);
    return 1;
  }
  console.log('[generate-revenue-dashboard] --selftest OK');
  return 0;
}

main();
