#!/usr/bin/env node
/**
 * generate-shindan-version.mjs
 *
 * 各アプリ本体に /check-shindan-version/ を作る共通生成器。
 * - Next.js App Router: public/check-shindan-version/report.json を更新し、同梱 page.tsx が表示
 * - 静的サイト: <公開ルート>/check-shindan-version/index.html と report.json を生成
 *
 * 進捗率は品質点ではない。「導入・配線・実測・履歴・公開」の確認可能な節目だけを数える。
 * 測れなかった項目は 0 点に偽装せず、黄色の「未計測」として独立表示する。
 *
 * Usage:
 *   node scripts/generate-shindan-version.mjs
 *   node scripts/generate-shindan-version.mjs --measure
 *   node scripts/generate-shindan-version.mjs --root . --out site/check-shindan-version
 *   node scripts/generate-shindan-version.mjs --selftest
 */
import {
  existsSync, mkdirSync, readFileSync, writeFileSync
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

function option(name, fallback = null) {
  const at = argv.lastIndexOf(name);
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : fallback;
}
function has(name) { return argv.includes(name); }
function isPlaceholder(value) {
  const text = String(value ?? '').trim();
  return !text || /^<.*>$/.test(text) || /^\{\{.*\}\}$/.test(text);
}
function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}
function firstExisting(root, paths) {
  return paths.map((path) => join(root, path)).find((path) => existsSync(path)) || null;
}
function rel(root, path) {
  return path ? relative(root, path).replaceAll('\\', '/') || '.' : '未導入';
}
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function validColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;
}
function percent(done, total) {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}
function git(root, args, fallback = '') {
  try {
    return execFileSync('git', args, {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000
    }).trim();
  } catch { return fallback; }
}
function verdictStatus(verdict) {
  if (verdict === 'pass') return 'pass';
  if (verdict === 'fail') return 'fail';
  return 'unmeasured';
}
function makeCheck(label, status, evidence, nextAction = '') {
  return { label, status, evidence, nextAction };
}
function fileCheck(root, label, paths, nextAction) {
  const path = firstExisting(root, paths);
  return makeCheck(label, path ? 'pass' : 'unmeasured', rel(root, path), path ? '' : nextAction);
}
function stage(id, title, summary, checks) {
  const completed = checks.filter((check) => check.status === 'pass').length;
  let status = 'unmeasured';
  if (checks.some((check) => check.status === 'fail')) status = 'fail';
  else if (completed === checks.length && checks.length) status = 'pass';
  else if (completed > 0 || checks.some((check) => check.status === 'warning')) status = 'warning';
  return { id, title, summary, status, completed, total: checks.length, percent: percent(completed, checks.length), checks };
}

async function importArray(path, key) {
  if (!path) return [];
  try {
    const module = await import(pathToFileURL(path).href + `?diagnosis=${Date.now()}`);
    return Array.isArray(module[key]) ? module[key] : [];
  } catch { return []; }
}

function runMeasurement(root, reportPath) {
  const runner = firstExisting(root, [
    'scripts/run-instruments.mjs', 'templates/scripts/run-instruments.mjs'
  ]);
  if (!runner) return { attempted: false, exitCode: 2 };
  const result = spawnSync(process.execPath, [runner, '--deep', '--report', reportPath, root], {
    cwd: root, encoding: 'utf8', stdio: 'inherit', timeout: 15 * 60 * 1000
  });
  return { attempted: true, exitCode: Number.isInteger(result.status) ? result.status : 1 };
}

function detectWebRoot(root) {
  const explicit = option('--web-root');
  if (explicit) return resolve(root, explicit);
  const candidates = [root, join(root, 'apps', 'web'), join(root, 'web'), join(root, 'client')];
  return candidates.find((candidate) =>
    existsSync(join(candidate, 'app', 'check-shindan-version', 'page.tsx'))
    || Boolean(readJson(join(candidate, 'package.json'), {})?.dependencies?.next)
  ) || root;
}

function detectOutput(root, webRoot) {
  const explicit = option('--out');
  if (explicit) return resolve(root, explicit);
  if (existsSync(join(webRoot, 'app', 'check-shindan-version', 'page.tsx'))) {
    return join(webRoot, 'public', 'check-shindan-version');
  }
  if (existsSync(join(root, 'public'))) return join(root, 'public', 'check-shindan-version');
  if (existsSync(join(root, 'site'))) return join(root, 'site', 'check-shindan-version');
  if (existsSync(join(root, 'src'))) return join(root, 'src', 'check-shindan-version');
  return join(root, 'check-shindan-version');
}

