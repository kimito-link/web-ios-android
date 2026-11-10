// check-human-handoff.mjs の回帰テスト。
// 何を守るか: 2026-11-10 の実例（Git Bash に貼るコマンド・画面を送って・PC で最新にして会議を動かして）は拒否、
// 「人に頼む理由:」付き・引用での言及・ふつうの報告は通す、無効化変数と壊れた入力は通す(fail-open)。
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findHumanHandoff } from "./check-human-handoff.mjs";

const HOOK = fileURLToPath(new URL("./check-human-handoff.mjs", import.meta.url));
const run = (input, env = {}) =>
  spawnSync(process.execPath, [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8", env: { ...process.env, ...env } });
const post = (text) => ({ tool_name: "mcp__hearthbot__post_message", tool_input: { text } });
const decision = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision : undefined);

describe("findHumanHandoff", () => {
  it("2026-11-10 の実例を拾う", () => {
    expect(findHumanHandoff(["Git Bash に次の1行を貼って実行してください\n```\nnpx wrangler deploy\n```"])).not.toBeNull();
    expect(findHumanHandoff(["wrangler login を実行してください。"])).not.toBeNull();
    expect(findHumanHandoff(["画面を送ってください"])).not.toBeNull();
    expect(findHumanHandoff(["PCで tsuioku を git pull で最新にしてから会議を動かしてください"])).not.toBeNull();
    expect(findHumanHandoff(["下のコマンドを実行してください\n```\nnode scripts/x.mjs\n```"])).not.toBeNull();
  });
  it("ふつうの報告・引用での言及は拾わない", () => {
    expect(findHumanHandoff(["wrangler deploy まで自分で実行し、本番で確認しました。"])).toBeNull();
    expect(findHumanHandoff(["これからは「Git Bash に貼って実行して」と頼む前に止まります。"])).toBeNull();
    expect(findHumanHandoff(["マージしてよいか教えてください。"])).toBeNull();
  });
});

describe("hook", () => {
  it("理由なしの依頼は deny、理由ありは通す", () => {
    expect(decision(run(post("Git Bash に貼って実行してください")))).toBe("deny");
    expect(decision(run(post("Git Bash に貼って実行してください。人に頼む理由: 本人のログイン画面での承認が要るため")))).toBeUndefined();
  });
  it("request_decision の選択肢の中も見る", () => {
    const r = run({ tool_name: "mcp__hearthbot__request_decision", tool_input: { question: "どうしますか", options: [{ label: "自分で", consequence: "PowerShell で実行してください" }] } });
    expect(decision(r)).toBe("deny");
  });
  it("対象外のツール・無効化・壊れた入力は通す", () => {
    expect(decision(run({ tool_name: "Bash", tool_input: { command: "echo 貼って実行して Git Bash" } }))).toBeUndefined();
    expect(decision(run(post("Git Bash に貼って実行してください"), { HUMAN_HANDOFF_CHECK_OFF: "1" }))).toBeUndefined();
    expect(run("not json").status).toBe(0);
  });
});
