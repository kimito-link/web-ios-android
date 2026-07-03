#!/usr/bin/env node
// Android スプラッシュ「Capacitor デフォルト出荷事故」防止ゲート（直接証拠方式）。
// iOS 版 verify-ios-splash-not-default.mjs と対の Android 版。
//
// 背景:
//   `cap add android` は android/app/src/main/res/drawable*/splash.png に
//   Capacitor デフォルトのプレースホルダ画像を置く。スプラッシュ用マスター画像
//   （assets/splash.png）が無いと @capacitor/assets はスプラッシュを生成せず、
//   そのデフォルトがそのまま出荷される（iOS の青×ロゴ事故と同型のリスク）。
//
//   iOS の Splash.imageset/Contents.json のような単一マニフェストは Android には無い。
//   drawable/splash.png・drawable-land-*/splash.png・drawable-port-*/splash.png
//   （明表示、全 11 ファイル。ダークモード対応時は drawable-night 系 11 ファイルも追加）が
//   それぞれ固定パスの直接ファイルなので、パスの集合を直接列挙してハッシュ比較する。
//
// このスクリプトの方式（iOS 版と対称）:
//   1. `@capacitor/assets generate` を呼ぶ「前」に、既知の全 splash.png パスの
//      sha256 集合を記録（--snapshot）。ファイルが無ければスキップ（cap add 直後は必ずある）。
//   2. 生成「後」に、同じパス群のファイルが全て存在し、かつ手順1で記録した
//      デフォルトのハッシュ集合に1つも含まれないことを確認（--verify）。
//      1つでも一致＝ブランド素材に差し替わっていない → 非ゼロ終了でビルドを止める。
//
// 使い方（CI のスプラッシュ生成ステップを挟む形で2回呼ぶ）:
//   node scripts/verify-android-splash-not-default.mjs --snapshot
//   npx @capacitor/assets generate --android ...   # 既存の生成ステップ
//   node scripts/verify-android-splash-not-default.mjs --verify
//
// オプション:
//   --res <path>     既定: android/app/src/main/res
//   --state <path>   スナップショット保存先 既定: .android-splash-default-hashes.json
//
// 注意: アプリ固有値は持たない（パスは Capacitor 標準構成のみ）。完全に汎用。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const MODE = process.argv.includes('--snapshot') ? 'snapshot'
  : process.argv.includes('--verify') ? 'verify' : null;
const RES = arg('--res', path.join('android', 'app', 'src', 'main', 'res'));
const STATE = arg('--state', '.android-splash-default-hashes.json');

function fail(msg) { console.error(`::error::${msg}`); process.exit(1); }

// drawable/splash.png (no qualifier) + drawable-{land,port}-{ldpi,mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/splash.png
// = 1 + 6 + 6 = 13 の明表示パス。ダーク(-night)は splash-dark.png ソースが無ければ
// cap add でも生成されず対象外になるため、存在するファイルだけを対象にする。
const DENSITIES = ['ldpi', 'mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
function splashPaths(res) {
  const dirs = [
    'drawable',
    ...DENSITIES.map((d) => `drawable-land-${d}`),
    ...DENSITIES.map((d) => `drawable-port-${d}`),
    'drawable-night',
    ...DENSITIES.map((d) => `drawable-land-night-${d}`),
    ...DENSITIES.map((d) => `drawable-port-night-${d}`),
  ];
  return dirs.map((d) => path.join(res, d, 'splash.png'));
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

if (!MODE) fail('--snapshot か --verify を指定してください。');

if (MODE === 'snapshot') {
  const existing = splashPaths(RES).filter((p) => fs.existsSync(p));
  if (existing.length === 0) {
    console.log(`snapshot: ${RES} 配下に splash.png が無い（cap add android 未実行？）。スキップ。`);
    fs.writeFileSync(STATE, JSON.stringify({ defaultHashes: [] }, null, 2));
    process.exit(0);
  }
  const hashes = [...new Set(existing.map(sha256))].sort();
  fs.writeFileSync(STATE, JSON.stringify({ defaultHashes: hashes }, null, 2));
  console.log(`snapshot: ${hashes.length} 個のデフォルトスプラッシュ画像ハッシュを記録 → ${STATE}`);
  process.exit(0);
}

// verify
if (!fs.existsSync(STATE)) fail(`${STATE} がありません。先に --snapshot を実行してください。`);
const { defaultHashes } = JSON.parse(fs.readFileSync(STATE, 'utf8'));
const defaults = new Set(defaultHashes || []);

// 明表示13ファイルは必須。night系はソースが無ければ生成されない仕様なので任意。
const requiredLight = splashPaths(RES).filter((p) => !p.includes('-night') && !p.includes('night-'));
if (requiredLight.length === 0) fail('splashPaths() が空です（RES パス指定を確認してください）。');

for (const p of requiredLight) {
  if (!fs.existsSync(p)) fail(`${p} が存在しません（@capacitor/assets generate --android が失敗している可能性）。`);
  const h = sha256(p);
  if (defaults.has(h)) {
    fail(`${p} が Capacitor デフォルトのスプラッシュのままです（ブランド素材に差し替わっていません）。`);
  }
  console.log(`splash OK: ${path.relative(RES, p)} (sha256: ${h})`);
}
console.log('スプラッシュ検証: OK（Capacitor デフォルトは出荷されません）');
