#!/usr/bin/env node
// 役割: アプリがある Web サービスに、アプリ(App Store・Google Play)への導線があるかを見る。
// なぜ要るか: りんくの指示(2026-11-22「web系のもので、アプリがあるものは必ずアプリへの導線を入れて欲しい」)。
//   ストアに出ているアプリ12件のうち、Web のトップに自分のアプリへのリンクがあったのは3件だけだった(2026-11-22 本番で実測)。
//   ルール本文: docs/ai-rules/15_APP_LINK_FROM_WEB.md
// 使い方:
//   node scripts/check-app-link.mjs              # このリポ(app.config.json の stores)の Web のソースに導線があるか(lint CHECK 37 と同じ判定)
//   node scripts/check-app-link.mjs --offline    # ストアに公開中かを調べない(分からない扱い=無ければ warn)
//   node templates/scripts/check-app-link.mjs --registry [--json out.json]
//                                                # lib/app-links.json の全サービスの本番ページを開いて見る(週1の app-link-watch.yml)
// 終了コード: 0 = ok / warn / skip、1 = fail(公開中のアプリへの導線が無い)、2 = 一覧が読めない
// ★本番ページは JavaScript で描く画面が多いので、Playwright があればブラウザで描いてから見る(無ければ HTML をそのまま見る)。

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkAppLinks, extractStoreLinks, findAppLinksInSources, storeIdsFromConfig } from './lib/app-link-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REGISTRY_PATH = path.join(__dirname, 'lib', 'app-links.json');

const WEB_EXT = new Set(['.html', '.htm', '.astro', '.tsx', '.jsx', '.ts', '.js', '.mjs', '.vue', '.svelte', '.ejs', '.njk', '.hbs', '.php']);
const PAGE_EXT = new Set(['.html', '.htm', '.astro', '.tsx', '.jsx', '.vue', '.svelte', '.ejs', '.njk', '.hbs', '.php']);
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.vercel', '.wrangler', '.turbo', '.cache', 'dist', 'build', 'out', 'coverage',
  'android', 'ios', 'Pods', 'DerivedData', 'test', 'tests', '__tests__', 'fixtures', 'e2e', 'docs', '_docs', '.claude', '.agent',
  'templates', 'store-assets', 'scripts',
]);
const isTestFile = (name) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(name);

/** リポの中の Web のソースを集める(テスト・ネイティブ・書き出し先は除く)。 */
export function collectWebSources(root, { maxBytes = 2_000_000 } = {}) {
  const files = [];
  let hasPage = false;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name));
        continue;
      }
      const ext = path.extname(e.name).toLowerCase();
      if (!WEB_EXT.has(ext) || isTestFile(e.name) || e.name.endsWith('.d.ts')) continue;
      const full = path.join(dir, e.name);
      let text;
      try {
        if (fs.statSync(full).size > maxBytes) continue;
        text = fs.readFileSync(full, 'utf8');
      } catch { continue; }
      if (PAGE_EXT.has(ext)) hasPage = true;
      files.push({ path: path.relative(root, full).split(path.sep).join('/'), text });
    }
  };
  walk(root);
  return { files, hasPage };
}

/** そのストアで公開中か(true / false / null=分からない)。Play は「無いアプリ」の返事と比べて、ネットの不調と見分ける。 */
export async function lookupLive({ ascAppId, playPackageName }, { offline = false } = {}) {
  if (offline) return { ios: ascAppId ? null : undefined, play: playPackageName ? null : undefined };
  const t = () => AbortSignal.timeout(15000);
  let ios;
  if (ascAppId) {
    try {
      const r = await fetch(`https://itunes.apple.com/lookup?id=${ascAppId}&country=jp`, { signal: t() });
      ios = r.ok ? (await r.json()).resultCount > 0 : null;
    } catch { ios = null; }
  }
  let play;
  if (playPackageName) {
    try {
      const st = async (id) => (await fetch(`https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}&hl=ja`, { redirect: 'follow', signal: t() })).status;
      const [mine, control] = await Promise.all([st(playPackageName), st('com.kimito.link.notexist999')]);
      play = control === 404 ? mine === 200 : null;
    } catch { play = null; }
  }
  return { ios, play };
}

