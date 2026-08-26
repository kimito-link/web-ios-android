#!/usr/bin/env node
// Android「未署名 AAB 出荷事故」防止ゲート。
//
// 背景（出典: Exosome android-play-release.yml で実証）:
//   bubblewrap は build.gradle に signingConfig を生成しないため、そのままビルドすると
//   未署名 AAB ができ、Play Console がアップロードを弾く。CI/ローカルの bundleRelease の
//   「前」にこのチェックを通すことで、Play に弾かれる前に検出して止められる。
//   android-patch-signing.mjs を流せば signingConfig は注入される（このスクリプトはその検証）。
//
// ───────────────────────────────────────────────────────────────────────────
// ★2026-08-24: この門番自身が壊れていたのを実測で確認して直した。
//   ★発見と修正は kimitolink-linktree。キット配布物にも同じ穴があることを
//   毒テストで再現してから、こちらへ反映した（＝配った全アプリに同じ穴があった）。
//
//   【実損】kimitolink-linktree の android-twa/app/build.gradle:171 の `signingConfig signingConfigs.release` を
//     コメントアウト（＝未署名 AAB が出る状態）にして実行したところ、
//     「OK（署名済み AAB が生成されます）」と表示して ★exit 0（緑）を返した。
//
//   【真因】判定が Groovy のコメントを剥がさない生正規表現だった。
//     ＝ ★**コメントに書くだけで門番が通る**。
//     さらに `buildTypes {` からファイル末尾までを見ていたため、
//     `debug { }` 側や末尾のコメントにあるだけでも「release にある」と誤読した。
//
//   【対策】① コメントを剥がしてから判定する
//           ② ★波括弧の深さで release ブロックだけを切り出す
//           ③ 測れなかったときは緑にせず exit 2（inconclusive）
//           ④ ★何を見たかを実測値として出す（従来は OK/NG の字だけで復元できなかった）
//           ⑤ ★--selftest（毒→赤）を持たせ、次に壊れたら気付けるようにする
//
//   ★キット版でも同じ毒で exit 0 を再現済み（2026-08-24）。ここが正本なので、
//     ここを直さない限り**新規アプリすべてに同じ穴が配られ続ける**。
//
//   ★掟①: 名前や書式だけを見る検査は、通す方向にも見落とす方向にも同じように壊れる。
// ───────────────────────────────────────────────────────────────────────────
//
// 使い方:
//   node scripts/app/verify-android-signing-config.mjs
//   node scripts/app/verify-android-signing-config.mjs --gradle android-twa/app/build.gradle
//   node scripts/app/verify-android-signing-config.mjs --selftest   ★毒を入れて赤くなるか確認
//
// 終了コード（instrument-core の3値規約）:
//   0 = 合格（根拠つき） / 1 = 測れた上での赤 / ★2 = 測れなかった（緑ではない）
//
// 既定パスは Capacitor/TWA 標準構成。アプリ固有値は持たない。完全に汎用。
import fs from 'node:fs';
import {
  EXIT,
  computeExitCode,
  formatProbeReport,
  runSelfTest
} from './lib/instrument-core.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/**
 * ★Groovy のコメントを剥がす。
 *   技法の出どころは同リポの scripts/app/lint-pre-submission.mjs:91-96
 *   （URL の `//` を壊さないため `(^|[^:])` を前置する）。
 * @param {string} text
 * @returns {string}
 */
export function stripGroovyComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')      // ブロックコメント
    .replace(/(^|[^:])\/\/.*$/gm, '$1');   // 行コメント（URL の // は残す）
}

/**
 * ★波括弧の深さで、名前付きブロックの中身だけを切り出す。
 *   技法の出どころは同リポの scripts/app/lint-pre-submission.mjs:328-338。
 *   「`buildTypes {` から末尾まで」を見ると debug{} 側の記述で誤って緑になる。
 *
 * @param {string} text コメント除去済みのソース
 * @param {string} name ブロック名（例: 'buildTypes'）
 * @returns {string|null} ブロックの中身。見つからなければ null
 */
