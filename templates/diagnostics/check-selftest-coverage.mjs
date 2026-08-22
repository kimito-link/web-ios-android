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
// ★対象にする検査ファイル。拡張子を .mjs に固定していたため、
//   PowerShell で書かれたゲートは【1本も見えていなかった】(2026-08-23実測:
//   soushin-suggest の11本中6本が .ps1 で、まるごと対象外だった)。
//   ★言語が増えるたびキットを直す形にしない。ここに足すだけで済むようにする。
const CHECK_FILE_RE = /^(check|verify|audit|lint)-.*\.(mjs|js|ps1)$/;
const kindOfFile = (name) => (/\.ps1$/i.test(name) ? 'ps1' : 'js');

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
export function judgeSelftestPresence(src, kind) {
  const s = String(src || '');
  // ★コメントを除いた「実際に動くコード」だけで判定する。
  //   コメントに書いただけで✔が取れる穴を塞ぐ(このキットが過去に踏んだ型)。
  //   ★PowerShell は # 始まりがコメントなので、そちらも落とす。
  const code = (kind === 'ps1')
    ? s.replace(/^\s*#.*$/gm, ' ')
    : s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  // ★「引数を読んでいる」の綴りは言語ごとに違う。
  //   ここを JS 固定にしていたため、PowerShell のゲートは
  //   ★中身がどれだけ立派でも常に「欠落」に数えられていた(2026-08-23実測)。
  //   言語が増えるたびキットを直す設計は腐るので、綴りを表で持つ。
  const readsArgv = (kind === 'ps1')
    ? /\[switch\]\s*\$SelfTest|\$SelfTest\b|\$args\b|param\s*\(/i.test(code)
    : /process\.argv/.test(code);

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
export function scanDirectory(dir, filePattern) {
  if (!dir || !existsSync(dir)) {
    return { ok: false, total: 0, missing: [], reason: `対象が見つからない: ${dir}` };
  }
  // ★対象リポが「どれがゲートか」を宣言していれば、それに絞る。
  //   なぜ要るか(2026-08-23実測): 拡張子を広げた途端、対象リポの
  //   verify-*.ps1 が70本まとめて「欠落」に数えられた。
  //   ★しかしそれらは【製品を起動して測るプローブ】であって、
  //   校正は毒フィクスチャで行う。--selftest を要求すると
  //   ★通すためだけの空のselftestを書かせることになり、このキットの掟に反する。
  //   ⟹ 種類が違うものを同じ物差しで測らない。宣言が無ければ従来どおり全部見る。
  const re = filePattern instanceof RegExp ? filePattern : CHECK_FILE_RE;
  /** @type {string[]} */
  const missing = [];
  let total = 0;
  for (const name of readdirSync(dir)) {
    if (!re.test(name)) continue;
    if (name === basename(new URL(import.meta.url).pathname)) continue; // 自分は除く
    total += 1;
    const src = readFileSync(join(dir, name), 'utf8');
    if (!judgeSelftestPresence(src, kindOfFile(name)).has) missing.push(name);
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

  // ③-b ★PowerShell も同じ4枝で判定できること。
  //   ここが無いと、.ps1 を対象に加えた変更が【一度も試されないまま】入る
  //   ＝この検査自身が「サボると赤くなるか」を守れていない状態になる。
  const psReal = 'param([switch]$SelfTest)\nif ($SelfTest) { Invoke-SelfTest }';
  if (!judgeSelftestPresence(psReal, 'ps1').has) fails.push('★PowerShellの本物を見落とす');

  const psCommentOnly = '# 自己検査は check-foo.ps1 -SelfTest で走る\nWrite-Output 1';
  if (judgeSelftestPresence(psCommentOnly, 'ps1').has) fails.push('★PowerShellのコメントだけで✔が取れる');

  const psNoBranch = 'param([string]$In)\nWrite-Output $In';
  if (judgeSelftestPresence(psNoBranch, 'ps1').has) fails.push('★selftestが無いPowerShellを本物と誤認する');

  // ★JSの綴りでPowerShellを判定しないこと(逆も同じ)。
  //   process.argv はPowerShellには無いので、これを根拠に通してはいけない。
  const psJsSpelling = '# selftest\n$x = "process.argv"\nWrite-Output $x';
  if (judgeSelftestPresence(psJsSpelling, 'ps1').has) fails.push('★JSの綴りでPowerShellを通している');

  // ③-c ★宣言された形だけに絞れること。種類の違うものを同じ物差しで測らない。
  const mixed = mkdtempSync(join(tmpdir(), 'nl-selftest-mixed-'));
  writeFileSync(join(mixed, 'check-a.ps1'), 'param([switch]$SelfTest)\nif($SelfTest){}');
  writeFileSync(join(mixed, 'verify-b.ps1'), 'Write-Output "製品を起動して測るプローブ"');
  const all = scanDirectory(mixed);
  if (all.total !== 2) fails.push('★既定で両方を見ていない: ' + all.total);
  const only = scanDirectory(mixed, /^check-.*\.(mjs|js|ps1)$/);
  if (only.total !== 1) fails.push('★宣言で絞れていない: ' + only.total);
  if (only.missing.length !== 0) fails.push('★絞った上で誤検出している');
  // ★壊れた指定を渡されても既定に戻ること(診断を止めない)
  if (scanDirectory(mixed, 'not-a-regexp').total !== 2) fails.push('★壊れた指定で既定に戻らない');

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

  // ★--pattern で「どれがゲートか」を受け取れる(run.mjs が宣言から渡す)。
  //   ★不正な正規表現でも診断を止めない。案内板が汚れていることを理由に
  //   診断そのものを落とすと、100年のうちに必ず全社が止まる日が来る。
  let pattern;
  const pi = args.indexOf('--pattern');
  if (pi >= 0 && args[pi + 1]) {
    try { pattern = new RegExp(args[pi + 1]); }
    catch { pattern = undefined; }
  }
  const res = scanDirectory(dir, pattern);

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
