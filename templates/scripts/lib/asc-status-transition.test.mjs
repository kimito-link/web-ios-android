import { describe, expect, it } from "vitest";
import { diffStates, isSettled, parseStateBlock, renderStateBlock } from "./asc-status-transition.mjs";

const cur = (state, v = "0.1.2") => [{ versionString: v, state, platform: "IOS" }];

describe("状態ブロックの往復", () => {
  it("書いたものを読める", () => {
    const b = renderStateBlock([{ versionString: "0.1.2", state: "WAITING_FOR_REVIEW", platform: "IOS" }]);
    expect(parseStateBlock(`本文\n${b}\n末尾`)).toEqual({ "IOS:0.1.2": "WAITING_FOR_REVIEW" });
  });
  it("無い・壊れていれば null(初回扱い)", () => {
    expect(parseStateBlock("なし")).toBeNull();
    expect(parseStateBlock("<!-- asc-status:{壊れ:asc-status -->")).toBeNull();
    expect(parseStateBlock(undefined)).toBeNull();
  });
});

describe("diffStates", () => {
  it("初回(prev=null)は通知せず基準だけ(誤通知を避ける)", () => {
    expect(diffStates(null, cur("IN_REVIEW"))).toEqual([]);
  });
  it("審査待ち→審査中 は in_review", () => {
    const e = diffStates({ "IOS:0.1.2": "WAITING_FOR_REVIEW" }, cur("IN_REVIEW"));
    expect(e).toHaveLength(1);
    expect(e[0].kind).toBe("in_review");
  });
  it("審査中→開発者リリース待ち は approved", () => {
    expect(diffStates({ "IOS:0.1.2": "IN_REVIEW" }, cur("PENDING_DEVELOPER_RELEASE"))[0].kind).toBe("approved");
  });
  it("リリース待ち→公開 は live", () => {
    expect(diffStates({ "IOS:0.1.2": "PENDING_DEVELOPER_RELEASE" }, cur("READY_FOR_SALE"))[0].kind).toBe("live");
  });
  it("変化が無ければ空", () => {
    expect(diffStates({ "IOS:0.1.2": "IN_REVIEW" }, cur("IN_REVIEW"))).toEqual([]);
  });
  it("却下系は既存の issue 作成が扱うので、ここでは通知しない(二重通知を避ける)", () => {
    expect(diffStates({ "IOS:0.1.2": "IN_REVIEW" }, cur("METADATA_REJECTED"))).toEqual([]);
  });
  it("通知するほどでない遷移(審査待ちになった等)は黙る", () => {
    expect(diffStates({ "IOS:0.1.2": "PREPARE_FOR_SUBMISSION" }, cur("WAITING_FOR_REVIEW"))).toEqual([]);
  });
  it("前回に無かった新しい版が最初から審査中なら通知する", () => {
    expect(diffStates({ "IOS:0.1.1": "READY_FOR_SALE" }, [...cur("READY_FOR_SALE", "0.1.1"), ...cur("IN_REVIEW", "0.1.2")])).toHaveLength(1);
  });
});

describe("isSettled", () => {
  it("全部公開済みなら終端、1つでも途中なら続ける", () => {
    expect(isSettled(cur("READY_FOR_SALE"))).toBe(true);
    expect(isSettled([...cur("READY_FOR_SALE", "0.1.1"), ...cur("IN_REVIEW")])).toBe(false);
    expect(isSettled([])).toBe(false);
  });
});
