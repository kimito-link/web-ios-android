// hook 共通部品: 会話ログ(transcript.jsonl)から「このセッションで何を読んだか」を取り出す。
//
// ★なぜ lib に切り出したか（2026-10-06）: require-claude-md-read.mjs（Edit/Write の前）にだけあった
//   「CLAUDE.md を現在の内容のまま全文 Read したか」の判定を、外向きの操作（push・マージ・デプロイ等）の
//   前でも使う必要が出た（guard-external-actions.mjs）。同じ判定を2つの hook に複製すると、
//   片方だけ直して食い違う（CLAUDE.md「共通化すべきロジックをコピーしない」）ので、ここに1つだけ置く。
//
// 入力はすべて hook の標準入力(JSON)で渡される値: transcript_path / cwd。
// 失敗時は「読んだ形跡なし」(null/false)を返す＝呼び出し側が fail-closed か fail-open かを決める。

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Git Bash 等が渡す /c/Users/... をWindowsネイティブパスへ。素通しすると path.resolve が
// ドライブ直下からの相対扱いにして、存在するファイルを「無い」と誤判定する（実際に踏んだ）。
export function normalizeWindowsPath(p) {
  if (process.platform !== 'win32' || typeof p !== 'string') return p;
  const m = /^\/([a-zA-Z])\/(.*)$/.exec(p);
  if (m) return `${m[1]}:\\${m[2].replace(/\//g, '\\')}`;
  return p;
}

export function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

export function findRepoRoot(startDir) {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}

// 改行コードを LF へ揃える。ディスク上の CLAUDE.md（Windows の CRLF のことがある）と、
// Read ツールが返す tool_result（常に LF）を同じ土俵で比べるため。
export function normalizeNewlines(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/\r\n/g, '\n').replace(/\n+$/, '');
}

export function sha256(text) {
  return createHash('sha256').update(normalizeNewlines(text), 'utf8').digest('hex');
}

// Read ツールの出力は先頭に "1\t" のような行番号が付く(cat -n 形式)。生ファイルと比べるため剥がす。
export function stripLineNumbers(content) {
  if (typeof content !== 'string') return '';
  return content
    .split('\n')
    .map((line) => line.replace(/^\s*\d+\t/, ''))
    .join('\n');
}

// Read 出力の先頭行の行番号。offset 付きの部分読みでも絶対行番号が付くので、
// そのチャンクが元ファイルの何行目から始まるかが分かる。
export function rawFirstLineNumber(content) {
  const firstLine = content.split('\n', 1)[0] || '';
  const m = /^\s*(\d+)\t/.exec(firstLine);
  return m ? Number(m[1]) : null;
}

// transcript を1行ずつ JSON として返す（壊れた行は飛ばす）。読めなければ空配列。
export function readTranscriptEntries(transcriptPathRaw) {
  const transcriptPath = normalizeWindowsPath(transcriptPathRaw);
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  let raw;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // 壊れた行は無視
    }
  }
  return out;
}

// targetPath を Read した全チャンク（行番号つき）を集める。25000 トークン上限で
// 大きなファイルは offset/limit に分けて読まれるので、後段で隙間なく繋がるか確かめる。
export function collectReadChunks(transcriptPathRaw, targetPath) {
  const toolUseIdToPath = new Set();
  let chunks = [];
  for (const entry of readTranscriptEntries(transcriptPathRaw)) {
    const content = entry && entry.message ? entry.message.content : null;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && block.type === 'tool_use' && block.name === 'Read') {
        const fp = block.input ? block.input.file_path : null;
        if (typeof fp === 'string' && resolve(normalizeWindowsPath(fp)) === targetPath) {
          toolUseIdToPath.add(block.id);
        }
      }
      if (block && block.type === 'tool_result' && toolUseIdToPath.has(block.tool_use_id)) {
        const rawContent = typeof block.content === 'string' ? block.content : null;
        if (!rawContent) continue;
        const startLine = rawFirstLineNumber(rawContent);
        if (startLine === 1) chunks = []; // 先頭から読み直した＝それ以前の分は古い
        chunks.push({ startLine, stripped: stripLineNumbers(rawContent) });
      }
    }
  }
  return chunks;
}

// チャンクを行番号順に繋いで全文にする。隙間があれば null（fail-closed:
// 「たぶん全部読んだ」は、一度壊れた鮮度ガードには足りない）。
export function assembleFullText(chunks) {
  if (chunks.length === 0) return null;
  if (chunks.length === 1 && chunks[0].startLine === 1) return chunks[0].stripped;
  const sorted = chunks.slice().sort((a, b) => (a.startLine || 0) - (b.startLine || 0));
  if (sorted[0].startLine !== 1) return null;
  const linesByNumber = new Map();
  for (const chunk of sorted) {
    if (chunk.startLine === null) return null;
    chunk.stripped.split('\n').forEach((lineText, idx) => linesByNumber.set(chunk.startLine + idx, lineText));
  }
  const maxLine = Math.max(...linesByNumber.keys());
  const assembled = [];
  for (let i = 1; i <= maxLine; i++) {
    if (!linesByNumber.has(i)) return null;
    assembled.push(linesByNumber.get(i));
  }
  return assembled.join('\n');
}

// このセッションで targetPath を全文 Read していれば、その全文の SHA256。していなければ null。
export function findFullReadHash(transcriptPathRaw, targetPath) {
  const fullText = assembleFullText(collectReadChunks(transcriptPathRaw, targetPath));
  return fullText === null ? null : sha256(fullText);
}

// 「このセッションで、その文字列に触れたか」の事実だけを見る（tool_use の入力に含まれるか）。
// 例: coord.md を Read/cat/grep した形跡。中身を読んだかどうか・正しく理解したかは判定しない。
// ★検出できるのは「触れた」まで。「意味を踏まえて行動した」は機械では分からない。
export function transcriptTouchedPath(transcriptPathRaw, needle) {
  for (const entry of readTranscriptEntries(transcriptPathRaw)) {
    const content = entry && entry.message ? entry.message.content : null;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && block.type === 'tool_use' && block.input) {
        let s = '';
        try {
          s = JSON.stringify(block.input);
        } catch {
          s = '';
        }
        // JSON.stringify は \ を \\ にする。区切りは / と \ の両方を許して比べる。
        const norm = s.replace(/\\\\/g, '/').replace(/\\/g, '/');
        if (norm.includes(needle)) return true;
      }
    }
  }
  return false;
}
