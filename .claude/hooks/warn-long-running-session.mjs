#!/usr/bin/env node
// UserPromptSubmit ガード。非ブロッキング警告のみ(fail-open)。
//
// CLAUDE.md「★★この修正が効かない既知のケース: 既に開いたまま動いている
// セッション」節（正本への自動到達経路の項）は、Claude Codeがセッション開始時
// にしか指示書を読み込まないため、稼働中セッションには祖先ディレクトリの
// CLAUDE.md更新が反映されないと定める。だがこれまでは「気づいたら疑う」
// という人間の注意力に依存しており、機械検知が無かった。
//
// 実損（2026-09-26）: kimitolink-linktreeセッションが2026-08-31から
// 一度も再起動されず26日間継続稼働しており、その間にweb-ios-android/CLAUDE.md
// へ追記された全ルール（「直接URLを併記する」等）を一切反映していなかった。
// ユーザーがスクリーンショットで指摘して初めて発覚した。
//
// このhookは「セッション開始からの経過時間」という客観的事実だけを検出する。
// 「CLAUDE.mdが実際に古いか」「今回の応答がルール違反か」は意味判断であり
// 検出できない（経過時間が長くても、そのセッション中に明示的にCLAUDE.mdを
// Readしていれば最新化されている可能性がある。逆に経過時間が短くても
// セッション開始直後にCLAUDE.mdが書き換わっていれば同じ問題が起きる）。
// この限界ゆえブロックしない — 常にexit 0で、additionalContextで
// 気づきを促すだけに留める。
//
// ★実装上の重要な訂正（2026-09-26、事前調査エージェントの誤りを実測で修正）:
// 当初「セッションディレクトリのファイルシステム上のbirthtime」で開始時刻を
// 判定する設計を検討したが、実測したところWindows環境のbirthtimeは
// ファイルの実際のセッション開始と無関係な古い日付を返すことがあり
// （このキット自身の調査で2026-09-02という無関係な値が返った）、信頼できない
// と判明した。★正しい方法は、transcript.jsonl自体の**先頭行**に埋め込まれた
// `timestamp`フィールドを読むこと（実測で確認済み、queue-operation/user等
// 種別を問わず各エントリに存在する）。ファイルシステムのメタデータより
// transcriptの中身の方が正本である。
//
// 標準入力(JSON): session_id, transcript_path, prompt, cwd
// require-claude-md-read.mjsと同じtranscript_path走査パターンを流用する。

import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

// ★警告を出す閾値。実測した実損(26日間)より大幅に短い12時間に設定する。
//   長時間セッションは異常ではなく実態として起こりうる運用（並列セッション
//   協調プロトコル節を参照）なので、短すぎる閾値は「いつも警告が出る」
//   オオカミ少年になる。CLAUDE.md掟⑥と同じ考え方で、まず緩めに始める。
const WARN_THRESHOLD_HOURS = 12;

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

// transcriptの先頭行だけを読み、最初に見つかった有効なtimestampを返す。
// ★全行読み込みをしない（24時間超のセッションではファイルが数十MBに
//   達しうるため。行ストリームで最初の数行だけ見て打ち切る）。
async function readFirstTimestamp(transcriptPathRaw) {
  const transcriptPath = normalizeWindowsPath(transcriptPathRaw);
  if (!transcriptPath || !existsSync(transcriptPath)) return null;

  return new Promise((resolve) => {
    const stream = createReadStream(transcriptPath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let linesChecked = 0;
    const MAX_LINES_TO_CHECK = 10;
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      rl.close();
      stream.destroy();
      resolve(value);
    };

    rl.on('line', (line) => {
      linesChecked += 1;
      const trimmed = line.trim();
      if (trimmed) {
        try {
          const entry = JSON.parse(trimmed);
          if (entry && typeof entry.timestamp === 'string') {
            finish(entry.timestamp);
            return;
          }
        } catch {
          // 壊れた行は無視して次へ
        }
      }
      if (linesChecked >= MAX_LINES_TO_CHECK) finish(null);
    });
    rl.on('close', () => finish(null));
    rl.on('error', () => finish(null));
  });
}

async function main() {
  const stdin = readStdin();
  let input;
  try {
    input = JSON.parse(stdin);
  } catch {
    process.exit(0);
  }

  const firstTimestamp = await readFirstTimestamp(input.transcript_path);
  if (!firstTimestamp) process.exit(0); // 測れなければ何もしない(fail-open)

  const startMs = Date.parse(firstTimestamp);
  if (Number.isNaN(startMs)) process.exit(0);

  const elapsedHours = (Date.now() - startMs) / (1000 * 60 * 60);
  if (elapsedHours < WARN_THRESHOLD_HOURS) process.exit(0);

  const elapsedDays = (elapsedHours / 24).toFixed(1);
  const output = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext:
        `★このセッションは${elapsedDays}日前(約${Math.floor(elapsedHours)}時間前)に開始されました。` +
        'Claude Codeはセッション開始時にしか指示書(CLAUDE.md)を読み込まないため、' +
        'その後の更新が反映されていない可能性があります' +
        '（web-ios-android/CLAUDE.md「★★この修正が効かない既知のケース」節参照）。' +
        '疑わしい場合は `web-ios-android/CLAUDE.md` を今すぐReadして最新化するか、' +
        '新しいセッションに切り替えてください。',
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main();
