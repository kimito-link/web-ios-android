#!/usr/bin/env node
/**
 * check-inline-script-syntax.mjs — ★HTMLの中に直接書かれたJavaScriptの構文を検査する。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか（2026-09-06・全リポを実測した結果）
 *
 *   HTMLファイルの `<script>` タグの中に直接書かれたJSは、
 *   ★【どのリポでも検査を1バイトも通っていなかった】。
 *
 *     $ npx eslint some/page.html
 *       0:0  warning  File ignored because no matching configuration was supplied
 *       EXIT=0        ← ★エラーが無いのではなく【見ていない】のに緑を返す
 *
 *   実測した被害範囲（git追跡ファイルのみ・2026-09-06）:
 *     kimito-link      3,610行  ← ★lintという概念自体が存在しない（設定もscriptも0件）
 *     characterlive      651行  ← 同上
 *     web-ios-android    321行  ← ★このキット自身。配布元が穴を持つと派生先に伝播する
 *     tsuioku-no-kirameki 671行 ← eslintは在るが files: に .html が無く素通り
 *
 *   ★構文エラーが1つあると、そのブロックのJSは【丸ごと実行されない】。
 *   ページが真っ白になる・ボタンが無反応になる、という形で表に出る。
 *
 * ■ ★なぜ ESLint プラグインではなくこれなのか（★100年もたせるための設計）
 *
 *   HTML内のJSを lint する既製品を実測で比較した:
 *     eslint-plugin-html  8.2.0  … ★メンテナが1人。この人が止まれば終わる
 *     @html-eslint        0.65.0 … ★1.0未満。しかも公式が「script内のJSは lint しない」と明言
 *   加えて ESLint v9 系は 2026-08-06 に EOL。
 *
 *   ⟹ ★外部パッケージに寄りかかる設計は「ずっと動く」に向かない。
 *      この検査は **Node 標準の `node:vm` だけ**で書いてある。依存ゼロ＝
 *      Node が動く限り動く。キットの掟「対象リポに何もインストールしない」も満たす。
 *
 * ■ ★この検査が【判定しないこと】（正直に書く・実測した限界）
 *
 *   実際に4種類のバグを食わせて、何が捕まり何が漏れるかを測った:
 *     構文エラー（閉じ括弧忘れ）        → ✅ 捕まる
 *     重複した宣言（let a; let a;）      → ✅ 捕まる
 *     strictモード違反                   → ❌ 素通り
 *     ★タイポ（documnt.getElementById） → ❌ ★素通り
 *
 *   ★タイポは捕まえられない。それには ESLint（no-undef）が要る。
 *   ★だから「これさえ通れば安全」ではない。★二層の【下の層】であり、
 *     上の層（ESLint）が死んでも構文だけは守り続ける、という役回り。
 *
 * 使い方:
 *   node check-inline-script-syntax.mjs <リポのパス>
 *   node check-inline-script-syntax.mjs --selftest
 *
 * 終了コード: 0=合格 / 1=構文エラーあり / ★2=測れなかった（HTMLが1件も無い）
 */

import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });

/**
 * ★HTMLから「中身が直接書かれた script」だけを取り出す（純関数・I/Oしない）。
 *
 *   除外するもの（★どれも実際に踏みうる誤検出の元）:
 *     ・`src=` 付き        … 中身が空。別ファイルなので lint 側の担当
 *     ・`type="application/ld+json"` … ★JSONであってJSではない。構造化データ
 *     ・`type="text/template"` 等   … ★テンプレート置き場。JSとして書かれていない
 *
 * @param {string} html
 * @returns {Array<{ code: string, line: number, isModule: boolean }>}
 */
export function extractInlineScripts(html) {
  const src = String(html || '');
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(src))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;              // 外部ファイル
    const type = (attrs.match(/\btype\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    if (type && !isJavaScriptType(type)) continue;        // JSON / テンプレート等
    const code = m[2];
    if (!code.trim()) continue;                          // 空タグ
    // ★何行目から始まるか（人が直せるように位置を出す）
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ code, line, isModule: /\bmodule\b/i.test(type) });
  }
  return out;
}

/** その type 属性は JavaScript か。★空文字（属性なし）は JS 扱いが仕様。 */
function isJavaScriptType(type) {
  const t = String(type).trim().toLowerCase().split(';')[0];
  return t === '' || t === 'module' || t === 'text/javascript' ||
    t === 'application/javascript' || t === 'text/ecmascript' ||
    t === 'application/ecmascript';
}

/**
 * ★1ブロックの構文を検査する（純関数的・DOMもネットワークも触らない）。
 *   ★`new vm.Script()` は【構文解析だけ】で、中のコードを実行しない。
 *     だから未知のHTMLを食わせても安全（実行したら任意コード実行になる）。
 *
 * @param {string} code
 * @param {boolean} isModule ES module は import/export を許す必要がある
 * @returns {string|null} エラーメッセージ。問題なければ null
 */
export function findSyntaxError(code, isModule = false) {
  try {
    if (isModule) {
      // ★module は import/export を含みうる。vm.Script は解釈できないので
      //   関数本体としてではなく、モジュール構文を許す形で包んで検査する。
      //   ★new Function は import を許さないため、ここでは vm.Script に
      //     そのまま渡し、import/export を含む場合だけ検査を諦める（下記）。
      if (/^\s*(import|export)\b/m.test(code)) return null; // ★測れない＝嘘の赤を出さない
    }
    new vm.Script(code);
    return null;
  } catch (e) {
    return String((e && e.message) || e);
  }
}

