#!/usr/bin/env node
/**
 * ネイティブアプリ内に「アプリ外の購入・相談導線」が残っていないかを機械的に突合する。
 *
 * 【なぜ要るか】2026-08-17 作成
 * 「CTAコンポーネントにガードを入れれば全部塞がる」と考えて**10回**取りこぼした。
 * 毎回、同じ意味の導線が**別実装**（直書きの <a>/<Link>、別コンポーネント、
 * データ配列、フッター、FAQ末尾…）で存在していた。
 *
 * 目視と grep では「自分が知っている言葉」しか見つからない。
 * このスクリプトは逆向きに走る:
 *   **「購入・相談を示す文言やリンクを持つファイル」を全部列挙し、
 *     そこにネイティブ判定があるかを突合する。**
 * 判定が無いファイルは「要確認」として出す。誤検知は許容し、見落としを潰す。
 *
 * 使い方:
 *   node audit-native-cta.mjs <対象ディレクトリ...>
 * 例:
 *   node audit-native-cta.mjs apps/web/components apps/web/app
 */

import fs from 'node:fs';
import path from 'node:path';

/** 購入・相談導線を示す痕跡。1つでもあれば「導線を持つファイル」とみなす */
const CTA_SIGNS = [
  /lin\.ee|line\.me/i,                       // LINE
  /buy\.stripe|checkout\.stripe|paymentLink|createCheckout/i, // 決済
  /\/contact\/?\?topic=/,                    // 有償役務の受注フォーム
  /相談する|依頼する|申し込む|申込|購入する/,   // 受注CTAの文言
  /月額|円\/月|プラン|継続監視/,              // 価格・サブスク
];

/** ネイティブ判定の痕跡（呼び名はリポで違うので広めに） */
const GUARD = /isNativeApp|isNativePlatform|isCapacitorNative|window\.Capacitor/;

const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SKIP = new Set([
  'node_modules', '.next', 'dist', 'build', '.vercel', '.claude',
  'android', 'ios', 'worktrees', '.git', '__tests__',
]);

const flagged = [];
const guarded = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) walk(full);
      continue;
    }
    if (!EXTS.has(path.extname(e.name))) continue;
    if (/\.(test|spec)\.[jt]sx?$/.test(e.name)) continue;

    let body;
    try {
      body = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    // コメント行を除いた本文だけで判定（説明コメントに反応しないため）
    const code = body
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');

    const hit = CTA_SIGNS.find((re) => re.test(code));
    if (!hit) continue;

    const rel = path.relative(process.cwd(), full).split(path.sep).join('/');
    if (GUARD.test(code)) guarded.push(rel);
    else flagged.push({ file: rel, sign: String(hit) });
  }
}

for (const root of process.argv.slice(2)) walk(root);

console.log(`\n✅ ガードあり: ${guarded.length} ファイル`);
for (const g of guarded) console.log(`   ${g}`);

console.log(`\n⚠️ 要確認（導線の痕跡があるがネイティブ判定が無い）: ${flagged.length} ファイル`);
for (const f of flagged) console.log(`   ${f.file}\n      ← ${f.sign}`);

console.log(
  `\n※ 誤検知は前提。「価格を説明しているだけ」「サポート窓口」等は残してよい。` +
    `\n  判断の基準は「アプリの外で買える・頼めると分かるか」。` +
    `\n  ★このスクリプトは見落としを潰すためのもので、緑＝安全ではない。` +
    `\n  最終確認は window.Capacitor を注入した実測で行うこと。`,
);
