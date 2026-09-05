#!/usr/bin/env node
/**
 * check-cross-checked.mjs — ★「1つの手段だけで断定していないか」を数える。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか（2026-09-06・1日分を実測した結果）
 *
 *   AIエージェントが1日の作業で【9件】訂正した。全て「実行すれば1分で分かった」もの。
 *   分類すると型は2つだけだった:
 *
 *     型① 測る範囲が狭い（3件）
 *          src/lib だけ grep して「その関数は無い」と断定 → 実際は src/shared にあった
 *
 *     型② 実行せずに断定（6件）
 *          ★うち3件は【自分の道具の出力を1つだけ見て断定】:
 *            ・git merge-tree だけ見て「衝突0件」   → 実際は7ファイル衝突
 *            ・文字列カウントだけで「抽出可能4個」  → 構文解析すると0個
 *            ・サブエージェントの報告だけで「重複5個」→ 自分で grep したら2個
 *
 *   ★どれも【別の手段で1回確かめれば】防げた。
 *
 * ■ ★なぜ「間違えた回数」を数えないのか（★設計で一度間違えて直した）
 *
 *   最初は「1つの手段だけで断定した回数(少ないほど良い)」にした。
 *   ★これは【正直に訂正を書くほど数字が悪化する】＝正直さを罰する指標になる。
 *   実測すると訂正の記述も機械的に数えられてしまう（ある5日間で4件）。だからこそ危ない。
 *   書けば書くほど赤くなる仕組みは、書かない方向に働く。
 *
 *   ⟹ ★【確かめた回数】を数える（多いほど良い）。増やす行動がそのまま正解になる。
 *
 * ■ ★この検査が【判定しないこと】（正直に書く）
 *   ・その確認が本当に正しかったかは見ない。★「確かめたと書いたか」しか見ない
 *   ・書き手が言葉だけ増やせば数字は上がる（★ラチェットは増加を促すだけで、質は担保しない）
 *   ・だから hard fail にはしない。★減ったときだけ赤にする（ラチェット）
 *
 * ■ ★同じ轍を踏まないための設計（この配布元リポの実損より）
 *   ・「一度に全部直せと迫る仕掛けは全部死んだ」
 *     ⟹ 現在値を上限にせず【下限】として固定し、減ったら赤にする
 *   ・「検査自体が偽陽性を9回出した」
 *     ⟹ ★コミットが0件なら 0 ではなく【測れなかった(exit 2)】を返す
 *
 * 使い方:
 *   node check-cross-checked.mjs <リポのパス> [--days 30] [--baseline <数>]
 *   node check-cross-checked.mjs --selftest
 *
 * 終了コード: 0=合格 / 1=減った(赤) / ★2=測れなかった
 */

import { execFileSync } from 'node:child_process';

const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });

/**
 * ★「別の手段でも確かめた」と書かれた印。
 *   ★日本語と英語の両方を見る（配布先の書き言葉が違うため）。
 *   ★増やすときは「実際にその作業をしたときにしか書かない語」だけにする。
 *     例:「確認した」は弱い（何も確かめずにも書ける）ので入れない。
 */
export const CROSS_CHECK_MARKS = Object.freeze([
  '毒テスト', '毒で赤', '毒で確認',
  '実測で確認', '測り直', '再現し', '目視確認',
  '裏を取', '裏どり', '実際に走らせ', '別の手段',
  'poison test', 'reproduced', 'verified by measuring', 'double-checked'
]);

/**
 * コミット本文から印の出現回数を数える（純関数・I/Oしない）。
 * @param {string} bodies コミット本文を連結した文字列
 * @param {ReadonlyArray<string>} marks
 * @returns {{ total: number, byMark: Record<string, number> }}
 */
export function countCrossChecks(bodies, marks = CROSS_CHECK_MARKS) {
  const text = String(bodies || '');
  /** @type {Record<string, number>} */
  const byMark = {};
  let total = 0;
  for (const m of marks) {
    // ★正規表現ではなく split で数える（エスケープ事故を避ける）。
    const n = text.split(m).length - 1;
    if (n > 0) byMark[m] = n;
    total += n;
  }
  return { total, byMark };
}

/**
 * ★合否を決める（純関数）。
 * @param {number|null} count 今回の回数。★null は「測れなかった」
 * @param {number|null} baseline 下限。null なら初回＝今回値を下限にする
 * @returns {{ verdict:'pass'|'fail'|'inconclusive', line:string }}
 */
export function judgeCrossChecked(count, baseline) {
  if (count === null || count === undefined || !Number.isFinite(count)) {
    return { verdict: 'inconclusive', line: '🟡 測れませんでした（対象期間にコミットが無い）' };
  }
  if (baseline === null || baseline === undefined || !Number.isFinite(baseline)) {
    return { verdict: 'pass', line: `✅ 初回: ${count}回 を下限として記録してください（--baseline ${count}）` };
  }
  if (count < baseline) {
    return {
      verdict: 'fail',
      line: `🔴 別の手段で確かめた回数が減りました: ${baseline}回 → ${count}回`
    };
  }
  return { verdict: 'pass', line: `✅ ${count}回（下限 ${baseline}回）` };
}