function statusLabel(status) {
  return ({ pass: '確認済み', warning: '確認中', fail: '問題あり', unmeasured: '未確認' })[status] || '未確認';
}
function statusMark(status) {
  return ({ pass: '✓', warning: '△', fail: '!', unmeasured: '?' })[status] || '?';
}

function publicMetricLabel(label) {
  const friendly = {
    'selftest を持たない診断キットの検査': '追加確認が必要な動作チェック',
    'selftest を持たない配布スクリプト': '追加確認が必要な自動化処理',
    '診断キットの検査本数': '現在使える動作チェック'
  };
  return friendly[String(label || '')] || String(label || '更新項目');
}

function renderStatic(data) {
  const { app, progress, counts, stages, evolution } = data;
  const primary = validColor(app.primaryColor, '#315efb');
  const accent = validColor(app.accentColor, '#11a36a');
  const home = app.homeUrl || '/';
  const displayName = app.name === 'web-ios-android' ? 'アプリ公開キット' : app.name;
  const ringColor = counts.fail > 0 ? '#c43a45' : progress.percent === 100 ? '#047857' : '#d97706';
  const progressMessage = counts.fail > 0
    ? `確認が必要な項目が ${counts.fail} 件あります。詳しい内容は下で確認できます。`
    : progress.percent === 100
      ? '必要な確認はすべて終わっています。'
      : `あと ${Math.max(0, progress.total - progress.completed)} 項目を確認すると完了です。`;
  const stageHtml = stages.map((item) => `
      <article class="stage stage-${escapeHtml(item.status)}">
        <div class="stage-head">
          <div><span class="status">${statusMark(item.status)} ${statusLabel(item.status)}</span><h2>${escapeHtml(item.title)}</h2></div>
          <strong>${item.completed}/${item.total}</strong>
        </div>
        <p>${escapeHtml(item.summary)}</p>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${item.percent}" aria-label="${escapeHtml(item.title)} ${item.percent}%"><i style="width:${item.percent}%"></i></div>
        <ul>${item.checks.map((check) => `<li class="check-${check.status}"><span>${statusMark(check.status)}</span><div><b>${escapeHtml(check.label)}</b><small>${escapeHtml(check.evidence)}</small>${check.status !== 'pass' && check.nextAction ? `<em>次: ${escapeHtml(check.nextAction)}</em>` : ''}</div></li>`).join('')}</ul>
      </article>`).join('');
  const publicLatest = Array.isArray(evolution.publicLatest) ? evolution.publicLatest : evolution.latest;
  const latest = publicLatest.length
    ? publicLatest.map((row) => `<li><b>v${escapeHtml(row.version)}</b><span>${escapeHtml(publicMetricLabel(row.label))}${row.value !== '' ? ` ${escapeHtml(row.value)}${escapeHtml(row.unit)}` : ''}</span></li>`).join('')
    : '<li><span>新しい更新内容は、確認でき次第ここに表示します。</span></li>';
  return `<!doctype html>
  <html lang="ja"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>更新情報と動作チェック | ${escapeHtml(displayName)}</title>
  <meta name="description" content="${escapeHtml(displayName)}の最新版、準備の進み具合、動作確認の結果を分かりやすく表示します。">
  <meta name="robots" content="index,follow"><meta name="theme-color" content="${primary}">
  <style>
  :root{--brand:${primary};--accent:${accent};--ink:#1a1a2e;--muted:#5f6475;--line:#e2e5ec;--bg:#f7f7fb;--paper:#fff;--pass:#047857;--warn:#b45309;--fail:#b4232f;--unknown:#6b7280;--ring:${ringColor}}*{box-sizing:border-box}html{color-scheme:light}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif;line-height:1.7}a{color:inherit}.site-header{background:#fff;border-bottom:2px solid #eee}.site-header-inner{width:calc(100% - 32px);max-width:960px;margin:auto;min-height:68px;display:flex;justify-content:space-between;gap:16px;align-items:center}.brand{display:flex;gap:11px;align-items:center;text-decoration:none;min-width:0}.brand-mark{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;background:var(--brand);color:#fff;font-size:1.05rem;font-weight:900;flex:none}.brand-copy{display:grid;line-height:1.25}.brand-copy strong{font-size:.96rem}.brand-copy small{color:var(--muted);font-size:.72rem}.home-button{padding:9px 15px;border-radius:999px;background:var(--brand);color:#fff;text-decoration:none;font-weight:800;font-size:.82rem;white-space:nowrap}.wrap{width:calc(100% - 32px);max-width:960px;margin:auto;padding:36px 0 72px;overflow-wrap:anywhere}.intro{margin-bottom:22px}.intro h1{font-size:clamp(1.8rem,5vw,2.65rem);line-height:1.25;letter-spacing:-.035em;margin:0 0 10px}.intro p{margin:0;color:var(--muted)}.jump-links{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 24px}.jump-links a{border:1px solid var(--line);background:#fff;border-radius:999px;padding:8px 13px;text-decoration:none;color:var(--brand);font-size:.82rem;font-weight:800}.overview,.explain,.stage,.technical{background:var(--paper);border:1px solid var(--line);border-radius:20px;box-shadow:0 8px 28px #1a1a2e0a}.overview{padding:24px}.overview-top{display:grid;grid-template-columns:minmax(0,1fr) 170px;gap:24px;align-items:center}.eyebrow,.audience{margin:0 0 5px;color:var(--brand);font-weight:900;font-size:.75rem}.overview h2{font-size:clamp(1.45rem,4vw,2rem);margin:0 0 6px}.overview-message{color:var(--muted);margin:0}.ring{width:148px;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--ring) calc(${progress.percent} * 1%),#e5e7eb 0);position:relative;justify-self:end}.ring:before{content:"";position:absolute;inset:14px;border-radius:50%;background:#fff}.ring div{z-index:1;text-align:center}.ring strong{display:block;font-size:2.35rem;line-height:1}.ring span{color:var(--muted);font-size:.7rem;font-weight:800}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:20px}.stat{padding:14px;border-radius:12px;background:#f7f8fb;border:1px solid var(--line)}.stat b{font-size:1.35rem;display:block}.stat span{font-size:.74rem;color:var(--muted);font-weight:800}.explain{padding:22px;margin-top:18px}.explain h2{font-size:1.2rem;margin:0 0 12px}.latest{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:0;list-style:none}.latest li{display:flex;justify-content:space-between;gap:12px;padding:11px 12px;border-radius:12px;background:#f7f8fb;font-size:.84rem}.latest li span{min-width:0;text-align:right}.note{margin:14px 0 0;border-left:4px solid var(--brand);padding-left:13px;color:var(--muted);font-size:.86rem}.technical{margin-top:18px;padding:0;overflow:hidden}.technical>summary{cursor:pointer;padding:18px 22px;color:var(--brand);font-weight:900;list-style:none}.technical>summary::-webkit-details-marker{display:none}.technical>summary:before{content:"＋ ";}.technical[open]>summary:before{content:"－ ";}.technical-body{padding:0 20px 22px;border-top:1px solid var(--line)}.section-title{margin:22px 0 12px}.section-title h2{margin:0;font-size:1.12rem}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.stage{padding:20px;overflow:hidden}.stage-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.stage-head h2{font-size:1.05rem;margin:7px 0 0}.stage-head>strong{font-size:1.1rem}.status{display:inline-block;font-size:.7rem;font-weight:900;padding:3px 9px;border-radius:999px;background:#edf1f6;color:var(--unknown)}.stage-pass .status{background:#e8f7f0;color:var(--pass)}.stage-warning .status{background:#fff4d7;color:var(--warn)}.stage-fail .status{background:#ffeaec;color:var(--fail)}.stage>p{font-size:.84rem;color:var(--muted);min-height:3em}.bar{height:8px;border-radius:99px;background:#e7ebf1;overflow:hidden;margin:16px 0}.bar i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--brand),var(--accent))}.stage ul{list-style:none;margin:0;padding:0}.stage li{display:flex;gap:10px;padding:10px 0;border-top:1px solid #edf0f4}.stage li>span{font-weight:900}.stage li div{display:grid;gap:2px;min-width:0}.stage small{color:var(--muted)}.stage em{font-size:.76rem;color:var(--warn);font-style:normal;font-weight:800}.check-pass>span{color:var(--pass)}.check-fail>span{color:var(--fail)}.check-unmeasured>span,.check-warning>span{color:var(--warn)}.meta{margin-top:16px;color:var(--muted);font-size:.74rem}@media(max-width:700px){.site-header-inner{min-height:60px}.brand-copy small{display:none}.home-button{font-size:.75rem;padding:8px 11px}.wrap{padding-top:26px}.overview-top{grid-template-columns:1fr}.ring{justify-self:start;width:130px}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.grid,.latest{grid-template-columns:1fr}.stage>p{min-height:0}}@media(max-width:390px){.brand-copy strong{font-size:.82rem}.overview,.explain{padding:18px}.stat{padding:12px}.latest li{display:grid}.latest li span{text-align:left}}
  </style></head><body>
  <header class="site-header"><div class="site-header-inner"><a class="brand" href="${escapeHtml(home)}"><span class="brand-mark">${escapeHtml(String(displayName || 'ア').slice(0, 1))}</span><span class="brand-copy"><strong>${escapeHtml(displayName)}</strong><small>更新情報と動作チェック</small></span></a><a class="home-button" href="${escapeHtml(home)}">説明ページへ戻る</a></div></header>
  <main class="wrap">
    <section class="intro"><h1>更新情報と動作チェック</h1><p>最新版の内容と、公開に必要な準備がどこまで整っているかを確認できます。</p></section>
    <nav class="jump-links" aria-label="ページ内メニュー"><a href="${escapeHtml(home)}">キットの説明</a><a href="#updates">最新の更新</a><a href="#status">準備の状況</a></nav>
    <section class="overview" id="status"><div class="overview-top"><div><p class="eyebrow">現在の準備状況</p><h2>v${escapeHtml(app.version)} は ${progress.percent}% 確認済み</h2><p class="overview-message">${escapeHtml(progressMessage)}</p></div><div class="ring" role="img" aria-label="確認の進み具合 ${progress.percent}%"><div><strong>${progress.percent}%</strong><span>${progress.completed} / ${progress.total} 確認済み</span></div></div></div><div class="stats" aria-label="確認結果"><div class="stat"><b>${counts.pass}</b><span>確認できた項目</span></div><div class="stat"><b>${counts.warning}</b><span>確認中</span></div><div class="stat"><b>${counts.unmeasured}</b><span>まだ未確認</span></div><div class="stat"><b>${counts.fail}</b><span>見つかった問題</span></div></div></section>
    <section class="explain" id="updates" aria-labelledby="user-version-updates"><p class="audience">最新版</p><h2 id="user-version-updates">今回の更新内容</h2><ul class="latest">${latest}</ul><p class="note">この内容はキットの説明ページにも同じ情報が表示されます。</p></section>
    <details class="technical"><summary>詳しい確認内容を見る（開発者向け）</summary><div class="technical-body"><div class="section-title"><p class="audience">開発・確認用</p><h2>項目ごとの結果と、次にすること</h2></div><section class="grid">${stageHtml}</section><p class="note">この割合は出来の良し悪しを採点したものではなく、確認が終わった項目の割合です。未確認の項目を、問題なしとして数えることはありません。</p><div class="meta">version ${escapeHtml(app.version)} / commit ${escapeHtml(data.commit || '未取得')} / 更新 ${escapeHtml(data.generatedAtLabel)}</div></div></details>
  </main></body></html>`;
}

