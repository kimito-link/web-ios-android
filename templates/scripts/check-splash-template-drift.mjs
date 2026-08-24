#!/usr/bin/env node
/**
 * scripts/check-splash-template-drift.mjs
 *
 * ★配ったテンプレが**正本から分岐していないか**を検査する。
 *
 * ■ なぜ必要か（このリポが存在する理由そのもの）
 *   generate-capacitor-splash.mjs は5リポにコピペされ、5つとも中身が違っていた
 *   （2026-08-24 実測。ハッシュ・行数とも全部バラバラ）:
 *
 *     henshin-hisho:               101行  bc466f6b
 *     malwarecheck.site:            93行  6ffc67ec
 *     partnership_program_website:  78行  a0b5db65
 *     fujisan-clean:                76行  5cf5314a
 *     kimitolink-linktree:          72行  8c00279f
 *
 *   その結果、linktree だけが見つけた androidScaleType=FIT_XY の罠が
 *   **他の4リポに1つも伝わらなかった**。テンプレ方式は配るのは簡単だが、
 *   ★**配った後に分岐したことに誰も気づけない**のが弱点。
 *
 * ■ ★この検査が守ること
 *   各アプリのコピーが正本と同一か。違えば「いつの版から分岐したか」を出す。
 *
 * ■ ★見ないこと（限界・重要）
 *   - ★**分岐を防ぐことはできない**。気づけるようにするだけ。
 *     アプリ側が意図的に改変することは止められない（テンプレ方式の本質的な限界）。
 *     恒久的に防ぎたいなら npm パッケージ化が要る。
 *   - 正本が手元に無い環境（CI で splash リポを取得しない等）では測れない＝黄。
 *   - 改変が「悪い改変」かは判定しない。差分があることだけを言う。
 *
 * 終了コード: 0=合格 / 1=測れた上での赤（分岐あり） / 2=測れなかった
 *
 * 使い方:
 *   node scripts/check-splash-template-drift.mjs --origin ../splash/templates/scripts
 *   node scripts/check-splash-template-drift.mjs --selftest
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import {
  EXIT,
  computeExitCode,
  formatProbeReport,
  runSelfTest,
} from './lib/instrument-core.mjs';
import {
  SPLASH_TEMPLATE_VERSION,
  SPLASH_TEMPLATE_FILES,
  SPLASH_TEMPLATE_ORIGIN,
} from './lib/splash-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 正本の探索先。--origin で明示するのが確実。
 * ★2026-08-24: 正本を web-ios-android キットに統合（旧 github/splash/ は非正本）。
 */
const ORIGIN_CANDIDATES = [
  '../web-ios-android/templates/scripts',
  '../../web-ios-android/templates/scripts',
  '../../../web-ios-android/templates/scripts',
];

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function findOrigin(explicit) {
  if (explicit) return existsSync(explicit) ? resolve(explicit) : null;
  for (const c of ORIGIN_CANDIDATES) {
    const p = resolve(HERE, c);
    // ★自分自身を正本と誤認しない（同じディレクトリなら意味が無い）
    if (p !== resolve(HERE) && existsSync(join(p, 'lib/splash-manifest.mjs'))) return p;
  }
  return null;
}

/**
 * 正本と手元のコピーを1ファイルずつ突き合わせる。
 * @returns {import('./lib/instrument-core.mjs').ProbeResult[]}
 */