export function extractBlock(text, name) {
  const re = new RegExp(`(^|[^\\w.])${name}\\s*\\{`, 'm');
  const m = String(text).match(re);
  if (!m) return null;
  let i = m.index + m[0].length; // 開き波括弧の直後
  let depth = 1;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  if (depth !== 0) return null; // ★閉じていない＝壊れている。緑にしない
  return text.slice(m.index + m[0].length, i - 1);
}

/**
 * ★判定の本体（純関数・fs に触らない＝テストしやすい）。
 *
 * @param {string} rawSource build.gradle の生テキスト
 * @returns {import('./lib/instrument-core.mjs').ProbeResult[]}
 */
export function judgeSigningConfig(rawSource) {
  const src = stripGroovyComments(rawSource);
  /** @type {import('./lib/instrument-core.mjs').ProbeResult[]} */
  const results = [];

  const LIMIT =
    '★storeFile/keyAlias 等に正しい値が入っているか、鍵が実在するかは見ません（記述の有無だけ）。';

  // 1. signingConfigs ブロックがあるか
  const signingConfigs = extractBlock(src, 'signingConfigs');
  if (signingConfigs === null) {
    results.push({
      probe: 'signingConfigs ブロック',
      verdict: 'fail',
      evidence: { 検出: false },
      detail: "'signingConfigs' ブロックがありません（AAB が署名されず Play に弾かれます）",
      howToFix:
        'signingConfigs { release { storeFile / storePassword / keyAlias / keyPassword } } を追加（node scripts/app/android-patch-signing.mjs で自動注入できます）',
      limitation: LIMIT
    });
  } else {
    results.push({
      probe: 'signingConfigs ブロック',
      verdict: 'pass',
      evidence: { 検出: true, 文字数: signingConfigs.length },
      limitation: LIMIT
    });
  }

  // 2. ★buildTypes.release の中で signingConfig を参照しているか
  const buildTypes = extractBlock(src, 'buildTypes');
  if (buildTypes === null) {
    results.push({
      probe: 'buildTypes.release の signingConfig 参照',
      verdict: 'fail',
      evidence: { buildTypes: '見つからない' },
      detail: 'buildTypes ブロックがありません',
      howToFix: 'buildTypes { release { ... signingConfig signingConfigs.release } } を追加',
      limitation: LIMIT
    });
    return results;
  }

  const release = extractBlock(buildTypes, 'release');
  if (release === null) {
    results.push({
      probe: 'buildTypes.release の signingConfig 参照',
      verdict: 'fail',
      evidence: { buildTypes: '有', release: '見つからない' },
      detail: 'buildTypes の中に release ブロックがありません',
      howToFix: 'buildTypes { release { ... signingConfig signingConfigs.release } } を追加',
      limitation: LIMIT
    });
    return results;
  }

  const REF = /signingConfig\s+signingConfigs\.(\w+)/;
  const ref = release.match(REF);
  if (!ref) {
    // ★ここが実損の本体だった経路。誤読を防ぐため「どこには在ったか」も出す。
    const elsewhere = REF.test(src);
    results.push({
      probe: 'buildTypes.release の signingConfig 参照',
      verdict: 'fail',
      evidence: {
        'release 内の参照': false,
        'release 外（コメント除去後）に同じ記述': elsewhere
      },
      detail: elsewhere
        ? '★release ブロックの外には在りますが、release の中にありません（debug 側などに書かれている可能性）'
        : 'buildTypes.release が signingConfig を参照していません',
      howToFix: 'buildTypes { release { ... signingConfig signingConfigs.release } } を追加',
      limitation: LIMIT
    });
    return results;
  }

  results.push({
    probe: 'buildTypes.release の signingConfig 参照',
    verdict: 'pass',
    evidence: { 参照先: `signingConfigs.${ref[1]}`, 一致文字列: ref[0] },
    limitation: LIMIT
  });

  return results;
}

// ── selftest（★毒→赤。サボると鳴るかを機械で確かめる） ──────────────────────
//
// ★毒は「状態に依存しない」ものにする（キットの再発防止: 特定項目が todo である
//   前提の毒は、その項目が実装された瞬間に壊れる）。ここでは実ファイルを一切触らず、
//   ★文字列を組み立てて判定関数に食わせる（＝毒が確実に適用される）。
const GOOD_GRADLE = `
android {
    signingConfigs {
        release {
            storeFile file('release.keystore')
            keyAlias 'upload'
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
        }
        debug {
            minifyEnabled false
        }
    }
}
`;

