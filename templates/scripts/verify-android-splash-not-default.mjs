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
//   node scripts/verify-android-splash-not-default.mjs --selftest   ★毒→赤を確認（2026-08-25追加）
//
// オプション:
//   --res <path>     既定: android/app/src/main/res
//   --state <path>   スナップショット保存先 既定: .android-splash-default-hashes.json
//
// 終了コード（instrument-core の3値規約、2026-08-25導入）:
//   0 = 合格 / 1 = 測れた上での赤（デフォルトのまま出荷） / 2 = 測れなかった
//
// ★2026-08-25: --selftest が未実装で、渡されたフラグを無視して
//   「--snapshot か --verify を指定してください」の赤を返していた（iOS版と同型の穴、実測で確認）。
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

/**
 * ★判定の本体（純関数寄り・fsは読み取りのみ）。
 * @param {string} res android/app/src/main/res 相当のパス
 * @param {string} state スナップショットのパス
 * @returns {import('./lib/instrument-core.mjs').ProbeResult[]}
 */
export function judgeVerify(res, state) {
  const LIMIT = '★画像の内容そのもの（見た目の正しさ）は判定しません。Capacitorデフォルトと一致するかだけを見ます。';

  if (!fs.existsSync(state)) {
    return [{
      probe: 'Androidスプラッシュのデフォルト出荷検査',
      verdict: 'inconclusive',
      detail: `${state} がありません`,
      howToFix: '先に --snapshot を実行してください',
      limitation: LIMIT
    }];
  }
  const { defaultHashes } = JSON.parse(fs.readFileSync(state, 'utf8'));
  const defaults = new Set(defaultHashes || []);

  // 明表示13ファイルは必須。night系はソースが無ければ生成されない仕様なので任意。
  const requiredLight = splashPaths(res).filter((p) => !p.includes('-night') && !p.includes('night-'));
  if (requiredLight.length === 0) {
    return [{
      probe: 'Androidスプラッシュのデフォルト出荷検査',
      verdict: 'inconclusive',
      detail: 'splashPaths() が空です（res パス指定を確認してください）',
      howToFix: '--res で正しいパスを指定してください',
      limitation: LIMIT
    }];
  }

  for (const p of requiredLight) {
    if (!fs.existsSync(p)) {
      return [{
        probe: 'Androidスプラッシュのデフォルト出荷検査',
        verdict: 'fail',
        evidence: { 参照ファイル: p, 実在: false },
        detail: `${p} が存在しません（@capacitor/assets generate --android が失敗している可能性）`,
        howToFix: '@capacitor/assets generate --android をやり直してください',
        limitation: LIMIT
      }];
    }
    const h = sha256(p);
    if (defaults.has(h)) {
      return [{
        probe: 'Androidスプラッシュのデフォルト出荷検査',
        verdict: 'fail',
        evidence: { 一致ファイル: p, sha256: h },
        detail: `${p} が Capacitor デフォルトのスプラッシュのままです（ブランド素材に差し替わっていません）`,
        howToFix: 'assets/splash.png（2732x2732以上）を用意し、@capacitor/assets generate --android を実行してください',
        limitation: LIMIT
      }];
    }
  }
  return [{
    probe: 'Androidスプラッシュのデフォルト出荷検査',
    verdict: 'pass',
    evidence: { 検査ファイル数: requiredLight.length, デフォルト一致: 0 },
    limitation: LIMIT
  }];
}

// ── selftest（★毒→赤。実ファイルに触れず一時ディレクトリで完結） ──────────
function makeTmpRes(dir, pngContent) {
  const res = path.join(dir, 'res');
  for (const p of splashPaths(res).filter((x) => !x.includes('night'))) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, pngContent);
  }
  return res;
}

function sha256Buf(buf, dir) {
  const p = path.join(dir, `.tmp-hash-${Date.now()}-${Math.random()}`);
  fs.writeFileSync(p, buf);
  const h = sha256(p);
  fs.rmSync(p);
  return h;
}

