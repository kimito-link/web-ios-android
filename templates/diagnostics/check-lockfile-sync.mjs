#!/usr/bin/env node
// check-lockfile-sync.mjs — package.json と lockfile(package-lock.json)の依存関係の不一致を検出する。
//
// 原理: package.json の dependencies/devDependencies に書かれた各パッケージ名が、
//   package-lock.json の packages テーブル(npm v7+形式)に存在するかを静的比較する。
//   lockfile 更新忘れ(package.json だけ編集して npm install し忘れた/コミットし忘れた)は
//   ローカルでは動いてしまう(node_modules は残っている)が、git clone 直後(CI/Vercel)で
//   `npm ci` すると lockfile 基準で解決されるため、そこで初めて壊れる。
//
// 対応: npm の package-lock.json(lockfileVersion 2/3、packages形式)のみ。
//   yarn.lock/pnpm-lock.yaml は対象外。
//
// ───────────────────────────────────────────────────────────────────────────
// ★2026-08-27: 「対象外(skip)」を exit 0（緑）で返していたのを exit 2 に変えた。
//
//   【実損】surechigai-romi.link は pnpm 運用（pnpm-lock.yaml がある）。
//     この検査は package-lock.json しか見ないので
//     「package-lock.json が無い(skip)」と表示して ★exit 0 を返していた。
//     ＝ ★**一度も照合していないのに緑**。
//     「調べて問題なし」と「そもそも調べていない」が区別できていなかった。
//
//   【なぜ fail(1) ではなく inconclusive(2) か】
//     pnpm を使うのは正しい選択であって、製品の不具合ではない。
//     赤にすると常時赤になり、本物の赤が埋もれる（オオカミ少年）。
//     ★「測れなかった」は 2。0 と混ぜないことだけが重要。
//
//   ★掟: 件数0の緑こそ最も危険。
// ───────────────────────────────────────────────────────────────────────────
//
// 使い方:
//   node diagnostics/check-lockfile-sync.mjs [対象ディレクトリ]  # 省略時はcwd
//   exit 0 = 整合(照合できた) / exit 1 = 不一致検出(fail-closed) / ★exit 2 = 照合できなかった

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGET_DIR = resolve(process.argv[2] || process.cwd());

// ---- 純ロジック(fs非依存・単体テスト可) ----------------------------------

/** @param {Record<string,string>} deps @param {Record<string,unknown>} lockPackages
 *  @returns {string[]} lockfileに存在しない依存名の一覧 */
export function findMissingFromLock(deps, lockPackages) {
  const names = Object.keys(deps || {});
  const packages = lockPackages || {};
  const missing = [];
  for (const name of names) {
    const hasEntry = Object.prototype.hasOwnProperty.call(packages, `node_modules/${name}`);
    if (!hasEntry) missing.push(name);
  }
  return missing;
}

// ---- I/O(直接実行時のみ) ------------------------------------------------------

// process.argv[1] を file:// URL に正規化して比較する(node標準の url.pathToFileURL)。
// 手作りのパス文字列比較はWindowsでスラッシュ方向/ドライブレターの大小差により一致せず
// isMain=false のまま exit 0 で抜ける偽陽性を生む(check-tracked-imports.mjs と同じ既知の罠)。
const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const pkgPath = join(TARGET_DIR, 'package.json');
  const lockPath = join(TARGET_DIR, 'package-lock.json');

  if (!existsSync(pkgPath)) {
    console.error('[check-lockfile-sync] 🟡 package.json が無いため照合できませんでした(★緑ではありません)。');
    console.error('[check-lockfile-sync] → Node プロジェクトのルートで実行してください。');
    process.exit(2);
  }
  if (!existsSync(lockPath)) {
    console.error('[check-lockfile-sync] 🟡 package-lock.json が無いため照合できませんでした(★緑ではありません)。');
    console.error('[check-lockfile-sync] → この検査は npm 専用です。pnpm/yarn なら別手段で確認するか、npm install してください。');
    console.error('[check-lockfile-sync] ★この検査が判定しないこと: pnpm-lock.yaml / yarn.lock の整合性は見ません。');
    process.exit(2);
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (!lock.packages) {
    console.error('[check-lockfile-sync] 🟡 lockfileVersion 1形式のため照合できませんでした(★緑ではありません)。');
    console.error('[check-lockfile-sync] → npm install で lockfileVersion 2/3 に更新してください。');
    process.exit(2);
  }

  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const missing = findMissingFromLock(deps, lock.packages);

  if (missing.length > 0) {
    console.error(`[check-lockfile-sync] package.jsonにあるがlockfileに無い依存 ${missing.length} 件:`);
    for (const name of missing) console.error(`  - ${name}`);
    console.error('[check-lockfile-sync] 対処: `npm install` を実行しlockfileを更新→ package-lock.json をコミット。');
    process.exit(1);
  }
  console.log(`[check-lockfile-sync] OK(依存 ${Object.keys(deps).length} 件・lockfile不一致 0 件)。`);
}
