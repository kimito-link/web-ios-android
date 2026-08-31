#!/usr/bin/env node
// 2つのファイル（またはファイル群）から正規表現でキー集合を抽出し、
// 「片方にしかないキー」「消費されているが供給されていないキー」を機械的に検出するゲート。
//
// 移植元: web-health-check-app/scripts/audit-diagnosis-coverage.mjs
//         web-health-check-app/scripts/audit-neglect-wiring.mjs
//   （2026-08-31、council-fable「逆輸入候補」調査で発見・輸入、大幅汎用化）
//
// ★移植元の設計思想（そのまま踏襲）:
//   「ドキュメントの数字を信じない、実コードから機械で数える」。
//   移植元プロジェクトはこの手法無しで同じ病理を2度、目視レビューで見逃した
//   （未調査を問題なしと報告=8件、検出したのに黙っている=25件）。
//   さらに「配線層」（ロジックは正しいが呼び出し側が値を渡していない）という、
//   ロジック層のテストだけでは絶対に見つからない欠落もこの型で検出できる
//   （実測2026-08-28: noindexの判定はあるのに配線されておらず一生発火しなかった）。
//
// ★移植元との違い（汎用化のための一般化）:
//   移植元は「web-health-check-app と dns-osint-pro-ver2.0 という2リポジトリ」
//   「neglect-consequences.js / popup.js という特定ファイル」にハードコードされていた。
//   このゲートは比較対象のファイルパス・抽出用正規表現をすべて設定ファイルから
//   受け取る形にし、どのプロジェクトのどんな「A側キー集合 vs B側キー集合」比較にも
//   使える形にした。
//
// 使い方:
//   node scripts/verify-key-coverage.mjs --config key-coverage.config.json
//   node scripts/verify-key-coverage.mjs --config key-coverage.config.json --strict
//   node scripts/verify-key-coverage.mjs --selftest
//
// config.jsonの形式:
// {
//   "mode": "diff" | "wiring",
//   "left": { "path": "src/lib/foo.ts", "pattern": "([a-z_]{3,30})\\s*:\\s*\\{" },
//   "right": { "path": "src/lib/bar.js", "pattern": "([a-z_]{3,30})\\s*:\\s*\\{" },
//   "baselineOnlyLeft": ["known_gap_1"],   // diffモード: leftにのみ存在してよい既知キー
//   "baselineOnlyRight": [],               // diffモード: rightにのみ存在してよい既知キー
//   "baselineUnwired": ["known_unwired"]   // wiringモード: 未配線のまま許容する既知キー
// }
//
// mode: "diff"    = left/rightどちらかにしか無いキーを検出（項目網羅性の相互比較）
// mode: "wiring"  = leftが消費するキーのうちrightが供給していないものを検出（配線漏れ検出）
//
// ★実測で確認した限界（2026-08-31、移植元の実データで裏取り）:
//   diffモードは移植元(audit-diagnosis-coverage.mjs)の実データと完全一致を確認済み。
//   wiringモードは、供給側の呼び出しが「単純な object literal の直書き」なら機能するが、
//   移植元(audit-neglect-wiring.mjs)のように「特定の関数呼び出し( _updateNeglect({...}) )の
//   引数だけを括弧バランスで切り出してから中のキーを拾う」という構造的な絞り込みは
//   1本の正規表現では再現できない（ファイル全体から拾うと無関係なキーまで誤検知する。
//   実測: 元は1件検出のところ汎用版は5件と過検知した）。
//   このゲートのwiringモードは「供給側ファイルの対象範囲が正規表現1つで素直に切り出せる」
//   単純なケース向け。呼び出し境界の括弧バランス解析が要る複雑な配線検査は、
//   移植元スクリプトを直接参考にプロジェクト固有のスクリプトを書くこと（過剰な
//   一般化はしない）。
//
// 終了コード（instrument-core の3値規約）:
//   0 = ベースラインどおり(--strict時)または差分なし / 1 = 新規の欠落あり / 2 = 測れなかった（対象ファイル不在）
import fs from 'node:fs';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/**
 * 指定パターンでファイル本文からキー集合を抽出する。
 * @param {string} content
 * @param {string} patternSrc 正規表現文字列（キャプチャグループ1がキー名）
 * @returns {string[]}
 */
