import { describe, expect, it } from "vitest";
import { WARN_RATIO, judgeQueue, parseDependabotLimits } from "./dependabot-queue-core.mjs";

describe("parseDependabotLimits", () => {
  it("ecosystem ごとの上限を読む", () => {
    const yml = `version: 2
updates:
  - package-ecosystem: npm
    directory: /
    open-pull-requests-limit: 10
  - package-ecosystem: github-actions
    directory: /
`;
    const { ecosystems } = parseDependabotLimits(yml);
    expect(ecosystems).toEqual([
      { name: "npm", limit: 10 },
      // ★未指定は Dependabot の既定5。0にすると「上限なし」と誤読する
      { name: "github-actions", limit: 5 },
    ]);
  });

  it("設定が空でも例外を投げない", () => {
    expect(parseDependabotLimits("").ecosystems).toEqual([]);
  });
});

describe("judgeQueue", () => {
  // ★2026-09-01 に実際に起きていた状態
  it("満杯なら赤（新しいPRが作れない）", () => {
    const r = judgeQueue({ openCount: 10, limit: 10, oldestDays: 17, mergedEver: false });
    expect(r.verdict).toBe("fail");
    expect(r.reasons.join()).toMatch(/満杯/);
  });

  it("8割で警告する（満杯の手前で気づく）", () => {
    const r = judgeQueue({ openCount: 8, limit: 10 });
    expect(r.verdict).toBe("fail");
    expect(r.ratio).toBeGreaterThanOrEqual(WARN_RATIO);
  });

  it("余裕があれば緑", () => {
    expect(judgeQueue({ openCount: 3, limit: 10 }).verdict).toBe("pass");
  });

  it("0本なら緑", () => {
    expect(judgeQueue({ openCount: 0, limit: 10 }).verdict).toBe("pass");
  });

  // ★件数ベタ書きだと設定変更で嘘になる、を固定する
  it("上限が大きければ同じ本数でも緑", () => {
    expect(judgeQueue({ openCount: 10, limit: 30 }).verdict).toBe("pass");
  });

  it("30日以上の放置を検知する", () => {
    const r = judgeQueue({ openCount: 2, limit: 10, oldestDays: 45 });
    expect(r.verdict).toBe("fail");
    expect(r.reasons.join()).toMatch(/45日/);
  });

  it("一度もマージしていなければ赤", () => {
    const r = judgeQueue({ openCount: 2, limit: 10, mergedEver: false });
    expect(r.verdict).toBe("fail");
    expect(r.reasons.join()).toMatch(/一度もマージ/);
  });

  it("PRが0本なら「一度もマージしていない」は責めない", () => {
    expect(judgeQueue({ openCount: 0, limit: 10, mergedEver: false }).verdict).toBe("pass");
  });

  it("limitが0でもゼロ除算しない", () => {
    expect(() => judgeQueue({ openCount: 1, limit: 0 })).not.toThrow();
  });
});
