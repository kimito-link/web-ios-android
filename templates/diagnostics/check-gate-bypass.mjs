#!/usr/bin/env node
// check-gate-bypass.mjs — Gateを無効化・迂回して成功扱いにしていないかを検出する。
//
// CLAUDE.md「実装着手前の非交渉ルール」8番「Gateを無効化・迂回して成功扱いにしない」
// (`--no-verify`等でチェックを飛ばさない)は、意味判断ではなく「そのコマンド・設定が
// 使われたか」という客観的事実として検出できるにも関わらず機械検査が存在しなかった
// (2026-09-25、CLAUDE.md形骸化対策の一環でExploreサブエージェントが発見)。
//
// 対応する迂回パターン:
//   1. git commit時の --no-verify（直近のgitログにコミットメッセージとしては残らないため、
//      reflogを見ても検出できない。よってこの検査は「今後commitする瞬間」を狙うのではなく、
//      .github/workflows/内でCI自体がGateを迂回する設定になっていないかを見る）
//   2. GitHub Actions workflow内の continue-on-error: true（失敗しても成功扱いになる）
//   3. GitHub Actions workflow内の対象ステップの無効化コメントアウト
//      (例: `# - run: npm run verify` のように実行行だけコメントアウトされている)
//
// ★この検査が判定しないこと（意味判断が必要なため機械化していない）:
//   ・continue-on-error: trueが正当な理由（例: 実験的ステップ・通知専用ジョブ）で
//     使われているか、Gate迂回の意図で使われているかは区別できない。
//   ・コメントアウトされた行が「一時的な調査」か「恒久的な迂回」かは区別できない。
//   ・ローカルでの`git commit --no-verify`実行そのものは、実行後にコミットオブジェクト
//     へ痕跡が残らないため事後検出できない(この検査はCI設定ファイルの静的検査に限定)。
//
// 使い方:
//   node diagnostics/check-gate-bypass.mjs [対象ディレクトリ]  # 省略時はcwd
//   node diagnostics/check-gate-bypass.mjs --selftest
//   exit 0 = 迂回パターンなし / exit 1 = 検出(fail-closed) / exit 2 = 測定不能

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGET_DIR = resolve(process.argv[2] && process.argv[2] !== '--selftest' ? process.argv[2] : process.cwd());

// ---- 純ロジック(fs非依存・単体テスト可) ----------------------------------

/** @param {string} text workflow YAMLの中身 @returns {string[]} 検出した迂回パターンの説明一覧 */
export function findBypassPatterns(text) {
  const findings = [];
  // CRLFを先に潰す(check-gates-are-wired.mjsが踏んだ既知の地雷と同型)。
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const trimmed = rawLine.trim();

    // コメントアウトされた検証系runステップ(例: "#- run: npm run verify")は
    // それ自体が"#"始まりの行なので、先に単独チェックする。
    if (/^#\s*-?\s*run:\s*.*(verify|test|lint|check)/i.test(trimmed)) {
      findings.push(`${lineNo}行目: 検証系のrunステップがコメントアウトされている疑い`);
      return;
    }

    // それ以外の純粋なコメント行(「# continue-on-errorは使わない」という説明文等)は
    // 誤検知を避けるため除外する(check-gates-are-wired.mjsと同じ配慮)。
    if (trimmed.startsWith('#')) return;

    if (/continue-on-error\s*:\s*true/i.test(rawLine)) {
      findings.push(`${lineNo}行目: continue-on-error: true が使われている`);
    }
  });

  return findings;
}

/** @param {string} dir 対象ディレクトリ @returns {string[]} .github/workflows/配下のYAMLファイル一覧(相対パス) */
export function listWorkflowFiles(dir) {
  const workflowsDir = join(dir, '.github', 'workflows');
  if (!existsSync(workflowsDir)) return [];
  return readdirSync(workflowsDir)
    .filter((f) => /\.ya?ml$/i.test(f))
    .map((f) => join('.github', 'workflows', f));
}

// ---- I/O(直接実行時のみ) ------------------------------------------------------

function runSelftest() {
  const bypassSample = 'jobs:\n  test:\n    steps:\n      - run: npm test\n        continue-on-error: true\n';
  const cleanSample = 'jobs:\n  test:\n    steps:\n      - run: npm test\n';
  const commentedOutSample = 'jobs:\n  test:\n    steps:\n      #- run: npm run verify\n      - run: echo skip\n';

  const bypassFindings = findBypassPatterns(bypassSample);
  const cleanFindings = findBypassPatterns(cleanSample);
  const commentedFindings = findBypassPatterns(commentedOutSample);

  const ok =
    bypassFindings.length === 1 &&
    cleanFindings.length === 0 &&
    commentedFindings.length === 1;

  if (!ok) {
    console.error('[check-gate-bypass] --selftest 失敗:', {
      bypassFindings,
      cleanFindings,
      commentedFindings,
    });
    process.exit(1);
  }
  console.log('[check-gate-bypass] --selftest OK。');
  process.exit(0);
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  if (process.argv.includes('--selftest')) {
    runSelftest();
  } else {
    if (!existsSync(TARGET_DIR) || !statSync(TARGET_DIR).isDirectory()) {
      console.log('[check-gate-bypass] 対象ディレクトリが見つからない(測定不能)。');
      process.exit(2);
    }

    const workflowFiles = listWorkflowFiles(TARGET_DIR);
    if (workflowFiles.length === 0) {
      console.log('[check-gate-bypass] .github/workflows/ が無い(skip)。');
      process.exit(0);
    }

    let totalFindings = [];
    for (const relPath of workflowFiles) {
      const fullPath = join(TARGET_DIR, relPath);
      let text;
      try {
        text = readFileSync(fullPath, 'utf8');
      } catch {
        continue;
      }
      const findings = findBypassPatterns(text);
      for (const f of findings) {
        totalFindings.push(`${relPath} ${f}`);
      }
    }

    if (totalFindings.length > 0) {
      console.error(`[check-gate-bypass] Gate迂回パターンの疑いが ${totalFindings.length} 件:`);
      for (const f of totalFindings) console.error(`  - ${f}`);
      console.error('[check-gate-bypass] continue-on-error: true やコメントアウトされた検証ステップが');
      console.error('[check-gate-bypass] 意図的な迂回でないか確認すること(正当な理由がある場合はこの検査の対象外にする判断も可)。');
      process.exit(1);
    }
    console.log(`[check-gate-bypass] OK(workflow ${workflowFiles.length} 件・迂回パターンの疑い 0 件)。`);
  }
}