export function extractKeys(content, patternSrc) {
  if (!content) return [];
  const re = new RegExp(patternSrc, 'g');
  return [...new Set([...content.matchAll(re)].map((m) => m[1]))].sort();
}

/**
 * ★判定の本体（純関数・fsに触らない＝テストしやすい）。
 * @param {'diff'|'wiring'} mode
 * @param {string[]} leftKeys
 * @param {string[]} rightKeys
 * @param {{ leftExists: boolean, rightExists: boolean }} context
 * @param {{ baselineOnlyLeft?: string[], baselineOnlyRight?: string[], baselineUnwired?: string[] }} baseline
 * @param {boolean} strict
 * @returns {import('./lib/instrument-core.mjs').ProbeResult[]}
 */
export function judgeKeyCoverage(mode, leftKeys, rightKeys, context, baseline = {}, strict = false) {
  if (!context.leftExists || !context.rightExists) {
    return [{
      probe: `キー網羅性検査（${mode}）`,
      verdict: 'inconclusive',
      detail: `比較対象ファイルが見つかりません（left存在=${context.leftExists}, right存在=${context.rightExists}）`,
      howToFix: 'config.jsonのleft.path/right.pathが正しいか確認してください。比較先リポジトリが無い環境では意図的にinconclusiveになります'
    }];
  }

  // ★ファイルは在るのにキーが1件も取れない＝pattern が合っていない（2026-09-01 追加）。
  //   ★これを緑にしてはいけない。「差分なし」ではなく「比べていない」だから。
  //   実測: surechigai-romi.link で `^##\s+(SG-\d{2})` と書いたところ、
  //   複数行フラグが無いため先頭行しか見ず **左が0件**になった。
  //   それでも「✅ 合格」と出たので、索引に無い症状を足す毒テストでも赤くならなかった
  //   ＝**永久に緑の飾り**が出来ていた（この検査群が最も嫌う形）。
  if (leftKeys.length === 0) {
    return [{
      probe: `キー網羅性検査（${mode}）`,
      verdict: 'inconclusive',
      detail: '比較の左側からキーを1件も抽出できませんでした（★差分なしではなく、比べていません）',
      howToFix: 'config.json の left.pattern を見直してください。'
        + '★複数行の先頭に当てたいときは ^ ではなく \\n を使う（この検査は m フラグを付けません）。'
        + '正規表現の1つ目の丸括弧がキーとして拾われます'
    }];
  }

  if (mode === 'diff') {
    const onlyLeft = leftKeys.filter((k) => !rightKeys.includes(k));
    const onlyRight = rightKeys.filter((k) => !leftKeys.includes(k));

    if (!strict) {
      if (onlyLeft.length || onlyRight.length) {
        return [{
          probe: 'キー網羅性検査（diff）',
          verdict: 'fail',
          evidence: { left件数: leftKeys.length, right件数: rightKeys.length },
          detail: `left/rightのキー集合に差分があります: leftのみ=[${onlyLeft.join(', ')}] rightのみ=[${onlyRight.join(', ')}]`,
          howToFix: '片方に項目を足したら、もう片方にも足すか、既知の差分としてbaselineOnlyLeft/baselineOnlyRightに登録してください'
        }];
      }
      return [{ probe: 'キー網羅性検査（diff）', verdict: 'pass', evidence: { left件数: leftKeys.length, right件数: rightKeys.length } }];
    }

    const baseLeft = baseline.baselineOnlyLeft || [];
    const baseRight = baseline.baselineOnlyRight || [];
    const newlyOnlyLeft = onlyLeft.filter((k) => !baseLeft.includes(k));
    const newlyOnlyRight = onlyRight.filter((k) => !baseRight.includes(k));
    const fixedLeft = baseLeft.filter((k) => !onlyLeft.includes(k));
    const fixedRight = baseRight.filter((k) => !onlyRight.includes(k));

    if (newlyOnlyLeft.length || newlyOnlyRight.length) {
      return [{
        probe: 'キー網羅性検査（diff・strict）',
        verdict: 'fail',
        evidence: { 新規leftのみ: newlyOnlyLeft.length, 新規rightのみ: newlyOnlyRight.length },
        detail: `ベースラインを超えて新たな差分が発生しました: leftのみ=[${newlyOnlyLeft.join(', ')}] rightのみ=[${newlyOnlyRight.join(', ')}]`,
        howToFix: '両側に項目を揃えるか、意図的な差分ならconfig.jsonのbaselineに追加してください'
      }];
    }
    if (fixedLeft.length || fixedRight.length) {
      return [{
        probe: 'キー網羅性検査（diff・strict）',
        verdict: 'fail',
        evidence: { 解消済みleft: fixedLeft.length, 解消済みright: fixedRight.length },
        detail: `解消済みなのにベースラインに残っています: left=[${fixedLeft.join(', ')}] right=[${fixedRight.join(', ')}]`,
        howToFix: 'config.jsonのbaselineOnlyLeft/baselineOnlyRightから解消済みキーを削除してください（ベースラインは現状であって目標ではない。緩いまま放置すると次の欠落を見逃す）'
      }];
    }
    return [{ probe: 'キー網羅性検査（diff・strict）', verdict: 'pass', evidence: { left件数: leftKeys.length, right件数: rightKeys.length } }];
  }

  // mode === 'wiring': leftが消費するキーのうちrightに無いもの＝配線漏れ
  const unwired = leftKeys.filter((k) => !rightKeys.includes(k));

  if (!strict) {
    if (unwired.length) {
      return [{
        probe: 'キー配線検査（wiring）',
        verdict: 'fail',
        evidence: { 消費側件数: leftKeys.length, 供給側件数: rightKeys.length, 未配線件数: unwired.length },
        detail: `消費されているのに供給されていないキーがあります: [${unwired.join(', ')}]`,
        howToFix: 'この項目に対応するロジックは永久に発火しません。供給側（呼び出し元）で値を渡してください'
      }];
    }
    return [{ probe: 'キー配線検査（wiring）', verdict: 'pass', evidence: { 消費側件数: leftKeys.length, 供給側件数: rightKeys.length } }];
  }

  const baseUnwired = baseline.baselineUnwired || [];
  const newlyUnwired = unwired.filter((k) => !baseUnwired.includes(k));
  const fixedUnwired = baseUnwired.filter((k) => !unwired.includes(k));

  if (newlyUnwired.length) {
    return [{
      probe: 'キー配線検査（wiring・strict）',
      verdict: 'fail',
      evidence: { 新規未配線件数: newlyUnwired.length },
      detail: `新たに配線されていないキーがあります: [${newlyUnwired.join(', ')}]`,
      howToFix: 'この項目は検出しているのに黙っている状態です。供給側で値を渡すか、意図的ならbaselineUnwiredに追加してください'
    }];
  }
  if (fixedUnwired.length) {
    return [{
      probe: 'キー配線検査（wiring・strict）',
      verdict: 'fail',
      evidence: { 解消済み件数: fixedUnwired.length },
      detail: `解消済みなのにベースラインに残っています: [${fixedUnwired.join(', ')}]`,
      howToFix: 'config.jsonのbaselineUnwiredから解消済みキーを削除してください'
    }];
  }
  return [{ probe: 'キー配線検査（wiring・strict）', verdict: 'pass', evidence: { 消費側件数: leftKeys.length, 供給側件数: rightKeys.length } }];
}

