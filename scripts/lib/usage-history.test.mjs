import { describe, expect, it } from "vitest";
import {
  WINDOW_KEYS,
  WINDOW_MS,
  mergeSnapshot,
  normalizeUsage,
  paceOf,
  statusOf,
} from "../../site/hub/usage/usage-history.mjs";

const RAW = {
  plan: {
    status: "ok",
    plan: "Max",
    windows: [
      { label: "5-hour limit", percentUsed: 9, resetsAt: "2026-10-19T14:10:00.018Z" },
      { label: "Weekly · all models", percentUsed: 27, resetsAt: "2026-10-25T07:00:00.018Z" },
      { label: "Weekly · Fable", percentUsed: 6, resetsAt: "2026-10-25T07:00:00.018Z" },
    ],
    extraUsage: { enabled: false, percentUsed: 0, spent: "0.00", monthlyLimit: "50.00", currency: "USD" },
  },
  context: { status: "ok", tokensUsed: 646086, contextWindow: 1000000, percentUsed: 65 },
};

const SNAP = normalizeUsage(RAW);
const NOW0 = Date.parse("2026-10-19T10:00:00.000Z");
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

describe("WINDOW_KEYS / WINDOW_MS", () => {
  it("label→キーの対応が仕様通り", () => {
    expect(WINDOW_KEYS["5-hour limit"]).toBe("five");
    expect(WINDOW_KEYS["Weekly · all models"]).toBe("weekly");
    expect(WINDOW_KEYS["Weekly · Fable"]).toBe("fable");
  });

  it("枠の長さ（ミリ秒）が仕様通り", () => {
    expect(WINDOW_MS.five).toBe(5 * 60 * MIN);
    expect(WINDOW_MS.weekly).toBe(7 * DAY);
    expect(WINDOW_MS.fable).toBe(7 * DAY);
  });
});

describe("normalizeUsage", () => {
  it("正常入力から {plan, windows, extra, context} を作る", () => {
    expect(SNAP.plan).toBe("Max");
    expect(SNAP.windows.five).toEqual({ percentUsed: 9, resetsAt: "2026-10-19T14:10:00.018Z" });
    expect(SNAP.windows.weekly.percentUsed).toBe(27);
    expect(SNAP.windows.fable.percentUsed).toBe(6);
    expect(SNAP.extra).toEqual(RAW.plan.extraUsage);
    expect(SNAP.context.tokensUsed).toBe(646086);
  });

  it("plan.status が ok でなければ null", () => {
    expect(normalizeUsage({ plan: { status: "error", plan: "Max", windows: [], extraUsage: {} } })).toBeNull();
    expect(normalizeUsage({ plan: {} })).toBeNull();
    expect(normalizeUsage(null)).toBeNull();
  });

  it("未知の label の window は無視される", () => {
    const raw = structuredClone(RAW);
    raw.plan.windows.push({ label: "Mystery Window", percentUsed: 42, resetsAt: "2026-10-19T14:10:00.018Z" });
    const snap = normalizeUsage(raw);
    expect(Object.keys(snap.windows)).toEqual(["five", "weekly", "fable"]);
    expect(Object.values(snap.windows).some((w) => w.percentUsed === 42)).toBe(false);
  });

  it("percentUsed が数値でない（文字列の）window は除外される", () => {
    const raw = structuredClone(RAW);
    raw.plan.windows[0] = { label: "5-hour limit", percentUsed: "9", resetsAt: "2026-10-19T14:10:00.018Z" };
    const snap = normalizeUsage(raw);
    expect(snap.windows.five).toBeUndefined();
    expect(Object.keys(snap.windows)).toEqual(["weekly", "fable"]);
  });
});

