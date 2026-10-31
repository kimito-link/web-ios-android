#!/usr/bin/env node
// block-local-file-in-ai-browser.mjs — AI ツールの「内蔵ブラウザ」でローカルの HTML（file://）を開くのを止めるフック。
//
// なぜ要るか(2026-10-31・EMBRACE):
//   Forever Security の研究「EMBRACE」(2026-10-29) で、Claude Desktop・VS Code の内蔵ブラウザは
//   file:// で開いたページの Web Worker にフォルダの制限が効かず、ディスク全体(SSH鍵・.env・npm トークン)を
//   読めることが示された(Codex は制限そのものが無い)。Claude Desktop は修正時期が未公表。
//   このリポは確認の主戦場を Browser pane(=Claude Desktop の内蔵ブラウザ)にしているので、
//   「ローカルの HTML を内蔵ブラウザで開く」入口だけを機械で塞ぐ。localhost / https は止めない。
//   正本: docs/ai-rules/09_AI_TOOL_BROWSER_SAFETY.md
// 使い方: .claude/settings.json の PreToolUse(matcher: 内蔵ブラウザの MCP ツール名) に配線する。
// 判定しないこと: 普段の Chrome(Claude in Chrome)・Playwright の Chromium(普通のブラウザの守りがある)。
// I/O: 標準入力(JSON)で tool_name, tool_input を受け取り、該当すれば PreToolUse の deny を返す。読めなければ止めない(fail-open)。

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStdin } from './lib/transcript-reads.mjs';

// 内蔵ブラウザの MCP ツール名(デスクトップ版と、クラウドから端末へ繋いだとき)。
export const EMBEDDED_BROWSER_TOOL = /^mcp__(remote-devices__)?Claude_Browser__/;

// tool_input の中の文字列を全部見て、file: スキームの URL を探す(引数名に依存しない)。
export function findLocalFileUrl(value) {
  if (typeof value === 'string') {
    return /^\s*file:/i.test(value) ? value.trim() : null;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) {
      const hit = findLocalFileUrl(v);
      if (hit) return hit;
    }
  }
  return null;
}

// 純関数。返り値 null=通す / 文字列=拒否理由。
export function decide(toolName, toolInput) {
  if (typeof toolName !== 'string' || !EMBEDDED_BROWSER_TOOL.test(toolName)) return null;
  const url = findLocalFileUrl(toolInput);
  if (!url) return null;
  return (
    `内蔵ブラウザでローカルの HTML(${url.slice(0, 120)}) を開こうとしています。止めました。\n` +
    'AI ツールの内蔵ブラウザは file:// のページからディスク全体(SSH鍵・.env)を読まれる穴が報告されています(EMBRACE, 2026-10-29)。\n' +
    'かわりに: 自分のプロジェクトなら開発サーバー(http://localhost:…)を立てて開く。知らないリポの HTML は開かず、中身を Read で読む。\n' +
    '正本: docs/ai-rules/09_AI_TOOL_BROWSER_SAFETY.md'
  );
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    process.exit(0);
  }
  const reason = decide(input && input.tool_name, input && input.tool_input);
  if (!reason) process.exit(0);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main();
