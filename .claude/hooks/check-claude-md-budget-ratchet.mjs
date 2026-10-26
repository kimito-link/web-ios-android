#!/usr/bin/env node
// check-claude-md-budget-ratchet.mjs — CLAUDE.md の「必読の核」の予算(行数上限)を Edit/Write 境界で強制するフック。
//
// なぜ要るか(2026-10-21 全体設計会議 P0):
//   核の行数上限(templates/diagnostics/check-claude-md-budget.mjs・既定450)は「診断」としては在ったが、
//   どの hook にも配線されておらず、核は add-only で肥大し続けていた(1,017→1,345行/月・核は96%)。
//   「読んだ」は require-claude-md-read が強制するのに「核を太らせない」保護が無い非対称を、この境界ゲートで埋める。
// ★ratchet(ラチェット)の思想: 止めるのは「悪化(増やす)」だけ。既に超過していても「減らす方向」の編集は通す(warn)。
//   これが無いと「超過中は一切核を直せない→マーカーより下の無法地帯へ書く→decay が可視圏の外へ潜る」事故になる。
// ★gaming 検知: core:end マーカーを上へ動かすだけで coreLines は減る。実際に行を消さずマーカーだけ上げて
//   超過を回避する抜け道を塞ぐ(核から下へ「移設」したつもりが同じファイル内＝実は無法地帯へ退避しただけ)。
//   正しい減らし方は「実損本文を site/learnings/ か _docs/ へ出す=ファイルから消す」こと(CLAUDE.md L431-434 の掟)。
//
// 判定ロジックは純関数 applyEdit()/decideRatchet() に出してテスト可能にし、judge()/measureCore() は
//   check-claude-md-budget.mjs から import する(複製しない=片方だけ直って食い違う事故を防ぐ)。
// I/O: 標準入力(JSON)で session_id, tool_name, tool_input, cwd を受け取り、PreToolUse の permissionDecision を返す。

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRepoRoot, normalizeWindowsPath, readStdin } from './lib/transcript-reads.mjs';
import { measureCore, judge, DEFAULT_CORE_MAX } from '../../templates/diagnostics/check-claude-md-budget.mjs';
import { recordOutcome } from './lib/record-outcome.mjs';

// 編集後の CLAUDE.md 全文を組み立てる。組み立てられない(Edit の old_string が無い等)なら null=判定しない。
export function applyEdit(preText, toolName, toolInput) {
  const ti = toolInput && typeof toolInput === 'object' ? toolInput : {};
  if (toolName === 'Write') {
    return typeof ti.content === 'string' ? ti.content : null;
  }
  if (toolName === 'Edit') {
    const oldStr = typeof ti.old_string === 'string' ? ti.old_string : null;
    const newStr = typeof ti.new_string === 'string' ? ti.new_string : '';
    if (oldStr == null || oldStr === '' || !preText.includes(oldStr)) return null; // 実際の Edit も失敗するので止めない
    if (ti.replace_all) return preText.split(oldStr).join(newStr);
    return preText.replace(oldStr, newStr); // 最初の1件(Edit の既定)
  }
  return null; // NotebookEdit 等は対象外
}

