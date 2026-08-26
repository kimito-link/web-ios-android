#!/usr/bin/env node
// iOS スプラッシュ「Capacitor デフォルト出荷事故」防止ゲート（直接証拠方式）。
//
// 背景:
//   `cap add ios` は青×ロゴの Capacitor デフォルトスプラッシュを置く。
//   スプラッシュ用マスター画像が無いと @capacitor/assets はスプラッシュを生成せず、
//   そのデフォルトがそのまま出荷される（実際に Exosome で踏んだ事故）。
//   さらに @capacitor/assets は旧ファイルを上書きせず「新ファイル名で書いて
//   Contents.json を差し替える」ため、固定ファイル名のハッシュ比較では検証できない。
//
// このスクリプトの方式（出典: Exosome ios-appstore-release.yml で実証）:
//   1. `@capacitor/assets generate` を呼ぶ「前」に、Splash.imageset/Contents.json が
//      参照する画像（= Capacitor デフォルト）の sha256 集合を記録（--snapshot）。
//   2. 生成「後」に、Contents.json が参照する画像が全て存在し、かつ手順1で記録した
//      デフォルトのハッシュ集合に1つも含まれないことを確認（--verify）。
//      1つでも一致＝ブランド素材に差し替わっていない → 非ゼロ終了でビルドを止める。
//
// 使い方（CI のスプラッシュ生成ステップを挟む形で2回呼ぶ）:
//   node scripts/verify-ios-splash-not-default.mjs --snapshot
//   npx @capacitor/assets generate --ios ...   # 既存の生成ステップ
//   node scripts/verify-ios-splash-not-default.mjs --verify
//   node scripts/verify-ios-splash-not-default.mjs --selftest   ★毒→赤を確認（2026-08-25追加）
//
// オプション:
//   --imageset <path>  既定: ios/App/App/Assets.xcassets/Splash.imageset
//   --state <path>     スナップショット保存先 既定: .splash-default-hashes.json
//
// 終了コード（instrument-core の3値規約、2026-08-25導入）:
//   0 = 合格 / 1 = 測れた上での赤（デフォルトのまま出荷） / 2 = 測れなかった（imageset欠落等）
//
// ★2026-08-25: --selftest が未実装で、渡されたフラグを無視して
//   「--snapshot か --verify を指定してください」の赤を返していた（実測で確認）。
//   このキットが全体で徹底している「まずselftestで健全性確認してから使う」運用を
//   踏んだAI/CIが誤判定を受け取る穴だった。実ファイルに触れない毒（一時ディレクトリに
//   偽のimagesetを作る）で判定関数を検証する形にした。
//
// 注意: アプリ固有値は持たない（パスは Capacitor 標準構成のみ）。完全に汎用。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function referencedFiles(imageset) {
  const contents = path.join(imageset, 'Contents.json');
  if (!fs.existsSync(contents)) return null;
  const json = JSON.parse(fs.readFileSync(contents, 'utf8'));
  return (json.images || []).map((i) => i.filename).filter(Boolean);
}

/**
 * ★判定の本体（純関数寄り・fsは読み取りのみ）。
 * @param {string} imageset Splash.imageset のパス
 * @param {string} state スナップショットのパス
 * @returns {import('./lib/instrument-core.mjs').ProbeResult[]}
 */
export function judgeVerify(imageset, state) {
  const LIMIT = '★画像の内容そのもの（見た目の正しさ）は判定しません。Capacitorデフォルトと一致するかだけを見ます。';

  if (!fs.existsSync(state)) {
    return [{
      probe: 'iOSスプラッシュのデフォルト出荷検査',
      verdict: 'inconclusive',
      detail: `${state} がありません`,
      howToFix: '先に --snapshot を実行してください',
      limitation: LIMIT
    }];
  }
  const { defaultHashes } = JSON.parse(fs.readFileSync(state, 'utf8'));
  const defaults = new Set(defaultHashes || []);
  const files = referencedFiles(imageset);
  if (files === null) {
    return [{
      probe: 'iOSスプラッシュのデフォルト出荷検査',
      verdict: 'inconclusive',
      detail: `${path.join(imageset, 'Contents.json')} が存在しません（Splash.imageset が壊れています）`,
      howToFix: '先に npx cap add ios を実行してください',
      limitation: LIMIT
    }];
  }
  if (files.length === 0) {
    return [{
      probe: 'iOSスプラッシュのデフォルト出荷検査',
      verdict: 'inconclusive',
      detail: '生成後の Splash.imageset/Contents.json が画像を参照していません',
      howToFix: '@capacitor/assets generate --ios を実行してから再度確認してください',
      limitation: LIMIT
    }];
  }

  for (const f of files) {
    const p = path.join(imageset, f);
    if (!fs.existsSync(p)) {
      return [{
        probe: 'iOSスプラッシュのデフォルト出荷検査',
        verdict: 'fail',
        evidence: { 参照ファイル: f, 実在: false },
        detail: `Contents.json が参照する ${f} が存在しません（壊れた imageset が出荷されます）`,
        howToFix: '@capacitor/assets generate --ios をやり直してください',
        limitation: LIMIT
      }];
    }
    const h = sha256(p);
    if (defaults.has(h)) {
      return [{
        probe: 'iOSスプラッシュのデフォルト出荷検査',
        verdict: 'fail',
        evidence: { 一致ファイル: f, sha256: h },
        detail: `${f} が Capacitor デフォルトのスプラッシュのままです（ブランド素材に差し替わっていません）`,
        howToFix: 'assets/splash.png（2732x2732以上）を用意し、@capacitor/assets generate --ios を実行してください',
        limitation: LIMIT
      }];
    }
  }
  return [{
    probe: 'iOSスプラッシュのデフォルト出荷検査',
    verdict: 'pass',
    evidence: { 検査ファイル数: files.length, デフォルト一致: 0 },
    limitation: LIMIT
  }];
}

