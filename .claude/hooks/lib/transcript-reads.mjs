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
        // 以前は「1行目から読み直したら過去の分を捨てる」としていたが、読む順番で結果が変わり
        // (後半を先に読んでから前半を読むと後半が消える)、巨大ファイルを何度も読み直す羽目になった(2026-10-18)。
        // 古さは行ごとに判定する(findReadCoverage)。ここでは読んだ順に全部残す。
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
  if (chunks.some((c) => c.startLine === null)) return null;
  const linesByNumber = latestLinesByNumber(chunks);
  if (!linesByNumber.has(1)) return null;
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

// 読んだ行の「最新の版」を行番号ごとに持つ。同じ行を複数回読んでいれば、あとから読んだ方が勝つ。
// 巨大ファイルを複数回に分けて読む運用(25000 トークン上限)で、読む順番に結果が左右されないようにする。
function latestLinesByNumber(chunks) {
  const byNumber = new Map();
  for (const chunk of chunks) {
    if (chunk.startLine === null || chunk.startLine === undefined) continue;
    chunk.stripped.split('\n').forEach((lineText, idx) => byNumber.set(chunk.startLine + idx, lineText));
  }
  return byNumber;
}

// 現在のファイル内容に対して、「読んだ行が今の内容と一致している」行の被覆を調べる。
// 返り値: { complete, readAny, staleOrUnread: [[開始行, 終了行], ...] }。
//   complete … 今のファイルの全行について、このセッションで読んだ最新の版が今の内容と一致している。
//   staleOrUnread … 読んでいない行、または読んだ後に書き換わった行の範囲(Read の offset/limit にそのまま使える)。
// ★判定するのは「その行の中身を、今の内容のまま目にした」まで。理解したか・従うかは検出できない。
// 指示書の「必読の核」の範囲。行頭が `<!-- core:end` の行(マーカー)までを核とし、それ以降は判定対象にしない。
// マーカーが無いファイル(他プロジェクトの CLAUDE.md など)は、従来どおり全行が対象。
// なぜ: 1300行超の指示書を全文読ませる判定は、1行足すたびに全員が大量に読み直す高コストになる(2026-10-18 実測)。
//   必ず読む核を小さく保ち、残りはその作業のときだけ読む、という運用を hook が支える。
export function coreLinesOf(text) {
  const lines = normalizeNewlines(text).split('\n');
  const at = lines.findIndex((l) => /^<!--\s*core:end\b/.test(l));
  return at < 0 ? lines : lines.slice(0, at + 1);
}

export function findReadCoverage(transcriptPathRaw, targetPath, currentText, { coreOnly = true } = {}) {
  const chunks = collectReadChunks(transcriptPathRaw, targetPath);
  const byNumber = latestLinesByNumber(chunks);
  const currentLines = coreOnly ? coreLinesOf(currentText) : normalizeNewlines(currentText).split('\n');
  const ranges = [];
  let open = null;
  for (let i = 0; i < currentLines.length; i++) {
    const lineNo = i + 1;
    const fresh = byNumber.has(lineNo) && byNumber.get(lineNo) === currentLines[i];
    if (fresh) {
      if (open) {
        ranges.push([open, lineNo - 1]);
        open = null;
      }
    } else if (!open) {
      open = lineNo;
    }
  }
  if (open) ranges.push([open, currentLines.length]);
  return { complete: ranges.length === 0, readAny: byNumber.size > 0, staleOrUnread: ranges };
}

// 拒否文に入れる「あと何行・どこを読めばよいか」。長い範囲は Read の1回上限に収まるよう分けて示す。
export function describeCoverageGap(coverage, chunkLines = 400) {
  const total = coverage.staleOrUnread.reduce((acc, [x, y]) => acc + (y - x + 1), 0);
  const parts = [];
  for (const [first, last] of coverage.staleOrUnread) {
    for (let from = first; from <= last; from += chunkLines) {
      parts.push(`offset=${from - 1}（${from}〜${Math.min(last, from + chunkLines - 1)}行）`);
    }
  }
  const shown = parts.slice(0, 6).join(' / ');
  return `未読または読んだ後に書き換わった行が計 ${total} 行あります。その範囲だけ Read してください: ${shown}${parts.length > 6 ? ' ほか' : ''}（limit=${chunkLines}）。全文を読み直す必要はありません。`;
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
