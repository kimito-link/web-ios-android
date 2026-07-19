#!/usr/bin/env node
// check-large-tracked-files.mjs — サイズの大きいファイルがgitに誤って追跡されていないか検出する。
//
// 原理: git ls-files(追跡ファイル一覧)のうち、実ファイルサイズが閾値を超えるものを列挙する。
//   ビルド成果物・動画・DBダンプ等を誤ってcommitすると、リポジトリが肥大化してclone/CIが遅くなり、
//   後から取り除くにも履歴書き換えが要る(気づくのが遅いほど直すコストが跳ね上がる)。
//
// 使い方:
//   node diagnostics/check-large-tracked-files.mjs [対象ディレクトリ] [閾値MB]
//   （省略時: 対象=cwd、閾値=5MB）
//   exit 0 = 閾値超えなし / exit 1 = 検出(fail-closed)。

import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGET_DIR = resolve(process.argv[2] || process.cwd());
const THRESHOLD_MB = Number(process.argv[3]) > 0 ? Number(process.argv[3]) : 5;

// ---- 純ロジック(fs/git非依存・単体テスト可) ----------------------------------

/** @param {{path:string,sizeBytes:number}[]} files @param {number} thresholdMb
 *  @returns {{path:string,sizeMb:number}[]} 閾値を超えるファイルの一覧(サイズ降順) */
export function findOversizedFiles(files, thresholdMb) {
  const thresholdBytes = thresholdMb * 1024 * 1024;
  return (files || [])
    .filter((f) => f.sizeBytes > thresholdBytes)
    .map((f) => ({ path: f.path, sizeMb: Math.round((f.sizeBytes / 1024 / 1024) * 10) / 10 }))
    .sort((a, b) => b.sizeMb - a.sizeMb);
}

// ---- I/O(直接実行時のみ) ------------------------------------------------------

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  let all;
  try {
    all = execSync('git ls-files', { cwd: TARGET_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    console.log('[check-large-tracked-files] gitリポジトリでない(skip)。');
    process.exit(0);
  }

  const files = [];
  for (const p of all) {
    try {
      const st = statSync(join(TARGET_DIR, p));
      files.push({ path: p, sizeBytes: st.size });
    } catch { /* 索引ズレ(削除済み等)はスキップ */ }
  }

  const oversized = findOversizedFiles(files, THRESHOLD_MB);
  if (oversized.length > 0) {
    console.error(`[check-large-tracked-files] ${THRESHOLD_MB}MB超のファイルがgitに追跡されている ${oversized.length} 件:`);
    for (const f of oversized) console.error(`  - ${f.path} (${f.sizeMb}MB)`);
    console.error('[check-large-tracked-files] 対処: ビルド成果物/動画等なら .gitignore に追加し `git rm --cached <path>`。');
    console.error('[check-large-tracked-files] 既に履歴に残っている場合はリポジトリ肥大化の原因なので、必要ならgit-filter-repo等での履歴整理を検討。');
    process.exit(1);
  }
  console.log(`[check-large-tracked-files] OK(追跡ファイル ${files.length} 件・${THRESHOLD_MB}MB超 0 件)。`);
}
