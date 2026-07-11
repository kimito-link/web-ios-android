#!/usr/bin/env node
// 「CIが書き込む署名鍵の場所」と「build.gradleが実際に読む場所」の不一致を防ぐゲート
// (_docs/CAPACITOR-GOLDEN-RULES.md 原則9をコード化)。android-patch-signing.mjs を
// 実行する前に走らせ、鍵ファイルが無い状態でパッチだけ通ってしまう(=後段の
// bundleReleaseで初めて失敗が発覚する)事故を1階層目で検出する。
//
// 背景(2026-07-04 kimito resend実戦): android-patch-signing.mjs が注入する
// storeFile("../android-upload-key.jks") は <gradle>/../ からの相対パス解決＝
// build.gradle が android/app/build.gradle なら android/ 直下を指す。CIの
// 「Restore signing material」ステップがリポジトリルートに書いてしまうと、
// signReleaseBundle が「file doesn't exist」で落ちる。keystore.properties は
// rootProject.file("keystore.properties") 基準＝Gradle root project dir
// (android/ 直下)を指すため、こちらも同じ場所に置く必要がある。
//
// 使い方:
//   node scripts/verify-signing-material-path.mjs
//   node scripts/verify-signing-material-path.mjs --gradle android/app/build.gradle --keystore ../android-upload-key.jks
import fs from 'node:fs';
import path from 'node:path';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function fail(msg) { console.error(`::error::${msg}`); process.exit(1); }

const GRADLE = arg('--gradle', 'android-twa/app/build.gradle');
const KEYSTORE_REL_PATH = arg('--keystore', '../android-upload-key.jks');

if (!fs.existsSync(GRADLE)) {
  fail(`${GRADLE} が存在しません(cap add android 未実行、または working directory が違う?)`);
}

const gradleDir = path.dirname(GRADLE);
// storeFile はこの build.gradle からの相対パス解決。android-patch-signing.mjs と
// 同じ基準(gradleDir起点)で解決することで、実際にGradleが読む場所と一致させる。
const keystorePath = path.resolve(gradleDir, KEYSTORE_REL_PATH);
const androidRootDir = path.dirname(gradleDir); // <target>/app/build.gradle -> <target>/
const propertiesPath = path.join(androidRootDir, 'keystore.properties');

if (!fs.existsSync(keystorePath)) {
  console.error(`::error::署名鍵が期待パスにありません: ${keystorePath}`);
  console.error(`(${GRADLE} からの相対パス "${KEYSTORE_REL_PATH}" で解決した場所)`);
  console.error('android-patch-signing.mjs が注入する storeFile(...) はこの相対パスで解決されるため、');
  console.error('CIの「Restore signing material」ステップはここに書く必要がある。');
  console.error('リポジトリルート等の別の場所に書くと、signReleaseBundle が');
  console.error('「file doesn\'t exist」で失敗する(2026-07-04 kimito resend実戦で発見済みの失敗モード)。');
  process.exit(1);
}

if (!fs.existsSync(propertiesPath)) {
  console.error(`::error::keystore.properties が期待パスにありません: ${propertiesPath}`);
  console.error(`(rootProject.file("keystore.properties") の基準＝Gradle root project dir "${androidRootDir}")`);
  console.error('CIの「Restore signing material」ステップはここに書く必要がある。');
  process.exit(1);
}

console.log(`signing material path check: OK（keystore="${keystorePath}" / properties="${propertiesPath}"）`);
