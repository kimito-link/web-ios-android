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
//   node scripts/verify-signing-material-path.mjs --selftest   ★毒→赤を確認（2026-08-25追加）
//
// 終了コード（instrument-core の3値規約、2026-08-25導入）:
//   0 = 両方とも期待パスに存在 / 1 = 測れた上での赤（片方が無い） / 2 = 測れなかった（build.gradle不在）
//
// ★2026-08-25: --selftest が未実装で、渡されたフラグを無視して
//   「android-twa/app/build.gradle が存在しません」の赤を返していた（実測で確認）。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/**
 * ★判定の本体（純関数寄り・fsは実在確認のみ）。
 * @param {string} gradlePath
 * @param {string} keystoreRelPath
 * @returns {import('./lib/instrument-core.mjs').ProbeResult[]}
 */
export function judgeSigningMaterialPath(gradlePath, keystoreRelPath) {
  if (!fs.existsSync(gradlePath)) {
    return [{
      probe: '署名鍵の配置パス検査',
      verdict: 'inconclusive',
      detail: `${gradlePath} が存在しません`,
      howToFix: 'cap add android を先に実行するか、working directory を確認してください'
    }];
  }

  const gradleDir = path.dirname(gradlePath);
  // storeFile はこの build.gradle からの相対パス解決。android-patch-signing.mjs と
  // 同じ基準(gradleDir起点)で解決することで、実際にGradleが読む場所と一致させる。
  const keystorePath = path.resolve(gradleDir, keystoreRelPath);
  const androidRootDir = path.dirname(gradleDir); // <target>/app/build.gradle -> <target>/
  const propertiesPath = path.join(androidRootDir, 'keystore.properties');

  if (!fs.existsSync(keystorePath)) {
    return [{
      probe: '署名鍵の配置パス検査',
      verdict: 'fail',
      evidence: { 期待パス: keystorePath, 実在: false },
      detail: `署名鍵が期待パスにありません: ${keystorePath}（${gradlePath} からの相対パス "${keystoreRelPath}" で解決した場所）。`
        + 'android-patch-signing.mjs が注入する storeFile(...) はこの相対パスで解決されるため、'
        + 'CIの「Restore signing material」ステップはここに書く必要がある。'
        + 'リポジトリルート等の別の場所に書くと、signReleaseBundle が'
        + '「file doesn\'t exist」で失敗する（2026-07-04 kimito resend実戦で発見済みの失敗モード）。',
      howToFix: `CIの「Restore signing material」ステップの書き込み先を ${keystorePath} に合わせてください`
    }];
  }

  if (!fs.existsSync(propertiesPath)) {
    return [{
      probe: '署名鍵の配置パス検査',
      verdict: 'fail',
      evidence: { keystore実在: true, 'keystore.properties期待パス': propertiesPath, 'keystore.properties実在': false },
      detail: `keystore.properties が期待パスにありません: ${propertiesPath}（rootProject.file("keystore.properties") の基準＝Gradle root project dir "${androidRootDir}"）。`
        + 'CIの「Restore signing material」ステップはここに書く必要がある。',
      howToFix: `keystore.properties を ${propertiesPath} に配置してください`
    }];
  }

  return [{
    probe: '署名鍵の配置パス検査',
    verdict: 'pass',
    evidence: { keystore: keystorePath, properties: propertiesPath }
  }];
}

// ── selftest（★毒→赤。一時ディレクトリで実際のパス解決を検証） ──────────
function selftest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-signing-material-selftest-'));
  const cases = [];
  try {
    // 正しい配置: <tmp>/android/app/build.gradle, <tmp>/android/android-upload-key.jks, <tmp>/android/keystore.properties
    const androidDir = path.join(tmp, 'good', 'android');
    fs.mkdirSync(path.join(androidDir, 'app'), { recursive: true });
    fs.writeFileSync(path.join(androidDir, 'app', 'build.gradle'), '// stub');
    fs.writeFileSync(path.join(androidDir, 'android-upload-key.jks'), 'stub-keystore-bytes');
    fs.writeFileSync(path.join(androidDir, 'keystore.properties'), 'stub=1');

    cases.push({
      name: '毒なし: 鍵もpropertiesも期待パスにある場合は緑（誤検知しない）',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeSigningMaterialPath(
        path.join(androidDir, 'app', 'build.gradle'), '../android-upload-key.jks'
      )) === EXIT.PASS
    });

    // 毒1: keystoreが無い（実損そのもの・別の場所に置かれた）
    const dir1 = path.join(tmp, 'case1', 'android');
    fs.mkdirSync(path.join(dir1, 'app'), { recursive: true });
    fs.writeFileSync(path.join(dir1, 'app', 'build.gradle'), '// stub');
    fs.writeFileSync(path.join(dir1, 'keystore.properties'), 'stub=1');
    // keystoreファイルは書かない（欠落を再現）
    cases.push({
      name: '毒1: keystoreファイルが期待パスに無い',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeSigningMaterialPath(
        path.join(dir1, 'app', 'build.gradle'), '../android-upload-key.jks'
      )) === EXIT.FAIL
    });

    // 毒2: keystore.propertiesが無い
    const dir2 = path.join(tmp, 'case2', 'android');
    fs.mkdirSync(path.join(dir2, 'app'), { recursive: true });
    fs.writeFileSync(path.join(dir2, 'app', 'build.gradle'), '// stub');
    fs.writeFileSync(path.join(dir2, 'android-upload-key.jks'), 'stub-keystore-bytes');
    // keystore.propertiesは書かない
    cases.push({
      name: '毒2: keystore.propertiesが期待パスに無い',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeSigningMaterialPath(
        path.join(dir2, 'app', 'build.gradle'), '../android-upload-key.jks'
      )) === EXIT.FAIL
    });

    // 毒3: build.gradle自体が無い（測れなかった）
    cases.push({
      name: '毒3: build.gradleが存在しない（測れなかった）',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeSigningMaterialPath(
        path.join(tmp, 'nonexistent', 'app', 'build.gradle'), '../android-upload-key.jks'
      )) === EXIT.INCONCLUSIVE
    });

    const { ok, fails } = runSelfTest(cases);
    if (!ok) {
      console.error('🔴 selftest 失敗:');
      for (const f of fails) console.error(`  - ${f}`);
      process.exit(EXIT.FAIL);
    }
    console.log(`✅ selftest 合格（${cases.length}件: 鍵欠落・properties欠落・測れなかった状態の区別を確認）`);
    process.exit(EXIT.PASS);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

// ── 実行 ────────────────────────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  selftest();
}

const GRADLE = arg('--gradle', 'android-twa/app/build.gradle');
const KEYSTORE_REL_PATH = arg('--keystore', '../android-upload-key.jks');

const results = judgeSigningMaterialPath(GRADLE, KEYSTORE_REL_PATH);
const code = computeExitCode(results);
console.log(formatProbeReport(results, { label: 'signing-material' }));
if (code === EXIT.FAIL) {
  for (const r of results.filter((x) => x.verdict === 'fail')) {
    console.error(`::error::${r.detail}`);
  }
}
process.exit(code);