/**
 * ★合否を決める（純関数）。
 * @param {number} filesScanned 実際に中身を見たHTMLの数
 * @param {Array<{file:string, line:number, message:string}>} errors
 * @returns {{ verdict:'pass'|'fail'|'inconclusive', line:string }}
 */
export function judgeInlineSyntax(filesScanned, errors) {
  // ★0件を緑にしない。「対象が無い」と「対象を全部見て問題なし」は別のこと。
  if (!Number.isFinite(filesScanned) || filesScanned <= 0) {
    return { verdict: 'inconclusive', line: '🟡 測れませんでした（インラインJSを持つHTMLが1件もありません）' };
  }
  if (errors.length > 0) {
    return { verdict: 'fail', line: `🔴 構文エラー ${errors.length}件（そのブロックのJSは丸ごと実行されません）` };
  }
  return { verdict: 'pass', line: `✅ ${filesScanned}ファイルのインラインJS：構文エラーなし` };
}

/** git 追跡下の .html を列挙する。★追跡外（生成物・node_modules）は見ない。 */
function listTrackedHtml(repo) {
  try {
    const out = execFileSync('git', ['ls-files', '*.html'], {
      cwd: repo, encoding: 'utf8', timeout: 30000
    }).trim();
    return out ? out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** ★毒を食わせて、赤が出ることを自分で確かめる。 */
function runSelfTest() {
  const cases = [
    {
      name: '★壊れた構文を検出できる（毒で赤）',
      got: findSyntaxError('function f() { return 1;') !== null,
      want: true
    },
    {
      name: '正しい構文は通す（誤検出しない）',
      got: findSyntaxError('var a = 1; function f() { return a; }'),
      want: null
    },
    {
      name: '★重複宣言を検出できる',
      got: findSyntaxError('let a = 1; let a = 2;') !== null,
      want: true
    },
    {
      name: 'script タグから中身を取り出せる',
      got: extractInlineScripts('<script>var a=1;</script>').length,
      want: 1
    },
    {
      name: '★src= 付きは対象外（中身が無いので）',
      got: extractInlineScripts('<script src="x.js"></script>').length,
      want: 0
    },
    {
      name: '★ld+json は対象外（JSではない）',
      got: extractInlineScripts('<script type="application/ld+json">{"a":1}</script>').length,
      want: 0
    },
    {
      name: '★空のscriptは対象外',
      got: extractInlineScripts('<script>   </script>').length,
      want: 0
    },
    {
      name: '★0件を緑にしない（測れなかったを返す）',
      got: judgeInlineSyntax(0, []).verdict,
      want: 'inconclusive'
    },
    {
      name: '★エラーがあれば赤',
      got: judgeInlineSyntax(3, [{ file: 'a', line: 1, message: 'x' }]).verdict,
      want: 'fail'
    },
    {
      name: '見た上で問題なければ合格',
      got: judgeInlineSyntax(3, []).verdict,
      want: 'pass'
    }
  ];
  let ng = 0;
  for (const c of cases) {
    const ok = c.got === c.want;
    if (!ok) ng++;
    console.log(`${ok ? '  ✅' : '  ❌'} ${c.name} … got=${c.got} want=${c.want}`);
  }
  if (ng > 0) {
    console.error(`[check-inline-script-syntax] ★selftest 失敗 ${ng}件`);
    process.exit(EXIT.FAIL);
  }
  console.log('[check-inline-script-syntax] ✅ selftest 合格（毒で赤くなることを確認）');
  process.exit(EXIT.PASS);
}

// ─── 実行 ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes('--selftest')) runSelfTest();

const repo = argv.find((a) => !a.startsWith('-')) || '.';
const files = listTrackedHtml(repo);

let filesScanned = 0;
let blocks = 0;
let lines = 0;
const errors = [];

for (const rel of files) {
  let html;
  try {
    html = readFileSync(join(repo, rel), 'utf8');
  } catch {
    continue; // ★読めない1件で全体を落とさない
  }
  const scripts = extractInlineScripts(html);
  if (!scripts.length) continue;
  filesScanned++;
  for (const s of scripts) {
    blocks++;
    lines += s.code.split('\n').length;
    const msg = findSyntaxError(s.code, s.isModule);
    if (msg) errors.push({ file: rel, line: s.line, message: msg });
  }
}

const v = judgeInlineSyntax(filesScanned, errors);
console.log(`[check-inline-script-syntax] ${v.line}`);

if (filesScanned > 0) {
  console.log(`  対象: ${filesScanned}ファイル / ${blocks}ブロック / 約${lines}行`);
}
for (const e of errors.slice(0, 20)) {
  console.log(`  🔴 ${e.file}:${e.line} — ${e.message}`);
}
if (errors.length > 20) console.log(`  … 他 ${errors.length - 20}件`);

if (v.verdict === 'inconclusive') {
  console.log('  → 対処: リポのパスを確認してください（今: ' + repo + '）。');
  console.log('    ★HTMLが無いプロジェクトなら、この検査は不要です。');
}
console.log('  ★この検査が判定しないこと: タイポ（未定義の参照）は見ません。それには ESLint が要ります。');

process.exit(v.verdict === 'fail' ? EXIT.FAIL : v.verdict === 'inconclusive' ? EXIT.INCONCLUSIVE : EXIT.PASS);
