#!/usr/bin/env node
/**
 * check-selftest-coverage.mjs — ★「サボると赤くなるか」を確かめていない検査を数える。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか(2026-08-23・実損)
 *
 *   このキットの掟はこう書いてある:
 *     「仕掛けが生き残るかは【サボると赤くなるか】で決まる」
 *
 *   ★ところがキット自身の診断3本が、その掟を破っていた。
 *     check-large-tracked-files / check-lockfile-sync / check-secrets-not-tracked
 *     → コード内に "selftest" の語が ★0件。
 *     → `--selftest` を渡しても【引数が無視され】普通に走り、
 *       対象が無ければ "skip" と出して ★終了コード0 を返す。
 *
 *   ★つまり「壊れていても緑に見える」。
 *   ★私(AI)は実際にこれで一度だまされ、「selftest ✅」と3件並べて報告した。
 *     終了コードだけを見て判定したため。
 *
 * ■ ★なぜ「個別に足す」で終わらせないか
 *   3本に手で足すのは、★次に4本目を作った人が忘れたら終わり。
 *   このキットの失敗型そのもの:
 *     「人が手で書く登録簿は必ず死ぬ」
 *     「機械が見ている所だけが動く」
 *   ⟹ ★機械が数える。増えたら赤くなる。
 *
 * ■ ★なぜ「100%必須」にしないか(強制しない)
 *   いきなり全部必須にすると、通すためだけの★空のselftest
 *   (`if(selftest) process.exit(0)`)が書かれる。それは検査ではない。
 *   ⟹ ★ベースライン＋ラチェット。いまの欠落数を上限として固定し、
 *     ★増えたときだけ赤くする。減らすのは自由。
 *
 * ■ 3値の終了コード(このキットの掟)
 *   0 = 合格
 *   1 = ★測れた上での赤(欠落が増えた)
 *   2 = ★測れなかった(対象が見つからない等)
 *   ★2を0に混ぜないこと。「測っていない」を「異常なし」と言わないため。
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 使い方:
 *   node check-selftest-coverage.mjs [対象ディレクトリ]
 *   node check-selftest-coverage.mjs --selftest   ← ★自分自身を毒で試す
 */

