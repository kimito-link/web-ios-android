#!/usr/bin/env node
// check-tracked-imports.mjs — 「コミットし忘れた新規ファイルを import している」を機械検出する出荷事故ゲート。
//
// 出典(金型の元): tsuioku-no-kirameki.com(2026-07-06 実事故から実装・実証済み)。
//   実事故: 新規ファイルを `git add` し忘れたまま commit → ローカルの verify / pre-push は
//   「作業ツリー基準」(未追跡でもディスクにあれば bundler が resolve できる)のため全部緑のまま、
//   Vercel ビルド(= git clone 直後の状態)だけが `Could not resolve` で全デプロイ失敗した。
//
// 原理: git ls-files(追跡ファイル一覧)だけを真実として、追跡ファイル内の相対 import が
//   すべて追跡ファイルに解決できるかを静的検査する = git clone 直後の状態を模した判定。依存追加なし。
//
// 使い方:
//   node scripts/check-tracked-imports.mjs                # 問題があれば exit 1
//   TRACKED_IMPORT_ROOTS="src,app" node scripts/...       # 検査対象ルートの限定(省略時は全追跡ファイル)
//   CI の build ステップ直後・pre-push に足すのが定位置。
//
// 対応: 静的 import / export...from / 副作用 import / 動的 import()。
//   JSDoc 型参照 `{import('./x.js').Foo}` は除外。拡張子は .js/.mjs/.ts/.tsx/.jsx と
//   省略時の .js/.ts/index.* 補完を候補にする(いずれか1つでも追跡されていればOK=誤検知ゼロ優先)。

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());
const SOURCE_EXT = /\.(js|mjs|ts|tsx|jsx)$/;
const EXCLUDE = /(^|\/)(node_modules|dist|build|\.next|out)\//;
const TEST_FILE = /\.(test|spec)\.[a-z]+$/;

// ---- 純ロジック(fs/git 非依存・単体テスト可) ----------------------------------

/**
 * ★コメントを「同じ長さの空白」に潰す（行番号がずれないように）。
 *
 * ★2026-08-25 に kimitolink-linktree で実測した誤検知:
 *   e2e/auth.config.ts の JSDoc に
 *     *   import { getTestAuth } from "./auth.config";
 *   という**使用例**が書かれているだけで「未追跡ファイルを import している」と赤になった
 *   （実際にはそのファイル自身であり、git に追跡もされている）。
 *
 *   ヘッダは「JSDoc 型参照は除外」と書いていたが、除外していたのは
 *   `{import('./x').Foo}` の形だけで、★コメント内の `import ... from` は素通りだった。
 *
 * ★これは掟①そのもの: 生テキストに正規表現を当てる検査は、通す方向にも
 *   見落とす方向にも同じように壊れる。ここでは「★誤って赤にする」方向に壊れていた。
 *   赤が嘘だと、本物の赤が信用されなくなる（オオカミ少年）。
 *
 * ★文字列リテラルは潰さない（`const s = "// not a comment"` を壊さないため）。
 *
 * @param {string} text
 * @returns {string} コメントを空白に置換したテキスト（長さ・改行位置は元のまま）
 */
