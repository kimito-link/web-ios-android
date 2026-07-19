#!/usr/bin/env node
// check-secrets-not-tracked.mjs — .env等の秘密情報ファイルがgitに誤って追跡されていないか検出する。
//
// 原理: git ls-files(追跡ファイル一覧)を、秘密情報になりやすいファイル名パターンと照合する。
//   .gitignore に書いてあっても、既に一度 `git add` されてしまった後は ignore が効かない
//   (よくある事故: 最初のcommitで .env を含めてしまい、後から .gitignore に足しても追跡済みのまま残る)。
//   このチェックは「意図に関わらず、今まさに追跡されているか」だけを機械的に見る。
//
// 対応: .env系(.env, .env.local, .env.production等)、鍵/証明書拡張子(.pem/.key/.p12/.keystore/.jks)、
//   よくある秘密ファイル名(credentials.json, serviceAccountKey.json)。
//   誤検知を避けるため .env.example / .env.template / .env.sample は除外(値を含まない雛形のため)。
//
// 使い方:
//   node diagnostics/check-secrets-not-tracked.mjs [対象ディレクトリ]  # 省略時はcwd
//   exit 0 = 追跡なし / exit 1 = 追跡検出(fail-closed)。

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGET_DIR = resolve(process.argv[2] || process.cwd());

const SAFE_SUFFIXES = /\.(example|template|sample)$/;

// ---- 純ロジック(fs/git非依存・単体テスト可) ----------------------------------

/** @param {string} path @returns {boolean} 秘密情報ファイルの疑いがあるか */
export function looksLikeSecretFile(path) {
  const p = String(path || '');
  const base = p.split('/').pop() || '';
  if (SAFE_SUFFIXES.test(base)) return false;

  const patterns = [
    /^\.env(\..+)?$/,           // .env, .env.local, .env.production 等
    /\.(pem|key|p12|keystore|jks)$/,
    /^credentials\.json$/,
    /^serviceAccountKey\.json$/,
    /^service-account.*\.json$/,
  ];
  return patterns.some((re) => re.test(base));
}

/** @param {string[]} trackedFiles @returns {string[]} 秘密情報の疑いがあるファイルの一覧 */
export function findTrackedSecrets(trackedFiles) {
  return (trackedFiles || []).filter(looksLikeSecretFile);
}

// ---- I/O(直接実行時のみ) ------------------------------------------------------

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  let all;
  try {
    all = execSync('git ls-files', { cwd: TARGET_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    console.log('[check-secrets-not-tracked] gitリポジトリでない(skip)。');
    process.exit(0);
  }

  const suspects = findTrackedSecrets(all);
  if (suspects.length > 0) {
    console.error(`[check-secrets-not-tracked] 秘密情報ファイルの疑いがgitに追跡されている ${suspects.length} 件:`);
    for (const p of suspects) console.error(`  - ${p}`);
    console.error('[check-secrets-not-tracked] 対処: `git rm --cached <path>` で追跡解除→ .gitignore に追加。');
    console.error('[check-secrets-not-tracked] 既に公開リポにpush済みなら、値そのものをローテーション(再発行)すること(履歴に残るため削除だけでは不十分)。');
    process.exit(1);
  }
  console.log(`[check-secrets-not-tracked] OK(追跡ファイル ${all.length} 件・秘密情報の疑い 0 件)。`);
}