function renderSummaryScript() {
  return `(() => {
  const slots = document.querySelectorAll('[data-shindan-version-summary]');
  if (!slots.length) return;
  if (!document.getElementById('shindan-version-summary-style')) {
    const style = document.createElement('style');
    style.id = 'shindan-version-summary-style';
    style.textContent = '.sv-summary{margin:0 auto 28px;padding:22px;border:1px solid #e2e5ec;border-radius:20px;background:#fff;box-shadow:0 8px 30px #1a1a2e0d}.sv-summary__top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.sv-summary__eyebrow{font-size:.74rem;font-weight:900;color:#667eea}.sv-summary h2{margin:4px 0 6px;font-size:1.25rem;color:#1a1a2e}.sv-summary__sub{font-size:.86rem;color:#5f6475}.sv-summary__score{font-size:1.8rem;font-weight:900;color:#4058c9;white-space:nowrap}.sv-summary__bar{height:8px;background:#e4e8f0;border-radius:99px;overflow:hidden;margin:16px 0}.sv-summary__bar i{display:block;height:100%;background:linear-gradient(90deg,#667eea,#11a36a);border-radius:inherit}.sv-summary__chips{display:flex;flex-wrap:wrap;gap:7px}.sv-summary__chips span{font-size:.74rem;font-weight:800;padding:5px 9px;border-radius:999px;background:#f1f2f6;color:#505a6b}.sv-summary__latest{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:14px 0 0;padding:0;list-style:none}.sv-summary__latest li{display:flex;justify-content:space-between;gap:8px;padding:9px 10px;background:#f7f7fb;border-radius:10px;font-size:.78rem}.sv-summary__foot{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:16px;font-size:.78rem;color:#5f6475}.sv-summary__foot a{display:inline-block;padding:8px 12px;border-radius:999px;background:#667eea;color:#fff;font-weight:900;text-decoration:none}@media(max-width:640px){.sv-summary__top,.sv-summary__foot{display:grid}.sv-summary__latest{grid-template-columns:1fr}.sv-summary__score{font-size:1.45rem}}';
    document.head.appendChild(style);
  }
  const append = (parent, tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    parent.appendChild(node);
    return node;
  };
  for (const slot of slots) {
    const reportUrl = slot.dataset.reportUrl || '/check-shindan-version/report.json';
    fetch(reportUrl, { credentials: 'same-origin' }).then((response) => {
      if (!response.ok) throw new Error('report ' + response.status);
      return response.json();
    }).then((data) => {
      slot.textContent = '';
      const card = append(slot, 'section', 'sv-summary');
      card.setAttribute('aria-label', 'バージョンアップ情報');
      const top = append(card, 'div', 'sv-summary__top');
      const title = append(top, 'div');
      append(title, 'div', 'sv-summary__eyebrow', 'キットの更新状況');
      append(title, 'h2', '', 'v' + data.app.version + ' の準備状況');
      append(title, 'p', 'sv-summary__sub', '最新版の内容と、公開に必要な準備がどこまで終わったかを表示しています。');
      append(top, 'strong', 'sv-summary__score', data.progress.percent + '%');
      const bar = append(card, 'div', 'sv-summary__bar');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', String(data.progress.percent));
      append(bar, 'i').style.width = data.progress.percent + '%';
      const chips = append(card, 'div', 'sv-summary__chips');
      [['確認済み', data.counts.pass], ['確認中', data.counts.warning], ['まだ未確認', data.counts.unmeasured], ['見つかった問題', data.counts.fail]].forEach(([label, value]) => append(chips, 'span', '', label + ' ' + value));
      const publicLatest = Array.isArray(data.evolution.publicLatest) ? data.evolution.publicLatest : data.evolution.latest;
      if (Array.isArray(publicLatest) && publicLatest.length) {
        const list = append(card, 'ul', 'sv-summary__latest');
        publicLatest.slice(0, 4).forEach((row) => {
          const item = append(list, 'li');
          append(item, 'b', '', 'v' + row.version);
          const friendly = {'selftest を持たない診断キットの検査':'追加確認が必要な動作チェック','selftest を持たない配布スクリプト':'追加確認が必要な自動化処理','診断キットの検査本数':'現在使える動作チェック'};
          append(item, 'span', '', (friendly[row.label] || row.label) + (row.value !== '' ? ' ' + row.value + row.unit : ''));
        });
      }
      const foot = append(card, 'div', 'sv-summary__foot');
      append(foot, 'span', '', '更新 ' + data.generatedAtLabel);
      const link = append(foot, 'a', '', '更新内容と動作チェックを見る →');
      link.href = data.app.diagnosisUrl || '/check-shindan-version/';
      slot.setAttribute('aria-live', 'polite');
    }).catch(() => {
      slot.textContent = '';
      const fallback = append(slot, 'a', '', '更新情報と動作チェックを見る →');
      fallback.href = '/check-shindan-version/';
    });
  }
})();\n`;
}

