#!/usr/bin/env node
// 「capacitor.config.ts の webDir」と「CI の Prepare webDir が実際に作る場所」の
// 不一致を防ぐゲート(_docs/CAPACITOR-GOLDEN-RULES.md 原則8をコード化)。
//
// 背景(2026-07-04 kimito resend実戦): webDir:'www' のまま7回連続でAndroidビルドが
// 失敗した。真因は `cap copy android` が `www/` を探すのに CI の「Prepare webDir」は
// `dist/public` にしか作らない不一致で、capacitor.config.json の書き込みが失敗し
// capacitor.settings.gradle が生成されずGradleが「Could not read script
// capacitor.settings.gradle」で落ちる、という3階層先のエラーとして現れた
// (根本原因から遠いエラーメッセージで出るので気づきにくい)。
//
// このスクリプトは webDir を変更する余地(cap copy/cap sync の)より前、
// 「Prepare webDir」ステップの直後に走らせ、値のズレを1階層目で機械的に検出する。
//
// 使い方:
//   node scripts/verify-webdir-consistency.mjs
//   node scripts/verify-webdir-consistency.mjs --expected dist/public
//   node scripts/verify-webdir-consistency.mjs --config capacitor.config.ts
//   node scripts/verify-webdir-consistency.mjs --selftest   ★毒→赤を確認（2026-08-25追加）
//
// 終了コード（instrument-core の3値規約、2026-08-25導入）:
//   0 = 一致 / 1 = 不一致（測れた上での赤） / 2 = 測れなかった（config不在・webDir未定義等）
//
// ★2026-08-25: --selftest が未実装で、渡されたフラグを無視して
//   「capacitor.config.ts も capacitor.config.json も存在しません」の赤を返していた（実測で確認）。
import fs from 'node:fs';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function normalize(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/**
 * ★判定の本体（純関数・fsに触らない＝テストしやすい）。
 * @param {{ exists: boolean, name: string, content: string }|null} tsFile
 * @param {{ exists: boolean, content: string }|null} jsonFile
 * @param {string} expected
 * @returns {import('./lib/instrument-core.mjs').ProbeResult[]}
 */
export function judgeWebDir(tsFile, jsonFile, expected) {
  let sourceName = null;
  let webDirRaw = null;

  if (tsFile?.exists) {
    sourceName = tsFile.name;
    webDirRaw = tsFile.content.match(/\bwebDir\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? null;
  } else if (jsonFile?.exists) {
    sourceName = 'capacitor.config.json';
    try {
      webDirRaw = JSON.parse(jsonFile.content).webDir ?? null;
    } catch (e) {
      return [{
        probe: 'webDir一致検査',
        verdict: 'inconclusive',
        detail: `${sourceName} の JSON.parse に失敗しました: ${e.message}`,
        howToFix: 'capacitor.config.json の構文を確認してください'
      }];
    }
  } else {
    return [{
      probe: 'webDir一致検査',
      verdict: 'inconclusive',
      detail: 'capacitor.config.ts も capacitor.config.json も存在しません',
      howToFix: 'cap add を先に実行するか、working directory がアプリrootか確認してください'
    }];
  }

  if (webDirRaw == null) {
    return [{
      probe: 'webDir一致検査',
      verdict: 'inconclusive',
      detail: `${sourceName} に webDir が見つかりません`,
      howToFix: 'server.url 連動型でも webDir は必須です（オフライン/未応答時のフォールバックstub置き場）'
    }];
  }

  const got = normalize(webDirRaw);
  const exp = normalize(expected);

  if (got !== exp) {
    return [{
      probe: 'webDir一致検査',
      verdict: 'fail',
      evidence: { [`${sourceName}のwebDir`]: webDirRaw, 'CIの生成先': expected },
      detail: `webDir 不一致検出: ${sourceName} の webDir="${webDirRaw}" だが CI の「Prepare webDir」は "${expected}" にしか生成しない。`
        + 'この不一致は cap copy が webDir を見つけられず capacitor.config.json の書き込みに失敗し、'
        + 'capacitor.settings.gradle が生成されずGradleが「Could not read script capacitor.settings.gradle」で'
        + '落ちる、という3階層先のエラーとして現れる（2026-07-04 kimito resend実戦で7回連続失敗した地雷そのもの）。',
      howToFix: `${sourceName} の webDir を "${expected}" に合わせるか、CI側の「Prepare webDir」の生成先を webDir と揃えてください`
    }];
  }

  return [{
    probe: 'webDir一致検査',
    verdict: 'pass',
    evidence: { [`${sourceName}のwebDir`]: webDirRaw, 'CIの生成先': expected }
  }];
}

// ── selftest（★毒→赤。fsに触れず文字列を直接組み立てる） ──────────────────
function selftest() {
  const cases = [
    {
      name: '毒1: webDirがCIの生成先と不一致（実損そのもの）',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeWebDir(
        { exists: true, name: 'capacitor.config.ts', content: "export default { webDir: 'www' };" },
        null,
        'dist/public'
      )) === EXIT.FAIL
    },
    {
      name: '毒なし: webDirが一致していれば緑のまま（誤検知しない）',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeWebDir(
        { exists: true, name: 'capacitor.config.ts', content: "export default { webDir: 'dist/public' };" },
        null,
        'dist/public'
      )) === EXIT.PASS
    },
    {
      name: '毒3: パス区切り・末尾スラッシュの表記ゆれは同一と判定する（誤検知しない）',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeWebDir(
        { exists: true, name: 'capacitor.config.ts', content: "export default { webDir: './dist\\public/' };" },
        null,
        'dist/public'
      )) === EXIT.PASS
    },
    {
      name: '毒4: configファイルが両方とも無い（測れなかった）',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeWebDir(null, null, 'dist/public')) === EXIT.INCONCLUSIVE
    },
    {
      name: '毒5: webDirキー自体が無い（測れなかった）',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeWebDir(
        { exists: true, name: 'capacitor.config.ts', content: 'export default {};' },
        null,
        'dist/public'
      )) === EXIT.INCONCLUSIVE
    }
  ];

  const { ok, fails } = runSelfTest(cases);
  if (!ok) {
    console.error('🔴 selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`✅ selftest 合格（${cases.length}件: 不一致検知・誤検知なし・測れなかった状態の区別を確認）`);
  process.exit(EXIT.PASS);
}

// ── 実行 ────────────────────────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  selftest();
}

const CONFIG_TS = arg('--config', 'capacitor.config.ts');
const CONFIG_JSON = 'capacitor.config.json';
const EXPECTED = arg('--expected', 'dist/public');

const tsFile = fs.existsSync(CONFIG_TS)
  ? { exists: true, name: CONFIG_TS, content: fs.readFileSync(CONFIG_TS, 'utf8') }
  : { exists: false };
const jsonFile = fs.existsSync(CONFIG_JSON)
  ? { exists: true, content: fs.readFileSync(CONFIG_JSON, 'utf8') }
  : { exists: false };

const results = judgeWebDir(tsFile, jsonFile, EXPECTED);
const code = computeExitCode(results);
console.log(formatProbeReport(results, { label: 'webdir' }));
if (code === EXIT.FAIL) {
  for (const r of results.filter((x) => x.verdict === 'fail')) {
    console.error(`::error::${r.detail}`);
  }
}
process.exit(code);
