#!/usr/bin/env bash
# クラウド環境（claude.ai のクラウドのスレッド・司令塔）に、全体の決まりを守らせる hook を配線する。
#
# なぜこのファイルがあるか（2026-11-27 りんく「全体の容量かんがえてうごくようにして」）:
#   クラウドの環境の setup script に hook を1本ずつ直書きしていたため、hook を足すたびに環境の編集（承認）が要り、
#   残り枠の知らせ inject-ai-budget-mode は一度も配線されていなかった。クラウドのセッションは /home/user から始まり
#   リポの .claude/settings.json を読まないので、司令塔もスレッドも枠の残りを知らずに Opus で手を動かしていた。
#   環境の setup script は「このファイルを main から取って走らせる」1行だけにし、足すのはこのファイル（PR）で行う。
#
# 使い方（環境の setup script）:
#   curl -fsSL https://raw.githubusercontent.com/kimito-link/web-ios-android/main/templates/cloud-env/setup.sh | bash || true
# 何度走らせても同じ結果になる（入っている hook は足さない）。どこかで失敗してもセッションの起動は止めない。
set -u
B="${CLOUD_ENV_BASE:-https://raw.githubusercontent.com/kimito-link/web-ios-android/main}"
H="$HOME/.claude/hooks"
mkdir -p "$H"
get() { curl -fsSL "$B/$1" -o "$2" 2>/dev/null || echo "cloud-env: $1 を取れなかった" >&2; }

# 人に確認を求める文を止める（docs/ai-rules/08_NO_HUMAN_HANDS.md）
get .claude/hooks/check-human-handoff.mjs "$H/check-human-handoff.mjs"
# 頼まれていない削除を commit/push 前に止める（docs/ai-rules/11_NO_REGRESSION.md）
get .claude/hooks/guard-unrequested-removal.mjs "$H/guard-unrequested-removal.mjs"
get templates/diagnostics/check-unrequested-removal.mjs "$H/check-unrequested-removal.mjs"
# Fable 5.2 は頭脳労働専用（docs/ai-workflows/FABLE-3STEP-HOWTO.md）
get .claude/hooks/guard-fable-manual-work.mjs "$H/guard-fable-manual-work.mjs"
# 残り枠で振り分けを切り替える（docs/ai-workflows/MULTI-BRAIN-HOWTO.md §1g）。
# hook は ../../site/hub/usage/ を import するので、リポと同じ並びで置く。
BM="$H/budget-mode"
mkdir -p "$BM/.claude/hooks" "$BM/site/hub/usage"
get .claude/hooks/inject-ai-budget-mode.mjs "$BM/.claude/hooks/inject-ai-budget-mode.mjs"
get site/hub/usage/budget-mode.mjs "$BM/site/hub/usage/budget-mode.mjs"
get site/hub/usage/usage-history.mjs "$BM/site/hub/usage/usage-history.mjs"

node - "$HOME/.claude/settings.json" "$H" <<'JS' || true
const fs = require("fs");
const [p, H] = process.argv.slice(2);
let s = {};
try { s = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
s.hooks ??= {};
const add = (event, file, matcher, timeout) => {
  if (!fs.existsSync(`${H}/${file}`)) return;
  s.hooks[event] ??= [];
  const name = file.split("/").pop();
  if (JSON.stringify(s.hooks[event]).includes(name)) return;
  const group = { hooks: [{ type: "command", command: `node "${H}/${file}"`, timeout }] };
  if (matcher) group.matcher = matcher;
  s.hooks[event].push(group);
};
add("PreToolUse", "check-human-handoff.mjs",
  "AskUserQuestion|mcp__hearthbot__post_message|mcp__hearthbot__request_decision|mcp__hearthbot__post_widget|mcp__hearthbot__edit_message", 10);
add("PreToolUse", "guard-unrequested-removal.mjs", "Bash", 15);
add("PreToolUse", "guard-fable-manual-work.mjs", "Edit|Write|NotebookEdit|Read|Grep|Glob|Bash", 10);
add("UserPromptSubmit", "budget-mode/.claude/hooks/inject-ai-budget-mode.mjs", null, 10);
fs.mkdirSync(require("path").dirname(p), { recursive: true });
fs.writeFileSync(p, JSON.stringify(s, null, 2));
JS

# 人間に確認を求めない（templates/auto-mode/README.md）: 本人の常設の許可を auto mode へ
A="$HOME/.claude/auto-mode"
mkdir -p "$A"
get templates/auto-mode/install.mjs "$A/install.mjs"
get templates/auto-mode/rules.json "$A/rules.json"
[ -f "$A/rules.json" ] && node "$A/install.mjs" >/dev/null 2>&1 || true
exit 0
