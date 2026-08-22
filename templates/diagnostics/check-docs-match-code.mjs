#!/usr/bin/env node
/**
 * check-docs-match-code.mjs — ★「説明した置き場所」と「コードが実際に探す場所」を突き合わせる。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか(2026-08-23 ユーザー指摘)
 *
 *   「これは自分以外の人にもルールとして分かるようにLPに記載すべきですね」
 *
 *   ★そのとおりだった。置き場所の決まりは【AIの発言の中にしか無く】、
 *   公開ページには1文字も書かれていなかった(「ディレクトリ」0件・「ai-hub」0件)。
 *   ⟹ ★渡された人は、なぜ動かないのか永久に分からない。
 *
 * ■ ★しかし「書いた」だけでは、もっと悪くなることがある
 *   このリポの実損記録:
 *     ・紹介LPの版数4箇所だけが最新で、★本文は242版前だった
 *     ・引き継ぎ文書に存在しないパスが書かれ、受け取った人が詰まった
 *   ⟹ ★説明はコードより先に腐る。腐った説明は、無い説明より高くつく。
 *
 * ■ ★だから「書く」と同時に「ズレたら鳴る」を置く
 *   コードが探すパスを★コードから抜き出し、
 *   ページにそのパスが書かれているかを突き合わせる。
 *   ★人が両方を直したかどうかに依存しない。
 *
 * ■ ★この検査が判定しないこと
 *   説明が【分かりやすいか】は判定しない。
 *   ★パスが載っているかだけを見る(載っていても説明が嘘なら分からない)。
 *
 * ■ 3値の終了コード
 *   0 = 合格 / 1 = ★ズレている / 2 = ★測れなかった
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 使い方:
 *   node check-docs-match-code.mjs [キットのルート]
 *   node check-docs-match-code.mjs --selftest
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * ソースから「探す場所」を抜き出す。
 *
 * ★対象は join(base, ...) の形だけ。★変数を渡している所は拾わない
 *   (拾えないものを「無い」と言わないため)。
 *
 * @param {string} src
 * @returns {string[]}
 */
export function extractSearchPaths(src) {
  const s = String(src || '');
  const out = [];
  const re = /join\(base,\s*'([^']+)'(?:\s*,\s*'([^']+)')?(?:\s*,\s*'([^']+)')?\)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    out.push([m[1], m[2], m[3]].filter(Boolean).join('/'));
  }
  return [...new Set(out)];
}

/**
 * @typedef {object} DocsMatchVerdict
 * @property {boolean} measured
 * @property {string[]} missing ★コードにあるのに説明に無いパス
 * @property {number} total
 * @property {string} reason
 */

/**
 * @param {object} input
 * @param {string} [input.codeSrc]
 * @param {string} [input.docSrc]
 * @returns {DocsMatchVerdict}
 */
export function judgeDocsMatchCode(input) {
  const code = input?.codeSrc;
  const doc = input?.docSrc;
  if (typeof code !== 'string' || code.length === 0) {
    return { measured: false, missing: [], total: 0, reason: '★コードが読めません' };
  }
  if (typeof doc !== 'string' || doc.length === 0) {
    return { measured: false, missing: [], total: 0, reason: '★説明が読めません' };
  }
  const paths = extractSearchPaths(code);
  if (paths.length === 0) {
    // ★0件は「ズレていない」ではない。書き方が変わった可能性がある。
    return { measured: false, missing: [], total: 0, reason: '★探す場所を1件も抜き出せません' };
  }
  const missing = paths.filter((p) => !doc.includes(p));
  return {
    measured: true,
    missing,
    total: paths.length,
    reason: `${paths.length} 件中 ${paths.length - missing.length} 件が説明に載っています`
  };
}

/** ★自分自身を毒で試す。 */
function runSelftest() {
  const fails = [];
  const code = "join(base, 'src/lib/a.js'), join(base, '..', 'ai-hub', 'index.json')";

  // ① 抜き出せること(多階層も1本に繋ぐ)
  const got = extractSearchPaths(code);
  if (!got.includes('src/lib/a.js')) fails.push('★1階層を拾えない');
  if (!got.includes('../ai-hub/index.json')) fails.push('★多階層を繋げない');

  // ② ★説明に無いものを見つけること
  const v = judgeDocsMatchCode({ codeSrc: code, docSrc: '<p>src/lib/a.js</p>' });
  if (!v.measured) fails.push('★測れたのに測れないと言う');
  if (v.missing.join() !== '../ai-hub/index.json') {
    fails.push('★足りないパスの判定が違う: ' + v.missing.join());
  }

  // ③ 両方載っていれば合格
  const ok = judgeDocsMatchCode({ codeSrc: code, docSrc: 'src/lib/a.js と ../ai-hub/index.json' });
  if (ok.missing.length !== 0) fails.push('★載っているのに足りないと言う');

  // ④ ★測れないときに合格と言わないこと
  if (judgeDocsMatchCode({ codeSrc: 'const x=1;', docSrc: 'あ' }).measured) {
    fails.push('★0件を測れたことにしている');
  }
  if (judgeDocsMatchCode({ codeSrc: code, docSrc: '' }).measured) {
    fails.push('★説明が無いのに測れたことにしている');
  }
  if (judgeDocsMatchCode(/** @type {any} */ (null)).measured) fails.push('★null を測れたことにしている');

  if (fails.length) {
    console.error('[check-docs-match-code] ★selftest 失敗:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log(
    '[check-docs-match-code] selftest OK'
    + '(多階層を繋ぐ / ★説明に無いパスを見つける / 載っていれば通す / ★0件を緑にしない)'
  );
  process.exit(0);
}

function main() {
  if (process.argv.includes('--selftest')) return runSelftest();

  const root = process.argv.slice(2).find((a) => !a.startsWith('--'))
    || join(__dirname, '..', '..');
  const codePath = join(__dirname, 'check-symptom-index.mjs');
  const docPath = join(root, 'site/features/health-check/index.html');

  if (!existsSync(codePath) || !existsSync(docPath)) {
    console.error('[check-docs-match-code] ★測れませんでした: 突き合わせる相手が見つかりません');
    console.error(`  コード: ${codePath} ${existsSync(codePath) ? '' : '★無い'}`);
    console.error(`  説明:   ${docPath} ${existsSync(docPath) ? '' : '★無い'}`);
    process.exit(2);
  }

  const v = judgeDocsMatchCode({
    codeSrc: readFileSync(codePath, 'utf8'),
    docSrc: readFileSync(docPath, 'utf8')
  });
  if (!v.measured) {
    console.error(`[check-docs-match-code] ★測れませんでした: ${v.reason}`);
    process.exit(2);
  }

  console.log(`[check-docs-match-code] 探す場所 ${v.total} 件 / 説明に無い ${v.missing.length} 件`);
  for (const p of v.missing) console.log(`  ⚪ ${p}`);

  if (v.missing.length > 0) {
    console.error('[check-docs-match-code] 🔴 コードが探す場所が、説明に載っていません。');
    console.error('  → 直し方: 公開ページの「どこに置くか」の表に、上のパスを足してください。');
    console.error('    ★渡された人は、載っていない場所を推測できません。');
    console.error('  → ★この検査が判定しないこと: 説明が分かりやすいかは見ません。');
    process.exit(1);
  }
  console.log('[check-docs-match-code] ✅ 合格(説明とコードが一致)。');
  process.exit(0);
}

main();
