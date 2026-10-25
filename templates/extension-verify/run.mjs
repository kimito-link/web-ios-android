#!/usr/bin/env node
/**
 * run.mjs — ★Chrome拡張を「本物のブラウザに読み込んで」全画面・全差し込み先を自動で確かめる共通検証。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか(2026-10-25・りんくの依頼「拡張を自動で動かして検証する仕組みを全部にいれたい」)
 *
 *   拡張の不具合は「単体テストは緑なのに、読み込むと動かない」形で出ることが多い:
 *     ・manifest が指すファイルが無い／service worker の import 先が無い
 *       → 拡張が丸ごと読み込まれない、保存が全部止まる(返信サジェスト 2026-08-17 実損)
 *     ・画面を開くと例外で真っ白(HTML 内の script 参照切れ・初期化順の崩れ)
 *     ・content script が注入されない(manifest の matches 書き換え漏れ)
 *   どれも「拡張を読み込んで、開いてみる」まで見えない。人が毎回手でリロードして
 *   確かめていた(=依頼の回数がそのまま負担になっていた)のを、コマンド1本にする。
 *
 * ■ 何をするか(3段)
 *   1. 静的: manifest が指す全ファイル・service worker の import 先(再帰)・
 *      各画面 HTML の script/link 参照が実在するか。
 *      ★網羅の門: 拡張フォルダ直下と manifest の画面があるフォルダの *.html は、
 *      「検証する」か「検証しない理由」のどちらかが extension-verify.json に無いと赤。
 *      ＝新しい画面を足したのに検証に入れ忘れる、を機械で止める。
 *   2. 起動: 拡張を読み込んだ Chromium を起動し、service worker が起き、
 *      manifest の version を返すか(=拡張が「外れていない・壊れていない」)。
 *   3. 画面と差し込み先:
 *      ・全画面を chrome-extension:// で開き、未捕捉例外・console.error・
 *        拡張内ファイルの 404 が無いこと、body が空でないこと、指定した確認式が真であること。
 *      ・content_scripts の各グループについて、対象 URL をネットに出さずに
 *        (fixture か空ページを返して)開き、拡張の isolated world が作られること
 *        (=注入された)、指定した確認式が真であること。
 *      ★isolated world を見ること: page.evaluate は main world なので、
 *        content script の変数は【必ず undefined】に見える(返信サジェスト 2026-08-14 誤診の実損)。
 *
 * ■ ★この検証が判定しないこと
 *   ・本物のサイト(ログインが要る Chatwork 等)での抽出精度。fixture の DOM での確認まで。
 *   ・ボタンを押した先の個々の機能の正しさ。それは各リポの e2e/単体テストの役目。
 *     ここは「全部の入口が開いて、落ちずに立ち上がる」を全拡張で同じ物差しで保証する土台。
 *   ・利用者の普段の Chrome に拡張が入ったままか(別プロファイル・Chrome 再起動で外れる件)。
 *     それは各 PC 上の検査(例: 追憶 scripts/check-chrome-load-path.mjs)の役目。
 *
 * ■ 設定: 対象リポ直下の extension-verify.json(無ければ既定値で走る)
 *   {
 *     "extensionDir": ".",                       // manifest.json のあるフォルダ
 *     "pages":  [{ "path": "status.html", "expect": "!!document.querySelector('#app')" }],
 *     "ignorePages": [{ "path": "lp.html", "reason": "LP。拡張の画面ではない" }],
 *     "sites":  [{ "url": "https://www.chatwork.com/", "fixture": "test/fixtures/x.html",
 *                  "expect": "typeof window.__x === 'object'" }],
 *     "allowErrors": [{ "pattern": "正規表現", "reason": "なぜ無害か" }],
 *     "copyExclude": ["android-app"],            // 一時コピーから外す重いフォルダ
 *     "settleMs": 1500
 *   }
 *
 * 使い方:
 *   node templates/extension-verify/run.mjs [対象リポ]            # 静的+ブラウザ
 *   node templates/extension-verify/run.mjs [対象リポ] --static-only
 *   node templates/extension-verify/run.mjs [対象リポ] --headed    # 画面を出して見る
 *   node templates/extension-verify/run.mjs [対象リポ] --extension-dir build/pkg  # 出荷パッケージを確かめる
 *   node templates/extension-verify/run.mjs --selftest              # ★自分自身を毒で試す
 *
 * 前提: 対象リポか実行環境に playwright(または @playwright/test)と chromium。
 *   無ければ `npm i -D playwright && npx playwright install chromium`。
 *   ★Chrome 正式版(137+)は --load-extension を無視する。Playwright の chromium を使うこと。
 *
 * 終了コード: 0 = 合格 / 1 = ★測れた上での赤 / 2 = ★測れなかった(playwright 無し等)
 * 証拠: <対象>/.artifacts/extension-verify/ に report.json と各画面のスクリーンショット。
 * ───────────────────────────────────────────────────────────────────────────
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { dirname, extname, join, posix, relative, resolve, sep } from 'node:path';

// ─── 設定 ────────────────────────────────────────────────────────────────
export function loadConfig(targetDir) {
  const p = join(targetDir, 'extension-verify.json');
  const cfg = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
  return {
    configFound: existsSync(p),
    extensionDir: cfg.extensionDir || '.',
    pages: cfg.pages || [],
    ignorePages: cfg.ignorePages || [],
    sites: cfg.sites || [],
    allowErrors: cfg.allowErrors || [],
    copyExclude: cfg.copyExclude || [],
    settleMs: cfg.settleMs ?? 1500,
  };
}

const stripQuery = (p) => String(p).split(/[?#]/)[0];

// ─── 1. 静的検査 ──────────────────────────────────────────────────────────
/** manifest が「拡張の画面」として宣言している HTML(クエリ付きのまま)。 */
export function declaredPages(manifest) {
  const out = [];
  const add = (p, why) => { if (p) out.push({ path: String(p).replace(/^\//, ''), why }); };
  add(manifest.action?.default_popup || manifest.browser_action?.default_popup, 'popup');
  add(manifest.options_page, 'options');
  add(manifest.options_ui?.page, 'options');
  add(manifest.side_panel?.default_path, 'side_panel');
  add(manifest.devtools_page, 'devtools');
  for (const [k, v] of Object.entries(manifest.chrome_url_overrides || {})) add(v, `override:${k}`);
  return out;
}

/** manifest が参照する全ファイル(存在確認用・クエリ除去済み)。 */
export function manifestRefs(manifest) {
  const refs = new Set();
  const add = (p) => { if (typeof p === 'string' && p && !/^https?:/.test(p)) refs.add(stripQuery(p).replace(/^\//, '')); };
  add(manifest.background?.service_worker);
  for (const s of manifest.background?.scripts || []) add(s);
  for (const cs of manifest.content_scripts || []) { (cs.js || []).forEach(add); (cs.css || []).forEach(add); }
  for (const p of declaredPages(manifest)) add(p.path);
  const icons = (o) => { if (typeof o === 'string') add(o); else for (const v of Object.values(o || {})) add(v); };
  icons(manifest.icons); icons(manifest.action?.default_icon);
  for (const w of manifest.web_accessible_resources || []) {
    for (const r of (typeof w === 'string' ? [w] : w.resources || [])) if (!/[*]/.test(r)) add(r);
  }
  return [...refs];
}

const IMPORT_RE = /(?:^|[\s;])import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|importScripts\(([^)]*)\)/gm;
/** service worker からたどれる import の欠落を、相対パスで返す(コメント内は粗く除外)。 */
export function missingImports(extDir, entry) {
  const missing = [];
  const seen = new Set();
  const walk = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const abs = join(extDir, rel);
    if (!existsSync(abs)) { missing.push(rel); return; }
    const src = readFileSync(abs, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(IMPORT_RE)) {
      const specs = m[3] ? [...m[3].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]) : [m[1] || m[2]];
      for (const s of specs) {
        if (!s || !/^\.{0,2}\//.test(s)) continue; // bare / URL は対象外
        const next = s.startsWith('/') ? s.slice(1) : posix.normalize(posix.join(posix.dirname(rel), s));
        walk(stripQuery(next));
      }
    }
  };
  walk(entry);
  return missing;
}

/** HTML の <script src> / <link href> の拡張内参照の欠落。 */
export function missingHtmlRefs(extDir, pageRel) {
  const abs = join(extDir, pageRel);
  if (!existsSync(abs)) return [pageRel];
  const html = readFileSync(abs, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  for (const m of html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)\s*=\s*["']([^"']+)["']/gi)) {
    const ref = m[1];
    if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(ref)) continue;
    const r = stripQuery(ref.startsWith('/') ? ref.slice(1) : posix.normalize(posix.join(posix.dirname(pageRel), ref)));
    if (!existsSync(join(extDir, r))) out.push(`${pageRel} → ${ref}`);
  }
  return out;
}

/** 網羅の門で見る HTML: 拡張直下 + 宣言済み画面のあるフォルダ(非再帰)。 */
export function candidateHtml(extDir, manifest) {
  const dirs = new Set(['.']);
  for (const p of declaredPages(manifest)) dirs.add(posix.dirname(stripQuery(p.path)));
  const out = [];
  for (const d of dirs) {
    const abs = join(extDir, d);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) {
      if (extname(f).toLowerCase() === '.html' && statSync(join(abs, f)).isFile()) out.push(posix.normalize(posix.join(d, f)));
    }
  }
  return [...new Set(out)].sort();
}

/** match パターン → 実際に開く URL。 */
export function urlForPattern(pattern) {
  if (pattern === '<all_urls>') return 'https://example.com/';
  const m = /^(\*|https?|file):\/\/([^/]*)(\/.*)?$/.exec(pattern);
  if (!m) return null;
  const scheme = m[1] === '*' ? 'https' : m[1];
  if (scheme === 'file') return null;
  let host = m[2];
  if (host === '*' ) host = 'example.com';
  else if (host.startsWith('*.')) host = 'www.' + host.slice(2);
  const path = (m[3] || '/').replace(/\*/g, '');
  return `${scheme}://${host}${path || '/'}`;
}

function patternToRegex(pattern) {
  if (pattern === '<all_urls>') return /^(https?|file):/;
  const m = /^(\*|https?|file):\/\/([^/]*)(\/.*)?$/.exec(pattern);
  if (!m) return /^$/;
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const scheme = m[1] === '*' ? 'https?' : esc(m[1]);
  const host = m[2] === '*' ? '[^/]+' : m[2].startsWith('*.') ? `(?:[^/]+\\.)?${esc(m[2].slice(2))}` : esc(m[2]);
  const path = esc(m[3] || '/').replace(/\\\*|\*/g, '.*');
  return new RegExp(`^${scheme}://${host}${path}$`);
}
export const urlMatches = (url, patterns) => (patterns || []).some((p) => patternToRegex(p).test(url));

/** 静的検査一式。{ manifest, pages, sites, failures[], notes[] } */
export function staticPlan(targetDir, cfg) {
  const extDir = resolve(targetDir, cfg.extensionDir);
  const failures = [];
  const notes = [];
  const mp = join(extDir, 'manifest.json');
  if (!existsSync(mp)) return { failures: [`manifest.json が無い: ${mp}`], notes, pages: [], sites: [], extDir };
  let manifest;
  try { manifest = JSON.parse(readFileSync(mp, 'utf8')); } catch (e) {
    return { failures: [`manifest.json が JSON として読めない: ${e.message}`], notes, pages: [], sites: [], extDir };
  }

  for (const r of manifestRefs(manifest)) if (!existsSync(join(extDir, r))) failures.push(`manifest が指すファイルが無い: ${r}`);
  const sw = manifest.background?.service_worker;
  if (sw) for (const r of missingImports(extDir, sw)) failures.push(`service worker の import 先が無い: ${r}`);

  // 開く画面 = manifest 宣言 + 設定の pages(重複はクエリ込みで除く)
  const pageMap = new Map();
  for (const p of declaredPages(manifest)) pageMap.set(p.path, { path: p.path, why: p.why });
  for (const p of cfg.pages) pageMap.set(String(p.path).replace(/^\//, ''), { ...pageMap.get(p.path), ...p, why: p.why || pageMap.get(p.path)?.why || 'config' });
  const pages = [...pageMap.values()];
  for (const p of pages) for (const r of missingHtmlRefs(extDir, stripQuery(p.path))) failures.push(`画面の参照先が無い: ${r}`);

  // ★網羅の門
  const covered = new Set(pages.map((p) => stripQuery(p.path)));
  const ignored = new Map(cfg.ignorePages.map((p) => [String(p.path).replace(/^\//, ''), p.reason]));
  for (const [p, reason] of ignored) if (!reason || !String(reason).trim()) failures.push(`ignorePages に理由が無い: ${p}`);
  for (const h of candidateHtml(extDir, manifest)) {
    if (!covered.has(h) && !ignored.has(h)) {
      failures.push(`未検証の画面: ${h}(extension-verify.json の pages に足すか、ignorePages に理由つきで書く)`);
    }
  }

  // 差し込み先: 設定の sites + 誰にも当たらないグループには自動の URL を足す
  const sites = cfg.sites.map((s) => ({ ...s, auto: false }));
  (manifest.content_scripts || []).forEach((cs, i) => {
    const hit = sites.some((s) => urlMatches(s.url, cs.matches) && !urlMatches(s.url, cs.exclude_matches));
    if (hit) return;
    const url = (cs.matches || []).map(urlForPattern).find(Boolean);
    if (url) {
      sites.push({ url, auto: true, group: i });
      notes.push(`content_scripts[${i}] は空ページでの注入確認だけ(中身の確認式なし): ${url}`);
    } else {
      notes.push(`content_scripts[${i}] は開ける URL を作れない(${(cs.matches || []).join(', ')})ので未確認`);
    }
  });
  for (const s of sites) {
    s.groups = (manifest.content_scripts || [])
      .map((cs, i) => ({ cs, i }))
      .filter(({ cs }) => urlMatches(s.url, cs.matches) && !urlMatches(s.url, cs.exclude_matches))
      .map(({ cs, i }) => ({ i, world: cs.world || 'ISOLATED' }));
    if (!s.groups.length) failures.push(`sites の URL にどの content_scripts も当たらない: ${s.url}`);
    if (s.fixture && !existsSync(resolve(targetDir, s.fixture))) failures.push(`fixture が無い: ${s.fixture}`);
  }
  return { manifest, extDir, pages, sites, failures, notes };
}

// ─── 2/3. ブラウザ検査 ───────────────────────────────────────────────────
function loadPlaywright(targetDir) {
  const tries = [join(targetDir, 'package.json'), import.meta.url];
  for (const base of tries) {
    const req = createRequire(base);
    for (const name of ['playwright', '@playwright/test', 'playwright-core']) {
      try { const m = req(name); if (m.chromium) return m; } catch { /* 次へ */ }
    }
  }
  try { return createRequire(join(process.cwd(), 'x.js'))('playwright'); } catch { return null; }
}

/** Chromium の unpacked 拡張 ID(manifest.key があればそれ、無ければパス)。SW が無い拡張用の予備。 */
export function extensionIdFor(extDir, manifest) {
  const hex = manifest.key
    ? createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex')
    : createHash('sha256').update(process.platform === 'win32' ? Buffer.from(extDir, 'utf16le') : Buffer.from(extDir)).digest('hex');
  return [...hex.slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

/** --load-extension は日本語パスを渡すと文字化けして読まれない(返信サジェスト 2026-08-17)。ASCII の一時フォルダへ写す。 */
function asciiCopy(extDir, exclude) {
  if (/^[\x20-\x7e]+$/.test(extDir)) return { dir: extDir, cleanup: () => {} };
  const dir = mkdtempSync(join(tmpdir(), 'ext-verify-'));
  const skip = new Set(['node_modules', '.git', '.artifacts', ...exclude]);
  cpSync(extDir, dir, { recursive: true, filter: (src) => !skip.has(relative(extDir, src).split(sep)[0]) });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const DEFAULT_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>extension-verify</title></head><body><main><p>extension-verify</p></main></body></html>';

async function browserPhase(targetDir, cfg, plan, { headed }) {
  const pw = loadPlaywright(targetDir);
  if (!pw) return { unmeasurable: 'playwright が見つからない(npm i -D playwright && npx playwright install chromium)' };
  const results = [];
  const allow = cfg.allowErrors.map((a) => ({ re: new RegExp(a.pattern), reason: a.reason }));
  const isAllowed = (msg) => allow.some((a) => a.re.test(msg));
  const outDir = join(targetDir, '.artifacts', 'extension-verify');
  mkdirSync(outDir, { recursive: true });

  const copy = asciiCopy(plan.extDir, cfg.copyExclude);
  const userDataDir = mkdtempSync(join(tmpdir(), 'ext-verify-profile-'));
  let context;
  try {
    context = await pw.chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: !headed,
      args: [`--disable-extensions-except=${copy.dir}`, `--load-extension=${copy.dir}`],
    });
  } catch (e) {
    copy.cleanup();
    return { unmeasurable: `Chromium を起動できない: ${String(e.message).split('\n')[0]}(npx playwright install chromium)` };
  }

  try {
    // 2. 起動: service worker
    let id = null;
    if (plan.manifest.background?.service_worker) {
      const pick = () => context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
      let sw = pick();
      const deadline = Date.now() + 30_000;
      while (!sw && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 200)); sw = pick(); }
      if (!sw) {
        results.push({ kind: 'boot', name: 'service worker 起動', ok: false, detail: '30秒待っても起きない＝拡張が読み込まれていない/SW が例外で死んだ' });
        return { results };
      }
      id = new URL(sw.url()).host;
      let ver = null;
      try { ver = await sw.evaluate(() => chrome.runtime.getManifest().version); } catch (e) { ver = 'ERR ' + e.message; }
      results.push({ kind: 'boot', name: 'service worker 起動', ok: ver === plan.manifest.version, detail: `id=${id} version=${ver}` });
    } else {
      id = extensionIdFor(copy.dir, plan.manifest);
      results.push({ kind: 'boot', name: 'service worker 起動', ok: true, detail: `SW なし。id はパスから算出: ${id}` });
    }

    // 3a. 画面
    for (const p of plan.pages) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(`例外: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
      page.on('response', (r) => { if (r.url().startsWith('chrome-extension://') && r.status() >= 400) errors.push(`${r.status()}: ${r.url()}`); });
      // ★ERR_ABORTED は「ファイルが無い」ではなく読み込みの中断(headless で mp4 を再生しない等)。無い時は ERR_FILE_NOT_FOUND。
      page.on('requestfailed', (r) => {
        const why = r.failure()?.errorText || '';
        if (r.url().startsWith('chrome-extension://') && !/ERR_ABORTED/.test(why)) errors.push(`読込失敗(${why}): ${r.url()}`);
      });
      // ★devtools_page は DevTools の中でしか chrome.devtools が無い。最小の代役を入れて
      //   「落ちずに立ち上がり、作るパネルのファイルが実在するか」まで見る。
      const devtools = p.devtoolsStub ?? p.why === 'devtools';
      if (devtools) {
        await page.addInitScript(() => {
          const noop = () => {};
          const ev = { addListener: noop, removeListener: noop };
          window.__extVerifyPanels = [];
          chrome.devtools = {
            panels: {
              create: (title, icon, path, cb) => { window.__extVerifyPanels.push(path); cb?.({ onShown: ev, onHidden: ev }); },
              elements: { createSidebarPane: (t, cb) => cb?.({ setPage: noop, setObject: noop, onShown: ev }), onSelectionChanged: ev },
              themeName: 'default',
            },
            inspectedWindow: { tabId: 0, eval: (e, o, cb) => (typeof o === 'function' ? o : cb)?.(undefined), reload: noop, onResourceAdded: ev },
            network: { onRequestFinished: ev, onNavigated: ev, getHAR: (cb) => cb?.({ entries: [] }) },
          };
        });
      }
      const name = `画面 ${p.path}`;
      let ok = true; let detail = '';
      try {
        await page.goto(`chrome-extension://${id}/${p.path}`, { waitUntil: 'load', timeout: 20_000 });
        await page.waitForTimeout(cfg.settleMs);
        const filled = await page.evaluate(() => !!document.body && (document.body.innerText.trim().length > 0 || document.body.querySelectorAll('*').length > 0));
        if (devtools) {
          const panels = await page.evaluate(() => window.__extVerifyPanels || []);
          const lost = panels.filter((x) => !existsSync(join(plan.extDir, stripQuery(String(x).replace(/^\//, '')))));
          if (lost.length) { ok = false; detail = `作るパネルのファイルが無い: ${lost.join(', ')}`; }
          else detail = `パネル ${panels.length}件: ${panels.join(', ') || '(なし)'}`;
        } else if (!filled) { ok = false; detail = 'body が空(真っ白)'; }
        if (ok && p.expect) {
          const v = await page.evaluate(async (expr) => { try { return { v: await (0, eval)(expr) }; } catch (e) { return { e: String(e) }; } }, p.expect);
          if (v.v !== true) { ok = false; detail = `確認式が true でない → ${v.e || JSON.stringify(v.v)}`; }
        }
        await page.screenshot({ path: join(outDir, `page-${p.path.replace(/[^\w.-]+/g, '_')}.png`) }).catch(() => {});
      } catch (e) { ok = false; detail = `開けない: ${String(e.message).split('\n')[0]}`; }
      const bad = errors.filter((m) => !isAllowed(m));
      if (bad.length) { ok = false; detail = [detail, ...bad.slice(0, 5)].filter(Boolean).join(' | '); }
      results.push({ kind: 'page', name, ok, detail, allowed: errors.length - bad.length });
      await page.close();
    }

    // 3b. 差し込み先(ネットには出さない)
    for (const s of plan.sites) {
      const page = await context.newPage();
      const host = new URL(s.url).host;
      const body = s.fixture ? readFileSync(resolve(targetDir, s.fixture), 'utf8') : DEFAULT_HTML;
      await page.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.host === host && route.request().resourceType() === 'document') {
          return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
        }
        // ★abort するとページ側に「Failed to load resource」が出て、拡張の不具合と区別できなくなる。
        //   外の画像・CSS 等は空で返す(ネットには出さない)。
        return route.fulfill({ status: 204, body: '' });
      });
      const cdp = await context.newCDPSession(page);
      const ctxs = new Map();
      cdp.on('Runtime.executionContextCreated', ({ context: c }) => ctxs.set(c.id, c));
      cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => ctxs.delete(executionContextId));
      cdp.on('Runtime.executionContextsCleared', () => ctxs.clear());
      const errors = [];
      page.on('pageerror', (e) => errors.push(`例外: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
      await cdp.send('Runtime.enable');
      const name = `差し込み ${s.url}${s.auto ? '(自動)' : ''}`;
      let ok = true; let detail = '';
      try {
        await page.goto(s.url, { waitUntil: 'load', timeout: 20_000 });
        const needIsolated = s.groups.some((g) => g.world !== 'MAIN');
        const findExt = () => [...ctxs.values()].find((c) => c.auxData?.type === 'isolated'
          && (String(c.origin || '').includes(id) || c.name === plan.manifest.name));
        let ext = findExt();
        const deadline = Date.now() + 10_000;
        while (needIsolated && !ext && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 200)); ext = findExt(); }
        await page.waitForTimeout(cfg.settleMs);
        if (needIsolated && !ext) { ok = false; detail = '拡張の isolated world が無い＝content script が注入されていない'; }
        if (ok && s.expect) {
          const r = await cdp.send('Runtime.evaluate', {
            expression: `(async () => (${s.expect}))()`, contextId: (s.world === 'MAIN' || !ext) ? undefined : ext.id,
            awaitPromise: true, returnByValue: true,
          });
          // ★true だけを合格にする。失敗理由を文字列で返す確認式('messages=0' 等)が「真」扱いで素通りした実損(2026-10-25 毒テストで発覚)。
          if (r.exceptionDetails || r.result?.value !== true) {
            ok = false;
            detail = `確認式が true でない → ${r.exceptionDetails ? (r.exceptionDetails.exception?.description || r.exceptionDetails.text).split('\n')[0] : JSON.stringify(r.result?.value)}`;
          }
        }
        if (ok) detail = `注入グループ ${s.groups.map((g) => g.i).join(',')}`;
        await page.screenshot({ path: join(outDir, `site-${host.replace(/[^\w.-]+/g, '_')}.png`) }).catch(() => {});
      } catch (e) { ok = false; detail = `開けない: ${String(e.message).split('\n')[0]}`; }
      const bad = errors.filter((m) => !isAllowed(m));
      if (bad.length) { ok = false; detail = [detail, ...bad.slice(0, 5)].filter(Boolean).join(' | '); }
      results.push({ kind: 'site', name, ok, detail, allowed: errors.length - bad.length });
      await page.close();
    }
    return { results };
  } finally {
    await context.close().catch(() => {});
    rmSync(userDataDir, { recursive: true, force: true });
    copy.cleanup();
  }
}

// ─── 実行 ────────────────────────────────────────────────────────────────
export async function verify(targetDir, { staticOnly = false, headed = false, extensionDir, log = console.log } = {}) {
  const cfg = loadConfig(targetDir);
  if (extensionDir) cfg.extensionDir = resolve(extensionDir); // 出荷パッケージ(ストア ZIP の中身)を直接確かめたいとき
  const plan = staticPlan(targetDir, cfg);
  log(`■ 拡張の自動検証: ${plan.manifest?.name || '(manifest 読めず)'} v${plan.manifest?.version || '?'}`);
  if (!cfg.configFound) log('  (extension-verify.json が無いので既定値で実行)');
  log(`\n[1] 静的: 画面 ${plan.pages.length} / 差し込み先 ${plan.sites.length}`);
  for (const f of plan.failures) log(`  FAIL ${f}`);
  for (const n of plan.notes) log(`  note ${n}`);
  if (!plan.failures.length) log('  ok   参照切れ・未検証の画面なし');
  const report = { target: targetDir, static: { failures: plan.failures, notes: plan.notes }, browser: null };

  let code = plan.failures.length ? 1 : 0;
  if (!staticOnly && plan.manifest) {
    log('\n[2][3] ブラウザ');
    const b = await browserPhase(targetDir, cfg, plan, { headed });
    report.browser = b;
    if (b.unmeasurable) { log(`  測れず: ${b.unmeasurable}`); if (!code) code = 2; }
    for (const r of b.results || []) {
      log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? ' — ' + r.detail : ''}${r.allowed ? `(許容 ${r.allowed}件)` : ''}`);
      if (!r.ok) code = 1;
    }
  }
  try {
    const out = join(targetDir, '.artifacts', 'extension-verify');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  } catch { /* 証拠の書き込み失敗で判定は変えない */ }
  log(`\n結果: ${code === 0 ? '合格' : code === 1 ? '★赤' : '測れなかった'}`);
  return code;
}

// ─── 自己検査(毒で試す) ──────────────────────────────────────────────────
function selftest() {
  let fails = 0;
  const check = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails++; };
  const mk = (files) => {
    const d = mkdtempSync(join(tmpdir(), 'ext-verify-selftest-'));
    for (const [p, c] of Object.entries(files)) { if (c === undefined) continue; mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c); }
    return d;
  };
  const good = {
    'manifest.json': JSON.stringify({
      manifest_version: 3, name: 't', version: '1.0.0',
      background: { service_worker: 'sw.js', type: 'module' },
      action: { default_popup: 'popup.html' },
      content_scripts: [{ matches: ['https://*.example.org/*'], js: ['cs.js'] }],
    }),
    'sw.js': "import './lib/a.js';\n// import './commented-out.js';\n",
    'lib/a.js': 'export const a = 1;',
    'popup.html': '<html><body><script src="popup.js"></script></body></html>',
    'popup.js': '',
    'cs.js': '',
  };
  const g = mk(good);
  const pg = staticPlan(g, loadConfig(g));
  check('健全な拡張は静的検査で赤にならない', pg.failures.length === 0);
  check('差し込み先が自動で足される', pg.sites.length === 1 && pg.sites[0].url === 'https://www.example.org/');

  const bad = mk({
    ...good,
    'lib/a.js': undefined,
    'popup.html': '<html><body><script src="missing.js"></script></body></html>',
    'extra.html': '<html></html>',
    'extension-verify.json': JSON.stringify({ ignorePages: [{ path: 'nope.html', reason: '' }], sites: [{ url: 'https://other.test/' }] }),
  });
  const pb = staticPlan(bad, loadConfig(bad));
  const has = (s) => pb.failures.some((f) => f.includes(s));
  check('★SW の import 先の欠落を赤にする', has('service worker の import 先が無い: lib/a.js'));
  check('★コメント内の import は数えない', !has('commented-out'));
  check('★画面の script 参照切れを赤にする', has('popup.html → missing.js'));
  check('★未検証の画面を赤にする(網羅の門)', has('未検証の画面: extra.html'));
  check('★理由なしの除外を赤にする', has('ignorePages に理由が無い'));
  check('★どの content_scripts にも当たらない sites を赤にする', has('どの content_scripts も当たらない'));

  check('match: *.chatwork.com は www.chatwork.com に当たる', urlMatches('https://www.chatwork.com/#!rid1', ['https://*.chatwork.com/*']));
  check('match: *.chatwork.com は chatwork.com 自身にも当たる', urlMatches('https://chatwork.com/', ['https://*.chatwork.com/*']));
  check('match: 別ドメインには当たらない', !urlMatches('https://evilchatwork.com/', ['https://*.chatwork.com/*']));
  // 追憶の manifest.key(公開鍵・git 管理済み)→ 恒久ID ohifblceplfkfajfecaoaclmkiahfflm(AGENTS.md §2 の実値)
  const TSUIOKU_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAy2D/OmG4MwfDWDpw0lQ0BuMFStFPcDuuAHvQ5RB/TF2jzUKYjIFNqi+QDrnLEdFz7zNe3Wo6t8TzTeMJmTAguvlHM9hLHsF4jkwWL/lWz0x3DWZqTnw+lCh418eCFbjO+MkjDyDIOwIAO1gV2q+8wJ0HwSfGO8jcToBilHAP4kaxJSpC+MZftfbhngPI7TFrZY0j2BTpkp2HHG5ocXzsqhSD+Z2VU/xHvRNm9o823Bcfn8p3QIrRBu2w2iOlSuVl2j2b4nNR59GLis20aorT6HS5Jr8AYp/raftka/uiS0FWcJFpp3jshxpOqQ7OmPaAIoTcpshBTC+o6krbW9x0lwIDAQAB';
  check('ID: 公開鍵から決まる(追憶の恒久IDと一致)', extensionIdFor('/x', { key: TSUIOKU_KEY }) === 'ohifblceplfkfajfecaoaclmkiahfflm');
  for (const d of [g, bad]) rmSync(d, { recursive: true, force: true });
  console.log(fails ? `\n自己検査: ★${fails}件失敗` : '\n自己検査: 全部合格');
  return fails ? 1 : 0;
}

// ─── CLI ─────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) process.exit(selftest());
  const i = args.indexOf('--extension-dir');
  const extensionDir = i >= 0 ? args[i + 1] : undefined;
  const target = resolve(args.find((a, k) => !a.startsWith('--') && args[k - 1] !== '--extension-dir') || process.cwd());
  verify(target, { staticOnly: args.includes('--static-only'), headed: args.includes('--headed'), extensionDir })
    .then((c) => process.exit(c))
    .catch((e) => { console.error('測れなかった:', e); process.exit(2); });
}
