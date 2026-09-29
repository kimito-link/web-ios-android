#!/usr/bin/env node
// PreToolUse(Edit|Write) ガード。既存HTMLファイルの大規模書き換え前に、
// 非ブロッキング警告のみ(fail-open)。
//
// 実損(2026-09-29、kimito-Link-Voice): index.html（旧「声優マッチング」時代の
// ダッシュボード一式）を全面的に実装・本番デプロイしたが、server.jsの実
// ルーティングは「/」に lp/index.html を配信しており、index.html はどこ
// からもリンクされていない未使用ファイルだった。設計書
// (docs/DESIGN-clerk-migration-2026-09-26.md)自体が、事業ピボット
// (docs/BILLING-DESIGN.md)を踏まえず旧index.htmlを前提に書かれていた。
// 「設計書に書いてある対象ファイル」を鵜呑みにし、実際のサーバー
// ルーティング(server.js の app.get('/', ...)等)や本番URLへの実アクセスで
// 「そのファイルが本当に配信されているか」を一度も確認していなかった。
//
// このhookは「大きなHTMLファイルを書き換える直前に、ルーティング定義
// (server.js/app.py等)をgrepしたか、または本番/ローカルのそのパスへ
// WebFetch/curlでアクセスした形跡があるか」という客観的事実だけを検出する。
// 「設計書の前提が本当に正しいか」という意味判断はできない
// (偽陽性: 無関係な調査を数回叩けば通過する。偽陰性: server.js相当の
// ルーティング定義を持たない静的サイト・Next.js等のファイルベース
// ルーティングでは検出しようがない対象にも警告が出うる)。
// この限界ゆえブロックしない — permissionDecisionは常にallowで、
// systemMessageで気づきを促すだけに留める。
//
// 標準入力(JSON): session_id, transcript_path, tool_name, tool_input

import { readFileSync, existsSync } from 'node:fs';

const LOOKBACK_TOOL_USES = 20;

// ★新規作成(Write)は対象外。既存ファイルの「大規模書き換え」だけを見る
//   （新規作成は到達性より前の話＝これから配線するので対象外でよい）。
const MIN_CHANGED_CHARS = 500;

const ROUTING_SEARCH_TOOLS = new Set(['Grep']);
const NETWORK_TOOLS = new Set(['WebFetch']);
// Bashでcurl/wgetを直接叩いた場合もルーティング確認とみなす。
const ROUTING_BASH_PATTERN = /\b(curl|wget)\b/;
const GREP_ROUTING_PATTERN = /app\.get|app\.use|sendFile|router\.|routes?\.js|urlpatterns/i;

function normalizeWindowsPath(p) {
  if (process.platform !== 'win32' || typeof p !== 'string') return p;
  const m = /^\/([a-zA-Z])\/(.*)$/.exec(p);
  if (m) return `${m[1]}:\\${m[2].replace(/\//g, '\\')}`;
  return p;
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function isTargetFile(filePath) {
  if (typeof filePath !== 'string') return false;
  // .html の既存ファイル書き換えのみ対象。プロジェクトのトップレベル
  // エントリファイル名（index.html等）に絞ると偽陰性が増えるため、
  // 対象は「.htmlファイル全般」に広げる（過検出は許容、無視は避ける）。
  return /\.html$/.test(filePath);
}

function isLargeRewrite(toolInput) {
  const text = typeof toolInput.new_string === 'string' ? toolInput.new_string
    : typeof toolInput.content === 'string' ? toolInput.content : '';
  return text.length >= MIN_CHANGED_CHARS;
}

// check-write-preceded-by-search.mjs と同型（PAIRS対象・4箇所目の複製）。
function collectRecentToolUses(transcriptPathRaw, limit) {
  const transcriptPath = normalizeWindowsPath(transcriptPathRaw);
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  let raw;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }

  const uses = [];
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0 && uses.length < limit; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const content = entry && entry.message ? entry.message.content : null;
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0 && uses.length < limit; j--) {
      const block = content[j];
      if (block && block.type === 'tool_use' && typeof block.name === 'string') {
        uses.push({ name: block.name, input: block.input || {} });
      }
    }
  }
  return uses;
}

function hasReachabilityCheck(uses) {
  for (const u of uses) {
    if (ROUTING_SEARCH_TOOLS.has(u.name)) {
      const pattern = typeof u.input.pattern === 'string' ? u.input.pattern : '';
      if (GREP_ROUTING_PATTERN.test(pattern)) return true;
    }
    if (NETWORK_TOOLS.has(u.name)) return true;
    if (u.name === 'Bash' && typeof u.input.command === 'string' && ROUTING_BASH_PATTERN.test(u.input.command)) {
      return true;
    }
  }
  return false;
}

function main() {
  const stdin = readStdin();
  let input;
  try {
    input = JSON.parse(stdin);
  } catch {
    process.exit(0);
  }

  if (input.tool_name !== 'Edit' && input.tool_name !== 'Write') {
    process.exit(0);
  }

  const toolInput = input.tool_input || {};
  if (!isTargetFile(toolInput.file_path)) {
    process.exit(0);
  }
  if (!isLargeRewrite(toolInput)) {
    process.exit(0);
  }

  const recentUses = collectRecentToolUses(input.transcript_path, LOOKBACK_TOOL_USES);
  if (hasReachabilityCheck(recentUses)) {
    process.exit(0);
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      systemMessage:
        '★HTMLファイルを大きく書き換えようとしていますが、直近' +
        LOOKBACK_TOOL_USES +
        '回のツール呼び出しに、ルーティング定義の検索(Grepでapp.get等)や' +
        '本番/ローカルへの実アクセス(WebFetch/curl)が見当たりません。' +
        'このファイルは実際にサーバーのルーティングから配信されていますか' +
        '（設計書の記述を鵜呑みにせず、server.js等のエントリポイント定義を確認しましたか）。' +
        '実損: kimito-Link-Voiceでindex.htmlを全面実装したが、実際は' +
        'lp/index.htmlが配信されており未使用ファイルだった(2026-09-29)。',
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main();
