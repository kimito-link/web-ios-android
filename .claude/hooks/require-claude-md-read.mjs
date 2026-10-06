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
import {
  findFullReadHash,
  findRepoRoot,
  normalizeWindowsPath,
  readStdin,
  sha256,
} from './lib/transcript-reads.mjs';

// ★判定部品（transcript の走査・全文Readの組み立て・ハッシュ）は lib/transcript-reads.mjs に1つだけ置く。
//   guard-external-actions.mjs（push・マージ・デプロイ等の前）と共有するため（複製すると片方だけ直して食い違う）。

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

  // 編集対象のファイル自体がrepoRoot配下に無いなら検査対象外。
  // findRepoRootはcwdから祖先の.gitを探すため、リポジトリ内でセッションを
  // 開いたまま ~/.claude/plans/*.md のようなリポジトリ外のファイルを編集すると、
  // 無関係なそのリポのCLAUDE.md読了チェックが誤爆する(このセッション自身が実際に踏んだ)。
  const editTargetRaw =
    input.tool_input && typeof input.tool_input.file_path === 'string'
      ? input.tool_input.file_path
      : null;
  if (editTargetRaw) {
    const editTarget = resolve(normalizeWindowsPath(editTargetRaw));
    const repoRootResolved = resolve(repoRoot) + '\\';
    if (!(editTarget + '\\').startsWith(repoRootResolved) && editTarget !== resolve(repoRoot)) {
      process.exit(0);
    }
  }

  let currentContent;
  try {
    currentContent = readFileSync(claudeMdPath, 'utf8');
  } catch {
    process.exit(0);
  }
  const currentHash = sha256(currentContent);

  const target = resolve(join(repoRoot, 'CLAUDE.md'));
  const lastReadHash = findFullReadHash(input.transcript_path, target);

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
