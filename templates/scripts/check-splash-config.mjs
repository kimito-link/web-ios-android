#!/usr/bin/env node
/**
 * scripts/check-splash-config.mjs
 *
 * ★capacitor.config の**スプラッシュ設定そのもの**を検査する（画像ではなく設定）。
 *
 * ■ なぜ必要か（2026-08-24 実測）
 *   androidScaleType の既定値は **FIT_XY = 引き伸ばし**（aspect fill ではない）。
 *   出典: https://capacitorjs.com/docs/apis/splash-screen
 *   正方形の splash-2732.png を縦長端末に FIT_XY で敷くと**縦に間延びする**。
 *   iOS 側は aspect fill で切り抜くため、放置すると iOS と Android で見た目が食い違う。
 *
 *   実測: github 配下で androidScaleType を CENTER_CROP にしていたのは
 *   kimitolink-linktree **1リポのみ**。Exosome / malwarecheck / web-health-check /
 *   fujisan は既定のまま＝**Android で歪んだまま出荷されていた**。
 *   1箇所で直した知見が他に伝わらないのがこのリポが生まれた理由。
 *
 * ■ ★この検査が守ること
 *   1. androidScaleType が明示されている（既定=FIT_XY に落ちていない）
 *   2. 背景色が root / ios / android / plugins.SplashScreen で**一致**している
 *      （不一致だと画像が出る前の一瞬だけ下地色が露出＝白フラッシュ。
 *        CAPACITOR-GOLDEN-RULES 原則3 の kimito 実例 2026-07-02）
 *   3. 背景色が 8桁 ARGB である（Capacitor は #RRGGBBAA を要求）
 *
 * ■ ★見ないこと（限界）
 *   - 画像そのものの中身（地色が本当にその色か）は見ない。ここは**設定だけ**。
 *   - 実機の見え方は判定できない。設定が正しくても端末で確認する必要はある。
 *   - TWA(android-twa/twa-manifest.json)は対象外＝Capacitor 構成のみ。
 *
 * 終了コード: 0=合格 / 1=測れた上での赤 / 2=測れなかった
 *
 * 使い方:
 *   node scripts/check-splash-config.mjs
 *   node scripts/check-splash-config.mjs --config apps/mobile/capacitor.config.ts
 *   node scripts/check-splash-config.mjs --selftest
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  EXIT,
  computeExitCode,
  formatProbeReport,
  runSelfTest,
} from './lib/instrument-core.mjs';

/** Capacitor が引き伸ばす既定値。明示されていなければこれになる。 */
const STRETCHING_SCALE_TYPE = 'FIT_XY';
const SAFE_SCALE_TYPES = ['CENTER_CROP', 'FIT_CENTER', 'FIT_START', 'FIT_END'];

const CONFIG_CANDIDATES = [
  'capacitor.config.ts',
  'capacitor.config.json',
  'apps/mobile/capacitor.config.ts',
  'ios-app/capacitor.config.json',
];

function findConfig(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  return CONFIG_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

/**
 * ★このリポが Expo prebuild 方式かを判定する。
 *
 * なぜ必要か（2026-08-24 に自分がやらかした誤判定）:
 *   surechigai-romi.link は Capacitor → Expo prebuild へ**移行済み**なのに
 *   capacitor.config.json が**そのまま残っていた**。この検査はそれを読んで
 *   「androidScaleType が無い＝赤」と報告したが、★その設定は**誰も読んでいない**。
 *   実際の起動画面は app.config.ts の expo-splash-screen が作っており、
 *   しかも既に正しく直されていた（＝完全な偽陽性）。
 *
 *   出典: web-ios-android/_docs/SPLASH-SCREEN-PLAYBOOK.md
 *   「移行後は、どの設定ファイルが実際に読まれているかをワークフローで確認すること」
 *
 * ★死んだ設定ファイルを測って赤を出すのは、測っていないより悪い（直す先を間違える）。
 */
function detectExpo() {
  const hasExpoConfig =
    existsSync('app.config.ts') || existsSync('app.config.js') || existsSync('app.json');
  if (!hasExpoConfig) return false;
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return Boolean(deps.expo || deps['expo-splash-screen']);
  } catch {
    return hasExpoConfig;
  }
}

/**
 * ★コメント行は先に落とす。
 * linktree の config は androidScaleType の理由を長文コメントで書いており、
 * 素朴に正規表現をかけると解説文中の FIT_XY を設定値として拾ってしまう。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readScaleType(src) {
  const m = src.match(/androidScaleType\s*:\s*['"]([A-Z_]+)['"]/);
  return m ? m[1] : null;
}

/** 背景色を出現箇所ごとに全部拾う（一致しているかを見たいので集合で扱う）。 */
function readBackgroundColors(src) {
  const out = [];
  const re = /backgroundColor\s*:\s*['"](#[0-9a-fA-F]{6,8})['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1].toUpperCase());
  return out;
}