export function blankOutComments(text) {
  const s = String(text || '');
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const next = s[i + 1];
    // 文字列リテラル（' " `）はそのまま通す
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < s.length) {
        if (s[i] === '\\') { out += s[i] + (s[i + 1] ?? ''); i += 2; continue; }
        out += s[i];
        if (s[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    // 行コメント（改行は残す）
    if (c === '/' && next === '/') {
      while (i < s.length && s[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    // ブロックコメント（改行は残す＝行番号がずれない）
    if (c === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) {
        out += s[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  ';
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * ★「文字列の中に書かれたコード」を潰す。
 *
 *   `const sample = "import { a } from './missing';"` のように、
 *   ★import 文を**データとして**持つコードがある（テストの fixture が典型）。
 *   これを実物の import と読むと、存在しないファイルを指していると誤検知する。
 *
 * ★2026-08-25 実測: この検査に selftest を足した直後、CI で
 *   ★**自分自身の selftest fixture を「未追跡を import している」と赤にした**（3件）。
 *   ローカルでは緑だった——★まだ commit していなかったので git ls-files に載らず、
 *   自分自身が検査対象外だったため。＝「ローカルで緑」は「CIで緑」を意味しない。
 *
 *   ★この検査は git 追跡ファイルだけを見るので、
 *     ★**新規ファイルは commit するまで自分自身を検査できない**という性質がある。
 *     ローカルの緑を信用しすぎないこと。
 *
 * ★ネストした引用符（"..." の中の '...'）は外側だけを見れば十分。
 *   import 文の解析にしか使わないので、中身を空白にすれば誤検知は消える。
 *
 * @param {string} text コメントを潰した後のテキスト
 * @returns {string} 文字列リテラルの中身を空白にしたテキスト（長さは保つ）
 */
export function blankOutStringContents(text) {
  const s = String(text || '');
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < s.length) {
        if (s[i] === '\\') { out += '  '; i += 2; continue; }
        if (s[i] === quote) { out += quote; i++; break; }
        // ★改行は残す（行番号がずれない）
        out += s[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** @param {string} text @returns {{ specifier: string, line: number }[]} */
export function extractRelativeImportSpecifiers(text) {
  // ★コメントを潰してから当てる（使用例の import を実物と読み違えない）。
  const s = blankOutComments(text);
  // ★ただし import 文そのものの引用符は残す必要があるので、
  //   「文字列の中身を潰した版」は**別に**作り、そちらで
  //   「そもそも import 文が文字列の中にあるか」を判定する。
  const sBlank = blankOutStringContents(s);
  /** ★その位置の import が、文字列リテラルの内側なら無視する。 */
  const insideString = (idx) => sBlank[idx] === ' ' && s[idx] !== ' ';
  const out = [];
  const isRelative = (spec) => spec.startsWith('./') || spec.startsWith('../');
  const lineAt = (index) => s.slice(0, index).split('\n').length;
  let m;
  // import/export ... from '...'(複数行可)
  // ★insideString(m.index): その import 文自体が文字列リテラルの中にあるなら data であって import ではない。
  const staticRe = /\b(?:import|export)\b[^;'"]*?\bfrom\s*(['"])((?:(?!\1).)*)\1/g;
  while ((m = staticRe.exec(s)) != null) {
    if (isRelative(m[2]) && !insideString(m.index)) out.push({ specifier: m[2], line: lineAt(m.index) });
  }
  // 副作用 import '...';
  const sideEffectRe = /\bimport\s*(['"])((?:(?!\1).)*)\1\s*;/g;
  while ((m = sideEffectRe.exec(s)) != null) {
    if (isRelative(m[2]) && !insideString(m.index)) out.push({ specifier: m[2], line: lineAt(m.index) });
  }
  // 動的 import('...')。JSDoc 型参照(閉じ括弧直後に `.識別子` が続く)は除外。
  const dynamicRe = /\bimport\s*\(\s*(['"])((?:(?!\1).)*)\1\s*\)(\.[a-zA-Z_$])?/g;
  while ((m = dynamicRe.exec(s)) != null) {
    if (isRelative(m[2]) && !m[3] && !insideString(m.index)) out.push({ specifier: m[2], line: lineAt(m.index) });
  }
  return out;
}

/** @param {string} fromRepoPath @param {string} specifier @returns {string[]} */
export function resolveImportCandidates(fromRepoPath, specifier) {
  const stack = String(fromRepoPath || '').split('/').slice(0, -1);
  for (const part of String(specifier || '').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  const base = stack.join('/');
  if (!base) return [];
  const candidates = [];
  const push = (p) => { if (p && !candidates.includes(p)) candidates.push(p); };
  if (/\.[a-zA-Z0-9]+$/.test(base)) {
    push(base);
    // TS プロジェクトで `./x.js` 指定→実体 x.ts の moduleResolution(bundler/nodenext)対応
    push(base.replace(/\.js$/, '.ts'));
    push(base.replace(/\.js$/, '.tsx'));
  } else {
    for (const ext of ['.js', '.mjs', '.ts', '.tsx', '.jsx']) push(`${base}${ext}`);
    for (const ext of ['.js', '.ts', '.tsx']) push(`${base}/index${ext}`);
    push(base);
  }
  return candidates;
}

/** @param {{path:string,text:string}[]} files @param {Set<string>|string[]} trackedFiles */
export function findUntrackedImports(files, trackedFiles) {
  const tracked = trackedFiles instanceof Set ? trackedFiles : new Set(trackedFiles || []);
  const violations = [];
  for (const f of Array.isArray(files) ? files : []) {
    const from = String(f?.path || '');
    if (!from) continue;
    for (const ref of extractRelativeImportSpecifiers(f.text)) {
      const candidates = resolveImportCandidates(from, ref.specifier);
      if (candidates.length === 0) continue;
      if (!candidates.some((c) => tracked.has(c))) {
        violations.push({ from, line: ref.line, specifier: ref.specifier, candidates });
      }
    }
  }
  return violations;
}

// ---- I/O(直接実行時のみ) ------------------------------------------------------

// process.argv[1] を file:// URL に正規化して比較する(node標準の url.pathToFileURL)。
// 手作りのパス文字列比較(resolve + pathname置換)は Windows でスラッシュ方向/ドライブレターの
// 大小差により一致せず isMain=false のまま exit 0 で抜ける偽陽性を生む(2026-07-06実測・ai-hub selftest fixtureで検出)。
/**
 * ★selftest（毒→赤）。2026-08-25 追加。
 *
 * ★なぜ足したか: この検査は「コメント内の使用例」を実物の import と誤読して
 *   ★嘘の赤を出していた（kimitolink-linktree で実測）。直したが、
 *   selftest が無ければ次に同じ壊れ方をしても誰も気付けない。
 *   ★掟②「exit 2 を持っていることと、守れていることは別」。
 *
 * ★毒は状態に依存しない（実ファイルを触らず、文字列を純関数に食わせる）。
 */
function selftest() {
  const cases = [
    {
      name: '毒1: 本物の未追跡 import を検出できる',
      text: "import { a } from './missing';\n",
      tracked: ['src/app.ts'],
      from: 'src/app.ts',
      wantViolation: true
    },
    {
      name: '毒2: ★JSDoc の使用例を実物と誤読しない（今回の誤検知そのもの）',
      text: '/**\n *   import { getTestAuth } from "./auth.config";\n */\nexport const x = 1;\n',
      tracked: ['e2e/auth.config.ts'],
      from: 'e2e/auth.config.ts',
      wantViolation: false
    },
    {
      name: '毒3: ★行コメントに書いた import も拾わない',
      text: "// import { a } from './missing';\nexport const x = 1;\n",
      tracked: ['src/app.ts'],
      from: 'src/app.ts',
      wantViolation: false
    },
    {
      name: '毒4: ★文字列リテラル内の // でコメント判定を壊さない',
      text: "const url = 'https://example.com';\nimport { a } from './missing';\n",
      tracked: ['src/app.ts'],
      from: 'src/app.ts',
      wantViolation: true
    },
    {
      name: '毒5: 追跡済みへの import は赤にしない（誤検知しない）',
      text: "import { a } from './util';\n",
      tracked: ['src/app.ts', 'src/util.ts'],
      from: 'src/app.ts',
      wantViolation: false
    },
    {
      // ★2026-08-25 CI で実際に踏んだ: この検査自身の selftest fixture
      //   （文字列として持っている import 文）を実物と読んで自分を赤にした。
      //   ローカルで緑だったのは、まだ commit しておらず git ls-files に
      //   自分が載っていなかったから。★ローカルの緑を信用しすぎない。
      name: '★文字列リテラルの中の import 文を実物と読まない（自分の fixture で自爆しない）',
      text: 'const sample = "import { a } from \'./missing\';";\nexport const x = 1;\n',
      tracked: ['scripts/gate.mjs'],
      from: 'scripts/gate.mjs',
      wantViolation: false
    }
  ];

  const fails = [];
  for (const c of cases) {
    const got = findUntrackedImports([{ path: c.from, text: c.text }], new Set(c.tracked));
    const hasViolation = got.length > 0;
    if (hasViolation !== c.wantViolation) {
      fails.push(
        `${c.name}: 期待=${c.wantViolation ? '赤' : '緑'} / 実際=${hasViolation ? '赤' : '緑'}`
      );
    }
  }
  if (fails.length > 0) {
    console.error('[check-tracked-imports] 🔴 selftest 失敗:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`[check-tracked-imports] ✅ selftest 合格（${cases.length}件: 本物は赤・コメントは緑）`);
  process.exit(0);
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  if (process.argv.includes('--selftest')) selftest();

  let all;
  try {
    all = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    // ★2026-08-25: ここは以前 exit 0（緑）だった。
    //   git が無い/壊れている＝**一度も検査していない**のであって「問題なし」ではない。
    //   ★「測れなかった」は 2。0 と混ぜない（掟②・件数0の緑こそ最も危険）。
    console.error('[check-tracked-imports] 🟡 git ls-files を実行できませんでした（★緑ではありません）。');
    console.error(`[check-tracked-imports] → 理由: ${e && e.message}`);
    console.error('[check-tracked-imports] → 測れるようにするには: git リポジトリのルートで実行してください。');
    process.exit(2);
  }
  const trackedSet = new Set(all);
  const roots = String(process.env.TRACKED_IMPORT_ROOTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const inRoots = (p) => roots.length === 0 || roots.some((r) => p.startsWith(`${r}/`) || p === r);
  const targets = all.filter((p) => SOURCE_EXT.test(p) && !EXCLUDE.test(p) && !TEST_FILE.test(p) && inRoots(p));
  const files = [];
  for (const p of targets) {
    try { files.push({ path: p, text: readFileSync(join(ROOT, p), 'utf8') }); } catch { /* 索引ズレはスキップ */ }
  }
  // ★走査 0 件は「未追跡 import なし」ではなく【一度も見ていない】（2026-09-01 追加）。
  //   ★逆輸入元 surechigai-romi.link が持っていた契約をキット側にも入れる。
  //   実損: TRACKED_IMPORT_ROOTS に存在しないディレクトリ名（リネーム時に置き去りに
  //   なりやすい）を渡すと、0 ファイルを走査して「OK・0 件」と緑を出していた。
  //   ★件数0の緑は、この検査群が最も嫌う形（掟②）。
  if (files.length === 0) {
    console.error('[check-tracked-imports] 🟡 検査対象が 0 件でした（★緑ではありません。一度も見ていません）。');
    console.error(
      roots.length > 0
        ? `[check-tracked-imports] → TRACKED_IMPORT_ROOTS="${roots.join(',')}" に一致する追跡ファイルが 0 件でした。`
        : '[check-tracked-imports] → 追跡ファイルにソースが 1 件もありませんでした。'
    );
    console.error('[check-tracked-imports] → 直し方: TRACKED_IMPORT_ROOTS のディレクトリ名が実在するか確認してください。');
    process.exit(2);
  }

  const violations = findUntrackedImports(files, trackedSet);
  if (violations.length > 0) {
    console.error(`[check-tracked-imports] git 未追跡のファイルへ import している疑い ${violations.length} 件:`);
    for (const v of violations) {
      console.error(`  ${v.from}:${v.line} が '${v.specifier}' を import → 追跡に無い: ${v.candidates.join(' / ')}`);
    }
    console.error('[check-tracked-imports] 対処: 新規ファイルなら `git add <path>` してから commit。');
    console.error('[check-tracked-imports] (ローカル検証は作業ツリー基準のため、この検査だけが git clone 直後=CI/Vercel の実体を再現します)');
    process.exit(1);
  }
  console.log(`[check-tracked-imports] OK(検査対象 ${files.length} ファイル・未追跡 import 0 件)。`);
}