function selftest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-android-splash-selftest-'));
  const cases = [];
  try {
    const DEFAULT_PNG = Buffer.from('capacitor-default-splash-bytes');
    const BRAND_PNG = Buffer.from('actual-brand-splash-bytes');

    // 毒1: verify時、全ファイルがsnapshotのデフォルトハッシュと一致（＝差し替わっていない）
    const dir1 = path.join(tmp, 'case1');
    const res1 = makeTmpRes(dir1, DEFAULT_PNG);
    const state1 = path.join(dir1, 'state.json');
    fs.writeFileSync(state1, JSON.stringify({ defaultHashes: [sha256Buf(DEFAULT_PNG, dir1)] }));
    cases.push({
      name: '毒1: デフォルトスプラッシュのまま（差し替わっていない）',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeVerify(res1, state1)) === EXIT.FAIL
    });

    // 毒2: ブランド素材に差し替わっている → 緑であるべき（誤検知しないことの確認）
    const dir2 = path.join(tmp, 'case2');
    const res2 = makeTmpRes(dir2, BRAND_PNG);
    const state2 = path.join(dir2, 'state.json');
    fs.writeFileSync(state2, JSON.stringify({ defaultHashes: [sha256Buf(DEFAULT_PNG, dir2)] }));
    cases.push({
      name: '毒なし: ブランド素材に差し替え済みは緑のまま（誤検知しない）',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeVerify(res2, state2)) === EXIT.PASS
    });

    // 毒3: state.jsonが無い → inconclusive（緑にしない）
    const dir3 = path.join(tmp, 'case3');
    makeTmpRes(dir3, BRAND_PNG);
    cases.push({
      name: '毒3: スナップショットが無い（測れなかった）',
      poison: () => {},
      restore: () => {},
      isRed: () => computeExitCode(judgeVerify(path.join(dir3, 'res'), path.join(dir3, 'missing-state.json'))) === EXIT.INCONCLUSIVE
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

// ── 実行 ────────────────────────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  selftest();
}

const MODE = process.argv.includes('--snapshot') ? 'snapshot'
  : process.argv.includes('--verify') ? 'verify' : null;
const RES = arg('--res', path.join('android', 'app', 'src', 'main', 'res'));
const STATE = arg('--state', '.android-splash-default-hashes.json');

if (!MODE) {
  console.error(formatProbeReport([{
    probe: 'Androidスプラッシュのデフォルト出荷検査',
    verdict: 'inconclusive',
    detail: '--snapshot か --verify を指定してください',
    howToFix: 'node verify-android-splash-not-default.mjs --snapshot または --verify を使ってください'
  }]));
  process.exit(EXIT.INCONCLUSIVE);
}

if (MODE === 'snapshot') {
  const existing = splashPaths(RES).filter((p) => fs.existsSync(p));
  if (existing.length === 0) {
    console.log(`snapshot: ${RES} 配下に splash.png が無い（cap add android 未実行？）。スキップ。`);
    fs.writeFileSync(STATE, JSON.stringify({ defaultHashes: [] }, null, 2));
    process.exit(EXIT.PASS);
  }
  const hashes = [...new Set(existing.map(sha256))].sort();
  fs.writeFileSync(STATE, JSON.stringify({ defaultHashes: hashes }, null, 2));
  console.log(`snapshot: ${hashes.length} 個のデフォルトスプラッシュ画像ハッシュを記録 → ${STATE}`);
  process.exit(EXIT.PASS);
}

// verify
const results = judgeVerify(RES, STATE);
const code = computeExitCode(results);
console.log(formatProbeReport(results, { label: 'android-splash' }));
if (code === EXIT.FAIL) {
  for (const r of results.filter((x) => x.verdict === 'fail')) {
    console.error(`::error::${r.probe}: ${r.detail}`);
  }
}
process.exit(code);