/** lint-pre-submission の CHECK 37 と CLI の既定モード。 */
export async function appLinkReport(root, { offline = false, configPath } = {}) {
  let config = null;
  const cfgFile = configPath ?? path.join(root, 'app.config.json');
  try { config = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch { /* 無くてもよい */ }
  const app = storeIdsFromConfig(config);
  const label = config?.identity?.displayName && !/^<.*>$/.test(config.identity.displayName) ? config.identity.displayName : 'このリポ';
  if (!app.ascAppId && !app.playPackageName) return checkAppLinks({ label, app, found: { ios: false, play: false } });
  const { files, hasPage } = collectWebSources(root);
  const where = findAppLinksInSources(files, app);
  const live = await lookupLive(app, { offline });
  const r = checkAppLinks({
    label,
    app,
    live,
    hasWeb: hasPage,
    found: { ios: !!where.ios, play: !!where.play, banner: app.ascAppId ? !!where.banner : undefined },
  });
  return { ...r, where };
}

/** 本番ページの HTML を取る。Playwright があれば描いてから。 */
async function makeRenderer() {
  let chromium = null;
  try { ({ chromium } = await import('playwright')); } catch {
    // ESM の import は NODE_PATH を見ない。CommonJS の探し方(NODE_PATH・全体に入れたもの)でもう一度探す
    try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* 無ければ素の HTML */ }
  }
  if (!chromium) {
    return {
      kind: 'fetch',
      get: async (url) => (await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'Mozilla/5.0 app-link-check' } })).text(),
      close: async () => {},
    };
  }
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  return {
    kind: 'playwright',
    get: async (url) => {
      const page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 45000 });
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        return await page.content();
      } finally { await page.close(); }
    },
    close: () => browser.close(),
  };
}

export async function registryReport({ registry, offline = false, getHtml }) {
  const results = [];
  for (const s of registry.services ?? []) {
    const app = { ascAppId: s.ascAppId ?? null, playPackageName: s.playPackageName ?? null };
    const live = await lookupLive(app, { offline });
    for (const url of s.web ?? []) {
      let html = '';
      let error;
      try { html = await getHtml(url); } catch (e) { error = e.message; }
      if (error) {
        results.push({ service: s.id, url, repo: s.repo, status: 'warn', detail: `${s.name} ${url}: ページを開けなかった(${error.slice(0, 120)})`, missing: [] });
        continue;
      }
      const f = extractStoreLinks(html);
      const r = checkAppLinks({
        label: `${s.name} ${url}`,
        app,
        live,
        found: { ios: !!app.ascAppId && f.iosIds.includes(app.ascAppId), play: !!app.playPackageName && f.playPackages.includes(app.playPackageName), banner: app.ascAppId ? f.bannerIds.includes(app.ascAppId) : undefined },
      });
      results.push({ service: s.id, url, repo: s.repo, ...r });
    }
  }
  return results;
}

const MARK = { ok: '✓', warn: '!', fail: '✗', skip: '-' };

async function main() {
  const args = process.argv.slice(2);
  const offline = args.includes('--offline');
  const jsonAt = args.indexOf('--json');
  const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : null;

  if (args.includes('--registry')) {
    let registry;
    try { registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')); } catch (e) { console.error(`一覧が読めない: ${e.message}`); return 2; }
    const renderer = await makeRenderer();
    let results;
    try { results = await registryReport({ registry, offline, getHtml: renderer.get }); } finally { await renderer.close(); }
    console.log(`(ページの読み方: ${renderer.kind})`);
    for (const r of results) console.log(`${MARK[r.status]} ${r.detail}${r.status === 'fail' ? `  [直す場所: ${r.repo}]` : ''}`);
    if (jsonOut) fs.writeFileSync(jsonOut, `${JSON.stringify(results, null, 2)}\n`);
    return results.some((r) => r.status === 'fail') ? 1 : 0;
  }

  const r = await appLinkReport(process.env.LINT_ROOT ? path.resolve(process.env.LINT_ROOT) : process.cwd(), { offline });
  console.log(`${MARK[r.status]} アプリへの導線: ${r.detail}`);
  if (r.where) console.log(`  見つかった場所: App Store=${r.where.ios ?? 'なし'} / Google Play=${r.where.play ?? 'なし'} / Safari バナー=${r.where.banner ?? 'なし'}`);
  return r.status === 'fail' ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(await main());
