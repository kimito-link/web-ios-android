#!/usr/bin/env node
// PreToolUse(Edit|Write|NotebookEdit) ガード。
// セッション内でそのプロジェクトのCLAUDE.mdを「現在の内容のまま」Readした形跡が
// 無ければブロックする。「文章のルールに書いた」を「読んだ」と混同する事故
// (性善説の登録簿依存)を機械で防ぐ。web-ios-androidに限らず、CLAUDE.mdを持つ
// どのプロジェクトでも同じ強制がかかる(グローバル設定 ~/.claude/settings.json から配線)。
//
// 標準入力(JSON)で受け取る主なフィールド: session_id, transcript_path, tool_name, tool_input, cwd
// transcript_path はこのセッションのJSONL会話ログ。各行はメッセージで、
// assistantのtool_use(name:"Read")のinputにfile_pathが入り、対応するtool_result
// (次の行以降、同じtool_use_id)のcontentに実際に読んだ内容が入っている。
//
// ハッシュ比較: 「セッション中にCLAUDE.mdが更新された」場合、古い内容をReadした
// 記録だけでは今の内容を読んだことにならない。そこでtool_resultのcontentから
// SHA256を計算し、現在ディスク上のCLAUDE.mdのSHA256と比較する。

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Git Bash等が渡す /c/Users/... 形式をWindowsネイティブパスへ正規化する。
// 素通しするとpath.resolveがドライブ直下からの相対パス扱いにしてしまい、
// 存在するファイルが「無い」と誤判定される(このhook自身が実際に踏んだ)。
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

function findRepoRoot(startDir) {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Readツールの出力は先頭に "1\t" のような行番号プレフィックスが付く(cat -n形式)。
// ディスク上の生ファイルと比較するため、行番号プレフィックスを剥がして正規化する。
function stripLineNumbers(content) {
  if (typeof content !== 'string') return '';
  return content
    .split('\n')
    .map((line) => line.replace(/^\s*\d+\t/, ''))
    .join('\n');
}

// 会話ログを走査し、指定パスをReadした最新のtool_resultの内容ハッシュを返す。
// 複数回Readされていれば最後の1回を採用する(直近の内容が最新の認識とみなす)。
function findLatestReadHash(transcriptPathRaw, targetPath) {
  const transcriptPath = normalizeWindowsPath(transcriptPathRaw);
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  let raw;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }

  const toolUseIdToPath = new Map();
  let latestHash = null;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block?.type === 'tool_use' && block?.name === 'Read') {
        const fp = block?.input?.file_path;
        if (typeof fp === 'string' && resolve(normalizeWindowsPath(fp)) === targetPath) {
          toolUseIdToPath.set(block.id, true);
        }
      }
      if (block?.type === 'tool_result' && toolUseIdToPath.has(block.tool_use_id)) {
        const raw = typeof block.content === 'string' ? block.content : null;
        if (raw) {
          latestHash = sha256(stripLineNumbers(raw));
        }
      }
    }
  }
  return latestHash;
}

function main() {
  const stdin = readStdin();
  let input;
  try {
    input = JSON.parse(stdin);
  } catch {
    // 入力が壊れている場合はブロックしない(hook自体の不具合でセッションを止めない)。
    process.exit(0);
  }

  const cwd = normalizeWindowsPath(input.cwd) || process.cwd();
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) {
    process.exit(0);
  }

  const claudeMdPath = join(repoRoot, 'CLAUDE.md');
  if (!existsSync(claudeMdPath)) {
    // このリポにCLAUDE.mdが無いなら検査対象外。
    process.exit(0);
  }

  let currentContent;
  try {
    currentContent = readFileSync(claudeMdPath, 'utf8');
  } catch {
    process.exit(0);
  }
  const currentHash = sha256(currentContent);

  const target = resolve(join(repoRoot, 'CLAUDE.md'));
  const lastReadHash = findLatestReadHash(input.transcript_path, target);

  if (lastReadHash === currentHash) {
    process.exit(0);
  }

  const reason =
    lastReadHash === null
      ? 'このセッションでCLAUDE.mdをまだReadしていません。'
      : 'CLAUDE.mdが前回Readした時点から更新されています(古い内容のまま作業しようとしています)。';

  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        reason +
        ' 実装系ツールを使う前に、まず ' +
        claudeMdPath +
        ' をReadしてください（プロジェクトの設計の心臓部）。',
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main();
