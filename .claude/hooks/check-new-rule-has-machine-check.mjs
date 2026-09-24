#!/usr/bin/env node
// PreToolUse(Edit|Write) ガード。CLAUDE.md・docs/ai-rules/への編集を対象に、
// 非ブロッキング警告のみ(fail-open)。
//
// CLAUDE.md「新しいルールを書いたら、その場で機械検査化を検討する」節
// (2026-09-14追記)は、規範的な文章を追記したその場で
//   1. 客観的事実として検出できるか → check-*.mjsを作る
//   2. 自然言語判断が要るか → ハイブリッド型(check-decision-receipt.mjsの型)
//   3. どちらも無理なら「なぜ機械化できないか」を明示する
// を自問せよと定める。だがこの節自体が「AIの自己申告」に依存しており、
// 実際にはMain-Write Pauseが6日間無検査だった等、書いた直後に検討されない
// 事故が繰り返された(2026-09-24発覚、_docs/DESIGN-claude-md-decay-2026-09-24.md)。
//
// このhookは「規範文を新規追加した」という客観的事実(正規表現マッチ)は検出できるが、
// 「対応する機械検査を本当に検討したか」という意味判断はできない。検出できるのは
// 「check-*.mjsへの言及」または「機械化できない理由らしき文言」が同じ追加内容の
// 近くにあるかという事実だけ(ハイブリッド型)。誤魔化しの一文(キーワードだけ書いて
// 中身が伴わない)は検出できない、という限界がある。
//
// 標準入力(JSON): session_id, tool_name, tool_input.file_path, tool_input.new_string / content

import { readFileSync } from 'node:fs';

// 「〜すること」「〜しないこと」「〜する」等の命令形で終わる行を規範文の候補とみなす。
// 粗い正規表現であり、単なる説明文(「〜である」等)は拾わない設計だが、
// 完全ではない(過検出・過検出漏れの両方がありうる)。
const NORMATIVE_PATTERN = /(すること|しないこと|してはいけない|してはならない|する(?:。|$))/;

// 対応する機械検査への言及、または機械化できない理由の明示とみなすキーワード。
const MACHINE_CHECK_MENTION = /check-[\w-]+\.mjs|機械化できない|自然言語判断|意味判断|ハイブリッド型|性善説の登録簿依存/;

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
  const normalized = normalizeWindowsPath(filePath).replace(/\\/g, '/');
  return /\/CLAUDE\.md$/.test(normalized) || /\/docs\/ai-rules\//.test(normalized);
}

function extractAddedText(toolInput) {
  // Edit: new_string が追加分の近似(old_stringとの厳密diffは取らない、粗い近似)。
  // Write: content全体が対象(新規ファイルまたは全文書き換え)。
  if (typeof toolInput.new_string === 'string') return toolInput.new_string;
  if (typeof toolInput.content === 'string') return toolInput.content;
  return '';
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

  const addedText = extractAddedText(toolInput);
  if (!addedText) {
    process.exit(0);
  }

  const lines = addedText.split('\n');
  const normativeLines = lines.filter((line) => NORMATIVE_PATTERN.test(line));

  if (normativeLines.length === 0) {
    process.exit(0);
  }

  const hasMention = MACHINE_CHECK_MENTION.test(addedText);
  if (hasMention) {
    process.exit(0);
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      systemMessage:
        '★規範的な文章（「〜すること」等）を新規追加していますが、' +
        '対応するcheck-*.mjsへの言及や「なぜ機械化できないか」の明示が見当たりません。' +
        'CLAUDE.md「新しいルールを書いたら、その場で機械検査化を検討する」節の3項目を確認しましたか。',
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main();
