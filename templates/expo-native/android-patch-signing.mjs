#!/usr/bin/env node
// release ビルドに upload key の signingConfig を差し込む（冪等）。
//
// 対応する2方式:
//   - Expo prebuild  : android/app/build.gradle       ← 現行（2026-08 以降）
//   - TWA/bubblewrap : android-twa/app/build.gradle   ← 旧方式
//
// どちらも release 用の signingConfig を生成しないため、そのまま bundleRelease すると
// debug 署名の AAB ができ、Play Console に
// 「アップロードしたすべてのバンドルに署名する必要があります」で弾かれる。
//
// 使い方:
//   node scripts/android-patch-signing.mjs --gradle android/app/build.gradle
//   （--gradle 省略時は android/ → android-twa/ の順に自動検出）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/** --gradle が無ければ、実在する方を選ぶ（Expo prebuild を優先） */
function resolveGradlePath() {
  const explicit = arg('--gradle', null);
  if (explicit) return path.resolve(REPO, explicit);
  for (const rel of [
    ['android', 'app', 'build.gradle'],
    ['android-twa', 'app', 'build.gradle'],
  ]) {
    const p = path.join(REPO, ...rel);
    if (fs.existsSync(p)) return p;
  }
  return path.join(REPO, 'android', 'app', 'build.gradle');
}

const GRADLE = resolveGradlePath();

if (!fs.existsSync(GRADLE)) {
  console.error(`Not found: ${GRADLE}`);
  console.error('先に `npx expo prebuild --platform android` を実行してください。');
  process.exit(1);
}
console.log(`android-patch-signing: target = ${path.relative(REPO, GRADLE)}`);

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

/**
 * `名前 {` の直後から対応する `}` までを、波括弧を数えて切り出す。
 *
 * ⚠️ 正規表現でブロックを取ろうとすると入れ子で破綻する。
 *    `/signingConfigs\s*\{[\s\S]*?\brelease\s*\{/` は signingConfigs を
 *    **飛び越えて** buildTypes 内の `release {` にマッチしてしまい、
 *    「release はもうある」と誤判定して追加をスキップした。
 *    その結果 buildTypes だけ signingConfigs.release を参照する gradle ができ、
 *    `Could not get unknown property 'release'` でビルドが落ちた（2026-08-11 実障害）。
 *
 * @returns {{start:number,bodyStart:number,bodyEnd:number,end:number}|null}
 */
function findBlock(text, name, fromIndex = 0) {
  const re = new RegExp(`\\b${name}\\s*\\{`, 'g');
  re.lastIndex = fromIndex;
  const m = re.exec(text);
  if (!m) return null;
  const bodyStart = m.index + m[0].length;
  let depth = 1;
  for (let i = bodyStart; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        return { start: m.index, bodyStart, bodyEnd: i, end: i + 1 };
      }
    }
  }
  return null;
}

const RELEASE_SIGNING = `
        release {
            storeFile file("../android-upload-key.jks")
            storePassword keystoreProperties['storePassword']
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
        }`;

// --- 3'. signingConfigs に release を用意する ---
{
  const sc = findBlock(src, 'signingConfigs');
  if (!sc) {
    // そもそも signingConfigs が無い（TWA/bubblewrap 生成物）
    src = src.replace(/^(android\s*\{)/m, `$1\n${SIGNING_CONFIGS}`);
    console.log('android-patch-signing: injected signingConfigs block.');
  } else {
    // ★ signingConfigs の**中だけ**を見る。ここを間違えると誤検知する
    const body = src.slice(sc.bodyStart, sc.bodyEnd);
    if (/\brelease\s*\{/.test(body)) {
      console.log('android-patch-signing: signingConfigs.release already present.');
    } else {
      src = src.slice(0, sc.bodyStart) + RELEASE_SIGNING + src.slice(sc.bodyStart);
      console.log('android-patch-signing: added release to existing signingConfigs.');
    }
  }
}

/** buildTypes の中の release ブロックを、入れ子を数えて取り出す */
function findBuildTypesRelease(text) {
  const bt = findBlock(text, 'buildTypes');
  if (!bt) return null;
  const rel = findBlock(text, 'release', bt.bodyStart);
  // buildTypes の外側にある release（signingConfigs 内など）を掴まないこと
  if (!rel || rel.end > bt.bodyEnd) return null;
  return rel;
}

// --- 4. buildTypes.release を release 署名に向ける ---
// Expo 生成物は release ブロック内が `signingConfig signingConfigs.debug` になっている。
// **追記ではなく置換**しないと debug 署名が残り、本番AABがデバッグ鍵で署名されてしまう。
{
  const rel = findBuildTypesRelease(src);
  if (rel) {
    const body = src.slice(rel.bodyStart, rel.bodyEnd);
    let next = body;
    if (/signingConfig\s+signingConfigs\.debug/.test(body)) {
      next = body.replace(/signingConfig\s+signingConfigs\.debug/g, 'signingConfig signingConfigs.release');
      console.log('android-patch-signing: switched release buildType from debug to release signing.');
    } else if (!/signingConfig\s+signingConfigs\.release/.test(body)) {
      next = `\n            signingConfig signingConfigs.release${body}`;
      console.log('android-patch-signing: added signingConfig reference to buildTypes.release.');
    }
    if (next !== body) {
      src = src.slice(0, rel.bodyStart) + next + src.slice(rel.bodyEnd);
    }
  } else {
    console.error('::error::android-patch-signing: buildTypes.release ブロックが見つからない');
    process.exit(1);
  }
}

// --- 5. 書き込む前に、狙った状態になったか自分で検証する ---
// 「パッチした」と言いながら実際は当たっていない、を防ぐ。
// ★ ここも必ずブロックを切り出して中だけを見る。
//   正規表現で横断的に探すと、signingConfigs を飛び越えて buildTypes の
//   release にマッチし、緑のまま壊れた gradle を出荷する（2026-08-11 実障害）。
const problems = [];
{
  const sc = findBlock(src, 'signingConfigs');
  if (!sc) {
    problems.push('signingConfigs ブロックが無い');
  } else if (!/\brelease\s*\{/.test(src.slice(sc.bodyStart, sc.bodyEnd))) {
    problems.push('signingConfigs の中に release ブロックが無い（Gradle が unknown property "release" で落ちる）');
  }

  const rel = findBuildTypesRelease(src);
  if (!rel) {
    problems.push('buildTypes.release ブロックを特定できない');
  } else {
    const body = src.slice(rel.bodyStart, rel.bodyEnd);
    if (!/signingConfig\s+signingConfigs\.release/.test(body)) {
      problems.push('buildTypes.release が signingConfigs.release を参照していない');
    }
    if (/signingConfig\s+signingConfigs\.debug/.test(body)) {
      problems.push('buildTypes.release に debug 署名が残っている（本番がデバッグ鍵で署名される）');
    }
  }
}
if (problems.length) {
  for (const p of problems) console.error(`::error::android-patch-signing: ${p}`);
  process.exit(1);
}

fs.writeFileSync(GRADLE, src, 'utf8');
console.log('android-patch-signing: done. build.gradle is ready for signed bundleRelease.');
