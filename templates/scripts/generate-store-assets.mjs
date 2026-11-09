/**
 * 移植元: partnership_program_website/scripts/generate-store-assets.mjs
 *        (Exosome/scripts/generate-store-assets.mjs は Python ラッパ版。ここでは
 *         アプリ非依存にするため sharp 直叩きの partnership 版をベースに一般化した)
 *
 * Play Console / App Store / Web 提出用アセットを生成する。
 * app.config.json を SSOT とする: ロゴ / 配色 / アプリ名 / 本番URL はすべて
 * app.config.json(brand / identity)と env から読み、ハードコードしない。
 *
 * 生成物:
 *   store-assets/play/feature-graphic.png   … 1024x500(Play フィーチャーグラフィック)
 *   store-assets/play/icon-512.png          … 512x512(brand.iconSource を縮小)
 *   <repo>/og-image.png                     … 1200x630(Open Graph)
 *   store-assets/play/screenshots/NN-*.png  … 1080x2400(縦長スクショ)
 *
 *   store-assets/creative-assets/header.jpg         … 3840x1646(App Store「ヘッダと検索結果」のヘッダ)
 *   store-assets/creative-assets/search-results.jpg … 3840x2560(同 検索結果)
 *   store-assets/chrome/promo-small-440x280.png     … 440x280(CWS プロモーション タイル 小) ※--chrome か manifest.json があるとき
 *   store-assets/chrome/promo-marquee-1400x560.png  … 1400x560(CWS マーキー)              ※同上
 *
 * ★任意の欄も言われなくても埋める(2026-11-09 りんく指示、docs/ai-rules/10_STORE_FIELDS.md)。
 *   ヘッダ・検索結果・タイルは「既にあれば上書きしない」(人や AI が作り込んだ絵を消さない。作り直すなら --force)。
 *   store-assets/creative-assets/<header|search-results>.html や store-assets/chrome/<promo-small|promo-marquee>.html を置けば、
 *   それをその寸法で撮って使う(キャラ・実際の画面を入れた作り込み版)。無ければアイコン・アプリ名・短い説明で組む。
 *
 * 使い方:
 *   node scripts/generate-store-assets.mjs              # 全部
 *   node scripts/generate-store-assets.mjs --creative   # ヘッダ・検索結果(と CWS タイル)だけ
 *   node scripts/generate-store-assets.mjs --graphic    # グラフィックだけ
 *   node scripts/generate-store-assets.mjs --screenshots# スクショだけ
 *   # 別ホストから撮る場合:
 *   SCREENSHOT_URL=http://localhost:5173 node scripts/generate-store-assets.mjs --screenshots
 *
 * 依存: sharp(アイコン/グラフィック生成)、@playwright/test(スクショ)。
 *   スクショ用ルートは env STORE_SCREENSHOT_ROUTES(カンマ区切り)で指定可。
 *   未指定なら "/" の 1 枚のみ撮る(アプリ構造に依存しない安全側デフォルト)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadAppConfig, getProjectRoot, productionUrl, cfg, isPlaceholder } from './lib/app-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = getProjectRoot();
const APP_CONFIG = loadAppConfig();

// ロゴ/アイコンソース: app.config.json brand.iconSource(リポジトリ相対)。
const ICON_SOURCE_REL = cfg('brand.iconSource', 'store-assets/source/icon-source-1024.png');
const ICON_SOURCE = path.resolve(ROOT, ICON_SOURCE_REL);

const OUT_DIR = path.join(ROOT, 'store-assets', 'play');
const SHOTS_DIR = path.join(OUT_DIR, 'screenshots');
const BASE_URL = productionUrl();

// 配色とテキストは app.config.json から(プレースホルダは安全な既定値に)。
const PRIMARY = cfg('brand.primaryColor', '#0A0A0F');
const ACCENT = cfg('brand.accentColor', '#A78BFA');
const APP_NAME =
  (!isPlaceholder(APP_CONFIG.identity?.displayName) && APP_CONFIG.identity.displayName) ||
  (!isPlaceholder(APP_CONFIG.identity?.displayNameEn) && APP_CONFIG.identity.displayNameEn) ||
  'App';
const TAGLINE =
  (!isPlaceholder(APP_CONFIG.businessModel?.summaryJa) && APP_CONFIG.businessModel.summaryJa) ||
  (!isPlaceholder(APP_CONFIG.businessModel?.summaryEn) && APP_CONFIG.businessModel.summaryEn) ||
  '';
const DOMAIN_LABEL = (cfg('identity.productionDomain', '') || '').replace(/^https?:\/\//, '').replace(/\/$/, '');

const args = new Set(process.argv.slice(2));
const ONLY_GFX = args.has('--graphic');
const ONLY_SHOTS = args.has('--screenshots');
const ONLY_CREATIVE = args.has('--creative');
const ANY_ONLY = ONLY_GFX || ONLY_SHOTS || ONLY_CREATIVE;
const DO_GFX = ONLY_GFX || !ANY_ONLY;
const DO_SHOTS = ONLY_SHOTS || !ANY_ONLY;
const DO_CREATIVE = ONLY_CREATIVE || !ANY_ONLY;
const FORCE = args.has('--force');
const DO_CHROME = args.has('--chrome') || fs.existsSync(path.join(ROOT, 'manifest.json')) || fs.existsSync(path.join(ROOT, 'extension', 'manifest.json'));

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(SHOTS_DIR, { recursive: true });

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]),
  );
}

// アプリ名が長いと 1 行に収まらないので素朴に折り返す。
function wrapName(name, maxPerLine = 8) {
  const chars = [...String(name)];
  const lines = [];
  for (let i = 0; i < chars.length; i += maxPerLine) {
    lines.push(chars.slice(i, i + maxPerLine).join(''));
  }
  return lines.slice(0, 2); // 最大 2 行
}

function gradientDefs() {
  return `
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${escapeXml(PRIMARY)}"/>
      <stop offset="100%" stop-color="${escapeXml(PRIMARY)}"/>
    </linearGradient>
    <radialGradient id="glow" cx="80%" cy="20%" r="60%">
      <stop offset="0%" stop-color="${escapeXml(ACCENT)}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${escapeXml(ACCENT)}" stop-opacity="0"/>
    </radialGradient>`;
}

const FONT_STACK = "'Yu Gothic UI','Hiragino Kaku Gothic ProN','Meiryo',sans-serif";

async function loadLogoBuffer(size) {
  if (!fs.existsSync(ICON_SOURCE)) {
    console.warn(`[store-assets] WARN: icon source not found at ${ICON_SOURCE}; ロゴ無しで生成します`);
    return null;
  }
  return sharp(ICON_SOURCE)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

// ------------------------------------------------------------------
// Open Graph image 1200x630
// ------------------------------------------------------------------
async function buildOgImage() {
  const W = 1200;
  const H = 630;
  const logoSize = 240;
  const nameLines = wrapName(APP_NAME);
  const nameSvg = nameLines
    .map((line, i) => `<text x="340" y="${280 + i * 80}" font-size="72" font-weight="800" letter-spacing="2">${escapeXml(line)}</text>`)
    .join('\n    ');
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>${gradientDefs()}</defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <g font-family="${FONT_STACK}" fill="#ffffff">
    ${nameSvg}
    ${TAGLINE ? `<text x="340" y="${280 + nameLines.length * 80 + 30}" font-size="30" font-weight="500" fill="rgba(255,255,255,0.82)">${escapeXml(TAGLINE)}</text>` : ''}
    ${DOMAIN_LABEL ? `<text x="340" y="525" font-size="20" font-weight="500" fill="${escapeXml(ACCENT)}">${escapeXml(DOMAIN_LABEL)}</text>` : ''}
  </g>
</svg>`;
  const bg = await sharp(Buffer.from(svg)).png().toBuffer();
  const logo = await loadLogoBuffer(logoSize);
  const out = path.join(ROOT, 'og-image.png');
  let pipeline = sharp(bg);
  if (logo) {
    pipeline = pipeline.composite([{ input: logo, top: Math.round((H - logoSize) / 2), left: 70 }]);
  }
  await pipeline.png({ compressionLevel: 9 }).toFile(out);
  console.log(`[store-assets] og-image.png 1200x630 -> ${path.relative(ROOT, out)}`);
}

// ------------------------------------------------------------------
// Feature graphic 1024x500
// ------------------------------------------------------------------
async function buildFeatureGraphic() {
  const W = 1024;
  const H = 500;
  const logoSize = 200;
  const nameLines = wrapName(APP_NAME);
  const nameSvg = nameLines
    .map((line, i) => `<text x="280" y="${220 + i * 70}" font-size="62" font-weight="800" letter-spacing="2">${escapeXml(line)}</text>`)
    .join('\n    ');
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>${gradientDefs()}</defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <g font-family="${FONT_STACK}" fill="#ffffff">
    ${nameSvg}
    ${TAGLINE ? `<text x="280" y="${220 + nameLines.length * 70 + 20}" font-size="26" font-weight="500" fill="rgba(255,255,255,0.78)">${escapeXml(TAGLINE)}</text>` : ''}
  </g>
</svg>`;

  const bg = await sharp(Buffer.from(svg)).png().toBuffer();
  const logo = await loadLogoBuffer(logoSize);

  const out = path.join(OUT_DIR, 'feature-graphic.png');
  let pipeline = sharp(bg);
  if (logo) {
    pipeline = pipeline.composite([{ input: logo, top: Math.round((H - logoSize) / 2), left: 60 }]);
  }
  await pipeline.png({ compressionLevel: 9 }).toFile(out);
  console.log(`[store-assets] feature-graphic.png 1024x500 -> ${path.relative(ROOT, out)}`);

  // 高解像度アイコン 512(icon source を縮小して同梱)。
  if (fs.existsSync(ICON_SOURCE)) {
    const iconOut = path.join(OUT_DIR, 'icon-512.png');
    await sharp(ICON_SOURCE).resize(512, 512, { fit: 'cover' }).png().toFile(iconOut);
    console.log(`[store-assets] icon-512.png -> ${path.relative(ROOT, iconOut)}`);
  }
}

// ------------------------------------------------------------------
// 任意だが CVR に効く欄の画像(App Store ヘッダ・検索結果 / CWS プロモーション タイル)
//   どれも透明不可なので、背景色で塗りつぶして(flatten)不透明に書き出す。
// ------------------------------------------------------------------
const CREATIVE_TARGETS = [
  { name: 'header', dir: path.join(ROOT, 'store-assets', 'creative-assets'), file: 'header.jpg', w: 3840, h: 1646, apple: true },
  { name: 'search-results', dir: path.join(ROOT, 'store-assets', 'creative-assets'), file: 'search-results.jpg', w: 3840, h: 2560, apple: true },
  { name: 'promo-small', dir: path.join(ROOT, 'store-assets', 'chrome'), file: 'promo-small-440x280.png', w: 440, h: 280, chrome: true },
  { name: 'promo-marquee', dir: path.join(ROOT, 'store-assets', 'chrome'), file: 'promo-marquee-1400x560.png', w: 1400, h: 560, chrome: true },
];

function existingVariant(dir, base) {
  return ['.jpg', '.jpeg', '.png'].map((ext) => path.join(dir, base + ext)).find((p) => fs.existsSync(p));
}

// 横長の看板: 左にアイコン、右にアプリ名と短い説明。寸法に合わせて全部を比例で置く。
async function renderBanner(w, h) {
  const u = h / 500; // フィーチャーグラフィック(1024x500)と同じ比率感で拡大縮小する
  const logoSize = Math.round(Math.min(h * 0.46, w * 0.28));
  const textX = Math.round(logoSize + h * 0.24);
  // 文字がはみ出さないように、使える幅(右余白つき)から1行の字数と文字の大きさを決める(全角1字≒文字の大きさ1つ分)。
  const avail = w - textX - Math.round(h * 0.12);
  const nameLen = [...String(APP_NAME)].length;
  let fs1 = Math.round(66 * u);
  while (Math.ceil(nameLen / Math.max(1, Math.floor(avail / fs1))) > 2) fs1 = Math.floor(fs1 * 0.92);
  const lineCount = Math.ceil(nameLen / Math.max(1, Math.floor(avail / fs1)));
  const nameLines = wrapName(APP_NAME, Math.ceil(nameLen / lineCount)); // 2行なら半分ずつに分ける
  const tagLen = [...String(TAGLINE)].length;
  const fs2 = Math.min(Math.round(28 * u), tagLen ? Math.floor(avail / tagLen) : Infinity);
  const top = Math.round(h / 2 - ((nameLines.length - 1) * fs1 * 1.15) / 2 - (TAGLINE ? fs1 * 0.3 : 0));
  const nameSvg = nameLines
    .map((line, i) => `<text x="${textX}" y="${top + i * Math.round(fs1 * 1.15)}" font-size="${fs1}" font-weight="800" letter-spacing="${Math.round(2 * u)}">${escapeXml(line)}</text>`)
    .join('\n    ');
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>${gradientDefs()}</defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <g font-family="${FONT_STACK}" fill="#ffffff">
    ${nameSvg}
    ${TAGLINE ? `<text x="${textX}" y="${top + nameLines.length * Math.round(fs1 * 1.15) + Math.round(10 * u)}" font-size="${fs2}" font-weight="500" fill="rgba(255,255,255,0.82)">${escapeXml(TAGLINE)}</text>` : ''}
  </g>
</svg>`;
  const bg = await sharp(Buffer.from(svg)).png().toBuffer();
  const logo = await loadLogoBuffer(logoSize);
  let pipeline = sharp(bg);
  if (logo) pipeline = pipeline.composite([{ input: logo, top: Math.round((h - logoSize) / 2), left: Math.round(h * 0.14) }]);
  return pipeline.png().toBuffer();
}

// アプリ側が作り込んだ HTML があれば、それをその寸法で撮る(Playwright)。
async function renderHtml(htmlPath, w, h) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.goto('file://' + htmlPath, { waitUntil: 'networkidle' });
    return await page.screenshot({ type: 'png', omitBackground: false });
  } finally {
    await browser.close();
  }
}

async function buildCreativeAssets() {
  for (const t of CREATIVE_TARGETS) {
    if (t.chrome && !DO_CHROME) continue;
    fs.mkdirSync(t.dir, { recursive: true });
    const have = existingVariant(t.dir, path.parse(t.file).name);
    if (have && !FORCE) {
      console.log(`[store-assets] ${path.relative(ROOT, have)} は既にある(上書きしない。作り直すなら --force)`);
      continue;
    }
    const htmlSrc = path.join(t.dir, `${t.name}.html`);
    const raw = fs.existsSync(htmlSrc) ? await renderHtml(htmlSrc, t.w, t.h) : await renderBanner(t.w, t.h);
    const out = path.join(t.dir, t.file);
    // 透明不可(Apple・CWS とも)。背景色で塗って不透明にする。
    let img = sharp(raw).resize(t.w, t.h, { fit: 'cover' }).flatten({ background: PRIMARY });
    img = /\.jpe?g$/i.test(out) ? img.jpeg({ quality: 90 }) : img.png({ compressionLevel: 9 });
    await img.toFile(out);
    console.log(`[store-assets] ${t.file} ${t.w}x${t.h} -> ${path.relative(ROOT, out)}${fs.existsSync(htmlSrc) ? ` (${path.basename(htmlSrc)} から)` : ''}`);
  }
  console.log('[store-assets] ★画像の中の文字は機械で読めない。価格・「No.1」等の主張・他アプリの名前が無いかを、画像を開いて目で確かめる(2.3.14)');
}

// ------------------------------------------------------------------
// Phone screenshots
// ------------------------------------------------------------------
async function buildScreenshots() {
  const { chromium, devices } = await import('@playwright/test');
  const phone = {
    ...devices['Pixel 7'],
    viewport: { width: 1080, height: 2400 },
    deviceScaleFactor: 1, // 物理 px = viewport px(Play Console は実 px を要求)
  };

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    ...phone,
    locale: 'ja-JP',
    userAgent: `${phone.userAgent} StoreAssetGenerator`,
  });
  ctx.setDefaultTimeout(30_000);
  const page = await ctx.newPage();

  // 撮影ルートは env で指定(アプリ構造非依存)。未指定なら "/" のみ。
  const routes = (process.env.STORE_SCREENSHOT_ROUTES || '/')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  let idx = 0;
  for (const route of routes) {
    idx += 1;
    const slug = route === '/' ? 'home' : route.replace(/^\/+/, '').replace(/[^a-z0-9]+/gi, '-');
    const name = `${String(idx).padStart(2, '0')}-${slug}`;
    const target = BASE_URL.replace(/\/$/, '') + route;
    console.log(`[store-assets] visit ${target}`);
    await page.goto(target, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForSelector('body', { state: 'visible' }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollBy(0, 1));
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    const out = path.join(SHOTS_DIR, `${name}.png`);
    await page.screenshot({ path: out, fullPage: false, type: 'png' });
    console.log(`[store-assets] ${name}.png 1080x2400 -> ${path.relative(ROOT, out)}`);
  }

  await ctx.close();
  await browser.close();
}

async function main() {
  if (DO_GFX) {
    await buildFeatureGraphic();
    await buildOgImage();
  }
  if (DO_CREATIVE) await buildCreativeAssets();
  if (DO_SHOTS) await buildScreenshots();
  console.log('[store-assets] done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