// ── selftest（★毒→赤。実ファイルに触れず一時ディレクトリで完結） ──────────
function makeTmpImageset(dir, pngContent) {
  const imageset = path.join(dir, 'Splash.imageset');
  fs.mkdirSync(imageset, { recursive: true });
  fs.writeFileSync(path.join(imageset, 'splash.png'), pngContent);
  fs.writeFileSync(
    path.join(imageset, 'Contents.json'),
    JSON.stringify({ images: [{ filename: 'splash.png' }] }, null, 2)
  );
  return imageset;
}

function selftest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-ios-splash-selftest-'));
  const cases = [];
  try {
    const DEFAULT_PNG = Buffer.from('capacitor-default-splash-bytes');
    const BRAND_PNG = Buffer.from('actual-brand-splash-bytes');

    // 毒1: verify時、参照画像がsnapshotのデフォルトハッシュと一致（＝差し替わっていない）
    const dir1 = path.join(tmp, 'case1');
    const imageset1 = makeTmpImageset(dir1, DEFAULT_PNG);
    const state1 = path.join(dir1, 'state.json');
    fs.writeFileSync(state1, JSON.stringify({ defaultHashes: [sha256Buf(DEFAULT_PNG, dir1)] }));
    cases.push({
      name: '毒1: デフォルトスプラッシュのまま（差し替わっていない）',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeVerify(imageset1, state1)) === EXIT.FAIL
    });

    // 毒2: ブランド素材に差し替わっている → 緑であるべき（誤検知しないことの確認）
    const dir2 = path.join(tmp, 'case2');
    const imageset2 = makeTmpImageset(dir2, BRAND_PNG);
    const state2 = path.join(dir2, 'state.json');
    fs.writeFileSync(state2, JSON.stringify({ defaultHashes: [sha256Buf(DEFAULT_PNG, dir2)] }));
    cases.push({
      name: '毒なし: ブランド素材に差し替え済みは緑のまま（誤検知しない）',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeVerify(imageset2, state2)) === EXIT.PASS
    });

    // 毒3: state.jsonが無い → inconclusive（緑にしない）
    const dir3 = path.join(tmp, 'case3');
    const imageset3 = makeTmpImageset(dir3, BRAND_PNG);
    cases.push({
      name: '毒3: スナップショットが無い（測れなかった）',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeVerify(imageset3, path.join(dir3, 'missing-state.json'))) === EXIT.INCONCLUSIVE
    });

    const { ok, fails } = runSelfTest(cases);
    if (!ok) {
      console.error('🔴 selftest 失敗:');
      for (const f of fails) console.error(`  - ${f}`);
      process.exit(EXIT.FAIL);
    }
    console.log(`✅ selftest 合格（${cases.length}件: デフォルト検知・誤検知なし・測れなかった状態の区別を確認）`);
    process.exit(EXIT.PASS);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

function sha256Buf(buf, dir) {
  const p = path.join(dir, `.tmp-hash-${Date.now()}-${Math.random()}`);
  fs.writeFileSync(p, buf);
  const h = sha256(p);
  fs.rmSync(p);
  return h;
}

// ── 実行 ────────────────────────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  selftest();
}

const MODE = process.argv.includes('--snapshot') ? 'snapshot'
  : process.argv.includes('--verify') ? 'verify' : null;
const IMAGESET = arg('--imageset', path.join('ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset'));
const STATE = arg('--state', '.splash-default-hashes.json');

if (!MODE) {
  console.error(formatProbeReport([{
    probe: 'iOSスプラッシュのデフォルト出荷検査',
    verdict: 'inconclusive',
    detail: '--snapshot か --verify を指定してください',
    howToFix: 'node verify-ios-splash-not-default.mjs --snapshot または --verify を使ってください'
  }]));
  process.exit(EXIT.INCONCLUSIVE);
}

if (MODE === 'snapshot') {
  const files = referencedFiles(IMAGESET);
  if (files === null) {
    console.error(`::error::${path.join(IMAGESET, 'Contents.json')} が存在しません（Splash.imageset が壊れています）。`);
    process.exit(EXIT.INCONCLUSIVE);
  }
  const hashes = [...new Set(files.map((f) => sha256(path.join(IMAGESET, f))))].sort();
  fs.writeFileSync(STATE, JSON.stringify({ defaultHashes: hashes }, null, 2));
  console.log(`snapshot: ${hashes.length} 個のデフォルトスプラッシュ画像ハッシュを記録 → ${STATE}`);
  process.exit(EXIT.PASS);
}

// verify
const results = judgeVerify(IMAGESET, STATE);
const code = computeExitCode(results);
console.log(formatProbeReport(results, { label: 'splash' }));
if (code === EXIT.FAIL) {
  for (const r of results.filter((x) => x.verdict === 'fail')) {
    console.error(`::error::${r.probe}: ${r.detail}`);
  }
}
process.exit(code);
