#!/usr/bin/env node
// 金型: Android TWA 署名注入スクリプト。出どころ: Exosome/scripts/android-patch-signing.mjs
//
// このファイルは「無改変で使える」（アプリ固有値を含まない。keystore.properties と相対パスのみ参照）。
// 自リポの scripts/ にコピーし、package.json の android:twa:init / android:twa:update の末尾で実行する。
//
// 役割: `bubblewrap update` / `bubblewrap init` の後に android-twa/app/build.gradle へ署名ブロックを注入する。
// Bubblewrap は signingConfig を生成しないため、そのままだと Play Console が AAB を
// 「アップロードしたすべてのバンドルに署名する必要があります」で拒否する。
// このスクリプトは冪等で、次回の bundleRelease が正しく署名された AAB を出すようにする。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRADLE = path.join(REPO, 'android-twa', 'app', 'build.gradle');

if (!fs.existsSync(GRADLE)) {
  console.error(`Not found: ${GRADLE}`);
  process.exit(1);
}

let src = fs.readFileSync(GRADLE, 'utf8');

// --- 1. Already patched? ---
if (src.includes('signingConfigs') && src.includes('signingConfig signingConfigs.release')) {
  console.log('android-patch-signing: already patched, nothing to do.');
  process.exit(0);
}

// --- 2. Inject keystore.properties loader before `android {` ---
const KEYSTORE_LOADER = `\
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

`;

if (!src.includes('keystorePropertiesFile')) {
  src = src.replace(/^(android\s*\{)/m, `${KEYSTORE_LOADER}$1`);
  console.log('android-patch-signing: injected keystore.properties loader.');
}

// --- 3. Inject signingConfigs block inside `android {` ---
const SIGNING_CONFIGS = `\
    signingConfigs {
        release {
            storeFile file("../android-upload-key.jks")
            storePassword keystoreProperties['storePassword']
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
        }
    }
`;

if (!src.includes('signingConfigs')) {
  // Insert right after `android {`
  src = src.replace(/^(android\s*\{)/m, `$1\n${SIGNING_CONFIGS}`);
  console.log('android-patch-signing: injected signingConfigs block.');
}

// --- 4. Patch buildTypes.release to reference signingConfig ---
if (!src.includes('signingConfig signingConfigs.release')) {
  src = src.replace(
    /(buildTypes\s*\{[^}]*release\s*\{[^}]*minifyEnabled\s+\w+)/s,
    '$1\n            signingConfig signingConfigs.release',
  );
  console.log('android-patch-signing: added signingConfig reference to buildTypes.release.');
}

fs.writeFileSync(GRADLE, src, 'utf8');
console.log('android-patch-signing: done. build.gradle is ready for signed bundleRelease.');
