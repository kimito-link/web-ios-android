#!/usr/bin/env node
// web-ios-android-relay.mjs — 他プロジェクトのセッションから、web-ios-android の hook を呼ぶ中継。
//
// ■ なぜ要るか
//   web-ios-android の hook（guard-external-actions など）は、このリポの .claude/settings.json からは
//   `${CLAUDE_PROJECT_DIR}` で呼べるが、他プロジェクト（line-bot 等）のセッションからは場所が分からない。
//   そこで ~/.claude/settings.json に `node "<~/.claude/hooks>/web-ios-android-relay.mjs" <hook名.mjs>` と書き、
//   この中継が checkout を探して、その `.claude/hooks/<hook名.mjs>` を起動する。
//   以前は PC の ~/.claude/hooks/ にだけ実体があり、新しい PC のたびに人の手と記憶に頼っていた（2026-11-16 リポへ）。
//   入れ方: `node templates/hooks-relay/install.mjs`（README.md）。
//
// ■ checkout を探す順（最初に見つかったもの）
//   1. 環境変数 WEB_IOS_ANDROID_DIR
//   2. 作業ディレクトリ（stdin の cwd → CLAUDE_PROJECT_DIR → process.cwd()）とその祖先。各階層で「そこ自身」と
//      「その下の web-ios-android」（兄弟リポの形）を見る
//   3. install.mjs が書いた web-ios-android-relay.json の root（この中継と同じフォルダ）
//   4. 各 PC の決まった置き場所（warn-long-running-session.mjs の findWebIosAndroidRoot と同じ並び）
//   5. ~/.claude/web-ios-android（hook 専用の浅い clone）
//   「web-ios-android の checkout」とは、package.json の name が web-ios-android で `.claude/hooks/` があるフォルダ。
//
// ■ 失敗したとき（既存 hook 群と同じ fail-open）
//   checkout が無い・hook ファイルが無い・引数が不正 → hook を起動せず exit 0（stderr に1行）。
//   hook 自体の不具合や置き場所の問題でセッションを止めない。止めるかどうかは起動した hook の終了コードだけが決める。
//
// ■ 引数はファイル名だけ（`guard-external-actions.mjs`）。パス区切り・`..` は受け付けない（任意のファイル実行を防ぐ）。
//   stdin・stdout・stderr・終了コードはそのまま通す。

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SIDECAR_NAME = 'web-ios-android-relay.json';
const HOOK_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:mjs|cjs|js)$/;

/** hook 名として受け付けてよいか（ファイル名だけ。パス区切り・`..` は不可）。 */
export function isValidHookName(name) {
  return typeof name === 'string' && HOOK_NAME_RE.test(name) && !name.includes('..');
}

/** Windows のパス表記ゆれ（/c/Users/... → C:\Users\...）だけ直す。 */
function normalizePath(p) {
  if (typeof p !== 'string' || !p) return null;
  const m = /^\/([a-zA-Z])\/(.*)$/.exec(p);
  return m && process.platform === 'win32' ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}` : p;
}

/** dir が web-ios-android の checkout か（package.json の name と .claude/hooks/ で見る）。 */
export function isCheckout(dir) {
  try {
    if (!statSync(join(dir, '.claude', 'hooks')).isDirectory()) return false;
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return pkg?.name === 'web-ios-android';
  } catch {
    return false;
  }
}

/** 探す順に並べた候補（重複は除く）。純関数に近い形にして、テストで HOME・cwd を差し替えられるようにする。 */
export function candidateRoots({ env = process.env, cwds = [], home = homedir(), relayDir } = {}) {
  const out = [];
  const push = (p) => {
    if (p && !out.includes(p)) out.push(p);
  };
  if (env.WEB_IOS_ANDROID_DIR) push(resolve(env.WEB_IOS_ANDROID_DIR));
  for (const start of cwds) {
    if (!start) continue;
    let d = resolve(start);
    for (;;) {
      push(d);
      push(join(d, 'web-ios-android'));
      const up = dirname(d);
      if (up === d) break;
      d = up;
    }
  }
  if (relayDir) {
    try {
      const side = JSON.parse(readFileSync(join(relayDir, SIDECAR_NAME), 'utf8'));
      if (typeof side?.root === 'string' && side.root) push(resolve(side.root));
    } catch {
      // 置き場所の記録が無い・壊れている → 次の候補へ
    }
  }
  const rel = ['github', 'web-ios-android'];
  // ★意図的な複製: .claude/hooks/warn-long-running-session.mjs の findWebIosAndroidRoot と同じ並び。
  //   あちらは中継経由で呼ばれる側なので、この中継を import できない（同期対象。片方を変えたらもう片方も）。
  for (const p of [
    join(home, 'OneDrive', 'デスクトップ', 'Resilio', ...rel),
    join(home, 'Desktop', 'Resilio', ...rel),
    join(home, ...rel),
    join(home, 'Documents', ...rel),
    join(home, 'repos', 'web-ios-android'),
    join(home, 'projects', 'web-ios-android'),
    join(home, '.claude', 'web-ios-android'),
  ]) push(p);
  return out;
}

/** 候補のうち、指定の hook ファイルを持つ最初の checkout を返す。無ければ null。 */
export function findHook(hookName, opts) {
  for (const root of candidateRoots(opts)) {
    if (!isCheckout(root)) continue;
    const file = join(root, '.claude', 'hooks', hookName);
    if (existsSync(file)) return { root, file };
  }
  return null;
}

function note(msg) {
  process.stderr.write(`[web-ios-android-relay] ${msg}\n`);
}

function main() {
  const [hookName, ...rest] = process.argv.slice(2);
  if (!isValidHookName(hookName)) {
    note(`hook 名が不正なので起動しません（ファイル名だけを渡す）: ${JSON.stringify(hookName ?? null)}`);
    process.exit(0);
  }
  let stdin = Buffer.alloc(0);
  try {
    stdin = readFileSync(0);
  } catch {
    // stdin が無い（手で試したとき等）
  }
  let inputCwd = null;
  try {
    inputCwd = normalizePath(JSON.parse(stdin.toString('utf8'))?.cwd);
  } catch {
    // JSON でなければ cwd は使わない
  }
  const found = findHook(hookName, {
    cwds: [inputCwd, normalizePath(process.env.CLAUDE_PROJECT_DIR), process.cwd()],
    relayDir: dirname(fileURLToPath(import.meta.url)),
  });
  if (!found) {
    note(`${hookName} を持つ web-ios-android の checkout が見つからないので素通しします（WEB_IOS_ANDROID_DIR で場所を指定できます）`);
    process.exit(0);
  }
  const r = spawnSync(process.execPath, [found.file, ...rest], { input: stdin, stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.error) {
    note(`${hookName} を起動できませんでした: ${r.error.message}`);
    process.exit(0);
  }
  process.exit(typeof r.status === 'number' ? r.status : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