// ── selftest（★毒→赤） ──────────────────────────────────────────────────
function selftest() {
  const cases = [
    {
      name: '毒1: 比較対象ファイルが存在しない（測れなかった）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeKeyCoverage('diff', [], [], { leftExists: false, rightExists: true })) === EXIT.INCONCLUSIVE
    },
    {
      // ★2026-09-01 追加。ファイルは在るのに pattern が合わず左が0件だったとき、
      //   「✅ 合格」と出て毒テストすら赤にならない**永久に緑の飾り**が実際に出来ていた。
      name: '★毒1b: ファイルは在るがキーが0件（緑にしない・比べていない）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeKeyCoverage('wiring', [], ['a'], { leftExists: true, rightExists: true })) === EXIT.INCONCLUSIVE
    },
    {
      name: '毒2: diffモードでleftのみのキーがある（赤）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeKeyCoverage('diff', ['a', 'b'], ['a'], { leftExists: true, rightExists: true })) === EXIT.FAIL
    },
    {
      name: '毒なし: diffモードでキー集合が一致すれば緑（誤検知しない）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeKeyCoverage('diff', ['a', 'b'], ['a', 'b'], { leftExists: true, rightExists: true })) === EXIT.PASS
    },
    {
      name: '毒3: wiringモードで消費されているが供給されていないキーがある（赤）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeKeyCoverage('wiring', ['metaNoindex', 'seoLevel'], ['seoLevel'], { leftExists: true, rightExists: true })) === EXIT.FAIL
    },
    {
      name: '毒4: --strict時、ベースライン内の既知差分は許容される（誤検知しない）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeKeyCoverage('diff', ['a', 'b'], ['a'], { leftExists: true, rightExists: true }, { baselineOnlyLeft: ['b'] }, true)) === EXIT.PASS
    },
    {
      name: '毒5: --strict時、ベースラインを超える新規差分は赤',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeKeyCoverage('diff', ['a', 'b', 'c'], ['a'], { leftExists: true, rightExists: true }, { baselineOnlyLeft: ['b'] }, true)) === EXIT.FAIL
    },
    {
      name: '毒6: --strict時、解消済みなのにベースラインに残っていれば赤（ラチェットが緩まない）',
      poison: () => {}, restore: () => {},
      isRed: () => computeExitCode(judgeKeyCoverage('diff', ['a'], ['a'], { leftExists: true, rightExists: true }, { baselineOnlyLeft: ['b'] }, true)) === EXIT.FAIL
    },
  ];

  const { ok, fails } = runSelfTest(cases);
  if (!ok) {
    console.error('🔴 selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`✅ selftest 合格（${cases.length}件: diff/wiring両モードの検知・誤検知なし・ベースラインのラチェットを確認）`);
  process.exit(EXIT.PASS);
}

// ── 実行 ────────────────────────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  selftest();
}

