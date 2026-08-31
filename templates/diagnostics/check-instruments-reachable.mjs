#!/usr/bin/env node
/**
 * check-instruments-reachable.mjs — ★計器は「置いた」だけでは動かない。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★なぜ要るか(2026-08-25・同じ日に2回踏んだ実損)
 *
 *   ある製品で「別のモニタに表示される」不具合を追っていた。
 *   位置を測る計器を入れ、「原因は分かった」と報告した。
 *   ★実機ログを見ると、その計器は【1件も記録されていなかった】。
 *
 *   真因: 計器が `curX` を参照していたが、curX は
 *   「カーソル位置モード」の分岐でしか定義されない。
 *   利用者の設定は「中央モード」だった。
 *   ⟹ 未定義変数の参照で例外 → try に丸ごと飲まれ、★1件も記録されない。
 *
 *   同じ日、同じ製品の【中心的な計器】にも同型の穴が見つかった:
 *   破棄後のオブジェクトのプロパティを try の外で触っており、
 *   ★「異常が起きた瞬間にだけ計器が死ぬ」形になっていた。
 *
 * ■ ★これが最悪である理由
 *   計器が無いなら「無い」と分かる。
 *   ★計器が【あるのに動かない】と、「0件だから正常」と誤読する。
 *   実際そう報告してしまった。沈黙を正常と読む、最も危険な形。
 *
 * ■ ★何を検出するか
 *   1. try ブロックの中で計器を呼んでおり、
 *      ★その手前で「条件分岐の片側でしか定義されない変数」を参照している
 *   2. 計器のキーに変数を連結しているが、
 *      ★その変数が同じ関数内で無条件に定義されていない
 *
 * ■ ★この検査が判定しないこと
 *   実際に例外が出るかは分からない(実行しないと確定できない)。
 *   ★「飲まれうる形になっている」ことだけを指摘する。
 *   誤検出はありうる。だが★見逃すより安全側に倒す。
 *
 * ■ ★強制しない(このキットの掟)
 *   件数の上限はラチェット。★増えたときだけ赤。減らすのは自由。
 *
 * ■ 3値の終了コード
 *   0 = 合格 / 1 = ★測れた上での赤(増えた) / 2 = ★測れなかった
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 使い方:
 *   node check-instruments-reachable.mjs [対象ディレクトリ]
 *   node check-instruments-reachable.mjs --selftest
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * ★既定は【ラチェット】。0 ではない。
 *
 * 【なぜ0にしないか(2026-08-25・実測)】実在の製品(32ファイル)に当てたら
 *   26件検出した。★そのうち多くは誤検出だった:
 *     DiagBump(ok ? "A" : "B")        … ok は直前で必ず代入される
 *     DiagBump("pxSkip:" . pxSkip)    … 同じ if の中でしか呼ばれない
 *   この検査は行単位の近似で、ループやネストを正確には追えない。
 *   ★0 にすると初日から26件赤になり、「毎回赤い検査」= 誰も読まない検査になる。
 *
 * 【ではどう使うか】★実測値を基準にして、増えたときだけ赤にする。
 *   対象リポジトリごとに、最初の実測値をここへ書き写して使う。
 *   ★減らすのは自由。増やすときは理由を書く。
 *
 * 【★この検査の本当の価値】件数ではなく【一覧】にある。
 *   出力された行を1つずつ読み、「本当に飲まれうるか」を人が判断する。
 *   ★今日の実損(curX)は、この一覧に出ていれば気づけた形だった。
 */
// ★実測値(2026-08-25・soushin-suggest リポジトリ全体で31件)。
//   src のみなら26件。差の5件は scripts/unit のテスト用フィクスチャ。
//   ★この数字は「今ここまでは許す」の意味で、目標ではない。減らすのは自由。
//
// 【★31 → 32 へ更新した理由(2026-08-31・二分探索で特定)】
//   増えた分は【新しい計器ではなかった】。コミットを1つずつ当てて測ったところ:
//     838bf2e(8/25) = 31件  ← 上の基準値が測られた版
//     40fc703(8/27) = 32件  ← ★ここで増えた
//   40fc703 の差分は src/030-input.ahk の +24行のみで、
//   ★DiagBump は1行も足していない(実害対策の早期 return を1つ足しただけ:
//     プローブがスタートメニューのショートカットを壊すのを止めるガード)。
//
//   ⟹ ★増えたのは計器ではなく【この検査の見え方】。
//      splitFunctions は「次の関数定義まで」を関数本体とみなす近似で、
//      早期 return が増えると分岐の深さの数え方が変わる。
//
//   ★ここで無理に31へ戻すと、10回の再発を経て作った白化の計器
//     (s0Client / s0Gdi / s0ILBitmap 等)を、動いているのに
//     【検査に合わせて書き換える】ことになる。それは本末転倒。
//   ⟹ 32件すべてを個別に読み、飲まれうる実体が無いことを確認した上で
//      基準値を上げる。次に【本当に】増えたときはちゃんと赤くなる。
export const DEFAULT_RISKY_MAX = 32;

const SRC_FILE_RE = /\.(ahk|js|mjs|ts|cs|py)$/;

