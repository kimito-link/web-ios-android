// check-ask-preceded-by-research.mjs の「理由タグ必須（拒否）」の回帰テスト。
// 何を守るか: タグ無しの AskUserQuestion は deny、許可タグ3種のどれかがあれば通る、無効化変数で止められる、壊れた入力は通す(fail-open)。
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hasReasonTag, REASON_TAGS } from "./check-ask-preceded-by-research.mjs";

const HOOK = fileURLToPath(new URL("./check-ask-preceded-by-research.mjs", import.meta.url));
const run = (input, env = {}) =>
  spawnSync(process.execPath, [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8", env: { ...process.env, ...env } });
const ask = (question) => ({ tool_name: "AskUserQuestion", tool_input: { questions: [{ question, header: "h", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] }] } });
const decision = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision : undefined);

describe("hasReasonTag", () => {
  it("許可タグ3種を拾い、未知のタグ・無しは拾わない", () => {
    for (const t of REASON_TAGS) expect(hasReasonTag([`どちらにしますか（確認が必要な理由: ${t}）`])).toBe(true);
    expect(hasReasonTag(["確認が必要な理由：事実不在"])).toBe(true);
    expect(hasReasonTag(["確認が必要な理由: なんとなく"])).toBe(false);
    expect(hasReasonTag(["どちらにしますか"])).toBe(false);
  });
});

describe("hook 本体", () => {
  it("タグ無しは deny、理由に決め直す手順が入る", () => {
    const r = run(ask("A案とB案どちらにしますか？"));
    expect(decision(r)).toBe("deny");
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason).toContain("自分が1つに決めて実行");
  });
  it("許可タグがあれば deny しない", () => {
    expect(decision(run(ask("本番に公開してよいですか（確認が必要な理由: 取り消せない操作）")))).not.toBe("deny");
  });
  it("ASK_REASON_TAG_OFF=1 で無効化できる", () => {
    expect(decision(run(ask("どちらにしますか"), { ASK_REASON_TAG_OFF: "1" }))).not.toBe("deny");
  });
  it("AskUserQuestion 以外・壊れた入力は通す（fail-open）", () => {
    expect(run({ tool_name: "Bash", tool_input: {} }).stdout).toBe("");
    expect(run("not json").status).toBe(0);
  });
});
