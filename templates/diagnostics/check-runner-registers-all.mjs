#!/usr/bin/env node
/**
 * check-runner-registers-all.mjs — ★診断キットに在るのに run.mjs が呼ばない検査を見つける。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか（2026-08-29）
 *
 *   run.mjs の CHECKS は【手で書く】登録表。だから書き忘れた検査は
 *   ★ファイルとして存在するのに一度も走らない。
 *   「検査を足した」と本人は思っていて、実際には何も守られていない状態になる。
 *
 *   ★これは想像ではない。同じ日に隣で実際に起きていた:
 *     _docs/instruments/check-drift.mjs の PAIRS（同じく手書きの登録表）は
 *     ★22件の登録漏れを抱えていた。うち1件は【キット自身】の土台で、
 *     正本より12行古いまま、それを4本の検査が使っていた。
 *     手作業の調査では3件しか見つけられず、機械に探させて初めて22件と分かった。
 *
 *   ⟹ ★手で書く登録表は必ず穴が開く。表そのものを検査対象にする。
 *
 * ■ ★なぜ「今は漏れが無い」でも要るのか
 *   この検査を書いた時点で登録漏れは0件だった。★それでも要る。
 *   守るのは「今」ではなく、★次に検査を足す人が忘れたときだから。
 *   （漏れが出てから作ると、その1件は必ず見逃されている）
 *
 * ■ この検査が判定しないこと
 *   ★登録されているかだけを見る。中身が正しいか・その検査が有用かは見ない。
 *   ★意図的に外している検査は EXCLUDED に理由を書く（書けないなら登録する）。
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 使い方:
 *   node diagnostics/check-runner-registers-all.mjs [キットのルート]
 *   node diagnostics/check-runner-registers-all.mjs --selftest
 *   exit 0 = 全部登録済み / 1 = 未登録あり / ★2 = 測れなかった
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * ★意図的に登録しないもの。理由を書けないなら登録すること。
 */
export const EXCLUDED = Object.freeze([
  {
    name: 'check-runner-registers-all',
    why: '★この検査自身。run.mjs から呼ぶと自分を数えて再帰的になるため、'
       + 'verify から直接呼ぶ（npm script に配線済み）'
  }
]);

/**
 * ★純粋な判定。ディレクトリの中身と、runner のソースを突き合わせる。
 *
 * @param {string[]} checkFiles 診断ディレクトリにある check-*.mjs のファイル名
 * @param {string} runnerSource run.mjs の中身
 * @returns {{verdict:'pass'|'fail'|'inconclusive', unregistered:string[], evidence?:object, reason?:string}}
 */
export function judgeRunnerCoverage(checkFiles, runnerSource) {
  const files = Array.isArray(checkFiles) ? checkFiles : [];
  const src = typeof runnerSource === 'string' ? runnerSource : '';

  // ★1本も見つからない＝探せていない。「全部登録済み」ではない。
  if (files.length === 0) {
    return {
      verdict: 'inconclusive',
      unregistered: [],
      reason: '検査ファイルが1本も見つからない（★未登録0件ではなく、探せていません）'
    };
  }
  // ★runner が読めない/空なら判定できない。空文字を「登録ゼロ＝全部未登録」と
  //   読むと嘘の赤になり、逆に緑にすると嘘の緑になる。どちらでもなく inconclusive。
  if (src.trim() === '') {
    return {
      verdict: 'inconclusive',
      unregistered: [],
      reason: 'runner のソースが読めない（★中身が空です）'
    };
  }

  const excluded = new Set(EXCLUDED.map((e) => e.name));
  const unregistered = [];
  for (const f of files) {
    const name = basename(f, '.mjs');
    if (excluded.has(name)) continue;
    // ★name: 'xxx' の形で登録されているかを見る（パス表記の揺れに影響されない）。
    if (!src.includes(`'${name}'`) && !src.includes(`"${name}"`)) unregistered.push(name);
  }

  return {
    verdict: unregistered.length > 0 ? 'fail' : 'pass',
    unregistered,
    evidence: {
      検査ファイル: files.length,
      登録済み: files.length - unregistered.length - excluded.size,
      未登録: unregistered.length,
      意図的な除外: excluded.size
    }
  };
}

