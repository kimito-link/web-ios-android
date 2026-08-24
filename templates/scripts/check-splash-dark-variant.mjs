#!/usr/bin/env node
/**
 * scripts/check-splash-dark-variant.mjs
 *
 * ★ダークモード用スプラッシュが**本当に別画像か**を検査する。
 *
 * ■ なぜ必要か（2026-08-24 実測）
 *   splash.png と splash-dark.png のハッシュを突き合わせたら、**4リポすべてで同一**だった:
 *
 *     fujisan-clean:               1b7860c3 / 1b7860c3  ★同一
 *     henshin-hisho/ios-app:       7bf4735c / 7bf4735c  ★同一
 *     malwarecheck.site:           91a3c860 / 91a3c860  ★同一
 *     partnership_program_website: 171d2b24 / 171d2b24  ★同一
 *
 *   真因は generate-capacitor-splash.mjs が**同じバッファを2回書いている**こと:
 *       await writeFile(SPLASH, composed);
 *       await writeFile(SPLASH_DARK, composed);   // ← 同じ composed
 *
 *   ファイルは2つ存在するので「ダーク対応済み」に見える。★存在検査では絶対に見つからない。
 *   CAPACITOR-GOLDEN-RULES 原則6「Verify はファイル存在でなく壊したい挙動が無いことを見る」の実例。
 *
 * ■ ★この検査が守ること
 *   ダーク素材がライト素材と**別の中身**であること（ハッシュ比較）。
 *
 * ■ ★見ないこと（限界）
 *   - 別画像でありさえすれば通る。**ダークとして適切な色か**は判定しない
 *     （真っ白なダーク素材でも「別画像」なら緑になる）。
 *   - ダーク非対応を選ぶ設計は正当。その場合は --allow-missing で「意図的に持たない」と宣言する
 *     （★黙って同一ファイルを置くのとは違う。宣言は記録に残る）。
 *   - 実機のダークモードでの見え方は判定できない。
 *
 * 終了コード: 0=合格 / 1=測れた上での赤 / 2=測れなかった
 *
 * 使い方:
 *   node scripts/check-splash-dark-variant.mjs
 *   node scripts/check-splash-dark-variant.mjs --dir assets
 *   node scripts/check-splash-dark-variant.mjs --allow-missing
 *   node scripts/check-splash-dark-variant.mjs --selftest
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import {
  EXIT,
  computeExitCode,
  formatProbeReport,
  runSelfTest,
} from './lib/instrument-core.mjs';

/** 素材が置かれうる場所。最初に見つかったものを使う。 */
const DIR_CANDIDATES = ['assets', 'store-assets/source', 'apps/mobile/assets'];

/** ライト素材とダーク素材の対。 */
const PAIRS = [
  { light: 'splash.png', dark: 'splash-dark.png' },
  { light: 'splash-2732.png', dark: 'splash-2732-dark.png' },
];

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function findDir(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  return DIR_CANDIDATES.find((d) => existsSync(d)) ?? null;
}

/**
 * 1組のライト/ダーク対を検査する。
 * @returns {import('./lib/instrument-core.mjs').ProbeResult|null} 対が存在しなければ null
 */
export function probePair(dir, pair, allowMissing) {
  const lightPath = join(dir, pair.light);
  const darkPath = join(dir, pair.dark);
  const probe = `${pair.dark} がライト素材と別画像`;

  if (!existsSync(lightPath)) return null; // この対は使っていない

  if (!existsSync(darkPath)) {
    if (allowMissing) {
      return {
        probe,
        verdict: 'pass',
        evidence: { darkVariant: 'absent', declared: '--allow-missing' },
        limitation: 'ダーク素材を持たない設計として宣言済み。実機での見え方は判定しない',
      };
    }
    return {
      probe,
      verdict: 'fail',
      evidence: { light: pair.light, dark: 'missing' },
      detail: `${pair.dark} が無い（ダークモードでライト素材が使われる）`,
      howToFix:
        `${pair.dark} を作る。ダーク非対応が意図なら --allow-missing を付けて宣言する`,
      limitation: 'ダークとして適切な色かは判定しない',
    };
  }

  const lightHash = sha256(lightPath);
  const darkHash = sha256(darkPath);

  if (lightHash === darkHash) {
    return {
      probe,
      verdict: 'fail',
      evidence: {
        light: `${pair.light}:${lightHash.slice(0, 8)}`,
        dark: `${pair.dark}:${darkHash.slice(0, 8)}`,
        identical: true,
      },
      detail:
        `${pair.light} と ${pair.dark} が**同一ファイル**（sha256 ${lightHash.slice(0, 8)}）。` +
        'ファイルは2つあるがダークは機能していない',
      howToFix:
        'ダーク用の地色で別途生成する。生成スクリプトが同じバッファを2回書いていないか確認' +
        '（★これが4リポで実際に起きていた真因）',
      limitation: 'ダークとして適切な色かは判定しない',
    };
  }

  return {
    probe,
    verdict: 'pass',
    evidence: {
      light: `${pair.light}:${lightHash.slice(0, 8)}`,
      dark: `${pair.dark}:${darkHash.slice(0, 8)}`,
    },
    limitation: 'ダークとして適切な色かは判定しない',
  };
}

