import { describe, expect, it } from "vitest";
import { budgetMode, budgetNotice } from "../../site/hub/usage/budget-mode.mjs";

const NOW = Date.parse("2026-11-26T00:00:00.000Z");
const RESET = "2026-11-29T06:59:59.744Z"; // 11/25 の実際の戻り時刻
const usage = (weekly, fable, { updatedAt = "2026-11-25T22:00:00.000Z", resetsAt = RESET } = {}) => ({
  updatedAt,
  current: {
    windows: {
      ...(weekly === null ? {} : { weekly: { percentUsed: weekly, resetsAt } }),
      ...(fable === null ? {} : { fable: { percentUsed: fable, resetsAt } }),
    },
  },
});

describe("budgetMode", () => {
  it("11/25 の実数(週75%・Fable98%)は、ペースが危ないので強い節約・Fable 止め", () => {
    const m = budgetMode(usage(75, 98), NOW);
    expect(m.fable).toBe("off");
    expect(m.level).toBe("strict");
    expect(m.stale).toBe(false);
  });
  it("週の段階: 49→ふつう / 50→節約 / 80→強い節約 / 95→ほぼ空(ペースが穏やかな時)", () => {
    const late = "2026-11-26T05:00:00.000Z"; // 枠の終わり近く=時間の割に使いすぎではない
    const at = (p) => budgetMode(usage(p, 0, { resetsAt: late }), NOW).level;
    expect([at(49), at(50), at(80), at(95)]).toEqual(["normal", "save", "strict", "empty"]);
  });
  it("このペースだと尽きる(danger)なら一段きつくする", () => {
    // 枠が始まって1日で40% → 7日では足りない
    const resetsAt = new Date(NOW + 6 * 86400000).toISOString();
    expect(budgetMode(usage(40, 0, { resetsAt }), NOW).level).toBe("save");
  });
  it("Fable: 69→ok / 70→limit / 95→off", () => {
    const f = (p) => budgetMode(usage(10, p), NOW).fable;
    expect([f(69), f(70), f(95)]).toEqual(["ok", "limit", "off"]);
  });
  it("戻り時刻を過ぎた古い数字では締め付けない", () => {
    const m = budgetMode(usage(99, 99, { resetsAt: "2026-11-25T23:00:00.000Z" }), NOW);
    expect(m.level).toBe("normal");
    expect(m.fable).toBe("ok");
  });
  it("12時間より古い記録・週の数字が空・読めない記録は stale", () => {
    expect(budgetMode(usage(10, 10, { updatedAt: "2026-11-25T10:00:00.000Z" }), NOW).stale).toBe(true);
    expect(budgetMode(usage(null, null), NOW).stale).toBe(true);
    expect(budgetMode(null, NOW).stale).toBe(true);
  });
});

describe("budgetNotice", () => {
  it("ふつう・Fable ok・新しい記録なら何も足さない", () => {
    expect(budgetNotice(budgetMode(usage(10, 10), NOW))).toBe("");
  });
  it("強い節約では、節約の決まりも含めて Codex・dot・Fable 止めを伝える", () => {
    const t = budgetNotice(budgetMode(usage(75, 98), NOW));
    expect(t).toContain("強い節約");
    expect(t).toContain("dispatch.py");
    expect(t).toContain("--verify");
    expect(t).toContain("--out");
    expect(t).toContain("dot");
    expect(t).toContain("プランモードに入らない");
    expect(t).toContain("11/29");
  });
  it("節約以上では、スレッドを立てる側（司令塔）にも決まりを渡す", () => {
    expect(budgetNotice(budgetMode(usage(55, 10, { resetsAt: "2026-11-26T12:00:00.000Z" }), NOW))).toContain("既にあるスレッドへ回せないか");
    expect(budgetNotice(budgetMode(usage(75, 98), NOW))).toContain("ワークフロー・deep research を新しく立てない");
    expect(budgetNotice(budgetMode(usage(96, 98), NOW))).toContain("司令塔は新しいスレッドを立てない");
  });
  it("クラウドでは dispatch の行き先を会社PC（Remote Control）と dot に言い換える", () => {
    const m = budgetMode(usage(75, 98), NOW);
    expect(budgetNotice(m)).not.toContain("start_remote_control");
    expect(budgetNotice(m, { cloud: true })).toContain("start_remote_control");
    expect(budgetNotice(budgetMode(usage(10, 10), NOW), { cloud: true })).toBe("");
  });
  it("記録が止まっていれば、それを言い、節約として振る舞わせる", () => {
    const t = budgetNotice(budgetMode(usage(null, null), NOW));
    expect(t).toContain("record-claude-usage");
    expect(t).toContain("dispatch.py");
  });
});
