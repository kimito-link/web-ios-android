import { describe, expect, it } from "vitest";
import { decideAction, formatInboxEntry, symptomSignature } from "./loop-run-core.mjs";

const card = (id, verdict) => ({ id, verdict });

describe("symptomSignature", () => {
  it("fail と warn の症状IDをソートして連結する（ok と unmeasured は含めない）", () => {
    expect(symptomSignature([card("b", "fail"), card("a", "warn"), card("c", "ok"), card("d", "unmeasured")])).toBe("a+b");
  });
  it("同じIDのカードが重複していても、署名は変わらない（前の実行のカードが混ざった事故の再発防止）", () => {
    expect(symptomSignature([card("a", "fail"), card("a", "fail"), card("b", "fail")])).toBe(symptomSignature([card("a", "fail"), card("b", "fail")]));
  });
  it("症状が無ければ空文字", () => {
    expect(symptomSignature([card("a", "ok"), card("b", "unmeasured")])).toBe("");
    expect(symptomSignature([])).toBe("");
  });
  it("カードの並びが違っても同じ署名", () => {
    expect(symptomSignature([card("x", "fail"), card("y", "fail")])).toBe(symptomSignature([card("y", "fail"), card("x", "fail")]));
  });
});

describe("decideAction", () => {
  const ledger = (decision) => [{ id: "D0001", proposal: "P0001-x", decision: "proposed" }, ...(decision === "proposed" ? [] : [{ id: "D0002", proposal: "P0001-x", decision }])];
  const state = { bySignature: { "x": "P0001-x" } };

  it("症状が無ければ AI を呼ばない（測れていないカードがあれば、緑でないことを理由に書く）", () => {
    expect(decideAction({ cards: [card("a", "ok")], ledger: [], state: {} }).action).toBe("no-symptoms");
    const r = decideAction({ cards: [card("a", "ok"), card("b", "unmeasured")], ledger: [], state: {} });
    expect(r.action).toBe("no-symptoms");
    expect(r.reason).toContain("緑ではない");
  });
  it("新しい症状の組み合わせは提案する", () => {
    const r = decideAction({ cards: [card("x", "fail")], ledger: [], state: {} });
    expect(r).toMatchObject({ action: "propose", signature: "x" });
  });
  it("同じ症状で、前の提案が proposed / approved / rejected / deferred なら重複として止める", () => {
    for (const d of ["proposed", "approved", "rejected", "deferred"]) {
      const r = decideAction({ cards: [card("x", "fail")], ledger: ledger(d), state });
      expect(r.action).toBe("skip-duplicate");
      expect(r.proposal).toBe("P0001-x");
    }
  });
  it("前の提案が no_effect（直らなかった）なら、新しく提案する", () => {
    const l = [...ledger("approved"), { id: "D0003", proposal: "P0001-x", decision: "no_effect" }];
    const r = decideAction({ cards: [card("x", "fail")], ledger: l, state });
    expect(r.action).toBe("propose");
    expect(r.reason).toContain("効果なし");
  });
  it("--force なら重複でも提案する", () => {
    expect(decideAction({ cards: [card("x", "fail")], ledger: ledger("rejected"), state, force: true }).action).toBe("propose");
  });
  it("state にあるが台帳に無い提案（壊れた状態）も、重複として止める（勝手に再提案しない）", () => {
    expect(decideAction({ cards: [card("x", "fail")], ledger: [], state }).action).toBe("skip-duplicate");
  });
});

describe("formatInboxEntry", () => {
  it("提案書の場所・症状・次の一手（人間が自分のターミナルで記録）を含み、データは含まない", () => {
    const t = formatInboxEntry({ at: "2026-10-18T06:00:00Z", project: "demo", action: "proposed", reason: "新しい症状", proposalPath: "_loop/demo/proposals/P0001-x.md", signature: "a+b" });
    expect(t).toContain("P0001-x.md");
    expect(t).toContain("a+b");
    expect(t).toContain("自分のターミナル");
    expect(t).toContain("record-loop-decision.mjs");
  });
  it("提案書が無い場合は次の一手を出さない", () => {
    expect(formatInboxEntry({ at: "t", project: "p", action: "skip", reason: "r", signature: "" })).not.toContain("record-loop-decision");
  });
});
