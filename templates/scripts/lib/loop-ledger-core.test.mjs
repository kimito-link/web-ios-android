import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { nextId, replayLedger, stateOf, validateEntry } from "./loop-ledger-core.mjs";

const e = (over = {}) => ({
  schema: 1, id: "D0001", proposal: "P0001-comment-lag", decision: "proposed", by: "ai:qwen3-local", at: "2026-10-18T05:30:00Z", ...over,
});
const rules = (entry, existing = []) => validateEntry(entry, existing).violations.map((x) => `${x.path}:${x.rule}`);

describe("形", () => {
  it("正しい proposed は通る（reason は不要）", () => {
    expect(validateEntry(e(), []).ok).toBe(true);
  });
  it("未知キー・schema違い・id/by/at形式・決定が許可外を拒否", () => {
    expect(rules(e({ note: "x" }))).toContain("$.note:unknown-key");
    expect(rules(e({ schema: 2 }))).toContain("$.schema:schema-must-be-1");
    expect(rules(e({ id: "x1" }))).toContain("$.id:format");
    expect(rules(e({ by: "someone" })).some((r) => r.startsWith("$.by:format"))).toBe(true);
    expect(rules(e({ at: "昨日" }))).toContain("$.at:format");
    expect(rules(e({ decision: "merged" }))).toContain("$.decision:decision-not-allowed");
  });
  it("id の重複を拒否", () => {
    expect(rules(e(), [e()])).toContain("$.id:duplicate-id");
  });
});

describe("AI は決められない（承認は人間だけ）", () => {
  const prior = [e()];
  it("ai: による approved/rejected/deferred/no_effect を拒否", () => {
    for (const d of ["approved", "rejected", "deferred", "no_effect"]) {
      expect(rules(e({ id: "D0002", decision: d, by: "ai:qwen3-local", reason: "良さそう" }), prior)).toContain("$.by:ai-cannot-decide");
    }
  });
  it("human: による approved は通る", () => {
    expect(validateEntry(e({ id: "D0002", decision: "approved", by: "human:link", reason: "確認した" }), prior).ok).toBe(true);
  });
});

describe("状態遷移", () => {
  const h = (extra) => [e(), ...extra];
  it("提案なしの approved を拒否／二重 proposed を拒否", () => {
    expect(rules(e({ decision: "approved", by: "human:link", reason: "r" }))).toContain("$.decision:transition-not-allowed(none->approved)");
    expect(rules(e({ id: "D0002" }), [e()])).toContain("$.decision:transition-not-allowed(proposed->proposed)");
  });
  it("rejected と no_effect は終端、approved の後は no_effect だけ", () => {
    const rej = h([e({ id: "D0002", decision: "rejected", by: "human:link", reason: "前提が違う" })]);
    expect(rules(e({ id: "D0003", decision: "approved", by: "human:link", reason: "r" }), rej).some((r) => r.includes("transition-not-allowed(rejected->approved)"))).toBe(true);
    const app = h([e({ id: "D0002", decision: "approved", by: "human:link", reason: "ok" })]);
    expect(validateEntry(e({ id: "D0003", decision: "no_effect", by: "human:link", reason: "測ったが変わらず" }), app).ok).toBe(true);
    expect(rules(e({ id: "D0003", decision: "rejected", by: "human:link", reason: "r" }), app).some((r) => r.includes("transition-not-allowed(approved->rejected)"))).toBe(true);
  });
  it("deferred の後は再判断できる", () => {
    const d = h([e({ id: "D0002", decision: "deferred", by: "human:link", reason: "後で" })]);
    expect(validateEntry(e({ id: "D0003", decision: "approved", by: "human:link", reason: "やる" }), d).ok).toBe(true);
    expect(stateOf(d, "P0001-comment-lag")).toBe("deferred");
  });
});