/** git のコミット本文を取る。★コミット0件なら null（0ではない）。 */
function readCommitBodies(repo, days) {
  try {
    const oneline = execFileSync('git', ['log', `--since=${days} days ago`, '--oneline'], {
      cwd: repo, encoding: 'utf8', timeout: 30000
    }).trim();
    if (!oneline) return null; // ★測れなかった
    return execFileSync('git', ['log', `--since=${days} days ago`, '--format=%b'], {
      cwd: repo, encoding: 'utf8', timeout: 30000
    });
  } catch {
    return null;
  }
}

/** ★毒を食わせて、赤が出ることを自分で確かめる。 */
function runSelfTest() {
  const cases = [
    {
      name: '印がある本文を数えられる',
      got: countCrossChecks('毒テストで赤を目視。実測で確認した。').total,
      want: 2
    },
    {
      name: '★印が無ければ0（数え上げが空振りしていない証拠）',
      got: countCrossChecks('ふつうのコミット本文です').total,
      want: 0
    },
    {
      name: '★測れなかった(null)を0と混ぜない',
      got: judgeCrossChecked(null, 10).verdict,
      want: 'inconclusive'
    },
    {
      name: '★減ったら赤',
      got: judgeCrossChecked(3, 10).verdict,
      want: 'fail'
    },
    {
      name: '同数なら合格（増加を強制しない）',
      got: judgeCrossChecked(10, 10).verdict,
      want: 'pass'
    },
    {
      name: '★初回（下限なし）は合格で、下限を提案する',
      got: judgeCrossChecked(54, null).verdict,
      want: 'pass'
    },
    {
      // ★実際に踏んだバグ: `Number(x) || 30` だと --days 0 が falsy で 30 に化け、
      //   「0日なのに69回」という嘘を返した。★selftest だけ見て合格と断定していたら見逃した。
      name: '★--days 0 が 30 に化けない（falsy 事故）',
      got: parseDays(['--days', '0']),
      want: 0
    },
    {
      name: '--days 未指定なら既定30',
      got: parseDays([]),
      want: 30
    },
    {
      name: '--days に数字でない値なら既定30',
      got: parseDays(['--days', 'abc']),
      want: 30
    }
  ];
  let ng = 0;
  for (const c of cases) {
    const ok = c.got === c.want;
    if (!ok) ng++;
    console.log(`${ok ? '  ✅' : '  ❌'} ${c.name} … got=${c.got} want=${c.want}`);
  }
  if (ng > 0) {
    console.error(`[check-cross-checked] ★selftest 失敗 ${ng}件`);
    process.exit(EXIT.FAIL);
  }
  console.log('[check-cross-checked] ✅ selftest 合格（毒で赤くなることを確認）');
  process.exit(EXIT.PASS);
}

/**
 * ★`--days` を読む（純関数＝selftest で試せる形にする）。
 *   ★`Number(x) || 30` は使わない: --days 0 が falsy で 30 に化ける（実測で踏んだ）。
 * @param {ReadonlyArray<string>} argv
 * @returns {number}
 */
export function parseDays(argv) {
  const i = argv.indexOf('--days');
  if (i < 0) return 30;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

// ─── 実行 ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes('--selftest')) runSelfTest();

const repo = argv.find((a) => !a.startsWith('-')) || '.';
const days = parseDays(argv);
const baselineArg = argv.indexOf('--baseline');
const baseline = baselineArg >= 0 ? Number(argv[baselineArg + 1]) : null;

const bodies = readCommitBodies(repo, days);
if (bodies === null) {
  console.log('[check-cross-checked] 🟡 測れませんでした: 対象期間にコミットがありません');
  console.log(`  → 対処: --days を延ばすか、リポのパスを確認してください（今: ${repo} / ${days}日）`);
  process.exit(EXIT.INCONCLUSIVE);
}

const { total, byMark } = countCrossChecks(bodies);
const v = judgeCrossChecked(total, Number.isFinite(baseline) ? baseline : null);

console.log(`[check-cross-checked] ${v.line}`);
const parts = Object.entries(byMark).sort((a, b) => b[1] - a[1]).slice(0, 6);
if (parts.length) console.log('  内訳: ' + parts.map(([k, n]) => `${k}=${n}`).join(' / '));
console.log('  ★この検査が判定しないこと: その確認が正しかったかは見ません（書いたかどうかだけ）');

process.exit(v.verdict === 'fail' ? EXIT.FAIL : EXIT.PASS);
