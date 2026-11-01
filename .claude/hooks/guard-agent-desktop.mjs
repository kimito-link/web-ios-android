#!/usr/bin/env node
// guard-agent-desktop.mjs — PC のアプリを操作する道具 agent-desktop の「危ない使い方」だけを止めるフック。
//
// なぜ要るか(2026-11-01・agent-desktop 採用):
//   agent-desktop は既定で裏で動く(マウス・キーを奪わない)が、--headed で本物のマウス・キーを動かせ、
//   --force で alt+f4・win+l などの柵を外せ、clipboard-get でクリップボード(鍵が入っていることがある)を読める。
//   文章の決まりは読まれなければ形だけなので(CLAUDE.md「非ブロッキングの警告は…」)、事実で拾えるものは拒否する。
//   正本: docs/ai-workflows/AGENT-DESKTOP-HOWTO.md §4・§5・§7
// 使い方: .claude/settings.json の PreToolUse(matcher: Bash) に配線する。
// 判定しないこと: どのアプリを触っているか・押すボタンが取り消せないか(意味の判断。AI が §5 を当てる)/引用符に隠した呼び出し。
// I/O: 標準入力(JSON)で tool_name, tool_input を受け取り、該当すれば PreToolUse の deny を返す。読めなければ止めない(fail-open)。

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStdin } from './lib/transcript-reads.mjs';

const HOWTO = '正本: docs/ai-workflows/AGENT-DESKTOP-HOWTO.md';
// agent-desktop の呼び出し。コマンドの先頭にあるときだけ数える(環境変数の前置き・npx・PowerShell の & ・パス付き・.cmd/.exe を許す)。
// grep "agent-desktop --force" のような、文字として含むだけのものは拾わない。
const INVOKE = /^\s*(\w+=("[^"]*"|'[^']*'|\S+)\s+)*(npx\s+(-y\s+)?)?(&\s*)?['"]?[^\s'"]*?agent-desktop(\.cmd|\.exe)?['"]?(?=\s|$)/;
// npm/pnpm/yarn/bun で agent-desktop を入れる行。
const INSTALL = /\b(npm|pnpm|yarn|bun)\s+(i|install|add)\b[^;&|\n]*?(^|\s)agent-desktop(@\S*)?(?=\s|$)/;
const HEADED_OK = /\bAGENT_DESKTOP_HEADED_OK_BY_USER=("[^"]+"|'[^']+'|\S+)/;

// コマンドを ; && || | 改行 で区切った各部分ごとに見る(別コマンドの --force を拾わない)。
function segments(command) {
  return command.split(/\n|;|&&|\|\||\|/);
}

// 純関数。返り値 null=通す / 文字列=拒否理由。
export function decide(toolName, toolInput) {
  if (toolName !== 'Bash') return null;
  const command = toolInput && typeof toolInput.command === 'string' ? toolInput.command : '';
  if (!command.includes('agent-desktop')) return null;

  for (const seg of segments(command)) {
    const install = seg.match(INSTALL);
    if (install) {
      if (!/^@\d/.test(install[4] || '')) {
        return (
          'agent-desktop を版なしで入れようとしています。止めました。\n' +
          '版を固定して入れる(例: npm install -g agent-desktop@1.0.2)。上げるときは HOWTO の版の行も一緒に直す。\n' +
          HOWTO
        );
      }
      continue;
    }
    if (!INVOKE.test(seg)) continue;
    if (/(^|\s)--force(?=\s|=|$)/.test(seg)) {
      return (
        'agent-desktop の --force(alt+f4・win+l などの危ない近道キーの柵を外す)を使おうとしています。止めました。\n' +
        '柵を外さずにできる方法(部品の番号で押す・close-app 等)に変える。' + HOWTO
      );
    }
    if (/(^|\s)clipboard-get(?=\s|$)/.test(seg)) {
      return (
        'agent-desktop でクリップボードを読もうとしています。止めました(鍵が入っていることがある)。\n' +
        '値の受け渡しは CLAUDE.md の決まった手順だけで行う。' + HOWTO
      );
    }
    if (/(^|\s)--headed(?=\s|=|$)/.test(seg) && !HEADED_OK.test(command)) {
      return (
        'agent-desktop の --headed(本物のマウス・キーを動かす)を、本人の OK なしで使おうとしています。止めました。\n' +
        'まず裏で動く既定のまま(--headed なし)で試す。失敗したから --headed でやり直す、はしない。\n' +
        '本人がチャットで OK したときだけ、コマンドに AGENT_DESKTOP_HEADED_OK_BY_USER="<OKの中身>" を付ける(無断で付けるのは虚偽申告)。\n' +
        HOWTO
      );
    }
  }
  return null;
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    process.exit(0);
  }
  const reason = decide(input && input.tool_name, input && input.tool_input);
  if (!reason) process.exit(0);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main();
