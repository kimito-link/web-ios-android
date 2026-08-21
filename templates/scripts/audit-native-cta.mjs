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
 * 【★9回目の検証で判明した、より深い取りこぼしの型（2026-08-17）】
 * 「リンク元のCTAを隠す」だけでは足りない。**遷移先のルート自体**を塞ぐ必要がある。
 *   Capacitor が server.url + allowNavigation: ['example.com', '*.example.com'] の
 *   リモート読込型だと、**ドメイン全体がアプリ内で到達可能**。
 *   リンクを隠してもURL直打ち・内部遷移・外部からの戻りで開けてしまう。
 *   実例: /contact（受注フォーム）と /monitor/connect（申込フォーム）が
 *         8回の修正すべてで対象外のまま残っていた。
 *
 * → components だけでなく **app/ 配下のルート定義も必ず走査対象に含める**こと。
 *   さらに「そのページは丸ごと購入・受注導線ではないか」を目で確認する。
 *   ページ自体が導線なら、CTAを隠すのではなく**ルートごと塞ぐ**
 *   （deny-list 方式の実例: partnership_program_website の
 *    client/src/lib/authRoutes.ts の NATIVE_AUTH_PRIVATE_PREFIXES）。
 *
 * 使い方:
 *   node audit-native-cta.mjs <対象ディレクトリ...>
 * 例:
 *   node audit-native-cta.mjs apps/web/components apps/web/app apps/web/lib
 *
 * ★引数を渡し忘れると exit 2 で落ちる（0件の偽の緑を防ぐため）。
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

/*
 * ★--selftest: 検知器に毒を食わせ、赤が出ることを確認する。
 *
 * ■ なぜ要るか
 *   このスクリプトは「見落としを潰す」ためのものだが、
 *   ★**検知器自身が壊れると、静かに全部通す**(0件＝緑に見える)。
 *   2026-08-17 に踏んだ「引数なしの偽の緑」と同じ型で、
 *   今度は**正規表現が効かなくなる**形で起きうる。そのときは誰も気づけない。
 *
 * ■ 何を確かめるか
 *   1. 導線の痕跡を★検知できるか(できなければ検知器が死んでいる)
 *   2. ネイティブ判定を★認識できるか(できないと全部が「要確認」になり読まれなくなる)
 *
 * ★毒はメモリ上の文字列だけ。ファイルを触らないので原状復帰が要らない
 *   (原状復帰の要る毒は、失敗時に本体を壊す危険がある)。
 */
if (process.argv.includes('--selftest')) {
  const fails = [];
  // (1) 検知できるべきもの: CTA_SIGNS のどれかに当たること
  const shouldFlag = '相談する はこちら / 月額 3,000円';
  if (!CTA_SIGNS.some((re) => re.test(shouldFlag))) {
    fails.push('導線の痕跡を検知できない(CTA_SIGNS が効いていない)');
  }
  // (2) ネイティブ判定を認識できること
  const nativeLine = 'const native = window.Capacitor?.isNativePlatform?.();';
  if (!GUARD.test(nativeLine)) {
    fails.push('ネイティブ判定を認識できない(GUARD が効いていない)');
  }
  // (3) 無関係な文字列を拾わないこと(誤検知だらけだと読まれなくなる)
  if (CTA_SIGNS.some((re) => re.test('export function formatDate(d) { return d; }'))) {
    fails.push('無関係なコードを導線として誤検知している');
  }
  if (fails.length) {
    console.error('\n❌ selftest 失敗(検知器が効いていません):');
    for (const f of fails) console.error('   - ' + f);
    process.exit(1);
  }
  console.log('✅ selftest OK(痕跡を検知する / ネイティブ判定を認識する / 誤検知しない)');
  process.exit(0);
}

const roots = process.argv.slice(2);

// ★引数ゼロで「0件＝緑」に見える罠を塞ぐ（2026-08-17 に実際に踏んだ）。
// 走査対象を渡し忘れると何も歩かず「✅ 0件 / ⚠️ 0件」と出て、
// **審査対策が終わったように見えてしまう**。件数0の緑こそ最も危険。
if (roots.length === 0) {
  console.error(
    `\n❌ 走査対象のディレクトリが指定されていません。\n` +
      `   引数なしでは何も検査せず「0件」と表示され、緑と誤読されます。\n\n` +
      `   例: node audit-native-cta.mjs apps/web/components apps/web/app apps/web/lib\n`,
  );
  process.exit(2);
}

let walked = 0;
for (const root of roots) {
  if (!fs.existsSync(root)) {
    console.error(`❌ 指定されたパスが存在しません: ${root}`);
    process.exit(2);
  }
  walk(root);
  walked += 1;
}

// 対象は在るのに1ファイルも読めていない場合も緑にしない。
if (guarded.length === 0 && flagged.length === 0) {
  console.error(
    `\n❌ ${walked} 個のパスを走査しましたが、対象ファイル(.ts/.tsx/.js/.jsx)を1件も検出できませんでした。` +
      `\n   パスの指定ミスの可能性があります。「0件だから安全」と読まないでください。\n`,
  );
  process.exit(2);
}

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