const configPath = arg('--config', null);
if (!configPath) {
  console.error('[key-coverage] FAIL  --config <path> が必須です（設定ファイルの形式はスクリプト冒頭コメント参照）');
  process.exit(EXIT.INCONCLUSIVE);
}
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.error(`[key-coverage] FAIL  --config ${configPath} の読み込みに失敗しました: ${e.message}`);
  process.exit(EXIT.INCONCLUSIVE);
}

const strict = process.argv.includes('--strict');
const leftContent = fs.existsSync(config.left.path) ? fs.readFileSync(config.left.path, 'utf8') : null;
const rightContent = fs.existsSync(config.right.path) ? fs.readFileSync(config.right.path, 'utf8') : null;

const leftKeys = extractKeys(leftContent, config.left.pattern);
const rightKeys = extractKeys(rightContent, config.right.pattern);

const results = judgeKeyCoverage(
  config.mode,
  leftKeys,
  rightKeys,
  { leftExists: leftContent !== null, rightExists: rightContent !== null },
  { baselineOnlyLeft: config.baselineOnlyLeft, baselineOnlyRight: config.baselineOnlyRight, baselineUnwired: config.baselineUnwired },
  strict
);
const code = computeExitCode(results);
console.log(formatProbeReport(results, { label: 'key-coverage' }));
if (code === EXIT.FAIL) {
  for (const r of results.filter((x) => x.verdict === 'fail')) {
    console.error(`::error::${r.detail}`);
  }
}
process.exit(code);
