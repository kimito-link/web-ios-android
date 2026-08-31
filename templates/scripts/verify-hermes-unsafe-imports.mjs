#!/usr/bin/env node
// Hermes（React Native/Capacitorのネイティブビルドで使われるJSエンジン）が
// バイトコード化できない依存を、ネイティブビルド前に静的検出するゲート。
//
// 移植元: surechigai-romi.link/scripts/check-hermes-unsafe-imports.mjs
//   （2026-08-31、council-fable「逆輸入候補」調査で発見・輸入）
//
// ★元の事故(2026-08-14、移植元プロジェクトで実際に起きた):
//   exifr を追加したら iOS の Release ビルドが落ちた。
//     main.jsbundle:494786:18: error: Invalid expression encountered
//   exifr の既定(full)ビルドは Node 用フォールバックとして動的 import を含み、
//   Hermes のバイトコード変換がこれを受け付けない。
//
//   ★この壊れ方の特徴: Web ビルドは通る。tsc も通る。テストも通る。
//   ネイティブをビルドして初めて分かるため、気づくのが一番遅い層にある。
//   しかもリリースワークフローは20〜30分かかるので、発見コストが高い。
//   だから「バンドルに入る import 文」を静的に見て、先に止める。
//
// 検査対象は自分のソースが指しているモジュール指定子だけにする。
// node_modules 全体を走査すると、実際にはバンドルされないものまで拾って
// 無意味に赤くなる（fail-closed のつもりが運用を止める）。
//
// 使い方:
//   node scripts/verify-hermes-unsafe-imports.mjs
//   node scripts/verify-hermes-unsafe-imports.mjs --dir app --dir src
//   node scripts/verify-hermes-unsafe-imports.mjs --unsafe unsafe-imports.json
//   node scripts/verify-hermes-unsafe-imports.mjs --selftest
//
// --unsafe で渡すJSONの形式: [{ "bad": "exifr", "good": "exifr/dist/lite.esm.js", "why": "..." }]
// 未指定時は既定の既知パターン（exifr）のみ検査する。
//
// 終了コード（instrument-core の3値規約）:
//   0 = 危険なimportなし / 1 = 検出あり（測れた上での赤） / 2 = 測れなかった（対象dirが1つも存在しない）
import fs from 'node:fs';
import path from 'node:path';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';
import { blankOutComments } from './check-tracked-imports.mjs';

/** 既定で検査する既知の危険なモジュール。「使うな」でなく「こう書け」を示す。 */
const DEFAULT_UNSAFE_SPECIFIERS = [
  {
    bad: 'exifr',
    good: 'exifr/dist/lite.esm.js',
    why: '既定(full)ビルドが動的 import を含み Hermes が弾く（iOS Release ビルドが失敗）',
  },
];

const DEFAULT_SCAN_DIRS = ['app', 'src', 'lib', 'components', 'hooks', 'modules', 'features'];
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);

function argAll(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === name && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
}
function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/**
 * import 文・動的 import・require から、指定子だけを抜き出す。
 * ★コメントを先に潰してから解析する（コメント内の例示で誤検知しないため）。
 * @param {string} source
 * @returns {string[]}
 */
export function specifiersOf(source) {
  const stripped = blankOutComments(String(source || ''));
  const out = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(stripped)) !== null) out.push(m[1]);
  }
  return out;
}

/**
 * ★判定の本体（純関数・fsに触らない＝テストしやすい）。
 * @param {{ path: string, content: string }[]} files
 * @param {{bad:string, good:string, why:string}[]} unsafeSpecifiers
 * @param {{ dirsExist: boolean }} context
 * @returns {import('./lib/instrument-core.mjs').ProbeResult[]}
 */
export function judgeHermesUnsafeImports(files, unsafeSpecifiers, context) {
  if (!context.dirsExist) {
    return [{
      probe: 'Hermes非対応import検査',
      verdict: 'inconclusive',
      detail: '検査対象ディレクトリが1つも存在しません',
      howToFix: '--dir でソースディレクトリを指定してください（既定: app/src/lib/components/hooks/modules/features）'
    }];
  }

  const violations = [];
  for (const f of files) {
    for (const spec of specifiersOf(f.content)) {
      for (const rule of unsafeSpecifiers) {
        // 完全一致だけを見る（"exifr/dist/lite.esm.js" は安全なので拾わない）
        if (spec === rule.bad) {
          violations.push({ file: f.path, ...rule });
        }
      }
    }
  }

  if (violations.length > 0) {
    const detail = violations
      .map((v) => `${v.file}: "${v.bad}"→"${v.good}"に変えること（${v.why}）`)
      .slice(0, 5)
      .join(' / ');
    return [{
      probe: 'Hermes非対応import検査',
      verdict: 'fail',
      evidence: { 検査ファイル数: files.length, 検出件数: violations.length },
      detail: `Hermesが扱えないimportがあります: ${detail}${violations.length > 5 ? ` 他${violations.length - 5}件` : ''}`,
      howToFix: 'これを直さないとiOS/Androidのネイティブビルドが"Invalid expression encountered"等で失敗します（Webビルド・tsc・テストは通るので気づけません）'
    }];
  }

  return [{
    probe: 'Hermes非対応import検査',
    verdict: 'pass',
    evidence: { 検査ファイル数: files.length, 既知パターン数: unsafeSpecifiers.length }
  }];
}

