#!/usr/bin/env node
// PreToolUse ガード（拒否・fail-open）: Fable 5.2 が「手作業」をしていたら止めて、Opus 5.5 か Codex へ回させる。
// 正本: docs/ai-workflows/FABLE-3STEP-HOWTO.md「Fable は頭脳労働専用」・CLAUDE.md 核「セッション開始時の必須アクション」5番。
//
// なぜ要るか（2026-11-16 りんく「Fable は頭脳労働専用」「それを全体設定にいれて」）:
//   Fable の週枠は Claude 全体とは別の上限（プランで 50% まで）で、11/16 時点で 36% 使っていた。
//   計画・設計・判断の文章は Fable の仕事だが、ファイルを読み回す・コマンドを繰り返す・コードを書く手作業まで
//   Fable がやると、一番高い頭脳の枠が量の多い作業で減る。文章の決まり（核5番・FABLE-3STEP-HOWTO）は
//   11/11 からあるが、プランモードに入った Fable は「手を動かす瞬間」にそれを読み返さない。
//
// 判定するのは形だけ:
//   1. 今このツールを呼んでいるモデルが Fable か（会話ログの最後の assistant の message.model。
//      サブエージェントなら <transcript>/subagents/agent-<agent_id>.jsonl を見る＝2026-11-16 実測した置き場所）。
//      Fable でなければ何もしない。
//   2. Edit / Write / NotebookEdit: 文章（.md / .txt / プランファイル）は通す。コードや設定のファイルは拒否。
//   3. Read / Grep / Glob / Bash: 今のターン（人の最後の発言から後）で Fable が使った回数を数え、
//      WARN_AT 回目から注意を足し、DENY_AT 回目から拒否する。Codex・別頭脳へ投げる Bash（dispatch.py・codex）は数えず通す。
// 判定しないこと: 読んだ量が本当に計画に要ったか（意味判断）。
// 実測（2026-11-16）: ふつうのセッション（クラウドのスレッド）は、tool_use を書いた assistant 行が hook より先に会話ログへ載る。
//   `claude -p` は会話ログをターンの終わりにまとめて書くので、その中では判定できず素通しになる（fail-open）。
// 無効化: 環境変数 FABLE_GUARD_OFF=1。Fable しか使えない日は FABLE_MANUAL_WORK_OK=1。壊れた入力は通す（fail-open）。

import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const WARN_AT = 8;
export const DENY_AT = 16;
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const LOOK_TOOLS = new Set(['Read', 'Grep', 'Glob', 'Bash']);
// Fable が書いてよい「計画・設計・判断の文章」
const TEXT_FILE_RE = /\.(md|markdown|txt)$/i;
const PLAN_DIR_RE = /[\\/]\.claude[\\/]plans[\\/]/;
// 手作業を別の頭脳へ投げるコマンド（数えない）
const DELEGATE_RE = /(dispatch\.py|\bcodex\b|\bgrok\b|\bagy\b)/i;

// FABLE_GUARD_MODEL_RE は試験用（別のモデルで本物の Claude Code に通して確かめるため）。
const MODEL_RE = new RegExp(process.env.FABLE_GUARD_MODEL_RE || 'fable', 'i');
export const isFable = (model) => typeof model === 'string' && MODEL_RE.test(model);