describe("reason", () => {
  const prior = [e()];
  it("proposed 以外は必須", () => {
    expect(rules(e({ id: "D0002", decision: "rejected", by: "human:link" }), prior)).toContain("$.reason:required");
    expect(rules(e({ id: "D0002", decision: "rejected", by: "human:link", reason: "  " }), prior)).toContain("$.reason:required");
  });
  it("秘密・メール・URLらしき形と長すぎを拒否", () => {
    for (const r of ["sk-abcdefgh12345 を使った", "OPENAI_API_KEY を渡した", "taro@example.com に確認", "https://example.com を見た"]) {
      expect(rules(e({ id: "D0002", decision: "rejected", by: "human:link", reason: r }), prior).some((x) => x.startsWith("$.reason:") && x !== "$.reason:required")).toBe(true);
    }
    expect(rules(e({ id: "D0002", decision: "rejected", by: "human:link", reason: "あ".repeat(501) }), prior).some((x) => x.includes("too-long"))).toBe(true);
  });
});

describe("再生と連番", () => {
  it("壊れた履歴を検出する", () => {
    const bad = [e(), e({ id: "D0002", decision: "approved", by: "ai:x", reason: "r" })];
    expect(replayLedger(bad).ok).toBe(false);
    expect(replayLedger([e()]).ok).toBe(true);
  });
  it("次のIDは最大+1", () => {
    expect(nextId([])).toBe("D0001");
    expect(nextId([e(), e({ id: "D0007" })])).toBe("D0008");
  });
});

describe("CLI（AIシェルでは承認系を拒否・追記専用）", () => {
  const cli = fileURLToPath(new URL("../record-loop-decision.mjs", import.meta.url));
  const baseEnv = () => {
    const env = { ...process.env };
    delete env.CLAUDE_CODE_SESSION_ID;
    return env;
  };
  const run = (args, env) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env });
  it("追記→人間の承認→AIシェルでの承認は拒否→壊れた台帳には追記しない", () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-"));
    const ledger = join(dir, "x", "decisions.jsonl");
    try {
      let r = run(["--ledger", ledger, "--proposal", "P1", "--decision", "proposed", "--by", "ai:local"], { ...baseEnv(), CLAUDE_CODE_SESSION_ID: "s" });
      expect(r.status).toBe(0); // proposed は AI シェルでも書ける
      r = run(["--ledger", ledger, "--proposal", "P1", "--decision", "approved", "--by", "human:link", "--reason", "ok"], { ...baseEnv(), CLAUDE_CODE_SESSION_ID: "s" });
      expect(r.status).toBe(1); // AI シェルからは承認できない
      expect(readFileSync(ledger, "utf8").trim().split("\n")).toHaveLength(1);
      r = run(["--ledger", ledger, "--proposal", "P1", "--decision", "approved", "--by", "human:link", "--reason", "ok"], baseEnv());
      expect(r.status).toBe(0);
      expect(readFileSync(ledger, "utf8").trim().split("\n")).toHaveLength(2);
      r = run(["--ledger", ledger, "--proposal", "P1", "--decision", "approved", "--by", "ai:x", "--reason", "ok"], baseEnv());
      expect(r.status).toBe(1); // 遷移違反（approved→approved）かつ ai
      writeFileSync(ledger, readFileSync(ledger, "utf8") + "{not json\n");
      r = run(["--ledger", ledger, "--proposal", "P2", "--decision", "proposed", "--by", "ai:local"], baseEnv());
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("壊れた台帳");
      // JSONとしては読めるが中身が不正な台帳（AIが承認した行が紛れた等）にも追記しない
      const tampered = join(dir, "tampered.jsonl");
      writeFileSync(tampered, JSON.stringify({ schema: 1, id: "D0001", proposal: "P9", decision: "approved", by: "ai:x", at: "2026-10-18T05:30:00Z", reason: "r" }) + "\n");
      r = run(["--ledger", tampered, "--proposal", "P2", "--decision", "proposed", "--by", "ai:local"], baseEnv());
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("検査に通らない");
      r = run(["--ledger", ledger], baseEnv());
      expect(r.status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(existsSync(dir)).toBe(false);
  });
});