async function collect(root, webRoot, outputDir) {
  const config = readJson(join(root, 'app.config.json'), {});
  const pkg = readJson(join(root, 'package.json'), {});
  const webPkg = webRoot === root ? pkg : readJson(join(webRoot, 'package.json'), {});
  const configuredName = option('--name') || config?.identity?.displayName;
  const name = isPlaceholder(configuredName) ? (pkg.name || 'このアプリ') : configuredName;
  const configuredDomain = config?.identity?.productionDomain;
  const domain = isPlaceholder(configuredDomain) ? '' : String(configuredDomain).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const homeUrl = String(option('--base-url') || (domain ? `https://${domain}` : '/')).replace(/\/$/, '') || '/';
  const version = String(pkg.version || config?.stores?.marketingVersion || '0.0.0');
  const reportPath = resolve(root, option('--report', '.instrument-report.json'));
  const measurement = has('--measure') ? runMeasurement(root, reportPath) : { attempted: false, exitCode: null };
  const instrumentReport = readJson(reportPath, null);
  const reportResults = Array.isArray(instrumentReport?.results) ? instrumentReport.results : [];
  const result = (needle) => reportResults.find((item) => String(item.label || '').includes(needle));
  const fromResult = (needle, missingEvidence, nextAction) => {
    const found = result(needle);
    return found
      ? makeCheck(needle, verdictStatus(found.verdict), `${found.verdict} / exit ${found.code}`, found.verdict === 'pass' ? '' : nextAction)
      : makeCheck(needle, 'unmeasured', missingEvidence, nextAction);
  };

  const metricsPath = firstExisting(root, ['scripts/improvement-metrics.mjs', 'templates/scripts/improvement-metrics.mjs']);
  const historyPath = firstExisting(root, ['scripts/improvement-history.mjs', 'templates/scripts/improvement-history.mjs']);
  const metrics = await importArray(metricsPath, 'IMPROVEMENT_METRICS');
  const history = await importArray(historyPath, 'IMPROVEMENT_HISTORY');
  const metricById = new Map(metrics.map((metric) => [metric.id, metric]));
  const currentRows = history.filter((row) => String(row?.version || '') === version);
  const ledgerPath = firstExisting(root, ['scripts/context-evolution.json', 'templates/scripts/context-evolution.json']);
  const ledger = readJson(ledgerPath, []);
  const decisions = Array.isArray(ledger) ? ledger : [];
  const provenDecisions = decisions.filter((row) =>
    ['confirmed', 'rejected'].includes(row?.status) && Array.isArray(row?.evidence) && row.evidence.length > 0
  );
  const stampPath = join(root, '.instrument-ran.json');
  const stamps = readJson(stampPath, {});
  const packageScripts = { ...(pkg.scripts || {}), ...(webPkg.scripts || {}) };
  const hasPageScript = Object.values(packageScripts).some((script) => String(script).includes('shindan-version'));
  const nextRoute = existsSync(join(webRoot, 'app', 'check-shindan-version', 'page.tsx'));

  const install = stage('install', '計器の導入', '診断を動かす土台が、本体リポジトリにそろっているか。', [
    fileCheck(root, '3値判定の共通土台', ['scripts/lib/instrument-core.mjs', 'templates/scripts/lib/instrument-core.mjs'], 'instrument-core.mjs をコピーする'),
    fileCheck(root, '完全版の統合入口', ['scripts/run-instruments.mjs', 'templates/scripts/run-instruments.mjs'], 'run-instruments.mjs をコピーする'),
    fileCheck(root, '全文脈エンジン', ['scripts/context-engine.mjs', 'templates/scripts/context-engine.mjs'], 'context-engine.mjs をコピーする'),
    fileCheck(root, '汎用診断ランナー', ['diagnostics/run.mjs', 'templates/diagnostics/run.mjs'], 'diagnostics/ をコピーする'),
    fileCheck(root, '進化台帳の門番', ['scripts/check-improvement.mjs', 'templates/scripts/check-improvement.mjs'], '進化台帳の3ファイルをコピーする')
  ]);

  const measured = stage('measurement', 'いまの状態を実測', '最後の計器実行が、文脈と製品状態を実際に測れたか。', [
    makeCheck('計器レポート', instrumentReport ? 'pass' : 'unmeasured', instrumentReport ? instrumentReport.generatedAt : 'レポートなし', 'npm run shindan を実行する'),
    fromResult('全文脈パケット', '実行記録なし', '全文脈パケットを再生成する'),
    fromResult('汎用診断', '実行記録なし', '黄または赤の診断を確認する')
  ]);

  const evolved = stage('evolution', '版ごとの進化', '何を良くするかを宣言し、同じ条件の実測と検証済み判断を次版へ渡せているか。', [
    makeCheck('改善指標の宣言', metrics.length ? 'pass' : 'unmeasured', `${metrics.length} 指標`, '実測してから better と why を宣言する'),
    makeCheck('実測履歴', history.length ? 'pass' : 'unmeasured', `${history.length} 件`, '実測値と source を記録する'),
    makeCheck('現在版の実測', currentRows.length ? 'pass' : 'unmeasured', currentRows.length ? `v${version}: ${currentRows.length} 件` : `v${version}: 0 件`, '現在版を実測する'),
    makeCheck('証拠つき判断', provenDecisions.length ? 'pass' : 'unmeasured', `${provenDecisions.length} 件`, '検証後に confirmed / rejected を証拠つきで記録する')
  ]);

  const continuity = stage('continuity', '計器の継続稼働', '計器を置いただけにせず、版が進んでも実際に走り続けているか。', [
    fileCheck(root, '停止検出の仕組み', ['scripts/check-instrument-ran.mjs', 'templates/scripts/check-instrument-ran.mjs'], 'check-instrument-ran.mjs をコピーする'),
    makeCheck('実行スタンプ', Object.keys(stamps || {}).length ? 'pass' : 'unmeasured', Object.keys(stamps || {}).length ? `${Object.keys(stamps).length} 種` : '記録なし', '緑の検査後に stamp を残す'),
    makeCheck('完全版の緑スタンプ', stamps?.['complete-instrument'] ? 'pass' : 'unmeasured', stamps?.['complete-instrument']?.at || '記録なし', '全計器を緑にして記録する')
  ]);

  const publishing = stage('publishing', '本体への公開', '本体ドメイン配下の同じURLで、いつでも現在地を確認できるか。', [
    makeCheck('本番ドメイン', domain || option('--base-url') ? 'pass' : 'unmeasured', domain || option('--base-url') || '未設定', 'app.config.json に productionDomain を設定する'),
    makeCheck('診断ページ本体', 'pass', nextRoute ? `${rel(root, webRoot)}/ App Router /check-shindan-version/` : rel(root, outputDir), ''),
    makeCheck('自動更新の配線', hasPageScript ? 'pass' : 'unmeasured', hasPageScript ? 'package.json scripts' : '未配線', 'prebuild と shindan スクリプトを追加する')
  ]);

  const security = stage('security', '公開前の安全確認', '診断ページを含む公開サイトを、安全側の基準で点検できるか。', [
    fileCheck(root, 'セキュリティ計器', ['scripts/verify-security-score.mjs', 'templates/scripts/verify-security-score.mjs'], 'verify-security-score.mjs をコピーする'),
    fromResult('セキュリティ計器 selftest', '自己検査の実行記録なし', 'npm run shindan で自己検査を実行する')
  ]);

  const stages = [install, measured, evolved, continuity, publishing, security];
  const checks = stages.flatMap((item) => item.checks);
  const counts = {
    pass: checks.filter((item) => item.status === 'pass').length,
    warning: checks.filter((item) => item.status === 'warning').length,
    fail: checks.filter((item) => item.status === 'fail').length,
    unmeasured: checks.filter((item) => item.status === 'unmeasured').length
  };
  const completed = counts.pass;
  const generatedAt = new Date().toISOString();
  const commit = git(root, ['rev-parse', '--short=8', 'HEAD'], '未取得');
  const latest = history.slice(-6).reverse().map((row) => {
    const metric = metricById.get(row.metric) || {};
    return {
      version: String(row.version || '—'), label: String(metric.label || row.metric || '指標'),
      value: Number.isFinite(row.value) ? row.value : '—', unit: String(metric.unit || '')
    };
  });
  const publicLatest = name === 'web-ios-android'
    ? [
        { version, label: '各アプリに更新情報と動作チェックページを追加', value: '', unit: '' },
        { version, label: '説明ページにも同じ更新情報を自動表示', value: '', unit: '' },
        { version, label: '前回の判断を引き継ぐ仕組みを追加', value: '', unit: '' }
      ]
    : latest.map((row) => ({ ...row, label: publicMetricLabel(row.label) }));

  return {
    schemaVersion: 1,
    generatedAt,
    generatedAtLabel: new Intl.DateTimeFormat('ja-JP', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo'
    }).format(new Date(generatedAt)),
    commit,
    measurement,
    app: {
      name, version, homeUrl, diagnosisUrl: `${homeUrl === '/' ? '' : homeUrl}/check-shindan-version/`,
      primaryColor: validColor(config?.brand?.primaryColor, '#315efb'),
      accentColor: validColor(config?.brand?.accentColor, '#11a36a')
    },
    progress: { completed, total: checks.length, percent: percent(completed, checks.length) },
    counts,
    stages,
    evolution: {
      metricCount: metrics.length, measurementCount: history.length,
      currentVersionMeasured: currentRows.length > 0,
      decisionCounts: {
        confirmed: decisions.filter((row) => row?.status === 'confirmed').length,
        rejected: decisions.filter((row) => row?.status === 'rejected').length,
        pending: decisions.filter((row) => row?.status === 'pending').length
      },
      latest,
      publicLatest
    },
    limitations: [
      '進捗率は品質点ではなく、確認できた導入・配線・実測・履歴・公開の節目の割合です。',
      '未計測は合格にも異常にも数えません。',
      '秘密ファイル本文、トークン、鍵、絶対パスは公開レポートへ含めません。',
      '外部サービス・実機・会話だけに残る判断は、証拠を記録するまで未取得です。'
    ]
  };
}

