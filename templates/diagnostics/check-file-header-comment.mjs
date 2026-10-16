#!/usr/bin/env node
/**
 * check-file-header-comment.mjs — ★新しく追加したソースファイルに「先頭コメント」があるかを見る。
 *
 * ─────────────────────────────────────────────────
 * ■ なぜ要るか（2026-10-16、本人の提案「ソースコードに何をしているか、人間もAIも分かるように
 *   コメントを入れるのはどうか」を全体ルール化したとき）
 *
 *   AIは別セッションに引き継がれるたび、前の文脈なしにコードを読み直す。ファイルの先頭に
 *   「役割・使い方・なぜ要るか」があれば、探索し直さずに済み、「既存実装を検索する」ときも
 *   役割説明の言葉で当たる。設計の理由（なぜ）はコードから復元できない。
 *   ★ルールを文章に書くだけでは守られないので、客観的に検出できる部分だけを機械にする
 *     （CLAUDE.md「新しいルールを書いたら、その場で機械検査化を検討する」節の手順1）。
 *
 * ■ 何を見るか／見ないか
 *   見る  : 【今回の変更で新しく追加された】ソースファイルの先頭に、一定量のコメントがあるか。
 *           （base...HEAD で追加されたもの＋ステージ済み＋未追跡）
 *   見ない: ★コメントの中身が正しいか・十分か（意味判断。人間とAIのレビューに残す）。
 *           ★既存ファイル（既存の75本はすべて先頭コメント済み。触るときに足せばよい。一括修正は
 *             コメントの質を落とすので、この検査は新規だけを赤くする）。
 *           ★1行ごとの「何をしているか」（コードを読めば分かり、直すと嘘になって腐る）。
 *
 * ■ 判定
 *   先頭（shebang・"use strict"・空行を除く）の連続したコメントから、記号と空白を除いた
 *   文字数が MIN_CHARS(20) 以上なら合格。`// x` のような中身の無いコメントは不合格。
 *   対象外: テスト(*.test.* / *.spec.*)・型定義(.d.ts)・生成物(dist/ build/ node_modules/ 等)・
 *           設定(*.config.*)・.example 等（拡張子が対象外）。
 *
 * ■ 3値の終了コード（このキットの掟）
 *   0 = 合格（または新規ファイルが無い）
 *   1 = 測れた上での赤（先頭コメントの無い新規ファイルがある）
 *   2 = 測れなかった（--selftest の期待外れ等）
 *   ★git が無い／比較元(base)が見つからない場合は "(skip)" を出して 0 で終わる。run.mjs が
 *     skip として数え、「ほとんど測れていません」と過半 skip を緑と名乗らない契約に乗る。
 *     （shallow clone の CI で赤にも緑にもしないため。fetch-depth: 0 か --base で測れる）
 *
 * ■ 使い方
 *   node check-file-header-comment.mjs [対象ディレクトリ]          # 新規ファイルだけ検査
 *   node check-file-header-comment.mjs --base origin/main          # 比較元を指定
 *   node check-file-header-comment.mjs --all                       # 既存も含め現状を数えるだけ（常に0・報告のみ）
 *   node check-file-header-comment.mjs --selftest                  # 毒→赤／正→緑 を確かめる
 * ─────────────────────────────────────────────────
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MIN_CHARS = 20;

const SOURCE_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|py|ps1|sh)$/i;
const SKIP_DIR = /(^|\/)(node_modules|dist|build|vendor|\.next|coverage|test-fixtures|fixtures)\//;
const SKIP_FILE = [/\.(test|spec)\.[a-z]+$/i, /\.d\.ts$/i, /\.min\.[a-z]+$/i, /\.config\.[a-z]+$/i];

// ---- 純ロジック（fs/git非依存・単体テスト可） --------------------------------

/** @param {string} path 検査対象のソースファイルか（拡張子・置き場所・種類で判定） */
export function isCheckablePath(path) {
  const p = String(path || '').replace(/\\/g, '/');
  if (!SOURCE_EXT.test(p)) return false;
  if (SKIP_DIR.test(p)) return false;
  return !SKIP_FILE.some((re) => re.test(p));
}