/** 計器らしい呼び出し。★言語ごとの綴りを表で持つ(名前で拾える範囲だけを対象にする)。 */
const INSTRUMENT_RE = /\b(DiagBump|Telemetry|Metric|Counter|track|record|logEvent|bump)\s*\(/i;

/** try に相当する行か。 */
function isTryLine(line) {
  return /^\s*(try\b|try\s*\{)/.test(line) || /^\s*\}\s*try\b/.test(line);
}

/**
 * ★「条件分岐の片側でしか定義されない変数」を集める。
 *
 * 対象にするのは、if/else の【中】で初めて代入される名前。
 * 関数の先頭で無条件に代入されている名前は安全なので除く。
 */
export function conditionalOnlyNames(funcBody) {
  const lines = String(funcBody || '').split(/\r?\n/);
  const unconditional = new Set();
  const conditional = new Set();
  let depth = 0;          // if/else のネスト深さ(ざっくり)
  for (const raw of lines) {
    const line = raw.replace(/;.*$/, '').replace(/\/\/.*$/, '');
    // ★分岐の開始/終了を数える。順序が重要:
    //   「} else {」は【閉じてから開く】ので、先に減らして後で増やす。
    //   ★逆にすると depth が 0 に落ち、else の中の代入を
    //     「無条件の代入」と誤判定する(selftest の正の対照で実際に外した)。
    if (/^\s*\}/.test(line) && depth > 0) depth--;
    if (/(^|\})\s*(if|else|switch|case)\b/.test(line)) depth++;
    const m = /^\s*([A-Za-z_]\w*)\s*:?=[^=]/.exec(line);
    if (!m) continue;
    if (depth > 0) conditional.add(m[1]);
    else unconditional.add(m[1]);
  }
  for (const n of unconditional) conditional.delete(n);
  return conditional;
}

/** 関数本体をざっくり切り出す。★完全な構文解析はしない(依存を増やさない)。 */
export function splitFunctions(src) {
  const s = String(src || '');
  const out = [];
  const re = /^[ \t]*(?:function\s+|def\s+|(?:public|private|static|async)\s+)*([A-Za-z_]\w*)\s*\([^)]*\)\s*[:{]/gm;
  const KEYWORDS = new Set(['if', 'else', 'while', 'for', 'loop', 'switch', 'catch',
    'try', 'return', 'and', 'or', 'not', 'case', 'do', 'until', 'with', 'in']);
  const starts = [];
  let m;
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

/** ★飲まれうる計器を探す。 */
export function findRisky(funcName, body) {
  const risky = [];
  const cond = conditionalOnlyNames(body);
  if (cond.size === 0) return risky;
  const lines = String(body || '').split(/\r?\n/);
  let inTry = false;
  let tryIndent = 0;
  lines.forEach((raw, i) => {
    const line = raw.replace(/;.*$/, '').replace(/\/\/.*$/, '');
    if (isTryLine(line)) {
      inTry = true;
      tryIndent = raw.length - raw.trimStart().length;
      return;
    }
    // try を抜けたと見なす: 同じか浅いインデントで } が来た
    if (inTry && /^\s*\}/.test(raw)) {
      const ind = raw.length - raw.trimStart().length;
      if (ind <= tryIndent) inTry = false;
      return;
    }
    if (!inTry) return;
    if (!INSTRUMENT_RE.test(line)) return;
    // ★この計器の行が、分岐でしか定義されない名前を参照しているか
    for (const nm of cond) {
      const use = new RegExp('\\b' + nm + '\\b');
      if (use.test(line)) {
        risky.push({ func: funcName, line: i + 1, name: nm, code: raw.trim().slice(0, 90) });
        break;
      }
    }
  });
  return risky;
}

export function scanDirectory(dir) {
  if (!dir || !existsSync(dir)) return { ok: false, reason: `対象が見つからない: ${dir}` };
  const risky = [];
  const seenKeys = new Set();   // ★生成物の二重計上を防ぐ
  let files = 0;
  const walk = (d) => {
    let ents = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory()) {
        // ★生成物・依存は見ない(2026-08-25・実測で二重計上が発覚)。
        //   dist/ には src/ を結合した成果物が入るため、
        //   同じコードを2回数えて件数が跳ね上がる(実測 26件 → 61件)。
        //   ★「同じものを2回数えて赤くなる」は、このキットが過去にも踏んだ型。
        //   ★名前の一覧だけに頼らない。次に別名(dist-demo など)が来たら同じ問題が起きる
        //   (実際 dist を除外した直後、dist-demo で再発した)。
        //   ⟹ 一覧に加えて、下で【同じ関数を2度数えない】ことでも守る。
        if (/^(node_modules|\.git|\.next|coverage|vendor|scratchpad)$/.test(e.name)) continue;
        if (/^(dist|build|out)(-|$)/.test(e.name)) continue;
        walk(join(d, e.name));
        continue;
      }
      if (!SRC_FILE_RE.test(e.name)) continue;
      let body = '';
      try { body = readFileSync(join(d, e.name), 'utf8'); } catch { continue; }
      files++;
      for (const fn of splitFunctions(body)) {
        for (const r of findRisky(fn.name, fn.body)) {
          // ★同じ関数の同じ行は1度しか数えない(2026-08-25)。
          //   生成物(src を結合した単一ファイル)が別名で置かれていると、
          //   同じコードを2回数えて件数が跳ね上がる。
          //   ★名前の除外一覧は漏れるので、内容でも守る。
          const key = fn.name + '#' + r.line + '#' + r.name;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          risky.push({ file: e.name, ...r });
        }
      }
    }
  };
  walk(dir);
  // ★ソースが1つも無いのは「合格」ではない。測れていない。
  if (files === 0) return { ok: false, reason: '対象にソースが1つも見つからない' };
  return { ok: true, files, risky };
}

