// runner.mjs — 人に渡すスクリプト（ダブルクリックする黒い画面）の共通の骨組み。
//   役割: 手順を「段」に分けて順に実行し、各段の前後で状態ファイルを書く。済んだ段は飛ばすので、
//         何度ダブルクリックしても途中から続く。Enter 待ち・pause・Read-Host は使わず、
//         待つのは「クリップボードに値が来た」「ファイルができた」などの出来事だけ。
//   なぜ要るか: 2026-10-28、黒い画面が「Enter を押して」で止まり、AI からは中身が見えず、
//         人に「いちばん下の行を送って」と頼んでいた（docs/ai-rules/08_NO_HUMAN_HANDS.md §4・§5）。
//         状態をファイルに書けば、AI がフォルダ接続や Remote Control で読んで続きを判断できる。
//   使い方: README.md。最小例は example.mjs。
//   ★秘密の値（コピーされた鍵）は状態ファイル・ログに書かない。段の中でだけ使い、書くのは「受け取った」という事実と長さだけ。
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 状態ファイルの置き場所。AI が読みに行く場所を全スクリプトで1つにそろえる。 */
export function runDir(name, base = process.env.AI_RUNS_DIR || join(homedir(), '.ai-runs')) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`name は英小文字・数字・ハイフンだけ: ${name}`);
  return join(base, name);
}

export function readState(dir) {
  const p = join(dir, 'state.json');
  if (!existsSync(p)) return { done: {}, status: 'new' };
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { done: {}, status: 'new' }; }
}

function writeState(dir, state) {
  const p = join(dir, 'state.json');
  writeFileSync(p + '.tmp', JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2));
  renameSync(p + '.tmp', p); // 読みかけの半端なファイルを AI に見せない
}

/**
 * 段を順に実行する。各段は { id, title, run(ctx) }。run は値を返してよい（秘密でないものだけ状態に残る）。
 * ctx.waitingHuman(what, url) — 人の1タップを待っていることを状態に書く（何を・どこで）。
 * ctx.log(msg) — ログに1行。
 * @returns {Promise<{status: 'done'|'failed', failedStep?: string}>}
 */
export async function runSteps({ name, steps, dir = runDir(name), print = console.log }) {
  mkdirSync(dir, { recursive: true });
  const state = readState(dir);
  state.done ||= {};
  const log = (msg) => { appendFileSync(join(dir, 'log.txt'), `${new Date().toISOString()} ${msg}\n`); print(msg); };
  const total = steps.length;
  for (const [i, step] of steps.entries()) {
    const head = `[${i + 1}/${total}] ${step.title}`;
    if (state.done[step.id]) { log(`${head} … 済み（飛ばします）`); continue; }
    Object.assign(state, { status: 'running', step: step.id, stepTitle: step.title, waiting: null, error: null });
    writeState(dir, state);
    log(`${head} …`);
    const ctx = {
      log,
      waitingHuman: (what, url = null) => {
        state.status = 'waiting_human'; state.waiting = { what, url };
        writeState(dir, state);
        log(`  → ${what}${url ? `\n     ${url}` : ''}`);
      },
    };
    try {
      const result = await step.run(ctx);
      state.done[step.id] = { at: new Date().toISOString(), result: result ?? null };
      state.status = 'running'; state.waiting = null;
      writeState(dir, state);
      log(`${head} … できました`);
    } catch (e) {
      Object.assign(state, { status: 'failed', error: String(e?.message || e) });
      writeState(dir, state);
      log(`${head} … 止まりました: ${state.error}`);
      log('もう一度ダブルクリックすると、ここから続きます。');
      return { status: 'failed', failedStep: step.id };
    }
  }
  Object.assign(state, { status: 'done', step: null, stepTitle: null });
  writeState(dir, state);
  log('ぜんぶ終わりました。この画面は閉じて大丈夫です。');
  return { status: 'done' };
}

/** 今のクリップボードの文字列（Windows / macOS / Linux）。読めなければ ''。 */
export function readClipboard() {
  const tries = process.platform === 'win32'
    ? [['powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw']]]
    : process.platform === 'darwin' ? [['pbpaste', []]]
    : [['wl-paste', ['--no-newline']], ['xclip', ['-selection', 'clipboard', '-o']]];
  for (const [cmd, args] of tries) {
    try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* 次 */ }
  }
  return '';
}

/**
 * pattern に合う値がクリップボードに来るまで待つ（Enter の代わり）。
 * 既定では始めた時点の中身は無視する（前の古い鍵を拾わないため）。先にコピーしてから
 * 起動し直す流れを許すなら acceptExisting: true（2026-10-28、コピー済みなのに Enter 待ちで止まった実損）。
 * ★値そのものは返すだけで、どこにも書かない。
 */
export async function waitForClipboard(pattern, { timeoutMs = 30 * 60_000, intervalMs = 1000, read = readClipboard, acceptExisting = false } = {}) {
  const before = acceptExisting ? null : read();
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = read();
    if (v && v !== before && pattern.test(v)) return v;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('待ち時間を過ぎました（コピーが届きませんでした）');
}

/** ファイルができるまで待つ。 */
export async function waitForFile(path, { timeoutMs = 30 * 60_000, intervalMs = 1000 } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (existsSync(path)) return path;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`待ち時間を過ぎました（${path} ができませんでした）`);
}
