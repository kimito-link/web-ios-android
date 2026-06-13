#!/usr/bin/env node
// Android「未署名 AAB 出荷事故」防止ゲート。
//
// 背景（出典: Exosome android-play-release.yml で実証）:
//   bubblewrap は build.gradle に signingConfig を生成しないため、そのままビルドすると
//   未署名 AAB ができ、Play Console がアップロードを弾く。CI/ローカルの bundleRelease の
//   「前」にこのチェックを通すことで、Play に弾かれる前に検出して止められる。
//   android-patch-signing.mjs を流せば signingConfig は注入される（このスクリプトはその検証）。
//
// 使い方:
//   node scripts/verify-android-signing-config.mjs
//   node scripts/verify-android-signing-config.mjs --gradle android-twa/app/build.gradle
//
// 既定パスは Capacitor/TWA 標準構成。アプリ固有値は持たない。完全に汎用。
import fs from 'node:fs';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function fail(msg) { console.error(`::error::${msg}`); process.exit(1); }

const GRADLE = arg('--gradle', 'android-twa/app/build.gradle');
if (!fs.existsSync(GRADLE)) fail(`${GRADLE} が存在しません。`);
const src = fs.readFileSync(GRADLE, 'utf8');

if (!/signingConfigs\s*\{/.test(src)) {
  console.error(`::error::${GRADLE} に 'signingConfigs' ブロックがありません。`);
  console.error('AAB が署名されず Play Console に弾かれます。');
  console.error("signingConfigs { release { storeFile / storePassword / keyAlias / keyPassword } } を追加し、");
  console.error('buildTypes.release 内で signingConfig signingConfigs.release を指定してください。');
  console.error('（android-patch-signing.mjs で自動注入できます）');
  process.exit(1);
}

// buildTypes ブロック内で release が signingConfig を参照しているか
const buildTypesIdx = src.search(/buildTypes\s*\{/);
const tail = buildTypesIdx >= 0 ? src.slice(buildTypesIdx) : src;
if (!/signingConfig\s+signingConfigs\.release/.test(tail)) {
  console.error(`::error::${GRADLE} の buildTypes.release が signingConfig を参照していません。`);
  console.error('buildTypes { release { ... signingConfig signingConfigs.release } } を追加してください。');
  process.exit(1);
}

console.log('signingConfig check: OK（署名済み AAB が生成されます）');
