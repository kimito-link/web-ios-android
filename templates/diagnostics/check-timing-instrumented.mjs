#!/usr/bin/env node
/**
 * check-timing-instrumented.mjs — ★「遅い」と言われる経路に、時間を測る計器があるか。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか(2026-08-23・実損)
 *
 *   オーナーが「スクショ履歴の反応がわるすぎる」と報告した。
 *   私はこう直した:
 *     1回目「PNG復元が遅いはず」   → 実測 47ms。違った
 *     2回目「固定 Sleep が原因」    → 条件待ちに変えた → 「全くなっていません」
 *     3回目 …
 *   ★3回とも推測で外した。理由は単純で、
 *     【その経路に時間を測る計器が1つも無かった】から。
 *
 *   ★測っていないものは直せない。にもかかわらず、
 *   人は「たぶんここが遅い」と当たりを付けて直してしまう。
 *   そして体感が変わらないと、また別の場所を推測で直す。
 *
 * ■ ★何を数えるか
 *   「利用者に見える操作」を担う関数のうち、
 *   ★経過時間を記録していないものを数える。
 *
 *   時間を記録している = 開始時刻を取り、差分を計器へ渡している。
 *   例(この製品の実装):
 *     tStart := A_TickCount
 *     ... 処理 ...
 *     DiagBump("pasteImgTotalMs:" . (((A_TickCount - tStart) // 50) * 50))
 *
 *   ★件数を数えるだけの計器では足りない。
 *   「何回やったか」は分かっても「何ms かかったか」は分からず、
 *   遅さの report に対して何も答えられない。
 *
 * ■ ★強制しない(このキットの掟)
 *   全経路に計時を要求すると、通すためだけの★空の計時が入る。
 *   ⟹ ベースライン＋ラチェット。★増えたときだけ赤。減らすのは自由。
 *
 * ■ ★この検査が判定しないこと
 *   計器の中身が正しいかは見ない。丸め方も見ない。
 *   「時間を測っている形跡があるか」だけ。★空の計時を書けば通る。
 *
 * ■ 3値の終了コード
 *   0 = 合格 / 1 = ★測れた上での赤(未計測が増えた) / 2 = ★測れなかった
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 使い方:
 *   node check-timing-instrumented.mjs [対象ディレクトリ]
 *   node check-timing-instrumented.mjs --selftest   ← ★自分自身を毒で試す
 */

import { readFileSync, existsSync, readdirSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * ★ここを超えて「計時の無い操作」が増えたら赤。
 *   ★既定は0。新しいプロジェクトは操作も計器も空から始まるので、
 *   ★操作を足したら計時も足す、が最初から守られる。
 *   既に操作がある既存プロジェクトに後付けするときだけ、実測値まで上げてよい。
 */
export const DEFAULT_UNTIMED_MAX = 0;

/** 対象にするソースの形。言語ごとに足すだけで済むようにする。 */
const SRC_FILE_RE = /\.(ahk|js|mjs|ts|cs|py)$/;

/**
 * 「利用者に見える操作」らしい関数名か。
 *
 * ★名前で当たりを付けるのは弱い判定だが、ここでは意図的にそうしている。
 *   本当に見たいのは「利用者が待たされる処理」で、それを機械が確実に
 *   判定する方法は無い。★名前で拾える範囲だけを対象にし、
 *   拾えないものは【この検査の対象外】と明示する(黙って見逃さない)。
 */
const ACTION_NAME_RE = /\b(Paste|Insert|Apply|Send|Submit|Upload|Download|Import|Export|Restore|Render|Search|Load)[A-Z]\w*/;

/** 経過時間を測っている形跡があるか。★言語ごとの綴りを表で持つ。 */
export function hasTiming(src) {
  const s = String(src || '');
  return /A_TickCount|QueryPerformanceCounter|performance\.now|Date\.now|Stopwatch|time\.perf_counter|DateTime\.Now/.test(s);
}

/** 計器へ渡している形跡があるか(測っただけで捨てていないか)。 */
export function reportsTiming(src) {
  const s = String(src || '');
  return /Ms["':\s]|Ms\b|elapsed|duration|Duration/.test(s);
}

/** ソースを関数単位にざっくり割る。★完全な構文解析はしない(依存を増やさない)。 */
export function splitFunctions(src) {
  const s = String(src || '');
  const out = [];
  // 行頭から始まる「名前(...) {」を関数の始まりとみなす。
  const re = /^[ \t]*(?:function\s+|def\s+|(?:public|private|static|async)\s+)*([A-Za-z_]\w*)\s*\([^)]*\)\s*[:{]/gm;
  // ★制御構文を関数名と誤認しない。
  //   これを入れる前は if(...) { を関数の始まりと見なし、
  //   ★本体をそこで切ってしまい【計時があるのに「無い」と判定】していた
  //   (実際に、計時を入れた直後の関数を未計測と誤判定した)。
  const KEYWORDS = new Set(['if', 'else', 'while', 'for', 'loop', 'switch', 'catch',
    'try', 'return', 'and', 'or', 'not', 'case', 'do', 'until', 'with', 'in']);
  let m;
  const starts = [];
  while ((m = re.exec(s)) !== null) {
    if (KEYWORDS.has(m[1].toLowerCase())) continue;
    starts.push({ name: m[1], at: m.index });
  }
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i].at;
    const to = i + 1 < starts.length ? starts[i + 1].at : s.length;
    out.push({ name: starts[i].name, body: s.slice(from, to) });
  }
  return out;
}