const SCALE_LIMITATION = '設定の有無だけを見る。実機の見え方は端末で確認すること';
const BG_LIMITATION = '画像の実際の地色とは照合しない（それは別の検査）';

/** @returns {import('./lib/instrument-core.mjs').ProbeResult} */
function probeScaleType(src) {
  const probe = 'androidScaleType が明示されている';
  const scaleType = readScaleType(src);

  if (scaleType === null) {
    return {
      probe,
      verdict: 'fail',
      evidence: { androidScaleType: null, effective: STRETCHING_SCALE_TYPE },
      detail: '設定に androidScaleType が無い（既定の FIT_XY = 引き伸ばしになる）',
      howToFix:
        'capacitor.config の plugins.SplashScreen に androidScaleType: CENTER_CROP を足す' +
        '（iOS の aspect fill と挙動を揃える）',
      limitation: SCALE_LIMITATION,
    };
  }
  if (scaleType === STRETCHING_SCALE_TYPE) {
    return {
      probe,
      verdict: 'fail',
      evidence: { androidScaleType: scaleType },
      detail: `androidScaleType: ${scaleType} ＝ 引き伸ばし。正方形素材が縦長端末で間延びする`,
      howToFix: 'androidScaleType: CENTER_CROP に変える',
      limitation: SCALE_LIMITATION,
    };
  }
  if (!SAFE_SCALE_TYPES.includes(scaleType)) {
    return {
      probe,
      verdict: 'inconclusive',
      evidence: { androidScaleType: scaleType },
      detail: `未知の値 ${scaleType}（この検査が知る安全な値: ${SAFE_SCALE_TYPES.join(', ')}）`,
      howToFix: '値が正しいか Capacitor のドキュメントで確認する',
      limitation: '知らない値は判定できない',
    };
  }
  return {
    probe,
    verdict: 'pass',
    evidence: { androidScaleType: scaleType },
    limitation: SCALE_LIMITATION,
  };
}

/** @returns {import('./lib/instrument-core.mjs').ProbeResult} */
function probeBackgroundConsistency(src) {
  const probe = '背景色が全箇所で一致している';
  const colors = readBackgroundColors(src);

  if (colors.length === 0) {
    return {
      probe,
      verdict: 'inconclusive',
      evidence: null,
      detail: 'backgroundColor が1つも見つからない',
      howToFix: 'root / ios / android / plugins.SplashScreen に背景色を設定する',
      limitation: '設定ファイルの字面だけを見る',
    };
  }

  const unique = [...new Set(colors)];
  if (unique.length > 1) {
    return {
      probe,
      verdict: 'fail',
      evidence: { distinctColors: unique, occurrences: colors.length },
      detail: `背景色が ${unique.length} 種類ある: ${unique.join(' / ')}（${colors.length}箇所）`,
      howToFix:
        '全て同じ値に揃える。★決めるときはテーマの明暗でなく**スプラッシュ画像の地色**を見る' +
        '（不一致だと画像が出る前の一瞬に下地色が露出＝白フラッシュ）',
      limitation: BG_LIMITATION,
    };
  }

  const color = unique[0];
  if (color.length !== 9) {
    return {
      probe,
      verdict: 'fail',
      evidence: { backgroundColor: color, digits: color.length - 1 },
      detail: `背景色 ${color} が 8桁ARGB ではない（${color.length - 1}桁）`,
      howToFix: `#RRGGBBAA 形式にする（例: ${color}FF）`,
      limitation: BG_LIMITATION,
    };
  }

  return {
    probe,
    verdict: 'pass',
    evidence: { backgroundColor: color, occurrences: colors.length },
    limitation: BG_LIMITATION,
  };
}

export function runProbes(src) {
  const clean = stripComments(src);
  return [probeScaleType(clean), probeBackgroundConsistency(clean)];
}