// ---- 実行 ------------------------------------------------------------------

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain && process.argv.includes('--selftest')) {
  const RUNNER = "const CHECKS = [{ name: 'check-a' }, { name: 'check-b' }];";
  /** @type {Array<{name:string, ok:() => boolean}>} */
  const cases = [
    {
      name: '★登録漏れがあれば赤くなる(見逃さない)',
      ok: () => judgeRunnerCoverage(['check-a.mjs', 'check-zzz.mjs'], RUNNER).verdict === 'fail'
    },
    {
      name: '★全部登録済みなら緑',
      ok: () => judgeRunnerCoverage(['check-a.mjs', 'check-b.mjs'], RUNNER).verdict === 'pass'
    },
    {
      name: '★走査0件を緑にしない(未登録なしと区別する)',
      ok: () => judgeRunnerCoverage([], RUNNER).verdict === 'inconclusive'
    },
    {
      name: '★runner が空なら緑にも赤にもしない(測れなかった)',
      ok: () => judgeRunnerCoverage(['check-a.mjs'], '').verdict === 'inconclusive'
    },
    {
      name: '★除外した検査は未登録に数えない',
      ok: () => judgeRunnerCoverage(['check-runner-registers-all.mjs'], RUNNER).verdict === 'pass'
    },
    {
      name: '★名前の一部が一致するだけでは登録済みにしない',
      ok: () => judgeRunnerCoverage(['check-a-extra.mjs'], RUNNER).verdict === 'fail'
    },
    {
      name: '★壊れた入力で throw しない',
      ok: () => judgeRunnerCoverage(null, null).verdict === 'inconclusive'
    }
  ];

  const failed = cases.filter((c) => { try { return !c.ok(); } catch { return true; } });
  if (failed.length) {
    console.error('[check-runner-registers-all] ★selftest 失敗（検知器が効いていません）:');
    for (const f of failed) console.error(`  - ${f.name}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`[check-runner-registers-all] selftest OK（${cases.length}件・未登録で赤 / 走査0を緑にしない）`);
  process.exit(EXIT.PASS);
}

if (isMain) {
  const argDir = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const diagDir = argDir ? resolve(argDir, 'templates/diagnostics') : HERE;
  const runnerPath = join(diagDir, 'run.mjs');

  if (!existsSync(diagDir) || !existsSync(runnerPath)) {
    console.error('[check-runner-registers-all] 🟡 診断ディレクトリ/run.mjs が見つからず測れませんでした(★緑ではありません)。');
    console.error(`  → 探した場所: ${diagDir}`);
    process.exit(EXIT.INCONCLUSIVE);
  }

  const files = readdirSync(diagDir).filter((n) => /^check-.*\.mjs$/.test(n));
  const r = judgeRunnerCoverage(files, readFileSync(runnerPath, 'utf8'));
  const mark = r.verdict === 'pass' ? '✅' : r.verdict === 'fail' ? '🔴' : '🟡';

  if (process.argv.includes('--count')) {
    if (r.verdict === 'inconclusive') process.exit(EXIT.INCONCLUSIVE);
    console.log(String(r.unregistered.length));
    process.exit(EXIT.PASS);
  }

  console.log(`[check-runner-registers-all] ${mark} 走らせる表への登録 — ${r.verdict}`);
  if (r.evidence) console.log('  根拠: ' + JSON.stringify(r.evidence, null, 0));
  if (r.reason) console.log('  ' + r.reason);
  if (r.unregistered.length) {
    console.log('  ★在るのに run.mjs が呼んでいない検査:');
    for (const n of r.unregistered) console.log('    ' + n);
    console.log('  → 直し方: run.mjs の CHECKS に足す。');
    console.log('    ★呼ばない判断をしたなら EXCLUDED に理由を書く（書けないなら足す）。');
  }
  console.log('  → ★この検査が判定しないこと: 登録されているかだけを見ます。'
    + '中身が正しいか・その検査が有用かは見ません。');

  process.exit(r.verdict === 'fail' ? EXIT.FAIL : r.verdict === 'inconclusive' ? EXIT.INCONCLUSIVE : EXIT.PASS);
}
