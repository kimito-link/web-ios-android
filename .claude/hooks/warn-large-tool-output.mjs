#!/usr/bin/env node
// PostToolUse 注意。非ブロッキング(fail-open)。
//
// 何のため: 大きな出力（ログ全文・JSON 丸ごと・長い一覧・MCP の巨大な返り値）をそのまま会話に入れると、
// その分の文脈が以後の全ターンで送り直され、週間上限を食う。Anthropic 公式の
// 「Code execution with MCP」（2025-11-04, https://www.anthropic.com/engineering/code-execution-with-mcp）は、
// 「途中のデータはコードの側で絞り・集計してからモデルに渡す（1万行→5行）」「待つ・繰り返すはコードのループで回す」
// で大きく減らせると示した。正本: docs/ai-workflows/MULTI-BRAIN-HOWTO.md §1b「コードで絞ってから読む」。
//
// 検出できること: 直前の道具の出力が LIMIT 文字を超えたという事実だけ。
// 検出できないこと: その全文が本当に必要だったか（意味判断）。だから止めず、気づきを1行足すだけ。
// 1セッションあたり MAX_WARN 回までにして、注意そのものが文脈を食わないようにする。
//
// 標準入力(JSON): session_id, tool_name, tool_input, tool_response
// 無効化: WARN_LARGE_OUTPUT_DISABLE=1

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIMIT = 20000; // 文字。日本語・コード混じりでおよそ 5千〜7千トークン
export const MAX_WARN = 3;

/** 出力の大きさ（文字数）。文字列以外は JSON にして測る（純関数）。 */
export function outputSize(resp) {
  if (resp == null) return 0;
  if (typeof resp === 'string') return resp.length;
  try {
    return JSON.stringify(resp).length;
  } catch {
    return 0;
  }
}

/** 注意文を返す。不要なら null（純関数）。 */
export function judge(input, warnedSoFar = 0) {
  if (!input || typeof input !== 'object') return null;
  const tool = String(input.tool_name || '');
  // サブエージェントの報告は既に要約なので対象外
  if (/^(Agent|Task)$/.test(tool)) return null;
  if (warnedSoFar >= MAX_WARN) return null;
  const size = outputSize(input.tool_response);
  if (size <= LIMIT) return null;
  return (
    `[コードで絞ってから読む] 直前の ${tool} の出力が約${size.toLocaleString('en-US')}文字ありました。` +
    `この分は以後のターンでも毎回送り直されます。次からは grep / jq / head・tail / 小さなスクリプトで` +
    `要る行・要る項目だけ取り出してから読み、待つ・繰り返す確認はコード（until ループ・Monitor）で回してください。` +
    `（正本: docs/ai-workflows/MULTI-BRAIN-HOWTO.md §1b「コードで絞ってから読む」）`
  );
}

function stateFile(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^\w-]/g, '_').slice(0, 80);
  return join(tmpdir(), 'claude-warn-large-output', `${safe}.json`);
}

function main() {
  if (process.env.WARN_LARGE_OUTPUT_DISABLE === '1') return;
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  const file = stateFile(input?.session_id);
  let count = 0;
  try {
    count = JSON.parse(readFileSync(file, 'utf8')).count || 0;
  } catch {
    /* 初回 */
  }
  const msg = judge(input, count);
  if (!msg) return;
  try {
    mkdirSync(join(tmpdir(), 'claude-warn-large-output'), { recursive: true });
    writeFileSync(file, JSON.stringify({ count: count + 1 }));
  } catch {
    /* 数えられなくても注意は出す */
  }
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: msg } }),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch {
    /* fail-open */
  }
  process.exit(0);
}