// ─── selftest ────────────────────────────────────────────────────────
// ★毒を食わせて赤くなることを確かめる。状態に依存しない毒にする
//   （instrument-core の警告: 実装状況に依存した毒はいつか壊れる）。
//   ここは純関数 runProbes に文字列を渡すだけなので、poison/restore は不要。
function selfTest() {
  const verdictOf = (src, idx) => runProbes(src)[idx].verdict;
  const noop = () => {};

  const cases = [
    {
      name: 'FIT_XY を赤にする',
      poison: noop,
      restore: noop,
      isRed: () =>
        verdictOf('{ androidScaleType: "FIT_XY", backgroundColor: "#00427BFF" }', 0) === 'fail',
    },
    {
      name: 'androidScaleType 未指定を赤にする',
      poison: noop,
      restore: noop,
      isRed: () => verdictOf('{ backgroundColor: "#00427BFF" }', 0) === 'fail',
    },
    {
      name: '背景色の不一致を赤にする',
      poison: noop,
      restore: noop,
      isRed: () =>
        verdictOf(
          '{ androidScaleType: "CENTER_CROP", backgroundColor: "#FFFFFFFF",' +
            ' ios: { backgroundColor: "#00427BFF" } }',
          1,
        ) === 'fail',
    },
    {
      name: '6桁カラーを赤にする',
      poison: noop,
      restore: noop,
      isRed: () =>
        verdictOf('{ androidScaleType: "CENTER_CROP", backgroundColor: "#00427B" }', 1) === 'fail',
    },
    {
      // ★逆方向の確認: 正しい設定で緑になること。
      //   これが無いと「常に赤を返す壊れた検査」も selftest を通ってしまう。
      name: '正しい設定を緑にする（常時赤の検査を弾く）',
      poison: noop,
      restore: noop,
      isRed: () => {
        const src = '{ androidScaleType: "CENTER_CROP", backgroundColor: "#00427BFF" }';
        return runProbes(src).every((r) => r.verdict === 'pass');
      },
    },
    {
      // ★死んだ設定を読んで赤を出す誤判定（2026-08-24 に実際にやった）を防ぐ。
      //   Expo 判定は cwd 依存なので、ここでは検出関数が
      //   「package.json も設定も無い場所では false」を返すことだけ確かめる。
      name: 'Capacitor リポを Expo と誤判定しない',
      poison: noop,
      restore: noop,
      isRed: () => detectExpo() === false,
    },
    {
      name: 'コメント内の FIT_XY を設定値と誤読しない',
      poison: noop,
      restore: noop,
      isRed: () =>
        verdictOf(
          '{ // 既定は FIT_XY なので CENTER_CROP にする\n' +
            '  androidScaleType: "CENTER_CROP", backgroundColor: "#00427BFF" }',
          0,
        ) === 'pass',
    },
  ];

  const { ok, fails } = runSelfTest(cases);
  if (ok) {
    console.log(`[check-splash-config] selftest OK (${cases.length}件すべて期待どおり)`);
  } else {
    console.error('[check-splash-config] ★selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
  }
  return ok;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    process.exit(selfTest() ? EXIT.PASS : EXIT.FAIL);
  }

  // ★--dry-run: 判定は出さず「この検査自身が動く状態か」だけを見る。
  //   site/claims.json の level:"auto" を名乗る条件（verify-claims-coverage.mjs RULE 3）。
  //   検査本体を走らせないのは、キット自身には capacitor.config が無く（テンプレート集なので当然）、
  //   実行すると常に🟡になり「配線の健全性」と「対象の状態」を区別できなくなるため。
  if (argv.includes('--dry-run')) {
    const ok = selfTest();
    console.log(
      ok
        ? '[check-splash-config] --dry-run OK（検査自身が正しく赤/緑を出せることを確認）'
        : '[check-splash-config] --dry-run 失敗',
    );
    console.log('★--dry-run が見ないこと: 対象リポの実際の合否。判定は --dry-run 無しで実行すること。');
    process.exit(ok ? EXIT.PASS : EXIT.FAIL);
  }

  const explicit = argv.includes('--config') ? argv[argv.indexOf('--config') + 1] : null;
  const configPath = findConfig(explicit);

  // ★Expo 方式なら capacitor.config は死んだ設定。読んで赤を出してはいけない。
  if (detectExpo() && !argv.includes('--force-capacitor')) {
    console.log('[check-splash-config] 🟡 Expo prebuild 方式のため、この検査は対象外');
    if (configPath) {
      console.log(`  ★${configPath} が残っているが、Expo 方式では**誰も読まない死んだ設定**`);
      console.log('  → 消すか、残す理由をコメントで書く（次の人が同じ誤読をする）');
    }
    console.log('  → Expo の起動画面は check-splash-safe-circle.mjs（web-ios-android キット）で見る');
    console.log('  ★この検査の限界: Capacitor 専用。Expo の設定は測れていない（緑ではない）');
    process.exit(EXIT.INCONCLUSIVE);
  }

  if (!configPath) {
    console.error('[check-splash-config] capacitor.config が見つからない');
    console.error(`  探した場所: ${CONFIG_CANDIDATES.join(', ')}`);
    console.error('  --config <path> で明示指定できる');
    console.error('  ★この検査の限界: 設定ファイルが読めないので何も測れていない');
    process.exit(EXIT.INCONCLUSIVE);
  }

  const src = readFileSync(resolve(configPath), 'utf8');
  const results = runProbes(src);

  console.log(formatProbeReport(results, { label: `splash config: ${configPath}` }));
  process.exit(computeExitCode(results));
}

main();