function selftest() {
  const failures = [];
  if (percent(0, 0) !== 0 || percent(1, 4) !== 25) failures.push('進捗率');
  if (escapeHtml('<script>') !== '&lt;script&gt;') failures.push('HTMLエスケープ');
  if (stage('x', 'x', 'x', [makeCheck('a', 'pass', ''), makeCheck('b', 'fail', '')]).status !== 'fail') failures.push('赤の優先');
  if (stage('x', 'x', 'x', [makeCheck('a', 'pass', ''), makeCheck('b', 'unmeasured', '')]).status !== 'warning') failures.push('未計測を全緑にしない');
  const html = renderStatic({
    app: { name: '<毒>', version: '1', homeUrl: '/', primaryColor: '#315efb', accentColor: '#11a36a' },
    progress: { percent: 0, completed: 0, total: 1 }, counts: { pass: 0, warning: 0, fail: 0, unmeasured: 1 },
    stages: [], evolution: { latest: [] }, commit: 'x', generatedAtLabel: 'x'
  });
  if (html.includes('<毒>') || !html.includes('&lt;毒&gt;')) failures.push('公開HTMLへの未エスケープ混入');
  if (failures.length) {
    console.error('[generate-shindan-version] selftest 失敗: ' + failures.join(' / '));
    process.exit(1);
  }
  console.log('[generate-shindan-version] selftest OK（赤優先 / 未計測を緑にしない / 公開HTMLをescape）');
}

if (has('--selftest')) selftest();
else {
  const root = resolve(option('--root', resolve(HERE, '..')));
  const webRoot = detectWebRoot(root);
  const outputDir = detectOutput(root, webRoot);
  const data = await collect(root, webRoot, outputDir);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'report.json'), JSON.stringify(data, null, 2) + '\n');
  writeFileSync(join(outputDir, 'summary.js'), renderSummaryScript());
  const isNextRoute = existsSync(join(webRoot, 'app', 'check-shindan-version', 'page.tsx'));
  if (!isNextRoute || has('--static')) {
    writeFileSync(join(outputDir, 'index.html'), renderStatic(data));
  }
  console.log(`[generate-shindan-version] Generated: ${rel(root, outputDir)}/`);
  console.log(`[generate-shindan-version] 進捗 ${data.progress.completed}/${data.progress.total} (${data.progress.percent}%) / 赤 ${data.counts.fail} / 未計測 ${data.counts.unmeasured}`);
  if (data.measurement.attempted && data.measurement.exitCode !== 0) {
    console.log(`[generate-shindan-version] 計器 exit ${data.measurement.exitCode}。ページは生成済み（黄/赤を隠しません）。`);
  }
}
