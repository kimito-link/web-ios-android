#!/usr/bin/env node
// PreToolUse(Bash) ガード（拒否・fail-open）: AI の修正で「頼まれていない機能」が消えたまま
// commit / push / PR 作成に進ませない。正本: docs/ai-rules/11_NO_REGRESSION.md。
//
// なぜ要るか（2026-11-14 りんく「これがおこらないようにして」「サイト全体で」）:
//   「AI にバグを直させたら、元々動いていたログイン・検索・設定が消えた」という事故が広く共有された。
//   AI は直す対象のファイルを丸ごと書き直しがちで、そのとき関係ない部分を落とす。
//   「関係ない所は触らない」と文章で書いても、書き直す瞬間には読まれない。
//   ⟹ 外へ出す直前（commit・push・PR 作成）に差分から「消えたもの」を拾い、
//     コミットメッセージ／PR 本文に「消してよい: 名前（理由）」と書いたものだけ通す。
//
// 判定の中身は templates/diagnostics/check-unrequested-removal.mjs（配布用の正本）を読み込んで使う。
// 同じ判定を2か所に書かない（CI も同じファイルを使う）。読み込めない場所に置かれたら何もしない（fail-open）。
// ★全プロジェクトで効かせるときは、この hook と check-unrequested-removal.mjs を同じフォルダ
//   （例: ~/.claude/hooks/）に置き、~/.claude/settings.json の PreToolUse(Bash) に配線する。
//
// 判定しないこと: 消した後も動くか（テスト・features.json の仕事）／宣言の理由が本当か。
// 無効化: 環境変数 REMOVAL_CHECK_OFF=1。壊れた入力・git が無い場所は通す（fail-open）。

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_CANDIDATES = [
  join(HERE, 'check-unrequested-removal.mjs'),
  resolve(HERE, '../../templates/diagnostics/check-unrequested-removal.mjs'),
];

/** 見張るコマンドを読む。引用符の中（コミットメッセージ）は宣言として使うので、ここでは消さない。 */
export function classify(cmd) {
  const s = String(cmd || '');
  // コマンドの頭（行頭・; && || | ( の直後）にあるものだけ。`echo git commit` は拾わない。
  const at = (body) => new RegExp(`(^|[;&|(\\n])\\s*(?:[A-Za-z_]\\w*=\\S*\\s+)*${body}`).test(s);
  if (at('git\\s+(?:-C\\s+\\S+\\s+)?commit\\b')) {
    const all = /\bcommit\b[^\n]*?\s(?:-[a-zA-Z]*a[a-zA-Z]*|--all)(\s|$)/.test(s);
    return { kind: 'commit', workingTree: all };
  }
  if (at('git\\s+(?:-C\\s+\\S+\\s+)?push\\b')) return { kind: 'push' };
  if (at('gh\\s+pr\\s+(create|ready)\\b')) return { kind: 'pr' };
  return null;
}

/** `cd <dir> &&` で始まるなら、その場所で見る。 */
export function leadingCd(cmd) {
  const m = /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*&&/.exec(String(cmd));
  return m ? m[1] || m[2] || m[3] : null;
}

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

async function main() {
  if (process.env.REMOVAL_CHECK_OFF === '1') process.exit(0);
  let input;
  try { input = JSON.parse(readStdin()); } catch { process.exit(0); }
  if (!input || input.tool_name !== 'Bash') process.exit(0);
  const cmd = input.tool_input && typeof input.tool_input.command === 'string' ? input.tool_input.command : '';
  const c = classify(cmd);
  if (!c) process.exit(0);

  const corePath = CORE_CANDIDATES.find((p) => existsSync(p));
  if (!corePath) process.exit(0);
  let core;
  try { core = await import(pathToFileURL(corePath).href); } catch { process.exit(0); }

  const cd = leadingCd(cmd);
  const root = cd ? resolve(input.cwd || process.cwd(), cd) : input.cwd || process.cwd();
  const r = core.run({
    root,
    staged: c.kind === 'commit' && !c.workingTree,
    workingTree: c.kind === 'commit' && c.workingTree,
    message: cmd, // コミットメッセージ・PR 本文はコマンドの中にある
  });
  if (r.exit !== core.EXIT.FAIL) process.exit(0); // 測れなかった(2)は止めない（fail-open）

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: r.text,
    },
  }));
  process.exit(0);
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main();
