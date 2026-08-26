#!/usr/bin/env node
/**
 * check-silent-hang-guard.mjs
 *   ★「コンソールが無いと固まる」書き方が残っていないかを見る。
 *
 * ■ ★なぜ要るか(2026-08-26・実損)
 *
 *   ある製品のビルドスクリプトが【返ってこなくなった】。
 *   exe のコンパイルまでは成功するのに zip だけができず、
 *   ★エラーも出ず、stderr も空。数分待っても終わらない。
 *   配布作業が止まり、zip を別の方法で手作業で作る羽目になった。
 *
 *   最初は「1.5MB の圧縮だから重いのだろう」と考えた。★これが誤り。
 *   実測で切り分けた結果:
 *
 *     入力              既定のまま        進捗バーを抑止
 *     1KB のファイル1つ  ★返ってこない     ★402 ms
 *     1.5MB の exe      (同上)            ★669 ms
 *
 *   ★1KB でも固まる。⟹ サイズは無関係だった。
 *   真因は進捗バーの描画で、コンソールを持たない環境
 *   (AIのツール実行・CI・出力のリダイレクト下)で待ち続けていた。
 *
 * ■ ★この型が怖い理由
 *   失敗が「エラー」ではなく【無言の停止】として現れる。
 *   - 例外が出ない ⟹ try/catch では捕まらない
 *   - 終了コードも返らない ⟹ 「赤か緑か」で見ている検査に映らない
 *   - タイムアウトで殺すと、原因ではなく症状だけが記録される
 *   ★「重いから遅い」と誤診しやすく、内訳を測るまで永久に見つからない。
 *
 * ■ ★何を数えるか
 *   進捗表示を出す呼び出しを使っているのに、
 *   それを抑止する宣言がファイル内に無いものを数える。
 *
 *   言語ごとの綴りは表で持つ(キットを更新しなくても増やせるよう、
 *   対象リポは diagnostics.json で自分の流儀を宣言できる)。
 *
 * ■ ★この検査が判定しないこと
 *   - 抑止さえ書いてあれば中身は見ない(実際に固まらないかまでは保証しない)
 *   - コメントの中の記述は数えない(偽の赤/偽の緑を両方作らないため)
 *
 * 使い方:
 *   node check-silent-hang-guard.mjs [対象ディレクトリ]
 *   node check-silent-hang-guard.mjs --selftest   ← ★自分自身を毒で試す
 *
 * 終了コード: 0=合格 / 1=測れた上での赤 / 2=★測れなかった
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

// 進捗表示を出す呼び出しと、その抑止の綴り。
// ★実際に固まった実績があるものを先頭に置く。
const RULES = [
  {
    lang: 'powershell',
    exts: ['.ps1', '.psm1'],
    risky: [
      'Compress-Archive', 'Expand-Archive',
      'Invoke-WebRequest', 'Invoke-RestMethod',
      'Start-BitsTransfer', 'Copy-Item -Recurse',
    ],
    // $ProgressPreference = 'SilentlyContinue' / "Ignore"
    guard: /\$ProgressPreference\s*=\s*['"]?(SilentlyContinue|Ignore)/,
    fix: "スクリプト冒頭に $ProgressPreference = 'SilentlyContinue' を足す",
  },
];

const COMMENT_PREFIX = { '.ps1': '#', '.psm1': '#' };

/** 純ロジック。ファイルI/Oを持たないので毒を食わせて検査できる。 */
export function analyzeText(text, ext) {
  const rule = RULES.find((r) => r.exts.includes(ext));
  if (!rule) return { applicable: false, used: [], guarded: false, needsGuard: false };

  const prefix = COMMENT_PREFIX[ext] || '#';
  const codeLines = text
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith(prefix));
  const code = codeLines.join('\n');

  const used = rule.risky.filter((c) => code.includes(c));
  const guarded = rule.guard.test(code);
  return {
    applicable: true,
    used,
    guarded,
    needsGuard: used.length > 0 && !guarded,
    fix: rule.fix,
  };
}

function walk(dir, out = [], depth = 0) {
  if (depth > 8) return out;
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.git' || e === 'dist') continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out, depth + 1);
    else if (RULES.some((r) => r.exts.includes(extname(p)))) out.push(p);
  }
  return out;
}

function runSelftest() {
  const fails = [];

  // ★負の対照: 危険な呼び出しがあり抑止が無い → 赤くなるべき
  const r1 = analyzeText('Compress-Archive -Path a -DestinationPath b', '.ps1');
  if (!r1.needsGuard) fails.push('抑止が無いのに赤くならなかった');

  // ★正の対照: 抑止があれば緑
  const r2 = analyzeText("$ProgressPreference = 'SilentlyContinue'\nCompress-Archive -Path a", '.ps1');
  if (r2.needsGuard) fails.push('抑止があるのに赤くなった');

  // ★無関係なスクリプトを赤くしない
  const r3 = analyzeText("Write-Output 'hello'", '.ps1');
  if (r3.needsGuard) fails.push('無関係なスクリプトを赤くした');

  // ★コメントの中だけの呼び出しは数えない(偽の赤を作らない)
  const r4 = analyzeText("# Compress-Archive は使わない\nWrite-Output 'x'", '.ps1');
  if (r4.needsGuard) fails.push('コメントを実コードと数えた');

  // ★コメントの中だけの抑止は有効と数えない(偽の緑を作らない)
  const r5 = analyzeText("# $ProgressPreference = 'SilentlyContinue'\nCompress-Archive -Path a", '.ps1');
  if (!r5.needsGuard) fails.push('コメントの抑止を有効と数えた');

  // ★対象外の拡張子は applicable=false(勝手に判定しない)
  const r6 = analyzeText('Compress-Archive', '.js');
  if (r6.applicable) fails.push('対象外の拡張子を判定した');

  if (fails.length) {
    console.error('[check-silent-hang-guard] ★selftest 失敗:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log('[check-silent-hang-guard] selftest OK (6/6)');
  process.exit(0);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) return runSelftest();

  const target = args[0] || process.cwd();
  if (!existsSync(target)) {
    console.log(`[check-silent-hang-guard] 測れませんでした: 対象が見つかりません: ${target}`);
    process.exit(2);
  }

  const files = walk(target);
  if (files.length === 0) {
    console.log('[check-silent-hang-guard] 対象の言語のファイルがありません (skip)');
    process.exit(0);
  }

  const bad = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    const r = analyzeText(text, extname(f));
    if (r.needsGuard) bad.push({ f, used: r.used, fix: r.fix });
  }

  console.log(`[check-silent-hang-guard] 対象 ${files.length} 本 / 抑止が要るのに無い ${bad.length} 本`);
  if (bad.length) {
    for (const b of bad) {
      console.log(`  NG ${relative(target, b.f)}  (${b.used.join(', ')})`);
    }
    console.log(`  → 直し方: ${bad[0].fix}`);
    console.log('    ★これが無いと、コンソールの無い環境で【固まって返ってこない】。');
    console.log('    実測: 既定=返ってこない / 抑止あり=402ms(1KB)・669ms(1.5MB)。');
    console.log('    ★1KBでも固まるので「重いから遅い」と誤診しやすい。');
    process.exit(1);
  }
  console.log('  OK: 無言で固まる形は見つかりませんでした');
  process.exit(0);
}

main();