describe("mergeSnapshot", () => {
  it("初回（prev=null）は1点の履歴を作る", () => {
    const out = mergeSnapshot(null, SNAP, NOW0);
    expect(out.updatedAt).toBe(new Date(NOW0).toISOString());
    expect(out.current).toBe(SNAP);
    expect(out.history).toHaveLength(1);
    expect(out.history[0]).toEqual({ t: new Date(NOW0).toISOString(), five: 9, weekly: 27, fable: 6 });
  });

  it("数値が変わったら点が増える（20分未満でも）", () => {
    const first = mergeSnapshot(null, SNAP, NOW0);
    const raw = structuredClone(RAW);
    raw.plan.windows[0].percentUsed = 12;
    const out = mergeSnapshot(first, normalizeUsage(raw), NOW0 + 5 * MIN);
    expect(out.history).toHaveLength(2);
    expect(out.history[1].five).toBe(12);
  });

  it("値が変わらず20分未満なら点が増えない（current と updatedAt だけ更新）", () => {
    const first = mergeSnapshot(null, SNAP, NOW0);
    const out = mergeSnapshot(first, SNAP, NOW0 + 19 * MIN);
    expect(out.history).toHaveLength(1);
    expect(out.history[0].t).toBe(new Date(NOW0).toISOString());
    expect(out.updatedAt).toBe(new Date(NOW0 + 19 * MIN).toISOString());
    expect(out.current).toBe(SNAP);
  });

  it("値が変わらなくても20分以上経てば点が増える", () => {
    const first = mergeSnapshot(null, SNAP, NOW0);
    const out = mergeSnapshot(first, SNAP, NOW0 + 20 * MIN);
    expect(out.history).toHaveLength(2);
    expect(out.history[1]).toEqual({ t: new Date(NOW0 + 20 * MIN).toISOString(), five: 9, weekly: 27, fable: 6 });
  });

  it("14日より古い点は落ちる（t 昇順のまま）", () => {
    const prev = {
      updatedAt: new Date(NOW0 - DAY).toISOString(),
      current: SNAP,
      history: [
        { t: new Date(NOW0 - 15 * DAY).toISOString(), five: 1, weekly: 1, fable: 1 },
        { t: new Date(NOW0 - DAY).toISOString(), five: 9, weekly: 27, fable: 6 },
      ],
    };
    const out = mergeSnapshot(prev, SNAP, NOW0);
    expect(out.history.map((p) => p.t)).toEqual([
      new Date(NOW0 - DAY).toISOString(),
      new Date(NOW0).toISOString(),
    ]);
    expect(out.history.some((p) => Date.parse(p.t) === NOW0 - 15 * DAY)).toBe(false);
  });

  it("snap=null なら prev をそのまま返す（null のままなら null）", () => {
    const first = mergeSnapshot(null, SNAP, NOW0);
    expect(mergeSnapshot(first, null, NOW0 + MIN)).toBe(first);
    expect(mergeSnapshot(null, null, NOW0)).toBeNull();
  });
});

describe("paceOf", () => {
  const W = WINDOW_MS.five;
  const resetsAt = "2026-10-19T14:10:00.000Z";
  const start = Date.parse(resetsAt) - W;

  it("経過50%で使用25% → ratio 0.5（このペースでは枠内に届かないので projectedHitAt は null）", () => {
    const out = paceOf({ percentUsed: 25, resetsAt }, W, start + W / 2);
    expect(out.elapsedPct).toBeCloseTo(50, 6);
    expect(out.ratio).toBeCloseTo(0.5, 6);
    expect(out.projectedHitAt).toBeNull();
  });

  it("経過10%で使用50% → ratio 5 かつ projectedHitAt が枠の終わりより前", () => {
    const out = paceOf({ percentUsed: 50, resetsAt }, W, start + 0.1 * W);
    expect(out.elapsedPct).toBeCloseTo(10, 6);
    expect(out.ratio).toBeCloseTo(5, 6);
    expect(out.projectedHitAt).not.toBeNull();
    const hit = Date.parse(out.projectedHitAt);
    expect(hit).toBe(start + 0.2 * W);
    expect(hit).toBeLessThan(Date.parse(resetsAt));
  });

  it("経過1%未満なら ratio は null（projectedHitAt も null）", () => {
    const out = paceOf({ percentUsed: 50, resetsAt }, W, start + 0.005 * W);
    expect(out.elapsedPct).toBeCloseTo(0.5, 6);
    expect(out.ratio).toBeNull();
    expect(out.projectedHitAt).toBeNull();
  });
});

describe("statusOf", () => {
  const W = WINDOW_MS.five;
  const resetsAt = "2026-10-19T14:10:00.000Z";
  const start = Date.parse(resetsAt) - W;
  const now50 = start + W / 2;

  it("window が無ければ unknown", () => {
    expect(statusOf(undefined, W, now50)).toBe("unknown");
    expect(statusOf(null, W, now50)).toBe("unknown");
  });

  it("safe: ratio<=0.9（経過50%・使用25% → ratio 0.5）", () => {
    expect(statusOf({ percentUsed: 25, resetsAt }, W, now50)).toBe("safe");
  });

  it("safe: ratio が 0.9 超でも projectedHitAt が null（届かない）なら safe", () => {
    // 経過50%・使用47.5% → ratio 0.95 > 0.9、ただし 100% 到達は枠の終わりより後
    expect(statusOf({ percentUsed: 47.5, resetsAt }, W, now50)).toBe("safe");
  });

  it("watch: 0.9<ratio<=1.2（経過50%・使用55% → ratio 1.1）", () => {
    expect(statusOf({ percentUsed: 55, resetsAt }, W, now50)).toBe("watch");
  });

  it("danger: projectedHitAt が枠の終わりより前 かつ ratio>1.2（経過10%・使用50% → ratio 5）", () => {
    expect(statusOf({ percentUsed: 50, resetsAt }, W, start + 0.1 * W)).toBe("danger");
  });
});