// 予算のラチェット判定。純関数(I/O なし)。返り値 decision: 'allow' | 'warn' | 'deny'。
export function decideRatchet(preText, postText, max = DEFAULT_CORE_MAX) {
  const pre = measureCore(preText);
  const post = measureCore(postText);

  // マーカーを消して予算判定自体を無効化する抜け道を塞ぐ(核の境界を外す編集は拒否)。
  if (pre.declared && !post.declared) {
    return { decision: 'deny', category: 'marker-removed', reason: 'core:end マーカーを消そうとしています。核の予算境界は外せません(マーカーは1つだけ残す)。' };
  }
  // 元々マーカーが無い(このリポは対象外)、または編集後もまだ無い → 予算の対象外。
  if (!post.declared) return { decision: 'allow', category: '', reason: '' };

  const jPost = judge(postText, max);

  // マーカーが2つ以上は常に拒否(judge と一致)。
  if (post.markers > 1) {
    return { decision: 'deny', category: 'multi-marker', reason: `core:end マーカーが ${post.markers} 個になります(1つだけにする)。` };
  }

  // gaming: 核が縮んだのに、縮んだ分だけファイル全体が縮んでいない = 行をマーカーより下へ退避しただけ。
  //   超過中にこれで予算内へ「見せかけ」るのを拒否する。正しくは learnings/_docs へ出す(ファイルから消す)。
  const coreShrink = pre.coreLines - post.coreLines; // 核が何行減ったか
  const totalShrink = pre.totalLines - post.totalLines; // ファイル全体が何行減ったか
  const relocatedBelow = coreShrink - totalShrink; // 核から下へ退避された(消さずに隠れた)行数
  if (pre.declared && pre.coreLines > max && relocatedBelow > 0 && post.coreLines < pre.coreLines) {
    return {
      decision: 'deny',
      category: 'gaming',
      reason:
        `核を ${coreShrink} 行減らしていますが、うち約 ${relocatedBelow} 行はマーカーを上へ動かして` +
        `「下へ退避」しただけで、ファイルからは消えていません(無法地帯へ潜るだけ)。` +
        `実損本文は site/learnings/ か _docs/ へ出し(ファイルから消す)、核には規範と検査の入口・EVIDENCE 行だけ残してください。`,
    };
  }

  if (jPost.status === 'fail') {
    // ここに来る fail は「核が上限超過」(markers>1 は上で処理済み)。
    if (post.coreLines > pre.coreLines) {
      // 増やして超過 = ラチェット発動(拒否)。
      return { decision: 'deny', category: 'over-budget-increase', reason: `${jPost.detail}（今 ${pre.coreLines} 行→${post.coreLines} 行に増加）。核は増やせません。実損本文を site/learnings/ か _docs/ へ移し、規範と検査の入口だけ残してください。` };
    }
    // 超過しているが減らす方向 = 通すが警告(減らす作業を妨げない)。
    return { decision: 'warn', category: 'over-budget-shrink', reason: `核はまだ上限 ${max} 行超過中（${pre.coreLines}→${post.coreLines} 行・減少中）。上限内まで移設を続けてください。` };
  }

  return { decision: 'allow', category: '', reason: '' };
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    process.exit(0); // 入力が壊れていてもセッションを止めない
  }

  const toolName = input.tool_name;
  if (toolName !== 'Edit' && toolName !== 'Write') process.exit(0);

  const cwd = normalizeWindowsPath(input.cwd) || process.cwd();
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) process.exit(0);

  const claudeMdPath = join(repoRoot, 'CLAUDE.md');
  if (!existsSync(claudeMdPath)) process.exit(0);

  // 対象は「このリポの CLAUDE.md への編集」だけ。それ以外のファイル編集は無関係。
  const editTargetRaw =
    input.tool_input && typeof input.tool_input.file_path === 'string' ? input.tool_input.file_path : null;
  if (!editTargetRaw) process.exit(0);
  if (resolve(normalizeWindowsPath(editTargetRaw)) !== resolve(claudeMdPath)) process.exit(0);

  let preText;
  try {
    preText = readFileSync(claudeMdPath, 'utf8');
  } catch {
    process.exit(0);
  }
  const postText = applyEdit(preText, toolName, input.tool_input);
  if (postText == null) process.exit(0); // 組み立てられない=実際の編集も起きないので止めない

  const { decision, reason, category } = decideRatchet(preText, postText);
  if (decision === 'deny') {
    // 結末台帳へ(観測・冪等・fail-open。記録の成否は判定に影響しない)。council §7 / P3。
    recordOutcome(input, { hook: 'check-claude-md-budget-ratchet', reasonCategory: category || 'deny' });
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
      }),
    );
  } else if (decision === 'warn') {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
        systemMessage: `[核の予算] ${reason}`,
      }),
    );
  }
  process.exit(0);
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main();
