#!/usr/bin/env node
// PreToolUse(Bash) ガード。git commit直前を対象に、非ブロッキング警告のみ(fail-open)。
//
// CLAUDE.md基準③「完膚なきまでの裏取り」は、実装した機能を「動かして確認してから
// 完了と報告する」ことを定める。だが文章のルールのままで機械検査が伴っておらず、
// 「実装した→ローカルで軽く触った→もう確認したつもりでcommit」という自己申告への
// 性善説依存（認知の癖4）が繰り返されていた。
//
// 実損（2026-09-29、kimito-link姉妹サービスの認証ちらつき解消セッション）:
// 1回目: exosomeの修正でローカルHTTPサーバーを起動しただけで、ブラウザでの実地確認
//   （navigate/javascript_toolでの実際のcookie挙動確認）をせずコミット・PR作成に
//   進もうとした。ユーザー指摘で初めて実地検証を行った。
// 2回目: surechigai PR #47・exosome PRについて、CIが通ったことだけを確認し、
//   ユーザーの本来の依頼「本番でちらつきが消えたか確認して」には未着手のまま
//   次のPR作成に進んでいた。ユーザーから「キットが裏取りを条件としてるのに、
//   キットが形だけになってる」と指摘された。
//
// このhookは「git commit直前に、ブラウザでの実地確認（mcp__Claude_Browser__*系
// ツール）またはcurl/WebFetchでの実アクセスを行った形跡があるか」という客観的事実
// だけを検出する。「本当に正しく確認できたか」「確認結果が良好だったか」は意味判断
// であり検出できない（偽陽性: 無関係な確認を1回叩けば通過する。偽陰性: UIを持たない
// 純粋なロジック変更やドキュメントのみの変更でも警告が出うる）。
// この限界ゆえブロックしない — permissionDecisionは常にallowで、systemMessageで
// 気づきを促すだけに留める。
//
// 標準入力(JSON): session_id, transcript_path, tool_name, tool_input
// check-write-preceded-by-search.mjsと同じtranscript_path走査パターンを流用する
// （PAIRS対象。5箇所目の複製であることをここに明記し、いずれかを直したら他も揃える）。

import { readFileSync, existsSync } from 'node:fs';

const LOOKBACK_TOOL_USES = 30;
const VERIFICATION_TOOL_PREFIX = 'mcp__Claude_Browser__';
const VERIFICATION_TOOL_NAMES = new Set(['WebFetch']);

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

// check-write-preceded-by-search.mjsと同一ロジック（5箇所目の複製）。
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

// git commit を実行しようとしているBashコマンドか（--amend等も含めて広く拾う）。
function isGitCommitCommand(command) {
  if (typeof command !== 'string') return false;
  return /\bgit\s+commit\b/.test(command);
}

// curlで実際のURLにアクセスしたか。
function isCurlVerification(command) {
  if (typeof command !== 'string') return false;
  return /\bcurl\b/.test(command);
}

function hasVerification(uses) {
  for (const u of uses) {
    if (u.name.startsWith(VERIFICATION_TOOL_PREFIX)) return true;
    if (VERIFICATION_TOOL_NAMES.has(u.name)) return true;
    if (u.name === 'Bash' && isCurlVerification(u.input.command)) return true;
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

  if (input.tool_name !== 'Bash') {
    process.exit(0);
  }

  const toolInput = input.tool_input || {};
  if (!isGitCommitCommand(toolInput.command)) {
    process.exit(0);
  }

  const recentUses = collectRecentToolUses(input.transcript_path, LOOKBACK_TOOL_USES);
  if (hasVerification(recentUses)) {
    process.exit(0);
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      systemMessage:
        '★git commitしようとしていますが、直近' +
        LOOKBACK_TOOL_USES +
        '回のツール呼び出しに、ブラウザでの実地確認（mcp__Claude_Browser__系ツール）や' +
        'curl/WebFetchでの実アクセスが見当たりません。' +
        'CLAUDE.md基準③「完膚なきまでの裏取り」を満たしていますか' +
        '（「編集した」「ローカルで軽く触った」を「確認した」と混同していませんか。' +
        '実際に動かして想定通りの結果になることを確認してからコミットしてください）。' +
        '実損: 2026-09-29、kimito-link姉妹サービスの認証修正で、実地検証を後回しに' +
        'したままコミット・PR作成を進めようとした。',
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main();