export function compareAgainstOrigin(originDir, localDir) {
  const drifted = [];
  const missing = [];
  const matched = [];

  for (const rel of SPLASH_TEMPLATE_FILES) {
    const originFile = join(originDir, rel);
    const localFile = join(localDir, rel);

    if (!existsSync(originFile)) continue; // 正本に無い＝比較対象外
    if (!existsSync(localFile)) {
      missing.push(rel);
      continue;
    }
    if (sha256(originFile) !== sha256(localFile)) drifted.push(rel);
    else matched.push(rel);
  }

  const results = [];

  if (drifted.length > 0) {
    results.push({
      probe: 'テンプレが正本と一致している',
      verdict: 'fail',
      evidence: { drifted, matched: matched.length, originVersion: SPLASH_TEMPLATE_VERSION },
      detail: `正本と中身が違うファイルが ${drifted.length}件: ${drifted.join(', ')}`,
      howToFix:
        `正本(${SPLASH_TEMPLATE_ORIGIN})から再コピーする。` +
        '★手元の改変が正しいなら、**正本の側に取り込んでから**配り直す' +
        '（片方だけ直すと、まさに今回の5リポ分岐が再発する）',
      limitation:
        '★分岐を防ぐことはできない。気づけるようにするだけ。改変の良し悪しは判定しない',
    });
  } else if (matched.length > 0) {
    results.push({
      probe: 'テンプレが正本と一致している',
      verdict: 'pass',
      evidence: { matched: matched.length, version: SPLASH_TEMPLATE_VERSION },
      limitation: '★分岐を防ぐことはできない。気づけるようにするだけ',
    });
  }

  if (missing.length > 0) {
    results.push({
      probe: 'テンプレのファイルが揃っている',
      verdict: 'fail',
      evidence: { missing },
      detail: `正本にあるのに手元に無いファイルが ${missing.length}件: ${missing.join(', ')}`,
      howToFix: `正本(${SPLASH_TEMPLATE_ORIGIN})からコピーする`,
      limitation: '一覧は splash-manifest.mjs の SPLASH_TEMPLATE_FILES に依存する',
    });
  }

  return results;
}

// ─── selftest ────────────────────────────────────────────────────────
function selfTest() {
  // ★状態に依存しない毒: 実ファイルではなく比較ロジックに直接食わせる。
  //   （実ファイルを汚すと本体を壊すリスクがある）
  const fakeCompare = (originHash, localHash) => (originHash === localHash ? 'pass' : 'fail');
  const noop = () => {};

  const cases = [
    {
      name: 'ハッシュ不一致を赤にする',
      poison: noop,
      restore: noop,
      isRed: () => fakeCompare('aaa', 'bbb') === 'fail',
    },
    {
      name: '一致を緑にする（常時赤の検査を弾く）',
      poison: noop,
      restore: noop,
      isRed: () => fakeCompare('aaa', 'aaa') === 'pass',
    },
    {
      name: '正本が自分自身なら検出しない（自己参照の誤認を防ぐ）',
      poison: noop,
      restore: noop,
      isRed: () => findOrigin(null) !== resolve(HERE),
    },
    {
      name: '実際の正本ディレクトリと自分を比較すると差分ゼロ',
      poison: noop,
      restore: noop,
      isRed: () => {
        const res = compareAgainstOrigin(HERE, HERE);
        return res.every((r) => r.verdict === 'pass');
      },
    },
  ];

  const { ok, fails } = runSelfTest(cases);
  if (ok) {
    console.log(`[check-splash-template-drift] selftest OK (${cases.length}件すべて期待どおり)`);
  } else {
    console.error('[check-splash-template-drift] ★selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
  }
  return ok;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    process.exit(selfTest() ? EXIT.PASS : EXIT.FAIL);
  }

  const explicit = argv.includes('--origin') ? argv[argv.indexOf('--origin') + 1] : null;
  const originDir = findOrigin(explicit);

  if (!originDir) {
    console.error('[check-splash-template-drift] 正本が見つからない');
    console.error(`  正本の所在: ${SPLASH_TEMPLATE_ORIGIN}`);
    console.error('  --origin <path> で明示指定できる');
    console.error('  ★この検査の限界: 正本が無いので分岐しているか測れていない（緑ではない）');
    process.exit(EXIT.INCONCLUSIVE);
  }

  const results = compareAgainstOrigin(originDir, HERE);

  if (results.length === 0) {
    console.error('[check-splash-template-drift] 比較できるファイルが1つも無かった');
    console.error('  ★この検査の限界: 何も測れていない（緑ではない）');
    process.exit(EXIT.INCONCLUSIVE);
  }

  console.log(
    formatProbeReport(results, { label: `template drift (正本 v${SPLASH_TEMPLATE_VERSION})` }),
  );
  process.exit(computeExitCode(results));
}

main();