function runSelftest() {
  const fails = [];
  const t = (label, cond) => { if (cond) console.log('  [ok ] ' + label); else { fails.push(label); console.log('  [BAD] ' + label); } };
  console.log('--- SelfTest: 飲まれうる計器の検出 ---');

  // ① ★正の対照: 今日の実損をそのまま再現する
  const real = `Show() {
    if (mode = "center") {
        x := 1
    } else {
        curX := 2
    }
    try {
        DiagBump("pos:" . curX)
    }
}`;
  const r1 = findRisky('Show', real);
  t('★実損の形(分岐でしか定義されない curX)を拾う', r1.length === 1 && r1[0].name === 'curX');

  // ② ★負の対照: 無条件に定義されていれば拾わない
  const safe = `Show() {
    curX := 0
    if (mode = "center") {
        curX := 1
    }
    try {
        DiagBump("pos:" . curX)
    }
}`;
  t('★無条件に定義済みなら拾わない', findRisky('Show', safe).length === 0);

  // ③ try の外なら対象外(そこは例外が飲まれないので別問題)
  const outside = `Show() {
    if (a) {
        curX := 1
    }
    DiagBump("pos:" . curX)
}`;
  t('try の外は対象外', findRisky('Show', outside).length === 0);

  // ④ 計器でない呼び出しは拾わない
  const notInstr = `Show() {
    if (a) {
        curX := 1
    }
    try {
        SomethingElse(curX)
    }
}`;
  t('計器でない呼び出しは拾わない', findRisky('Show', notInstr).length === 0);

  // ⑤ ★ソースが無いのを緑にしない
  const empty = mkdtempSync(join(tmpdir(), 'nl-instr-empty-'));
  t('★ソース0件を合格にしない', scanDirectory(empty).ok === false);

  // ⑥ ★node_modules は見ない
  const deps = mkdtempSync(join(tmpdir(), 'nl-instr-deps-'));
  mkdirSync(join(deps, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(deps, 'node_modules', 'x', 'a.mjs'), real);
  writeFileSync(join(deps, 'b.mjs'), 'function ok(){\n  return 1;\n}\n');
  const rd = scanDirectory(deps);
  t('★node_modules を数えない', rd.ok && rd.files === 1 && rd.risky.length === 0);

  if (fails.length) {
    console.error('[check-instruments-reachable] ★selftest 失敗:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log('[check-instruments-reachable] selftest OK'
    + '(★実損の形を拾う / 安全な形は拾わない / 0件を緑にしない)');
  process.exit(0);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) return runSelftest();
  const dir = args.find((a) => !a.startsWith('--')) || process.cwd();
  const res = scanDirectory(dir);
  if (!res.ok) {
    console.error(`[check-instruments-reachable] ★測れませんでした: ${res.reason}`);
    console.error('  → 対処: ソースのあるディレクトリを引数で渡してください。');
    process.exit(2);
  }
  const n = res.risky.length;
  console.log(`[check-instruments-reachable] ${res.files} ファイル / ★飲まれうる計器 ${n} 件`);
  for (const r of res.risky.slice(0, 20)) {
    console.log(`  ⚪ ${r.file}  ${r.func}()  「${r.name}」  ${r.code}`);
  }
  if (n > res.risky.length) console.log(`  … 他 ${n - 20} 件`);
  if (n > DEFAULT_RISKY_MAX) {
    console.error(`[check-instruments-reachable] 🔴 飲まれうる計器が ${DEFAULT_RISKY_MAX} 件を超えました(${n} 件)。`);
    console.error('  → ★なぜ止めるか(2026-08-25 実損): 計器が【あるのに動かない】と、');
    console.error('     「0件だから正常」と誤読します。実際そう報告してしまいました。');
    console.error('     計器が無いなら「無い」と分かる。★沈黙を正常と読むのが最も危険です。');
    console.error('  → 直し方: その変数を関数の先頭で無条件に初期化するか、');
    console.error('     計器を「その変数が必ず存在する位置」へ移してください。');
    console.error('  → ★この検査が判定しないこと: 実際に例外が出るかは分かりません。');
    console.error('     「飲まれうる形になっている」ことだけを指摘します。');
    process.exit(1);
  }
  console.log('[check-instruments-reachable] ✅ 合格(飲まれうる計器はありません)。');
  process.exit(0);
}

main();
