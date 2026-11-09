#!/usr/bin/env node
// build-site-seo.mjs — kimito-skill.link（site/）の「検索エンジンが辿れる道」を、正本1つから作り直す。
//
// ■ 何をするか（3つ。正本はどれも既存のもの。新しい正本は作らない）
//   1. site/sitemap.xml を site/sitemap/sitemap-manifest.json から作る。
//      これまで手書きで、配信中の30ページのうち13ページしか載っていなかった（2026-11-09 実測）。
//   2. ページに「JS が動かなくても読めるリンク」を焼き込む（プリレンダー）。
//      ヘッダー・フッター（site-chrome.js）、トップの「もっと知りたい方へ」（more-links.js）、
//      /sitemap/ のページ一覧（sitemap-render.js）は、どれも実行時に JS が差し込む作りで、
//      HTML の中身は空だった。Google は後から JS を動かして読むが、遅れるうえ、
//      Bing の一部・AI 検索のクローラーなど JS を動かさない読み手には「リンクが1本も無いページ」に見えていた。
//      ★差し込み口（<div id="site-header"> など）の中に同じ HTML を入れておくだけ。実行時には
//      各 JS がいつも通り中身を作り直すので、見た目は変わらない（site-chrome.js は outerHTML で丸ごと置き換え、
//      more-links.js / sitemap-render.js は中身を作り直す）。
//      ★site-chrome.js（配布正本・全サイトでバイト一致）は1文字も変えない。node の vm で
//      そのまま動かして出力を受け取るので、ヘッダーの組み立てを二重に持たない。
//   3. sitemap.xml に載せる各ページの基本（title・description・canonical が URL と一致・h1 が1つ・noindex でない）を検査する。
//
// ■ 使い方
//   node scripts/build-site-seo.mjs           # 作り直して書き込む（npm run deploy:site の最初に自動で走る）
//   node scripts/build-site-seo.mjs --check   # 書き込まずに「作り直すと変わるか」「各ページの基本」を検査（CI の門）
//   node scripts/build-site-seo.mjs --selftest
// 終了コード: 0=問題なし / 1=ずれ・不備あり / 2=測定不能（manifest が読めない等）
//
// ■ ★判定しないこと
//   ページの中身の質・キーワードの良し悪し（意味判断）。見るのは機械で決まる事実だけ。
//   lastmod（最終更新日）は git の履歴から入れるが、--check では比べない
//   （コミットするたびに日付が変わり、門が永遠に赤になるのを避けるため。本番へ出す deploy:site で毎回付け直す）。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const SITE = join(REPO_ROOT, 'site');
export const ORIGIN = 'https://kimito-skill.link';

// ---- 純ロジック（fs 非依存・selftest 対象） -----------------------------------------

/** manifest の href（/sitemap/ から相対）を、サイトルートからのパス（/xxx/）にする。外部・ページ内リンクは null。 */
export function hrefToPath(href) {
  const h = String(href || '');
  if (/^[a-z]+:/i.test(h) || h.startsWith('#')) return null;
  const noHash = h.split('#')[0];
  const url = new URL(noHash, `${ORIGIN}/sitemap/`);
  return url.pathname;
}

/** srcPath（site 相対の index.html）を公開パスにする。 */
export function srcToPath(srcPath) {
  const p = String(srcPath || '').replace(/\\/g, '/');
  if (p === 'index.html') return '/';
  return '/' + p.replace(/index\.html$/, '');
}

/**
 * manifest から sitemap.xml に載せる候補（重複なし・掲載順）を集める。
 * sections[].links の内部リンク ＋ unlisted[]（ナビには出さないが検索には出したいページ。noindex なら後で落とす）。
 * @returns {Array<{path:string, srcPath:string}>}
 */
export function collectPages(manifest) {
  const seen = new Set();
  const out = [];
  const add = (srcPath) => {
    if (typeof srcPath !== 'string' || !srcPath.endsWith('.html')) return;
    const path = srcToPath(srcPath);
    if (seen.has(path)) return;
    seen.add(path);
    out.push({ path, srcPath: srcPath.replace(/\\/g, '/') });
  };
  for (const s of (manifest && manifest.sections) || []) {
    for (const l of s.links || []) if (hrefToPath(l.href) !== null) add(l.srcPath);
  }
  for (const u of (manifest && manifest.unlisted) || []) add(u.srcPath);
  return out;
}

