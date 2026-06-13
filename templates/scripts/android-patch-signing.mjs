#!/usr/bin/env node
// Patch android-twa/app/build.gradle after `bubblewrap update` or `bubblewrap init`.
// Bubblewrap does NOT generate signingConfig, so Play Console rejects the AAB
// with "アップロードしたすべてのバンドルに署名する必要があります".
// This script idempotently injects the signing block so the next bundleRelease
// produces a properly signed AAB.
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