export function scanDirectory(dir) {
  if (!dir || !existsSync(dir)) {
    return { ok: false, total: 0, untimed: [], reason: `対象が見つからない: ${dir}` };
  }
  const untimed = [];
  let total = 0;
  let files = 0;
  // ★下の階層まで探す(2026-08-24)。
  //
  // 【なぜ直したか】最初の実装は【渡されたフォルダの直下だけ】を見ていた。
  // そのため run.mjs からリポジトリのルートを渡されると
  // ★ソースが1本も見つからず、毎回「測れませんでした」で終わっていた。
  // 手で src を渡したときだけ動くので、私は「動いている」と思い込んでいた。
  // ⟹ ★わざと引数を足さないと動かない検査は、実質【使われない検査】。
  //   このキットが繰り返し戒めている「登録されない仕組みは死ぬ」と同じ型。
  //
  // ビルド生成物や依存は見ない(遅いうえ、直せないものを数えても意味が無い)。
  const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', 'out',
    'vendor', 'coverage', '.next', 'target', 'bin', 'obj']);
  const walk = (d, depth) => {
    if (depth > 4) return;                      // ★深追いしない(実測で十分な深さ)
    let items = [];
    try { items = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (it.isDirectory()) {
        // ★dist-demo / build-old のような派生も除く。完全一致だけだと
        //   生成物を数えて【同じ関数を二重に数える】(実測で dist-demo が漏れた)。
        const skip = SKIP_DIR.has(it.name) || it.name.startsWith('.')
          || [...SKIP_DIR].some((k) => it.name.startsWith(k + '-'));
        if (skip) continue;
        walk(join(d, it.name), depth + 1);
        continue;
      }
      if (!SRC_FILE_RE.test(it.name)) continue;
      files += 1;
      let src = '';
      try { src = readFileSync(join(d, it.name), 'utf8'); } catch { continue; }
      for (const fn of splitFunctions(src)) {
        if (!ACTION_NAME_RE.test(fn.name)) continue;
        total += 1;
        if (!(hasTiming(fn.body) && reportsTiming(fn.body))) untimed.push(`${it.name}: ${fn.name}`);
      }
    }
  };
  walk(dir, 0);
  if (files === 0) {
    // ★「ソースが1本も無い」は合格ではない。測れなかった(コード2)。
    return { ok: false, total: 0, untimed: [], reason: 'ソースファイルが1本も見つからない' };
  }
  if (total === 0) {
    // ★対象の操作が0件も「合格」にしない。名前の付け方が違う可能性がある。
    return { ok: false, total: 0, untimed: [], reason: '利用者に見える操作らしい関数が1つも見つからない' };
  }
  return { ok: true, total, untimed, reason: '' };
}

