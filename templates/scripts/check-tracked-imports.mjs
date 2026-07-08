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

/** @param {string} text @returns {{ specifier: string, line: number }[]} */
export function extractRelativeImportSpecifiers(text) {
  const s = String(text || '');
  const out = [];
  const isRelative = (spec) => spec.startsWith('./') || spec.startsWith('../');
  const lineAt = (index) => s.slice(0, index).split('\n').length;
  let m;
  // import/export ... from '...'(複数行可)
  const staticRe = /\b(?:import|export)\b[^;'"]*?\bfrom\s*(['"])((?:(?!\1).)*)\1/g;
  while ((m = staticRe.exec(s)) != null) {
    if (isRelative(m[2])) out.push({ specifier: m[2], line: lineAt(m.index) });
  }
  // 副作用 import '...';
  const sideEffectRe = /\bimport\s*(['"])((?:(?!\1).)*)\1\s*;/g;
  while ((m = sideEffectRe.exec(s)) != null) {
    if (isRelative(m[2])) out.push({ specifier: m[2], line: lineAt(m.index) });
  }
  // 動的 import('...')。JSDoc 型参照(閉じ括弧直後に `.識別子` が続く)は除外。
  const dynamicRe = /\bimport\s*\(\s*(['"])((?:(?!\1).)*)\1\s*\)(\.[a-zA-Z_$])?/g;
  while ((m = dynamicRe.exec(s)) != null) {
    if (isRelative(m[2]) && !m[3]) out.push({ specifier: m[2], line: lineAt(m.index) });
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
const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const all = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const trackedSet = new Set(all);
  const roots = String(process.env.TRACKED_IMPORT_ROOTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const inRoots = (p) => roots.length === 0 || roots.some((r) => p.startsWith(`${r}/`) || p === r);
  const targets = all.filter((p) => SOURCE_EXT.test(p) && !EXCLUDE.test(p) && !TEST_FILE.test(p) && inRoots(p));
  const files = [];
  for (const p of targets) {
    try { files.push({ path: p, text: readFileSync(join(ROOT, p), 'utf8') }); } catch { /* 索引ズレはスキップ */ }
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