function* walk(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      yield* walk(p);
    } else if (EXTS.has(path.extname(e.name))) {
      yield p;
    }
  }
}

// ── selftest（★毒→赤） ──────────────────────────────────────────────────
function selftest() {
  const cases = [
    {
      name: '毒1: 対象ディレクトリが1つも無い（測れなかった）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeHermesUnsafeImports([], DEFAULT_UNSAFE_SPECIFIERS, { dirsExist: false })) === EXIT.INCONCLUSIVE
    },
    {
      name: '毒2: 危険なモジュールを実際にimportしている（赤）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const bad = { path: 'app/photo.ts', content: 'import exifr from "exifr";' };
        return computeExitCode(judgeHermesUnsafeImports([bad], DEFAULT_UNSAFE_SPECIFIERS, { dirsExist: true })) === EXIT.FAIL;
      }
    },
    {
      name: '毒3: コメント内の例示だけでは検知しない（誤検知しない）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const commented = { path: 'app/photo.ts', content: '// import exifr from "exifr"; // 使わない例' };
        return computeExitCode(judgeHermesUnsafeImports([commented], DEFAULT_UNSAFE_SPECIFIERS, { dirsExist: true })) === EXIT.PASS;
      }
    },
    {
      name: '毒4: 安全な代替パスは検知しない（誤検知しない）',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const safe = { path: 'app/photo.ts', content: 'import exifr from "exifr/dist/lite.esm.js";' };
        return computeExitCode(judgeHermesUnsafeImports([safe], DEFAULT_UNSAFE_SPECIFIERS, { dirsExist: true })) === EXIT.PASS;
      }
    },
    {
      name: '毒5: --unsafeで追加したカスタムパターンも検知される',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const bad = { path: 'app/foo.ts', content: 'import x from "some-unsafe-pkg";' };
        const custom = [{ bad: 'some-unsafe-pkg', good: 'some-unsafe-pkg/safe', why: 'テスト用' }];
        return computeExitCode(judgeHermesUnsafeImports([bad], custom, { dirsExist: true })) === EXIT.FAIL;
      }
    },
  ];

  const { ok, fails } = runSelfTest(cases);
  if (!ok) {
    console.error('🔴 selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`✅ selftest 合格（${cases.length}件: 検知・コメント無視・安全パス除外・カスタムパターンを確認）`);
  process.exit(EXIT.PASS);
}

// ── 実行 ────────────────────────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  selftest();
}

const argDirs = argAll('--dir');
const scanDirs = argDirs.length ? argDirs : DEFAULT_SCAN_DIRS;
const unsafePath = arg('--unsafe', null);
let unsafeSpecifiers = DEFAULT_UNSAFE_SPECIFIERS;
if (unsafePath) {
  try {
    unsafeSpecifiers = JSON.parse(fs.readFileSync(unsafePath, 'utf8'));
  } catch (e) {
    console.error(`[hermes-unsafe-imports] FAIL  --unsafe ${unsafePath} の読み込みに失敗しました: ${e.message}`);
    process.exit(EXIT.INCONCLUSIVE);
  }
}

const existingDirs = scanDirs.filter((d) => fs.existsSync(d));
const files = existingDirs
  .flatMap((d) => [...walk(d)])
  .map((p) => ({ path: p, content: fs.readFileSync(p, 'utf8') }));

const results = judgeHermesUnsafeImports(files, unsafeSpecifiers, { dirsExist: existingDirs.length > 0 });
const code = computeExitCode(results);
console.log(formatProbeReport(results, { label: 'hermes-unsafe-imports' }));
if (code === EXIT.FAIL) {
  for (const r of results.filter((x) => x.verdict === 'fail')) {
    console.error(`::error::${r.detail}`);
  }
}
process.exit(code);
