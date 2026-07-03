#!/usr/bin/env node
// Patch <target>/app/build.gradle so `bundleRelease` produces a signed AAB.
// Neither bubblewrap (TWA) nor `npx cap add android` (Capacitor) generate a
// signingConfig, so Play Console rejects the AAB with
// "アップロードしたすべてのバンドルに署名する必要があります".
// This script idempotently injects the signing block so the next bundleRelease
// produces a properly signed AAB. Works against either layout — pass --gradle
// to point at the actual build.gradle (android-twa/app/build.gradle for TWA,
// android/app/build.gradle for Capacitor).
//
// 使い方:
//   node scripts/android-patch-signing.mjs
//   node scripts/android-patch-signing.mjs --gradle android/app/build.gradle
//   node scripts/android-patch-signing.mjs --gradle android/app/build.gradle --keystore ../android-upload-key.jks
import fs from 'node:fs';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const GRADLE = arg('--gradle', 'android-twa/app/build.gradle');
// storeFile はこの build.gradle からの相対パス。TWA/Capacitor どちらも
// <target>/app/build.gradle という同じ深さなので既定値は共通で使える。
const KEYSTORE_REL_PATH = arg('--keystore', '../android-upload-key.jks');

if (!fs.existsSync(GRADLE)) {
  console.error(`Not found: ${GRADLE}`);
  process.exit(1);
}

let src = fs.readFileSync(GRADLE, 'utf8');

// --- 1. Already patched? ---
if (src.includes('signingConfigs') && src.includes('signingConfig signingConfigs.release')) {
  console.log(`android-patch-signing: ${GRADLE} already patched, nothing to do.`);
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
            storeFile file("${KEYSTORE_REL_PATH}")
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
console.log(`android-patch-signing: done. ${GRADLE} is ready for signed bundleRelease.`);
