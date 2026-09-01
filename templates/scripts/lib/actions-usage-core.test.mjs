import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, analyzeRuns, runMinutes } from "./actions-usage-core.mjs";

/** テスト用の実行1件を作る。 */
function run({ name = "CI", minutes = 4, status = "completed", at = "2026-08-31T10:00:00Z" } = {}) {
  const start = Date.parse(at);
  return {
    name,
    status,
    created_at: new Date(start).toISOString(),
    run_started_at: new Date(start).toISOString(),
    updated_at: new Date(start + minutes * 60000).toISOString(),
  };
}

describe("runMinutes", () => {
  it("開始と終了から分を出す", () => {
    expect(runMinutes(run({ minutes: 7 }))).toBe(7);
  });

  it("日付が壊れていたら null（0分と誤認しない）", () => {
    expect(runMinutes({ run_started_at: "not-a-date", updated_at: "also-bad" })).toBeNull();
  });

  it("終了が開始より前なら null", () => {
    expect(
      runMinutes({ run_started_at: "2026-08-31T10:00:00Z", updated_at: "2026-08-31T09:00:00Z" })
    ).toBeNull();
  });
});

describe("analyzeRuns", () => {
  it("平常時は違反ゼロ", () => {
    const runs = [...Array(20)].map(() => run({ name: "CI", minutes: 4 }));
    const r = analyzeRuns(runs);
    expect(r.violations).toEqual([]);
    expect(r.measuredRuns).toBe(20);
    expect(r.totalMinutes).toBe(80);
  });

  // ★2026-08-06 の実際の焼き方: 1本が毎push 30分回り続けた（Lightpanda）
  it("1回30分の暴走ジョブを single-run で捕まえる", () => {
    const runs = [run({ name: "Lightpanda", minutes: 30 }), run({ name: "CI", minutes: 4 })];
    const r = analyzeRuns(runs);
    const v = r.violations.find((x) => x.kind === "single-run");
    expect(v).toBeDefined();
    expect(v.name).toBe("Lightpanda");
    expect(v.minutes).toBe(30);
  });

  it("1回は短くても合計が膨らめば workflow-total で捕まえる", () => {
    // 15分×25回 = 375分。singleRunMinutes(20) は超えないが合計で引っかかる
    const runs = [...Array(25)].map(() => run({ name: "smoke", minutes: 15 }));
    const r = analyzeRuns(runs);
    expect(r.violations.some((x) => x.kind === "single-run")).toBe(false);
    expect(r.violations.some((x) => x.kind === "workflow-total")).toBe(true);
  });

  it("観測窓の合計が閾値を超えたら window-total", () => {
    // 10分 × 200回 = 2,000分（事故時は6日で6,801分）
    const runs = [...Array(200)].map((_, i) => run({ name: `wf${i % 9}`, minutes: 10 }));
    const r = analyzeRuns(runs);
    expect(r.violations.some((x) => x.kind === "window-total")).toBe(true);
  });

  it("completed 以外は数えない（実行中を0分と誤認しない）", () => {
    const runs = [run({ status: "in_progress", minutes: 999 }), run({ minutes: 4 })];
    const r = analyzeRuns(runs);
    expect(r.measuredRuns).toBe(1);
    expect(r.violations).toEqual([]);
  });

  it("日付が壊れた実行は母数から外す（0分として平均を薄めない）", () => {
    const broken = { name: "CI", status: "completed", updated_at: "bad" };
    const r = analyzeRuns([broken, run({ minutes: 5 })]);
    expect(r.measuredRuns).toBe(1);
    expect(r.totalMinutes).toBe(5);
  });

  it("空配列でも例外を投げず、測れた件数0を正直に返す", () => {
    const r = analyzeRuns([]);
    expect(r.measuredRuns).toBe(0);
    expect(r.violations).toEqual([]);
  });

  it("ワークフロー別の合計は多い順に並ぶ", () => {
    const runs = [
      run({ name: "small", minutes: 1 }),
      run({ name: "big", minutes: 10 }),
      run({ name: "mid", minutes: 5 }),
    ];
    expect(analyzeRuns(runs).byWorkflow.map((w) => w.name)).toEqual(["big", "mid", "small"]);
  });

  it("しきい値は差し替えられる", () => {
    const runs = [run({ minutes: 6 })];
    expect(analyzeRuns(runs).violations).toEqual([]);
    const strict = analyzeRuns(runs, { ...DEFAULT_THRESHOLDS, singleRunMinutes: 5 });
    expect(strict.violations.some((x) => x.kind === "single-run")).toBe(true);
  });
});
