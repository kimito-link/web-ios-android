#!/usr/bin/env node
/**
 * scripts/generate-capacitor-splash.mjs
 *
 * Capacitor 用スプラッシュ／アイコンのマスター素材を用意する（金型・アプリ非依存）。
 *
 * ★なぜこのファイルが要るか（2026-08-24 実測で判明した欠落）
 *   iOS/Android の release ワークフロー（ios-appstore-release.yml / android-play-release.yml）は
 *   どちらも `node scripts/generate-capacitor-splash.mjs` を**名指しで呼んでいた**のに、
 *   このキットの `templates/scripts/` には**そのファイルが1つも無かった**。
 *   結果、キットを使う各アプリが**それぞれ自力で書く**しかなく、5リポで実際に確認したところ
 *   **5つとも中身が違っていた**（ハッシュ・行数とも全部バラバラ）。
 *   ここに正本を1本置くことで、次のアプリはコピーするだけで済む。
 *
 * ■ このスクリプトがすること
 *   `assets/splash.png` と `assets/splash-dark.png` が無ければ、
 *   `app.config.json` のブランド色から単色スプラッシュを生成する（プレースホルダ）。
 *   ★両方とも**既に存在するなら何もしない**（手描きのブランド素材を上書きしない）。
 *
 * ■ ★見ないこと（限界・重要）
 *   実際の画像生成（全サイズ展開・LaunchScreen焼き込み）は `@capacitor/assets` に任せる。
 *   このスクリプトは「@capacitor/assets に渡す2732×2732のマスター」を用意するだけ。
 *   ★`@capacitor/assets` は `assets/icon-only.png` だけ渡すと**スプラッシュを生成せず
 *   黙ってスキップする**（`_docs/CAPACITOR-GOLDEN-RULES.md` 原則7）。マスターが
 *   `assets/splash*.png` に実在することを、このスクリプトが保証する。
 *
 * ■ ★ダーク素材について（4リポで実際に起きた事故の再発防止）
 *   `splash.png` と `splash-dark.png` を**別々に生成する**（同じバッファを2回書かない）。
 *   同一バッファを書く実装は check-splash-dark-variant.mjs が検出する。
 *
 * 使い方:
 *   node scripts/generate-capacitor-splash.mjs
 *   node scripts/generate-capacitor-splash.mjs --force        # 既存素材があっても再生成
 *   node scripts/generate-capacitor-splash.mjs --out-dir <path>  # 出力先を差し替える（検証用）
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// ★--out-dir は本番では使わない。実リポの assets/ を誤って上書きせずに
//   このスクリプトを検証するための脱出口（2026-08-24、隔離環境の構築中に
//   実際に他アプリの assets/splash.png を1回上書きした反省から追加）。
const outDirArg = process.argv.includes('--out-dir')
  ? process.argv[process.argv.indexOf('--out-dir') + 1]
  : null;
const ASSETS_DIR = outDirArg ? path.resolve(outDirArg) : path.join(ROOT, 'assets');
const SPLASH = path.join(ASSETS_DIR, 'splash.png');
const SPLASH_DARK = path.join(ASSETS_DIR, 'splash-dark.png');
const SIZE = 2732;

/** `assets/icon-only.png` が既にあれば中央に配置する。無ければ単色のみ。 */
const ICON = path.join(ASSETS_DIR, 'icon-only.png');

function loadAppConfig() {
  const p = path.join(ROOT, 'app.config.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

/** ARGB(#RRGGBBAA) や RGB(#RRGGBB) を sharp 用の {r,g,b,alpha} に変換。 */
function hexToRgba(hex, fallback) {
  const m = /^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex || '');
  if (!m) return fallback;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  const alpha = m[2] ? parseInt(m[2], 16) / 255 : 1;
  return { r, g, b, alpha };
}

async function buildOne(sharp, bgHex, outPath) {
  const bg = hexToRgba(bgHex, { r: 10, g: 10, b: 15, alpha: 1 });
  let composite = [];

  if (existsSync(ICON)) {
    const icon = await sharp(ICON)
      .resize({ width: Math.round(SIZE * 0.34), withoutEnlargement: false })
      .png()
      .toBuffer();
    composite = [{ input: icon, gravity: 'center' }];
  }

  const img = sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: bg },
  }).composite(composite);

  await writeFile(outPath, await img.png().toBuffer());
  console.log(`wrote ${path.relative(ROOT, outPath)}`);
}

async function main() {
  const force = process.argv.includes('--force');

  if (existsSync(SPLASH) && existsSync(SPLASH_DARK) && !force) {
    console.log('assets/splash.png と splash-dark.png は既にある（--force で再生成）');
    return;
  }

  const { default: sharp } = await import('sharp');
  const cfg = loadAppConfig();
  const lightBg = cfg.brand?.primaryColor ? `${cfg.brand.primaryColor}FF` : '#F5F5F7FF';
  // ★ダーク用は必ず別の色を使う。primaryColor と同じ値をここに書くと、
  //   結果として同一画像になり check-splash-dark-variant.mjs が赤になる
  //   （4リポで実際に起きた事故の再発防止。理由はコメントで明示する）。
  const darkBg = cfg.brand?.accentColor ? `${cfg.brand.accentColor}FF` : '#0A0A0FFF';

  await mkdir(ASSETS_DIR, { recursive: true });
  await buildOne(sharp, lightBg, SPLASH);
  await buildOne(sharp, darkBg, SPLASH_DARK);

  console.log('★プレースホルダを生成した。ブランド素材があるなら assets/splash*.png を差し替えること。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