export function readJsonl(path) {
  try {
    return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/** このツールを呼んでいる会話ログ（サブエージェントなら子のログ）の場所。 */
export function transcriptFor(input) {
  const main = input && input.transcript_path;
  if (typeof main !== 'string') return null;
  if (input.agent_id) {
    const sub = main.replace(/\.jsonl$/, '') + `/subagents/agent-${input.agent_id}.jsonl`;
    return existsSync(sub) ? sub : null; // 子のログが見つからなければ判定しない（親のモデルで子を止めない）
  }
  return main;
}

/** 人のふつうの発言か（ツールの結果を返すだけの user 行は除く）。 */
function isHumanPrompt(entry) {
  if (!entry || entry.type !== 'user' || entry.isMeta) return false;
  const c = entry.message && entry.message.content;
  if (typeof c === 'string') return true;
  return Array.isArray(c) && !c.some((b) => b && b.type === 'tool_result');
}

/** 最後の assistant のモデルと、今のターンで Fable が使った「見る」ツールの回数。 */
export function summarize(entries) {
  let model = null;
  let looks = 0;
  for (const e of entries) {
    if (isHumanPrompt(e)) { looks = 0; continue; }
    if (e.type !== 'assistant' || !e.message) continue;
    model = e.message.model || model;
    if (!isFable(e.message.model)) continue;
    for (const b of Array.isArray(e.message.content) ? e.message.content : []) {
      if (b && b.type === 'tool_use' && LOOK_TOOLS.has(b.name) && !isDelegation(b.name, b.input)) looks++;
    }
  }
  return { model, looks };
}

function isDelegation(tool, toolInput) {
  return tool === 'Bash' && toolInput && typeof toolInput.command === 'string' && DELEGATE_RE.test(toolInput.command);
}

const HOW_TO_HAND_OFF =
  '手作業は Opus 5.5 か Codex に回す: (1) 計画を文章で出し終えたらプランモードを抜ける（opusplan 設定なら抜けると Opus 5.5 になる）、'
  + '(2) 調べ物は Agent ツールで Explore などのサブエージェントへ（model は Opus 5.5 を指す名前。opusplan 設定の中では "sonnet"、それ以外は "opus"。'
  + '指定なしだと親の Fable を引き継ぐ）、(3) 実装・定型作業は python docs/ai-workflows/tools/dispatch.py --brain codex。'
  + ' 正本: docs/ai-workflows/FABLE-3STEP-HOWTO.md「Fable は頭脳労働専用」。';

/** 判定本体。{ decision: 'allow'|'warn'|'deny', reason } を返す。 */
export function judge(input, entries) {
  const tool = input && input.tool_name;
  if (!WRITE_TOOLS.has(tool) && !LOOK_TOOLS.has(tool)) return { decision: 'allow' };
  const { model, looks } = summarize(entries);
  if (!isFable(model)) return { decision: 'allow' };
  const ti = input.tool_input || {};
  if (WRITE_TOOLS.has(tool)) {
    const p = String(ti.file_path || ti.notebook_path || '');
    if (TEXT_FILE_RE.test(p) || PLAN_DIR_RE.test(p)) return { decision: 'allow' };
    return {
      decision: 'deny',
      reason: `Fable 5.2 はコードや設定を書かない（頭脳労働専用、2026-11-16 りんく指定）。${p || tool} の編集は Opus 5.5 か Codex で。${HOW_TO_HAND_OFF}`,
    };
  }
  if (isDelegation(tool, ti)) return { decision: 'allow' };
  const n = looks; // 今呼ぼうとしている分は会話ログに既に載っている（tool_use を書いてから hook が走る）
  if (n >= DENY_AT) {
    return {
      decision: 'deny',
      reason: `Fable 5.2 がこのターンで ${n} 回ファイルを読む・コマンドを走らせる作業をした（上限 ${DENY_AT}）。読み回しは Fable の週枠を減らす。${HOW_TO_HAND_OFF}`,
    };
  }
  if (n >= WARN_AT) {
    return {
      decision: 'warn',
      reason: `注意: Fable 5.2 がこのターンで ${n} 回、読む・走らせる作業をした（${DENY_AT} 回で止める）。残りの調べ物はサブエージェントへ。${HOW_TO_HAND_OFF}`,
    };
  }
  return { decision: 'allow' };
}

function main() {
  if (process.env.FABLE_GUARD_OFF === '1' || process.env.FABLE_MANUAL_WORK_OK === '1') return;
  let input;
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { return; }
  const tp = transcriptFor(input);
  if (!tp) return;
  const r = judge(input, readJsonl(tp));
  if (r.decision === 'deny') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r.reason },
    }));
  } else if (r.decision === 'warn') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: r.reason },
    }));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try { main(); } catch { /* fail-open */ }
}
