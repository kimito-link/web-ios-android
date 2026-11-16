// guard-fable-manual-work.mjs の回帰テスト。
// 何を守るか: Fable がコードを書く・読み回すと止まる／文章（計画）は書ける／Opus や Codex への委譲は止めない／
// Opus のセッション・Opus の子は一切止めない／壊れた入力と無効化変数は通す(fail-open)。
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { judge, summarize, transcriptFor, WARN_AT, DENY_AT } from "./guard-fable-manual-work.mjs";

const HOOK = fileURLToPath(new URL("./guard-fable-manual-work.mjs", import.meta.url));
const FABLE = "claude-fable-5-2";
const OPUS = "claude-opus-5-5";
const human = (text = "お題") => ({ type: "user", message: { role: "user", content: text } });
const result = () => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] } });
const call = (model, name, input = {}) => ({ type: "assistant", message: { model, content: [{ type: "tool_use", name, input }] } });
const reads = (model, n) => Array.from({ length: n }, () => [call(model, "Read", { file_path: "/r/a.mjs" }), result()]).flat();

describe("judge", () => {
  it("Fable がコードを書くのは拒否、計画の文章は通す", () => {
    const log = [human(), call(FABLE, "Edit", { file_path: "/r/src/app.mjs" })];
    expect(judge({ tool_name: "Edit", tool_input: { file_path: "/r/src/app.mjs" } }, log).decision).toBe("deny");
    expect(judge({ tool_name: "Write", tool_input: { file_path: "/r/.claude/settings.json" } }, log).decision).toBe("deny");
    expect(judge({ tool_name: "Write", tool_input: { file_path: "/r/_docs/DESIGN-x.md" } }, log).decision).toBe("allow");
    expect(judge({ tool_name: "Write", tool_input: { file_path: "/home/u/.claude/plans/plan-a.md" } }, log).decision).toBe("allow");
    expect(judge({ tool_name: "Write", tool_input: { file_path: "C:\\Users\\u\\.claude\\plans\\p" } }, log).decision).toBe("allow");
  });
  it("Opus は何をしても止めない", () => {
    const log = [human(), ...reads(OPUS, DENY_AT + 5), call(OPUS, "Edit")];
    expect(judge({ tool_name: "Edit", tool_input: { file_path: "/r/a.mjs" } }, log).decision).toBe("allow");
    expect(judge({ tool_name: "Read", tool_input: { file_path: "/r/a.mjs" } }, log).decision).toBe("allow");
  });
  it("Fable の読み回しは数えて、注意→拒否", () => {
    const at = (n) => judge({ tool_name: "Read", tool_input: {} }, [human(), ...reads(FABLE, n)]).decision;
    expect(at(WARN_AT - 1)).toBe("allow");
    expect(at(WARN_AT)).toBe("warn");
    expect(at(DENY_AT - 1)).toBe("warn");
    expect(at(DENY_AT)).toBe("deny");
  });
  it("人が新しく話すと数え直す", () => {
    const log = [human(), ...reads(FABLE, DENY_AT + 3), human("次のお題"), ...reads(FABLE, 2)];
    expect(summarize(log).looks).toBe(2);
    expect(judge({ tool_name: "Grep", tool_input: {} }, log).decision).toBe("allow");
  });
  it("Codex などへ投げる Bash は数えず通す", () => {
    const cmd = { command: "python docs/ai-workflows/tools/dispatch.py --brain codex --cwd . 'x'" };
    const log = [human(), ...reads(FABLE, DENY_AT + 1), call(FABLE, "Bash", cmd)];
    expect(judge({ tool_name: "Bash", tool_input: cmd }, log).decision).toBe("allow");
    expect(summarize([human(), ...Array.from({ length: 20 }, () => call(FABLE, "Bash", cmd))]).looks).toBe(0);
  });
  it("見張らないツール（Agent・返信）は通す", () => {
    const log = [human(), ...reads(FABLE, DENY_AT + 1)];
    expect(judge({ tool_name: "Agent", tool_input: {} }, log).decision).toBe("allow");
    expect(judge({ tool_name: "mcp__hearthbot__post_message", tool_input: {} }, log).decision).toBe("allow");
  });
});

describe("transcriptFor", () => {
  it("サブエージェントは子のログを見る。子のログが無ければ判定しない", () => {
    const d = mkdtempSync(join(tmpdir(), "fg-"));
    const main = join(d, "s1.jsonl");
    mkdirSync(join(d, "s1", "subagents"), { recursive: true });
    writeFileSync(join(d, "s1", "subagents", "agent-abc.jsonl"), "");
    expect(transcriptFor({ transcript_path: main })).toBe(main);
    expect(transcriptFor({ transcript_path: main, agent_id: "abc" })).toBe(join(d, "s1", "subagents", "agent-abc.jsonl"));
    expect(transcriptFor({ transcript_path: main, agent_id: "zzz" })).toBeNull();
  });
});

describe("hook（本物の標準入力で）", () => {
  const d = mkdtempSync(join(tmpdir(), "fg-"));
  const jl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const fableMain = join(d, "fable.jsonl");
  writeFileSync(fableMain, jl([human(), call(FABLE, "Edit", { file_path: "/r/a.mjs" })]));
  // 親は Fable、子は Opus（Fable が調べ物を Opus の子へ回した形）
  mkdirSync(join(d, "fable", "subagents"), { recursive: true });
  writeFileSync(join(d, "fable", "subagents", "agent-k1.jsonl"), jl([human(), call(OPUS, "Edit")]));
  const run = (input, env = {}) =>
    spawnSync(process.execPath, [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8", env: { ...process.env, ...env } });
  const decision = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision : undefined);
  const edit = { tool_name: "Edit", tool_input: { file_path: "/r/a.mjs" }, transcript_path: fableMain };

  it("Fable の本体がコードを書くと拒否", () => expect(decision(run(edit))).toBe("deny"));
  it("Fable が回した Opus の子は止めない", () => expect(decision(run({ ...edit, agent_id: "k1" }))).toBeUndefined());
  it("無効化変数と壊れた入力は通す", () => {
    expect(decision(run(edit, { FABLE_GUARD_OFF: "1" }))).toBeUndefined();
    expect(decision(run(edit, { FABLE_MANUAL_WORK_OK: "1" }))).toBeUndefined();
    expect(run("{壊れた").status).toBe(0);
    expect(run({ tool_name: "Edit" }).stdout).toBe("");
  });
});
