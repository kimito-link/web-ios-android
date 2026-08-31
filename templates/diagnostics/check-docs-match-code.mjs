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
 * run.mjs が走らせる検査の名前を抜き出す。
 *
 * ★なぜ要るか(2026-08-23)
 *   検査を3本足したのに、★公開ページの表には4本しか載っていなかった。
 *   ⟹ 読んだ人は「4本のキット」だと思う＝★足したのに存在しないのと同じ。
 *   ＝ 説明が実装より遅れる、同じ型。
 *
 * @param {string} runSrc
 * @returns {string[]}
 */
export function extractCheckNames(runSrc) {
  const s = String(runSrc || '');
  return [...new Set([...s.matchAll(/name:\s*'([a-z-]+)'/g)].map((m) => m[1]))];
}

/**
 * ★検査名が「説明」に載っているかを判定する（純粋関数）。
 *
 * ★なぜ関数に切り出すか（2026-08-31）:
 *   照合が `<code>名前</code>` という【HTML決め打ち】で書かれていたため、
 *   ★実際に人が読んでチャットに貼る DIAGNOSTICS-HANDOUT.md(Markdown) は
 *   一度も測られず、検査7本と書いたまま実体11本に対して2世代ズレていた。
 *   公開ページ側は緑だったので、ズレは最後まで表に出なかった。
 *
 *   ⟹ ★「説明」は1枚ではない。配る実体が複数あるなら、その全部を測る。
 *
 * ★HTML(`<code>x</code>`)と Markdown(`` `x` ``)の両方の書き方を受け付ける。
 *   ただし【単語の一部での一致は認めない】。
 *   例: `check-selftest-coverage` が載っているだけで
 *       `check-selftest-coverage-extra` を「載っている」と読むと嘘の緑になる。
 *
 * @param {string[]} names run.mjs に登録されている検査名
 * @param {string} docSrc 説明の中身(HTML でも Markdown でもよい)
 * @returns {string[]} ★説明に載っていない検査名
 */
export function findNamesMissingFromDoc(names, docSrc) {
  const list = Array.isArray(names) ? names : [];
  const doc = typeof docSrc === 'string' ? docSrc : '';
  if (doc.trim() === '') return [...list];

  return list.filter((n) => {
    // ★前後が「名前として続かない」ことを確かめる(部分一致で緑にしない)。
    // ★検査名は run.mjs の /name: '([a-z-]+)'/ 由来なので、正規表現の特殊文字は入らない。
    if (!/^[a-z-]+$/.test(n)) return !doc.includes(n);
    const re = new RegExp('(^|[^a-z0-9-])' + n + '([^a-z0-9-]|$)');
    return !re.test(doc);
  });
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

  // ⑤ ★検査名の照合が HTML と Markdown の両方で効くこと(2026-08-31 追加)。
  //    ★これが無かったせいで、配布の実体である DIAGNOSTICS-HANDOUT.md(Markdown)は
  //    照合が `<code>` 決め打ちだったため一度も測られず、2世代ズレたまま配られていた。
  if (findNamesMissingFromDoc(['check-a'], '<code>check-a</code>').length !== 0) {
    fails.push('★HTMLに載っているのに足りないと言う');
  }
  if (findNamesMissingFromDoc(['check-a'], '| `check-a` | 説明 |').length !== 0) {
    fails.push('★Markdownに載っているのに足りないと言う');
  }
  if (findNamesMissingFromDoc(['check-a'], 'なにも載っていない').length !== 1) {
    fails.push('★載っていないものを見逃す');
  }
  // ★部分一致で緑にしない。
  //   ★向きが大事: 説明に【長い名前】だけが載っていて、探すのが【短い名前】のとき、
  //   素朴な includes は「載っている」と読んでしまう(嘘の緑)。
  //   例: 説明に check-a-extra しか無いのに check-a を合格にする。
  if (findNamesMissingFromDoc(['check-a'], '`check-a-extra` だけが載っている').length !== 1) {
    fails.push('★長い名前への部分一致で「載っている」ことにしている');
  }
  // ★説明が空＝測れていない。「全部載っている」と読んではいけない
  if (findNamesMissingFromDoc(['check-a'], '').length !== 1) {
    fails.push('★空の説明を緑にしている');
  }
  if (findNamesMissingFromDoc(/** @type {any} */ (null), /** @type {any} */ (null)).length !== 0) {
    fails.push('★壊れた入力で throw する');
  }

  if (fails.length) {
    console.error('[check-docs-match-code] ★selftest 失敗:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log(
    '[check-docs-match-code] selftest OK'
    + '(多階層を繋ぐ / ★説明に無いパスを見つける / 載っていれば通す / ★0件を緑にしない'
    + ' / ★HTMLとMarkdownの両方で検査名を照合する)'
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

  const doc = readFileSync(docPath, 'utf8');
  const v = judgeDocsMatchCode({ codeSrc: readFileSync(codePath, 'utf8'), docSrc: doc });
  if (!v.measured) {
    console.error(`[check-docs-match-code] ★測れませんでした: ${v.reason}`);
    process.exit(2);
  }

  // ★検査そのものが表に載っているかも見る。
  //   2026-08-23: 検査を3本足したのに表は4本のままだった＝読んだ人には存在しない。
  const runPath = join(__dirname, 'run.mjs');
  const names = existsSync(runPath) ? extractCheckNames(readFileSync(runPath, 'utf8')) : [];

  // ★「説明」は1枚ではない。★配る実体を全部見る(2026-08-31)。
  //   公開ページ(HTML)だけを見ていたため、実際に人がチャットへ貼る
  //   DIAGNOSTICS-HANDOUT.md(Markdown)が【一度も測られず】検査7本のまま
  //   実体11本に対して2世代ズレて配られていた。公開ページは緑なので気づけなかった。
  const DOCS = [
    { label: '公開ページ', path: docPath, src: doc },
    ...['DIAGNOSTICS-HANDOUT.md', 'templates/diagnostics/README.md']
      .map((rel) => ({ label: rel, path: join(root, rel) }))
      .filter((d) => existsSync(d.path))
      .map((d) => ({ ...d, src: readFileSync(d.path, 'utf8') })),
  ];

  const missingByDoc = names.length === 0 ? [] : DOCS
    .map((d) => ({ label: d.label, missing: findNamesMissingFromDoc(names, d.src) }))
    .filter((r) => r.missing.length > 0);
  const missingNames = missingByDoc.flatMap((r) => r.missing);

  console.log(`[check-docs-match-code] 探す場所 ${v.total} 件 / 説明に無い ${v.missing.length} 件`);
  if (names.length > 0) {
    console.log(
      `[check-docs-match-code] 検査 ${names.length} 本 / 説明 ${DOCS.length} 枚`
      + ` / 載っていない ${missingNames.length} 件`
    );
    for (const r of missingByDoc) {
      for (const n of r.missing) console.log(`  ⚪ ${n} — ${r.label} に載っていない`);
    }
  }
  for (const p of v.missing) console.log(`  ⚪ ${p}`);

  if (v.missing.length > 0 || missingNames.length > 0) {
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
