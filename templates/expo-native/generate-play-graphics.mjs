#!/usr/bin/env node
/**
 * Play ストア用のグラフィック素材を作る。
 *
 *   store-assets/play/icon-512.png        512x512  アプリアイコン（必須）
 *   store-assets/play/feature-graphic.png 1024x500 フィーチャーグラフィック（必須）
 *
 * なぜ Playwright で作るのか:
 *   キット同梱の generate-store-assets.mjs は `sharp` を使うが、このリポは
 *   sharp を依存に持たない（package.json に無い）。素材源として想定される
 *   assets/images/feature-graphic-source.png も存在しない。
 *   一方 Playwright は E2E 用に既に入っているので、**新しい依存を増やさずに**
 *   ブラウザのレンダリングで PNG を作れる。
 *
 * デザインは DESIGN.md に従う:
 *   - ネイビー #00427B を基調、オレンジ #F97316 をアクセント
 *   - 最重要コピー「会いたい君がいる現在地」を主役に置く
 *   - 汎用SaaS風の白カード中心・抽象グラデーションだけ、は避ける
 *
 * 使い方:
 *   node scripts/generate-play-graphics.mjs
 *   node scripts/generate-play-graphics.mjs --check   # 生成せず存在と寸法だけ検査
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(REPO, 'store-assets', 'play');
const ICON_SRC = path.join(REPO, 'store-assets', 'appstore', 'app-icon-1024.png');
const ICON_OUT = path.join(OUT_DIR, 'icon-512.png');
const FEATURE_OUT = path.join(OUT_DIR, 'feature-graphic.png');

const NAVY = '#00427B';
const NAVY_DEEP = '#002F58';
const ORANGE = '#F97316';

/** PNG ヘッダから幅・高さを読む（外部ライブラリ不要） */
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24) throw new Error(`PNG として短すぎる: ${file}`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function checkOnly() {
  const expect = [
    [ICON_OUT, 512, 512],
    [FEATURE_OUT, 1024, 500],
  ];
  let ng = 0;
  for (const [file, w, h] of expect) {
    if (!fs.existsSync(file)) {
      console.error(`::error::存在しない: ${path.relative(REPO, file)}`);
      ng++;
      continue;
    }
    const s = pngSize(file);
    const ok = s.width === w && s.height === h;
    console.log(`${ok ? 'OK ' : 'NG '} ${path.relative(REPO, file)} = ${s.width}x${s.height}（期待 ${w}x${h}）`);
    if (!ok) ng++;
  }
  process.exit(ng ? 1 : 0);
}

if (process.argv.includes('--check')) checkOnly();

const { chromium } = await import('@playwright/test');

fs.mkdirSync(OUT_DIR, { recursive: true });

if (!fs.existsSync(ICON_SRC)) {
  console.error(`::error::アイコン元画像が無い: ${path.relative(REPO, ICON_SRC)}`);
  process.exit(1);
}
const iconDataUri = `data:image/png;base64,${fs.readFileSync(ICON_SRC).toString('base64')}`;

const browser = await chromium.launch();

// --- 1. アプリアイコン 512x512（元の 1024 を縮小するだけ。加工しない） ---
{
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>
    html,body{margin:0;padding:0;width:512px;height:512px;overflow:hidden}
    img{width:512px;height:512px;display:block}
  </style><img src="${iconDataUri}">`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: ICON_OUT, type: 'png' });
  await page.close();
  const s = pngSize(ICON_OUT);
  console.log(`icon-512.png        ${s.width}x${s.height}`);
}

// --- 2. フィーチャーグラフィック 1024x500 ---
// Play のフィーチャーグラフィックは端が切られる場合があるので、
// 文字は中央寄りに置き、端 80px には重要な要素を置かない。
{
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>
    @import url('');
    html,body{margin:0;padding:0;width:1024px;height:500px;overflow:hidden}
    .wrap{
      width:1024px;height:500px;position:relative;
      background:
        radial-gradient(900px 380px at 78% 30%, rgba(249,115,22,.22), transparent 62%),
        linear-gradient(135deg, ${NAVY} 0%, ${NAVY_DEEP} 100%);
      font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo",sans-serif;
      display:flex;align-items:center;
    }
    /* 足あとが重なっていく様子を、同心円の波として置く（レーダーの含意） */
    .ring{position:absolute;border:2px solid rgba(226,237,247,.16);border-radius:50%}
    .r1{width:300px;height:300px;right:110px;top:100px}
    .r2{width:440px;height:440px;right:40px;top:30px}
    .r3{width:580px;height:580px;right:-30px;top:-40px}
    .pin{position:absolute;right:243px;top:233px;width:34px;height:34px;border-radius:50%;
         background:${ORANGE};box-shadow:0 0 0 10px rgba(249,115,22,.28)}
    .copy{position:relative;padding-left:96px;max-width:640px}
    .title{color:#FFFFFF;font-size:62px;font-weight:800;line-height:1.22;letter-spacing:.01em;margin:0}
    .accent{color:${ORANGE}}
    .sub{color:#E2EDF7;font-size:26px;font-weight:600;line-height:1.5;margin:20px 0 0}
  </style>
  <div class="wrap">
    <div class="ring r1"></div><div class="ring r2"></div><div class="ring r3"></div>
    <div class="pin"></div>
    <div class="copy">
      <p class="title">会いたい君がいる<br><span class="accent">現在地</span></p>
      <p class="sub">足あとを残して、あとからその場所へ。</p>
    </div>
  </div>`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: FEATURE_OUT, type: 'png' });
  await page.close();
  const s = pngSize(FEATURE_OUT);
  console.log(`feature-graphic.png ${s.width}x${s.height}`);
}

await browser.close();

// 生成しっぱなしにせず、寸法を読み返して検証する
const icon = pngSize(ICON_OUT);
const feat = pngSize(FEATURE_OUT);
if (icon.width !== 512 || icon.height !== 512) {
  console.error(`::error::icon-512.png の寸法が不正: ${icon.width}x${icon.height}`);
  process.exit(1);
}
if (feat.width !== 1024 || feat.height !== 500) {
  console.error(`::error::feature-graphic.png の寸法が不正: ${feat.width}x${feat.height}`);
  process.exit(1);
}
console.log('generate-play-graphics: done.');
