// guard-unrequested-removal.mjs の回帰テスト。
// 何を守るか: 2026-11-14 の「AI がバグを直したらログイン・検索・設定が消えた」形は commit 前に拒否、
// コミットメッセージに「消してよい: 名前」があれば通す、関係ないコマンド・無効化変数・壊れた入力・git の外は通す(fail-open)。
import { describe, expect, it, beforeAll } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "./guard-unrequested-removal.mjs";

const HOOK = fileURLToPath(new URL("./guard-unrequested-removal.mjs", import.meta.url));
const run = (input, env = {}) =>
  spawnSync(process.execPath, [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8", env: { ...process.env, ...env } });
const bash = (command, cwd) => ({ tool_name: "Bash", tool_input: { command }, cwd });
const decision = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision : undefined);

let repo;
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "removal-"));
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
  g("init", "-q");
  g("config", "user.email", "t@example.invalid");
  g("config", "user.name", "t");
  writeFileSync(join(repo, "Header.tsx"),
    '<button data-testid="login">ログイン</button>\n<a href="/search">検索</a>\n<a href="/settings">設定</a>\n<p>バグ</p>\n');
  g("add", ".");
  g("commit", "-q", "-m", "init");
  // AI が「バグを直して」で丸ごと書き直し、3つの入口を落とした形
  writeFileSync(join(repo, "Header.tsx"), "<p>直した</p>\n");
  g("add", ".");
});

describe("classify", () => {
  it("commit / commit -a / push / gh pr create を拾い、それ以外は拾わない", () => {
    expect(classify('git commit -m "fix"')).toEqual({ kind: "commit", workingTree: false });
    expect(classify('git commit -am "fix"').workingTree).toBe(true);
    expect(classify("git push -u origin claude/x").kind).toBe("push");
    expect(classify('gh pr create --title t --body "b"').kind).toBe("pr");
    expect(classify("git status")).toBeNull();
    expect(classify("echo git commit")).toBeNull();
  });
});

describe("hook", () => {
  it("★ログイン・検索・設定が消えた commit は拒否し、消えたものと直し方を返す", () => {
    const r = run(bash('git commit -m "fix: バグを直した"', repo));
    expect(decision(r)).toBe("deny");
    const reason = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain("login");
    expect(reason).toContain("/search");
    expect(reason).toContain("/settings");
    expect(reason).toContain("消してよい:");
  });

  it("全部に宣言があれば通す", () => {
    const msg = "fix: x\n\n消してよい: login（理由: 移動）\n消してよい: /search（理由: 移動）\n消してよい: /settings（理由: 移動）";
    expect(decision(run(bash(`git commit -m "${msg}"`, repo)))).toBeUndefined();
  });

  it("★一部だけ宣言しても、残りがあれば拒否する", () => {
    expect(decision(run(bash('git commit -m "x\n\n消してよい: login（理由: 移動）"', repo)))).toBe("deny");
  });

  it("関係ないコマンド・無効化変数・壊れた入力・git の外は通す(fail-open)", () => {
    expect(decision(run(bash("git status", repo)))).toBeUndefined();
    expect(decision(run(bash('git commit -m "x"', repo), { REMOVAL_CHECK_OFF: "1" }))).toBeUndefined();
    expect(decision(run("{壊れた"))).toBeUndefined();
    expect(decision(run(bash('git commit -m "x"', mkdtempSync(join(tmpdir(), "nogit-")))))).toBeUndefined();
  });
});