import { readFileSync, existsSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * ★ここを超えて「selftest を持たない検査」が増えたら赤。
 *   2026-08-23 時点の実測値。★減らすのは自由・増やすときは理由を書く。
 */
export const KNOWN_MISSING_SELFTEST_MAX = 3;

/** 検査だと見なすファイル名の形。 */
const CHECK_FILE_RE = /^(check|verify|audit|lint)-.*\.mjs$/;

/**
 * ソースが「本物の selftest を持っている」と言えるか。
 *
 * ★名前だけを見ない(Detect the SHAPE, not one function name)。
 *   ★「selftest という語がある」だけなら、コメントで書いただけでも通ってしまう。
 *   ⟹ ★引数を実際に読んでいること + 分岐していること の両方を見る。
 *
 * @param {string} src
 * @returns {{ has: boolean, why: string }}
 */
export function judgeSelftestPresence(src) {
  const s = String(src || '');
  // ★コメントを除いた「実際に動くコード」だけで判定する。
  //   コメントに書いただけで✔が取れる穴を塞ぐ(このキットが過去に踏んだ型)。
  const code = s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  const readsArgv = /process\.argv/.test(code);
  const mentions = /selftest/i.test(code);
  if (!mentions) return { has: false, why: 'selftest の分岐が無い' };
  if (!readsArgv) return { has: false, why: 'selftest と書いてあるが引数を読んでいない' };
  return { has: true, why: 'selftest の分岐がある' };
}

/**
 * 対象ディレクトリの検査ファイルを調べる。
 *
 * @param {string} dir
 * @returns {{ ok: boolean, total: number, missing: string[], reason: string }}
 */
export function scanDirectory(dir) {
  if (!dir || !existsSync(dir)) {
    return { ok: false, total: 0, missing: [], reason: `対象が見つからない: ${dir}` };
  }
  /** @type {string[]} */
  const missing = [];
  let total = 0;
  for (const name of readdirSync(dir)) {
    if (!CHECK_FILE_RE.test(name)) continue;
    if (name === basename(new URL(import.meta.url).pathname)) continue; // 自分は除く
    total += 1;
    const src = readFileSync(join(dir, name), 'utf8');
    if (!judgeSelftestPresence(src).has) missing.push(name);
  }
  if (total === 0) {
    // ★「検査が1本も無い」は合格ではない。測れなかった(コード2)。
    return { ok: false, total: 0, missing: [], reason: '検査ファイルが1本も見つからない' };
  }
  return { ok: true, total, missing, reason: '' };
}

/** ★自分自身を毒で試す。サボると赤くなることを、この場で実演する。 */
function runSelftest() {
  const fails = [];

  // ① コメントだけの selftest を「持っている」と言わないこと
  const commentOnly = '// selftest を書くつもり\nconsole.log(1);';
  if (judgeSelftestPresence(commentOnly).has) fails.push('★コメントだけで✔が取れてしまう');

  // ② 語はあるが引数を読まない＝無視される形を見抜くこと(★今回の実損そのもの)
  const ignoresArg = 'const selftest = false;\nconsole.log("run");';
  if (judgeSelftestPresence(ignoresArg).has) fails.push('★引数を読まない形を本物と誤認する');

  // ③ 本物は通すこと(退化させない)
  const real = 'if (process.argv.includes("--selftest")) { runSelftest(); }';
  if (!judgeSelftestPresence(real).has) fails.push('★本物の selftest を見落とす');

  // ④ 対象が無いときに「合格」と言わないこと(★2を0に混ぜない)
  const none = scanDirectory(join(tmpdir(), 'nl-selftest-not-exist-' + Date.now()));
  if (none.ok) fails.push('★存在しないディレクトリを合格にしている');

  // ⑤ 検査0本のディレクトリを合格にしないこと
  const empty = mkdtempSync(join(tmpdir(), 'nl-selftest-empty-'));
  writeFileSync(join(empty, 'readme.txt'), 'x');
  if (scanDirectory(empty).ok) fails.push('★検査0本を合格にしている');

  if (fails.length) {
    console.error('[check-selftest-coverage] ★selftest 失敗:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log(
    '[check-selftest-coverage] selftest OK'
    + '(コメントだけを✔にしない / ★引数を読まない形を見抜く / 本物は通す / 0件を緑にしない)'
  );
  process.exit(0);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) return runSelftest();

  const dir = args.find((a) => !a.startsWith('--'))
    || join(process.cwd(), 'templates/diagnostics');
  const res = scanDirectory(dir);

  if (!res.ok) {
    // ★測れなかった＝コード2。合格(0)にも赤(1)にも混ぜない。
    console.error(`[check-selftest-coverage] ★測れませんでした: ${res.reason}`);
    console.error('  → 対処: 対象ディレクトリを引数で渡してください。');
    process.exit(2);
  }

  const n = res.missing.length;
  console.log(`[check-selftest-coverage] 検査 ${res.total} 本 / selftest 欠落 ${n} 本`);
  for (const m of res.missing) console.log(`  ⚪ ${m}`);

  if (n > KNOWN_MISSING_SELFTEST_MAX) {
    console.error(
      `[check-selftest-coverage] 🔴 欠落が ${KNOWN_MISSING_SELFTEST_MAX} 本を超えました(${n} 本)。`
    );
    console.error('  → 直し方: 新しい検査には --selftest を付ける('
      + 'わざと壊れた入力を食わせて【赤くなること】を確かめる枝)。');
    console.error('  → ★この検査が判定しないこと: selftest の中身が正しいかは見ません。'
      + '空の selftest を書けば通ります(それは検査ではありません)。');
    process.exit(1);
  }

  if (n > 0) {
    console.log(`[check-selftest-coverage] ✅ 合格(既知の欠落 ${n}/${KNOWN_MISSING_SELFTEST_MAX} 本)。`);
    console.log('  ★減らすのは自由です。減らしたら上限も下げてください。');
  } else {
    console.log('[check-selftest-coverage] ✅ 合格(欠落なし)。★上限を0に下げてください。');
  }
  process.exit(0);
}

main();