// ─── selftest ────────────────────────────────────────────────────────
// ★実ファイルを一時ディレクトリに作って毒を入れる。finally で必ず消す。
function selfTest() {
  let tmp = null;
  const mk = (name, bytes) => writeFileSync(join(tmp, name), Buffer.from(bytes));

  const cases = [
    {
      name: '同一ハッシュのダークを赤にする（4リポで実際に起きた事故）',
      poison: () => {
        tmp = mkdtempSync(join(tmpdir(), 'splash-selftest-'));
        mk('splash.png', [1, 2, 3]);
        mk('splash-dark.png', [1, 2, 3]); // ★同じ中身
      },
      restore: () => {
        if (tmp) rmSync(tmp, { recursive: true, force: true });
        tmp = null;
      },
      isRed: () => probePair(tmp, PAIRS[0], false).verdict === 'fail',
    },
    {
      name: 'ダーク素材が無いのを赤にする',
      poison: () => {
        tmp = mkdtempSync(join(tmpdir(), 'splash-selftest-'));
        mk('splash.png', [1, 2, 3]);
      },
      restore: () => {
        if (tmp) rmSync(tmp, { recursive: true, force: true });
        tmp = null;
      },
      isRed: () => probePair(tmp, PAIRS[0], false).verdict === 'fail',
    },
    {
      name: '別画像なら緑にする（常時赤の検査を弾く）',
      poison: () => {
        tmp = mkdtempSync(join(tmpdir(), 'splash-selftest-'));
        mk('splash.png', [1, 2, 3]);
        mk('splash-dark.png', [9, 9, 9]); // ★違う中身
      },
      restore: () => {
        if (tmp) rmSync(tmp, { recursive: true, force: true });
        tmp = null;
      },
      isRed: () => probePair(tmp, PAIRS[0], false).verdict === 'pass',
    },
    {
      name: '--allow-missing の宣言を尊重する',
      poison: () => {
        tmp = mkdtempSync(join(tmpdir(), 'splash-selftest-'));
        mk('splash.png', [1, 2, 3]);
      },
      restore: () => {
        if (tmp) rmSync(tmp, { recursive: true, force: true });
        tmp = null;
      },
      isRed: () => probePair(tmp, PAIRS[0], true).verdict === 'pass',
    },
  ];

  const { ok, fails } = runSelfTest(cases);
  if (ok) {
    console.log(`[check-splash-dark-variant] selftest OK (${cases.length}件すべて期待どおり)`);
  } else {
    console.error('[check-splash-dark-variant] ★selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
  }
  return ok;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    process.exit(selfTest() ? EXIT.PASS : EXIT.FAIL);
  }

  const allowMissing = argv.includes('--allow-missing');
  const explicit = argv.includes('--dir') ? argv[argv.indexOf('--dir') + 1] : null;
  const dir = findDir(explicit);

  if (!dir) {
    console.error('[check-splash-dark-variant] スプラッシュ素材のディレクトリが見つからない');
    console.error(`  探した場所: ${DIR_CANDIDATES.join(', ')}`);
    console.error('  --dir <path> で明示指定できる');
    console.error('  ★この検査の限界: 素材が読めないので何も測れていない');
    process.exit(EXIT.INCONCLUSIVE);
  }

  const results = PAIRS.map((p) => probePair(resolve(dir), p, allowMissing)).filter(Boolean);

  if (results.length === 0) {
    console.error(`[check-splash-dark-variant] ${dir} にライト素材が1つも無い`);
    console.error(`  探したファイル: ${PAIRS.map((p) => p.light).join(', ')}`);
    console.error('  ★この検査の限界: 対象が無いので何も測れていない（緑ではない）');
    process.exit(EXIT.INCONCLUSIVE);
  }

  console.log(formatProbeReport(results, { label: `splash dark: ${dir}` }));
  process.exit(computeExitCode(results));
}

main();