/** 装飾（記号・罫線・空白）を除いた文字数。`// ----` のような罫線だけのコメントを数えないため。 */
function substantiveLength(s) {
  return s.replace(/[\s/*#<>!\-=─━_~|.:;,'"`\\]+/g, '').length;
}

/**
 * ファイル先頭の連続したコメント本文を取り出す。
 * 先頭の shebang / "use strict" / 空行は読み飛ばす。コメントでない行に当たったら終わり。
 * 対応: `//` `#`（py/ps1/sh）`/* *​/` `<# #>`（ps1）`"""`/`'''`（py docstring）
 * @param {string} text @returns {string}
 */
export function extractHeaderComment(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  let i = 0;
  const out = [];
  // 読み飛ばす: shebang・'use strict'・空行
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === '' || /^#!/.test(t) || /^['"]use strict['"];?$/.test(t)) { i++; continue; }
    break;
  }
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === '') { // 空行はコメントの塊の区切り。最初の塊だけを見る。
      if (out.length > 0) break;
      i++; continue;
    }
    // ブロック: /* ... */
    if (t.startsWith('/*')) {
      while (i < lines.length) { out.push(lines[i]); if (lines[i].includes('*/')) { i++; break; } i++; }
      continue;
    }
    // ブロック: <# ... #>
    if (t.startsWith('<#')) {
      while (i < lines.length) { out.push(lines[i]); if (lines[i].includes('#>')) { i++; break; } i++; }
      continue;
    }
    // python docstring
    const q = t.match(/^(?:[rbuRBU]{0,2})("""|''')/);
    if (q) {
      const delim = q[1];
      const first = t.slice(t.indexOf(delim) + 3);
      if (first.includes(delim)) { out.push(first.slice(0, first.indexOf(delim))); i++; continue; }
      out.push(first); i++;
      while (i < lines.length) {
        if (lines[i].includes(delim)) { out.push(lines[i].slice(0, lines[i].indexOf(delim))); i++; break; }
        out.push(lines[i]); i++;
      }
      continue;
    }
    // 行コメント: // または #（#! と #requires は除外済み/対象外）
    if (t.startsWith('//') || (t.startsWith('#') && !t.startsWith('#!'))) { out.push(lines[i]); i++; continue; }
    break; // コメントでない行＝先頭コメントの終わり
  }
  return out.join('\n');
}

/** @returns {{ok: boolean, chars: number}} */
export function evaluateHeader(text, minChars = MIN_CHARS) {
  const chars = substantiveLength(extractHeaderComment(text));
  return { ok: chars >= minChars, chars };
}

// ---- I/O（直接実行時のみ） ------------------------------------------------------

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
}

function resolveBase(cwd, explicit) {
  const candidates = explicit ? [explicit] : ['origin/main', 'origin/master', 'main', 'master'];
  for (const ref of candidates) {
    try { git(['rev-parse', '--verify', '--quiet', ref], cwd); return ref; } catch { /* 次の候補 */ }
  }
  return null;
}

function lines(out) { return out.split('\n').map((s) => s.trim()).filter(Boolean); }

/** 今回の変更で追加されたファイル（コミット済み・ステージ済み・未追跡）の和集合。 */
function listNewFiles(cwd, base) {
  const set = new Set();
  const add = (out) => lines(out).forEach((f) => set.add(f));
  try { add(git(['diff', '--name-only', '--diff-filter=A', `${base}...HEAD`], cwd)); } catch { /* 比較不能でも他は見る */ }
  try { add(git(['diff', '--cached', '--name-only', '--diff-filter=A'], cwd)); } catch { /* */ }
  try { add(git(['ls-files', '--others', '--exclude-standard'], cwd)); } catch { /* */ }
  return [...set];
}

function run(argv) {
  const args = argv.slice(2);
  const flag = (n) => args.includes(n);
  const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--base' && args[i - 1] !== '--min');
  const cwd = resolve(positional[0] || process.cwd());
  const min = Number(val('--min')) || MIN_CHARS;

  try { git(['rev-parse', '--is-inside-work-tree'], cwd); } catch {
    console.log('[check-file-header-comment] gitリポジトリでない(skip)。');
    return 0;
  }

  if (flag('--all')) {
    const all = lines(git(['ls-files'], cwd)).filter(isCheckablePath);
    const missing = all.filter((f) => {
      try { return !evaluateHeader(readFileSync(join(cwd, f), 'utf8'), min).ok; } catch { return false; }
    });
    console.log(`[check-file-header-comment] 現状（報告のみ）: 対象 ${all.length} 件中、先頭コメント不足 ${missing.length} 件。`);
    for (const f of missing.slice(0, 50)) console.log(`  - ${f}`);
    if (missing.length > 50) console.log(`  …ほか ${missing.length - 50} 件`);
    return 0;
  }

  const base = resolveBase(cwd, val('--base'));
  if (!base) {
    console.log('[check-file-header-comment] 比較元(origin/main 等)が見つからない(skip)。shallow clone なら fetch-depth: 0 か --base で指定。');
    return 0;
  }

  const targets = listNewFiles(cwd, base).filter(isCheckablePath).filter((f) => existsSync(join(cwd, f)));
  const bad = [];
  for (const f of targets) {
    const r = evaluateHeader(readFileSync(join(cwd, f), 'utf8'), min);
    if (!r.ok) bad.push({ f, chars: r.chars });
  }
  if (bad.length > 0) {
    console.error(`[check-file-header-comment] 先頭コメントの無い新規ファイルが ${bad.length} 件（比較元: ${base}）:`);
    for (const b of bad) console.error(`  - ${b.f}（実質 ${b.chars} 文字 / 必要 ${min} 文字以上）`);
    console.error('[check-file-header-comment] 対処: ファイル先頭に「役割・使い方・なぜ要るか」を書く。1行ごとの説明は不要。');
    console.error('[check-file-header-comment]   方針: docs/ai-rules/01_CORE_RULES.md「コードコメントの書き方」。');
    return 1;
  }
  console.log(`[check-file-header-comment] OK（新規の検査対象 ${targets.length} 件・先頭コメント不足 0 件・比較元: ${base}）。`);
  return 0;
}

// ---- selftest（毒→赤／正→緑。★終了コードだけでなく、期待した理由で赤になるかを見る） ----

function selftest() {
  const fails = [];
  const expect = (name, cond) => { if (!cond) fails.push(name); };

  // 純ロジック
  expect('コメント無し→赤', !evaluateHeader('const a = 1;\n').ok);
  expect('中身の無い一行コメント→赤', !evaluateHeader('// x\nconst a = 1;\n').ok);
  expect('罫線だけ→赤', !evaluateHeader('// ----------------------------------------\nconst a = 1;\n').ok);
  expect('行コメント(十分)→緑', evaluateHeader('// このファイルは請求書の合計を丸めて返す純ロジック。端数は切り捨て。\nexport const a = 1;\n').ok);
  expect('shebang+ブロック→緑', evaluateHeader('#!/usr/bin/env node\n/**\n * 診断ランナー。対象リポの検査を順に実行し、失敗を集計して終了コードで返す。\n */\nimport x from "y";\n').ok);
  expect("'use strict'の後→緑", evaluateHeader("'use strict';\n// 設定を読み込んで検証するヘルパー。値が欠けたら例外にする。\nmodule.exports = {};\n").ok);
  expect('python docstring→緑', evaluateHeader('"""請求データを集計して月次レポートを作る。入力はCSV、出力はJSON。"""\nimport os\n').ok);
  expect('python #コメント→緑', evaluateHeader('#!/usr/bin/env python3\n# 取り込んだログを日付ごとに分けて保存するスクリプト。再実行しても重複しない。\nimport os\n').ok);
  expect('ps1ブロック→緑', evaluateHeader('<#\n  Chromeの拡張をzipにまとめる。出力先は dist/ 配下で、既存ファイルは上書きする。\n#>\nparam()\n').ok);
  expect('コメントが2塊目以降なら無視', !evaluateHeader('const a = 1;\n// このコメントは先頭ではないので数えない。十分に長い文章であっても。\n').ok);
  expect('対象外: テスト', !isCheckablePath('src/a.test.mjs'));
  expect('対象外: dist', !isCheckablePath('dist/a.js'));
  expect('対象外: d.ts', !isCheckablePath('src/a.d.ts'));
  expect('対象: 通常のmjs', isCheckablePath('scripts/a.mjs'));

  // 実git: 一時リポで end-to-end（毒: コメント無しの新規ファイル→exit 1／直す→exit 0／gitなし→skip）
  const self = fileURLToPath(import.meta.url);
  const tmp = mkdtempSync(join(tmpdir(), 'fhc-selftest-'));
  try {
    const g = (a) => spawnSync('git', a, { cwd: tmp, encoding: 'utf8' });
    g(['init', '-q', '-b', 'main']);
    g(['config', 'user.email', 't@example.com']); g(['config', 'user.name', 't']);
    writeFileSync(join(tmp, 'README.md'), 'x\n'); g(['add', '.']); g(['commit', '-q', '-m', 'init']);
    writeFileSync(join(tmp, 'poison.mjs'), 'export const a = 1;\n');
    const red = spawnSync('node', [self, tmp, '--base', 'main'], { encoding: 'utf8' });
    expect('実git: コメント無しの新規→exit 1', red.status === 1);
    expect('実git: 赤の理由に poison.mjs が出る', /poison\.mjs/.test(red.stderr || ''));
    writeFileSync(join(tmp, 'poison.mjs'), '// このファイルは動作確認用で、先頭コメントがあれば合格することを確かめる。\nexport const a = 1;\n');
    const green = spawnSync('node', [self, tmp, '--base', 'main'], { encoding: 'utf8' });
    expect('実git: コメントを足す→exit 0', green.status === 0);
    expect('実git: 既存ファイルは対象外（README等で赤にならない）', !/README/.test(green.stderr || ''));
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  if (fails.length > 0) {
    console.error(`[check-file-header-comment] selftest 失敗 ${fails.length} 件:`);
    for (const f of fails) console.error(`  ✗ ${f}`);
    return 2; // ★測れなかった扱い（検査自身が壊れている）。0 に混ぜない。
  }
  console.log('[check-file-header-comment] selftest OK（毒→赤・正→緑・既存は対象外）。');
  return 0;
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  process.exit(process.argv.includes('--selftest') ? selftest() : run(process.argv));
}