function runSelftest() {
  const fails = [];

  // ① 計時している関数を「していない」と言わないこと
  const timed = `PasteImage(dib) {
    t := A_TickCount
    DoWork()
    DiagBump("pasteMs:" . (A_TickCount - t))
  }`;
  if (!(hasTiming(timed) && reportsTiming(timed))) fails.push('★計時ありを見落とす');

  // ② 件数だけ数えて時間を測っていない形を見抜くこと(★今回の実損そのもの)
  const countOnly = `PasteImage(dib) {
    DiagBump("pasteCount")
    DoWork()
  }`;
  if (hasTiming(countOnly)) fails.push('★件数だけの計器を「計時あり」と誤認する');

  // ③ ★測っただけで捨てている形も見抜くこと
  const measuredButDropped = `PasteImage(dib) {
    t := A_TickCount
    DoWork()
  }`;
  if (hasTiming(measuredButDropped) && reportsTiming(measuredButDropped))
    fails.push('★測って捨てている形を本物と誤認する');

  // ④ 関数を割れること
  const two = `PasteText(s) {\n  x := 1\n}\nHelperThing(a) {\n  y := 2\n}\n`;
  if (splitFunctions(two).length !== 2) fails.push('★関数を割れない: ' + splitFunctions(two).length);

  // ④-b ★制御構文を関数と誤認しないこと。
  //   これを見落として、計時を入れた直後の関数を「未計測」と誤判定した(実損)。
  const withIf = 'PasteThing(a) {\n'
    + '    t := A_TickCount\n'
    + '    if (a) {\n'
    + '      DoWork()\n'
    + '    }\n'
    + '    DiagBump("thingMs:" . (A_TickCount - t))\n'
    + '  }';
  const fns = splitFunctions(withIf);
  if (fns.length !== 1) fails.push('★if を関数と誤認している: ' + fns.map((f) => f.name).join());
  else if (!(hasTiming(fns[0].body) && reportsTiming(fns[0].body)))
    fails.push('★if で本体が切れて計時を見落とす');

  // ⑤ 対象が無いときに「合格」と言わないこと(★2を0に混ぜない)
  if (scanDirectory(join(tmpdir(), 'nl-timing-not-exist-' + Date.now())).ok)
    fails.push('★存在しないディレクトリを合格にしている');

  // ⑥ ソース0本を合格にしないこと
  const empty = mkdtempSync(join(tmpdir(), 'nl-timing-empty-'));
  writeFileSync(join(empty, 'readme.txt'), 'x');
  if (scanDirectory(empty).ok) fails.push('★ソース0本を合格にしている');

  // ⑦ ★操作0件も合格にしないこと(名前の付け方が違うだけかもしれない)
  const noAction = mkdtempSync(join(tmpdir(), 'nl-timing-noaction-'));
  writeFileSync(join(noAction, 'a.mjs'), 'function helper(a) {\n  return a;\n}\n');
  if (scanDirectory(noAction).ok) fails.push('★操作0件を合格にしている');

  // ⑦-b ★下の階層のソースも見つけること。
  //   最初の実装は直下しか見ておらず、リポジトリのルートを渡されると
  //   毎回「測れませんでした」で終わっていた(実損)。
  //   ★手で src を渡したときだけ動くので「動いている」と誤認していた。
  const nested = mkdtempSync(join(tmpdir(), 'nl-timing-nested-'));
  mkdirSync(join(nested, 'src'), { recursive: true });
  writeFileSync(join(nested, 'src', 'a.mjs'), 'function PasteThing(a) {\n  return a;\n}\n');
  const rn = scanDirectory(nested);
  if (!(rn.ok && rn.total === 1))
    fails.push('★下の階層のソースを見つけられない: ' + JSON.stringify(rn));

  // ⑦-c ★node_modules は見ないこと(遅いうえ、直せないものを数えても意味が無い)
  const withDeps = mkdtempSync(join(tmpdir(), 'nl-timing-deps-'));
  mkdirSync(join(withDeps, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(withDeps, 'node_modules', 'x', 'b.mjs'), 'function PasteOther(a) {\n  return a;\n}\n');
  writeFileSync(join(withDeps, 'c.mjs'), 'function PasteMine(a) {\n  return a;\n}\n');
  const rd = scanDirectory(withDeps);
  if (!(rd.ok && rd.total === 1))
    fails.push('★node_modules を数えてしまっている: ' + JSON.stringify(rd));

  // ⑧ ★正の対照: 本物の未計測を1件だけ置いて、ちゃんと1件と数えること
  const one = mkdtempSync(join(tmpdir(), 'nl-timing-one-'));
  writeFileSync(join(one, 'a.mjs'), 'function PasteThing(a) {\n  return a;\n}\n');
  const r = scanDirectory(one);
  if (!(r.ok && r.total === 1 && r.untimed.length === 1))
    fails.push('★未計測を正しく数えられない: ' + JSON.stringify(r));

  if (fails.length) {
    console.error('[check-timing-instrumented] ★selftest 失敗:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log('[check-timing-instrumented] selftest OK'
    + '(件数だけの計器を見抜く / 測って捨てる形も見抜く / 0件を緑にしない / 正の対照)');
  process.exit(0);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) return runSelftest();

  const dir = args.find((a) => !a.startsWith('--')) || process.cwd();
  const res = scanDirectory(dir);

  if (!res.ok) {
    // ★測れなかった＝コード2。合格(0)にも赤(1)にも混ぜない。
    console.error(`[check-timing-instrumented] ★測れませんでした: ${res.reason}`);
    console.error('  → 対処: ソースのあるディレクトリを引数で渡してください。');
    process.exit(2);
  }

  const n = res.untimed.length;
  console.log(`[check-timing-instrumented] 利用者に見える操作 ${res.total} 件 / 時間を測っていない ${n} 件`);
  for (const u of res.untimed.slice(0, 20)) console.log(`  ⚪ ${u}`);
  if (res.untimed.length > 20) console.log(`  … 他 ${res.untimed.length - 20} 件`);

  if (n > DEFAULT_UNTIMED_MAX) {
    console.error(`[check-timing-instrumented] 🔴 時間を測っていない操作が ${DEFAULT_UNTIMED_MAX} 件を超えました(${n} 件)。`);
    console.error('  → 直し方: 開始時刻を取り、差分を計器へ渡す('
      + '例: t := A_TickCount ... DiagBump("xxxMs:" . (A_TickCount - t)))。');
    console.error('  → ★なぜ要るか: 「遅い」と報告されたとき、'
      + '測っていなければ推測で直すことになる。実損として3回外した記録がある。');
    console.error('  → ★この検査が判定しないこと: 計器の中身が正しいかは見ません。'
      + '空の計時を書けば通ります(それは計器ではありません)。');
    process.exit(1);
  }

  console.log('[check-timing-instrumented] ✅ 合格(利用者に見える操作はすべて時間を測っています)。');
  process.exit(0);
}

main();