function isRed(source) {
  return computeExitCode(judgeSigningConfig(source)) !== EXIT.PASS;
}

function selftest() {
  // ★毒が「実際に効いた」ことを、判定を読む前に確かめる（掟③）。
  //   置換が空振りしたまま「合格」と読む事故を防ぐ。
  function mutate(text, from, to, label) {
    const next = text.replace(from, to);
    if (next === text) {
      throw new Error(`★毒が1文字も適用されていません（置換が空振り）: ${label}`);
    }
    return next;
  }

  let poisoned = '';
  const cases = [
    {
      // ★実測した実損そのもの: signingConfig 行をコメントアウトする
      name: '毒1: release の signingConfig をコメントアウト（＝未署名 AAB）',
      poison: () => {
        poisoned = mutate(
          GOOD_GRADLE,
          'signingConfig signingConfigs.release',
          '// signingConfig signingConfigs.release',
          'signingConfig のコメントアウト'
        );
      },
      restore: () => { poisoned = ''; },
      isRed: () => isRed(poisoned)
    },
    {
      name: '毒2: signingConfigs ブロックごと消す',
      poison: () => {
        poisoned = mutate(GOOD_GRADLE, /signingConfigs\s*\{[\s\S]*?\n    \}\n/, '', 'ブロック削除');
      },
      restore: () => { poisoned = ''; },
      isRed: () => isRed(poisoned)
    },
    {
      // ★「buildTypes から末尾まで」方式だと通ってしまった経路を塞げているか
      name: '毒3: signingConfig を release でなく debug 側へ移す',
      poison: () => {
        const removed = mutate(
          GOOD_GRADLE,
          '            signingConfig signingConfigs.release\n',
          '',
          'release から除去'
        );
        poisoned = mutate(
          removed,
          '        debug {\n',
          '        debug {\n            signingConfig signingConfigs.release\n',
          'debug へ移設'
        );
      },
      restore: () => { poisoned = ''; },
      isRed: () => isRed(poisoned)
    },
    {
      // ★誤検知していないことの確認（正しい入力で赤くならないか）
      name: '毒なし: 正しい build.gradle は緑のまま（誤検知しない）',
      poison: () => { poisoned = GOOD_GRADLE; },
      restore: () => { poisoned = ''; },
      isRed: () => !isRed(poisoned) // 緑であるべきなので反転して渡す
    }
  ];

  const { ok, fails } = runSelfTest(cases);
  if (!ok) {
    console.error('🔴 selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`✅ selftest 合格（${cases.length}件: 毒を入れると赤くなり、正しい入力では緑のまま）`);
  process.exit(EXIT.PASS);
}

// ── 実行 ────────────────────────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  selftest();
}

const GRADLE = arg('--gradle', 'android-twa/app/build.gradle');

let raw;
try {
  raw = fs.readFileSync(GRADLE, 'utf8');
} catch (e) {
  // ★測れなかった＝緑ではない（従来は fail と混ざっていた）。
  const results = [
    {
      probe: 'build.gradle の読み取り',
      verdict: 'inconclusive',
      evidence: { path: GRADLE, error: e && e.message },
      detail: `${GRADLE} を読めませんでした`,
      howToFix: '--gradle でパスを指定するか、先に npx cap add android / bubblewrap を実行してください'
    }
  ];
  console.error(formatProbeReport(results, { label: 'signingConfig' }));
  console.error(`::error::${GRADLE} を読めないため署名設定を検証できませんでした（緑ではありません）。`);
  process.exit(EXIT.INCONCLUSIVE);
}

const results = judgeSigningConfig(raw);
const code = computeExitCode(results);

console.log(formatProbeReport(results, { label: 'signingConfig' }));
console.log(`   対象: ${GRADLE}`);

if (code === EXIT.FAIL) {
  for (const r of results.filter((x) => x.verdict === 'fail')) {
    console.error(`::error::${r.probe}: ${r.detail}`);
  }
}
process.exit(code);