export function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** @param {Array<{path:string, lastmod?:string}>} pages */
export function renderSitemapXml(pages) {
  const rows = pages.map((p) => {
    const lm = p.lastmod ? `<lastmod>${p.lastmod}</lastmod>` : '';
    return `  <url><loc>${escapeXml(ORIGIN + p.path)}</loc>${lm}</url>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- 自動生成: scripts/build-site-seo.mjs（正本は site/sitemap/sitemap-manifest.json）。手で書き換えない。 -->',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...rows,
    '</urlset>',
    ''
  ].join('\n');
}

/** lastmod を除いた形（--check で比べる用）。 */
export function stripLastmod(xml) {
  return String(xml).replace(/<lastmod>[^<]*<\/lastmod>/g, '');
}

/** 1ページの HTML から、検索の基本項目を拾う。 */
export function readSeoFacts(html) {
  const s = String(html);
  const pick = (re) => { const m = s.match(re); return m ? m[1].trim() : ''; };
  return {
    title: pick(/<title>([\s\S]*?)<\/title>/i),
    description: pick(/<meta\s+name="description"\s+content="([^"]*)"/i),
    canonical: pick(/<link\s+rel="canonical"\s+href="([^"]*)"/i),
    robots: pick(/<meta\s+name="robots"\s+content="([^"]*)"/i),
    h1Count: (s.match(/<h1[\s>]/gi) || []).length
  };
}

/** @returns {string[]} 不備の説明（空なら合格） */
export function seoProblems(facts, expectedUrl) {
  const out = [];
  if (!facts.title) out.push('<title> が無い');
  if (!facts.description) out.push('meta description が無い');
  if (!facts.canonical) out.push('canonical が無い');
  else if (facts.canonical !== expectedUrl) out.push(`canonical が URL と違う（${facts.canonical} ≠ ${expectedUrl}）`);
  if (facts.h1Count !== 1) out.push(`h1 が ${facts.h1Count} 個（1個にする）`);
  if (/noindex/i.test(facts.robots)) out.push('noindex なのに sitemap.xml に載っている（manifest から外す）');
  return out;
}

export function isNoindex(html) {
  return /noindex/i.test(readSeoFacts(html).robots);
}

/**
 * 差し込み口 <div ...id="X"...>中身</div> の中身を差し替える。差し込み口の中に div を入れ子にしない前提
 * （焼き込む中身は header/footer/nav/a/ul だけ。div が入るものは END 目印で閉じる）。
 */
export const MARK_START = '<!-- prerender:start（scripts/build-site-seo.mjs が焼き込む。手で書き換えない） -->';
export const MARK_END = '<!-- prerender:end -->';

/** @param {string} html @param {RegExp} openTagRe 差し込み口の開始タグ @param {string} inner */
export function fillSlot(html, openTagRe, inner) {
  const m = html.match(openTagRe);
  if (!m) return { html, found: false };
  const start = m.index + m[0].length;
  const rest = html.slice(start);
  let end;
  if (rest.startsWith(MARK_START)) {
    const e = rest.indexOf(MARK_END);
    if (e < 0) return { html, found: false };
    end = start + e + MARK_END.length;
  } else {
    // まだ焼き込んでいない空の差し込み口（<div id="x"></div>）だけを相手にする。中身入りは触らない。
    if (!/^\s*<\/div>/.test(rest)) return { html, found: false };
    end = start;
  }
  const body = `${MARK_START}${inner}${MARK_END}`;
  return { html: html.slice(0, start) + body + html.slice(end), found: true };
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** /sitemap/ のページ一覧（sitemap-render.js と同じクラス名。実行時は JS が作り直す）。 */
export function renderSitemapStatic(manifest) {
  const secs = ((manifest && manifest.sections) || []).map((sec) => {
    const items = (sec.links || []).map((l) => {
      const ext = l.external === true || /^https?:\/\//i.test(l.href);
      const attrs = ext ? ' target="_blank" rel="noopener noreferrer" class="sitemap-page__link--external"' : '';
      return `<li class="sitemap-page__item"><a href="${escHtml(l.href)}"${attrs}>${escHtml(l.label)}</a></li>`;
    }).join('');
    const id = sec.slug ? ` id="${escHtml(sec.slug)}"` : '';
    return `<section class="sitemap-page__section"${id}><h2 class="sitemap-page__section-title">${escHtml(sec.title || '')}</h2><ul class="sitemap-page__list">${items}</ul></section>`;
  }).join('');
  return `<nav class="sitemap-page__nav" aria-label="サイト内のページ一覧">${secs}</nav>`;
}

// ---- 既存の JS をそのまま動かして出力を受け取る（ロジックを二重に持たない） -------------

/** site-chrome.js を、そのページの URL で動かしてヘッダー・フッターの HTML を受け取る。 */
export function runSiteChrome(configJs, chromeJs, pathname) {
  const slots = { 'site-header': { outerHTML: '' }, 'site-footer': { outerHTML: '' } };
  let onReady = null;
  const document = {
    addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') onReady = fn; },
    getElementById: (id) => slots[id] || null,
    querySelector: () => null,
    dispatchEvent: () => true
  };
  const window = {};
  const ctx = vm.createContext({ window, document, CustomEvent: function () {}, location: { pathname } });
  ctx.window.location = ctx.location;
  vm.runInContext(configJs, ctx);
  vm.runInContext(chromeJs, ctx);
  if (onReady) onReady();
  return { header: slots['site-header'].outerHTML, footer: slots['site-footer'].outerHTML };
}

/** more-links.js を動かして「もっと知りたい方へ」の HTML を受け取る。 */
export async function runMoreLinks(moreJs, data) {
  const slot = { innerHTML: '', getAttribute: () => null };
  let onReady = null;
  const document = {
    addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') onReady = fn; },
    querySelectorAll: () => Object.assign([slot], { forEach: (f) => f(slot) })
  };
  const ctx = vm.createContext({
    document,
    fetch: () => Promise.resolve({ json: () => Promise.resolve(data) })
  });
  vm.runInContext(moreJs, ctx);
  if (onReady) onReady();
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  return slot.innerHTML;
}

// ---- 実行 ------------------------------------------------------------------------------

function gitLastmod(rel) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', rel], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : '';
  } catch { return ''; }
}

async function build({ check }) {
  const manifestPath = join(SITE, 'sitemap', 'sitemap-manifest.json');
  if (!existsSync(manifestPath)) { console.error('測定不能: manifest が無い'); return 2; }
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch (e) { console.error('測定不能: manifest が読めない', e.message); return 2; }

  const problems = [];
  const writes = []; // {file, next}

  // 1) sitemap.xml
  const candidates = collectPages(manifest);
  if (candidates.length === 0) { console.error('測定不能: 載せるページが0件'); return 2; }
  const pages = [];
  for (const c of candidates) {
    const file = join(SITE, c.srcPath);
    if (!existsSync(file)) { problems.push(`${c.srcPath}: manifest に載っているがファイルが無い`); continue; }
    const html = readFileSync(file, 'utf8');
    if (isNoindex(html)) continue;
    for (const p of seoProblems(readSeoFacts(html), ORIGIN + c.path)) problems.push(`${c.srcPath}: ${p}`);
    pages.push({ ...c, lastmod: gitLastmod(join('site', c.srcPath)) });
  }
  const xmlPath = join(SITE, 'sitemap.xml');
  const nextXml = renderSitemapXml(pages);
  const curXml = existsSync(xmlPath) ? readFileSync(xmlPath, 'utf8') : '';
  if (check) {
    if (stripLastmod(curXml) !== stripLastmod(nextXml)) problems.push('site/sitemap.xml が manifest とずれている（node scripts/build-site-seo.mjs で作り直す）');
  } else if (curXml !== nextXml) writes.push({ file: xmlPath, next: nextXml });

  // 2) プリレンダー（全配信ページ＝manifest 掲載＋unlisted。hub は対象外）
  const configJs = readFileSync(join(SITE, 'scripts', 'site-chrome.config.js'), 'utf8');
  const chromeJs = readFileSync(join(SITE, 'scripts', 'site-chrome.js'), 'utf8');
  const moreJs = readFileSync(join(SITE, 'scripts', 'more-links.js'), 'utf8');
  const moreData = JSON.parse(readFileSync(join(SITE, 'assets', 'data', 'more-links.json'), 'utf8'));
  const moreHtml = await runMoreLinks(moreJs, moreData);

  let filled = 0;
  for (const c of candidates) {
    const file = join(SITE, c.srcPath);
    if (!existsSync(file)) continue;
    const cur = readFileSync(file, 'utf8');
    let html = cur;
    const { header, footer } = runSiteChrome(configJs, chromeJs, c.path);
    for (const [re, inner] of [
      [/<div id="site-header">/, header],
      [/<div id="site-footer">/, footer],
      [/<div class="more-cards more-links-slot">/, moreHtml],
      [/<div id="sitemap-mount" aria-live="polite">/, c.srcPath === 'sitemap/index.html' ? renderSitemapStatic(manifest) : null]
    ]) {
      if (inner == null) continue;
      const r = fillSlot(html, re, inner);
      html = r.html;
    }
    if (html !== cur) {
      filled++;
      if (check) problems.push(`${c.srcPath}: 焼き込んだリンクが古い（node scripts/build-site-seo.mjs で作り直す）`);
      else writes.push({ file, next: html });
    }
  }

  for (const w of writes) writeFileSync(w.file, w.next);

  console.log(`sitemap.xml: ${pages.length} ページ（manifest 候補 ${candidates.length}、noindex 除外 ${candidates.length - pages.length}）`);
  if (!check) console.log(`書き込み: ${writes.length} ファイル`);
  if (problems.length) {
    console.error(`\n✗ ${problems.length} 件:`);
    for (const p of problems) console.error('  - ' + p);
    return 1;
  }
  console.log('✓ 検索の基本と焼き込みリンクは最新です');
  return 0;
}

// ---- selftest -------------------------------------------------------------------------

async function selftest() {
  const manifest = {
    sections: [
      { slug: 'a', title: 'A', links: [
        { label: 'トップ', href: '../', srcPath: 'index.html' },
        { label: 'G', href: '../guide/', srcPath: 'guide/index.html' },
        { label: 'G#x', href: '../guide/#x', srcPath: 'guide/index.html' },
        { label: '外', href: 'https://example.com/', external: true }
      ] }
    ],
    unlisted: [{ srcPath: 'lp/index.html' }]
  };
  const good = '<title>t</title><meta name="description" content="d"><link rel="canonical" href="https://kimito-skill.link/guide/"><h1>x</h1>';
  const cases = [
    ['href を公開パスにする', () => hrefToPath('../guide/') === '/guide/' && hrefToPath('../') === '/' && hrefToPath('https://x/') === null],
    ['重複と外部を落とし、unlisted を拾う', () => JSON.stringify(collectPages(manifest).map((p) => p.path)) === '["/","/guide/","/lp/"]'],
    ['sitemap.xml に loc と lastmod が入る', () => renderSitemapXml([{ path: '/a/', lastmod: '2026-11-09' }]).includes('<loc>https://kimito-skill.link/a/</loc><lastmod>2026-11-09</lastmod>')],
    ['--check は lastmod の違いを無視する', () => stripLastmod(renderSitemapXml([{ path: '/a/', lastmod: '2026-01-01' }])) === stripLastmod(renderSitemapXml([{ path: '/a/', lastmod: '2026-11-09' }]))],
    ['★毒: ページが1つ増えたら --check の比較はずれる', () => stripLastmod(renderSitemapXml([{ path: '/a/' }])) !== stripLastmod(renderSitemapXml([{ path: '/a/' }, { path: '/b/' }]))],
    ['基本がそろったページは合格', () => seoProblems(readSeoFacts(good), 'https://kimito-skill.link/guide/').length === 0],
    ['★毒: canonical のずれを落とす', () => seoProblems(readSeoFacts(good), 'https://kimito-skill.link/x/').some((p) => p.includes('canonical'))],
    ['★毒: canonical 無しを落とす', () => seoProblems(readSeoFacts('<title>t</title><meta name="description" content="d"><h1>x</h1>'), 'u').includes('canonical が無い')],
    ['★毒: h1 が2つを落とす', () => seoProblems(readSeoFacts(good + '<h1>y</h1>'), 'https://kimito-skill.link/guide/').some((p) => p.includes('h1'))],
    ['noindex を見分ける', () => isNoindex('<meta name="robots" content="noindex, nofollow">') && !isNoindex(good)],
    ['空の差し込み口に焼き込み、2回目は置き換えだけ', () => {
      const a = fillSlot('<div id="s"></div>', /<div id="s">/, '<a>1</a>').html;
      const b = fillSlot(a, /<div id="s">/, '<a>2</a>').html;
      return a === `<div id="s">${MARK_START}<a>1</a>${MARK_END}</div>` && b === `<div id="s">${MARK_START}<a>2</a>${MARK_END}</div>`;
    }],
    ['中身が手書きの差し込み口は触らない', () => !fillSlot('<div id="s"><p>手書き</p></div>', /<div id="s">/, 'x').found],
    ['site-chrome.js をそのまま動かしてヘッダーを受け取れる（現在ページに active）', () => {
      const conf = 'window.SITE_CHROME_CONFIG={brandName:"B",logoSrc:"/l.png",homeLabel:"H",brandCopyright:"C",navItems:[{href:"/guide/",label:"G"}]};';
      const chrome = readFileSync(join(SITE, 'scripts', 'site-chrome.js'), 'utf8');
      const { header, footer } = runSiteChrome(conf, chrome, '/guide/');
      return header.includes('<a href="/guide/" class="active">G</a>') && footer.includes('<a href="/guide/">G</a>');
    }]
  ];
  const ml = await runMoreLinks(readFileSync(join(SITE, 'scripts', 'more-links.js'), 'utf8'), { groups: [{ head: 'H', items: [{ icon: 'i', href: 'a/', title: 'T', desc: 'D' }] }] });
  cases.push(['more-links.js をそのまま動かしてカードを受け取れる', () => ml.includes('href="a/"') && ml.includes('<h4>T</h4>')]);

  let fail = 0;
  for (const [name, fn] of cases) {
    let ok = false;
    try { ok = fn(); } catch (e) { ok = false; console.error(e); }
    console.log(`${ok ? '✓' : '✗'} ${name}`);
    if (!ok) fail++;
  }
  return fail ? 1 : 0;
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const code = process.argv.includes('--selftest') ? await selftest() : await build({ check: process.argv.includes('--check') });
  process.exit(code);
}
