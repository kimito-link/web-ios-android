#!/usr/bin/env node
// PreToolUse(Write|Edit) ガード。非ブロッキング警告のみ(fail-open)。
//
// CLAUDE.md非交渉ルール1番「実装前に既存実装を検索する」・基準②「車輪の
// 再発明をしない」は、Write/Editで新規コード（特に新規関数定義）を書く前に
// Grep/Globで既存実装を探すよう定める。だが文章のルールのままで機械検査が
// 伴っていなかった。
//
// 実損（2026-09-27〜28、soushin-suggest.link）: 同一セッション内で3回、
// 「既存実装を検索せずに新規関数を書く」が繰り返された。1回目はヘッダーバンド
// を座標手打ちで自作（既存の確立されたヘッダーバンド実装を見ずに）、2回目は
// フッター実装（AddWindowFooter・LauncherRelayoutFooterForWidth）を新規に
// 2つ作った（ランチャーに既に13部品の完成したフッターがあったのに見なかった）、
// 3回目はさらに深刻——自分自身が074-common.ahkに作ったAddWindowFooter()を、
// 別ファイルでは使わず個別実装のままにした（同じセッション内での自己不整合）。
// このhookは check-ask-preceded-by-research.mjs と同じ設計思想（transcript
// 走査・非ブロッキング・fail-open）で、この失敗パターンへ機械検査を足す。
//
// このhookは「Write/Edit直前にGrep/Globを呼んだか」という客観的事実だけを
// 検出する（call-before-write heuristic）。「本当に重複を探したか」
// 「見つけた既存実装を正しく評価したか」は意味判断であり検出できない
// (偽陽性: 無関係な調査を数回叩けば通過する。偽陰性: 新規ファイル作成や
// 既存ファイルの単純な追記など、そもそも重複検索が不要な変更でも警告が出る)。
// この限界ゆえブロックしない — permissionDecisionは常にallowで、
// systemMessageで気づきを促すだけに留める。
//
// 標準入力(JSON): session_id, transcript_path, tool_name, tool_input
// require-claude-md-read.mjs・check-ask-preceded-by-research.mjsと同じ
// transcript_path走査パターンを流用する（PAIRS対象。3箇所目の複製である
// ことをここに明記し、いずれかを直したら他も揃える）。

import { readFileSync, existsSync } from 'node:fs';

const SEARCH_TOOLS = new Set(['Grep', 'Glob']);
const LOOKBACK_TOOL_USES = 15;

// ★新規関数定義の目印。言語非依存の緩い検出（偽陰性側に倒す方針——
//   検出漏れは「警告が出ない」だけで実害が無いが、誤検知は「無視される
//   計器」を作ってしまい、既存のcheck-doc-rot.mjs等と同じ設計思想に反する）。
const NEW_FUNCTION_PATTERNS = [
  /function\s+[A-Za-z_$][\w$]*\s*\(/, // JS/TS/AHKのfunction宣言
  /^[A-Za-z_][\w]*\s*\([^)]*\)\s*\{?\s*$/m, // AutoHotkey v2の関数定義（行頭・波括弧なしもあり）
  /const\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?\(/, // アロー関数の代入
  /def\s+[A-Za-z_][\w]*\s*\(/, // Python
];

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

// check-ask-preceded-by-research.mjsと同一ロジック（3箇所目の複製）。
function collectRecentToolNames(transcriptPathRaw, limit) {
  const transcriptPath = normalizeWindowsPath(transcriptPathRaw);
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  let raw;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }

  const names = [];
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0 && names.length < limit; i--) {
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
    for (let j = content.length - 1; j >= 0 && names.length < limit; j--) {
      const block = content[j];
      if (block && block.type === 'tool_use' && typeof block.name === 'string') {
        names.push(block.name);
      }
    }
  }
  return names;
}

// 新規に書こうとしている内容(new_stringまたはcontent)に、新規関数定義らしき
// パターンが含まれるか。含まれなければ「重複検索が要る変更」ではない可能性が
// 高い（単純な文言修正・既存関数の呼び出し追加等）ので、このhookの対象外とする。
function looksLikeNewFunctionDefinition(toolInput) {
  const text = toolInput && (toolInput.new_string || toolInput.content || '');
  if (typeof text !== 'string' || !text) return false;
  return NEW_FUNCTION_PATTERNS.some((re) => re.test(text));
}

function main() {
  const stdin = readStdin();
  let input;
  try {
    input = JSON.parse(stdin);
  } catch {
    process.exit(0);
  }

  if (input.tool_name !== 'Write' && input.tool_name !== 'Edit') {
    process.exit(0);
  }

  if (!looksLikeNewFunctionDefinition(input.tool_input)) {
    process.exit(0);
  }

  const recentNames = collectRecentToolNames(input.transcript_path, LOOKBACK_TOOL_USES);
  const hasSearch = recentNames.some((name) => SEARCH_TOOLS.has(name));

  if (hasSearch) {
    process.exit(0);
  }

  // 非ブロッキング: permissionDecisionは明示的にallow、systemMessageで
  // モデルのコンテキストへ警告を注入する。fail-open — このhook自体が
  // 壊れていても書き込みをブロックしてはいけない。
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      systemMessage:
        '★新しい関数定義らしきコードを書こうとしていますが、直近' +
        LOOKBACK_TOOL_USES +
        '回のツール呼び出しにGrep/Globが見当たりません。' +
        'CLAUDE.md非交渉ルール1番「実装前に既存実装を検索する」・基準②「車輪の再発明をしない」' +
        'を確認しましたか（同じ責務の実装が既にリポジトリ内に無いか、書く前に一度確認してください）。',
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main();
