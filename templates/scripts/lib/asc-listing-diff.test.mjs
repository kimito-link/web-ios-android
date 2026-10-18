import { describe, expect, it } from "vitest";
import { MISSING, clampReviewNotes, describeDiffs, diffListing } from "./asc-listing-diff.mjs";

describe("diffListing", () => {
  it("全項目が一致すれば空", () => {
    expect(diffListing({ a: "x", b: "y" }, { a: "x", b: "y" })).toEqual([]);
  });
  it("改行コードと前後の空白の違いは不一致にしない", () => {
    expect(diffListing({ a: "x\ny\n" }, { a: "x\r\ny" })).toEqual([]);
  });
  it("旧キーワードが残っていれば mismatch(今回の事故の再現)", () => {
    const d = diffListing({ "version.keywords": "サイト侵害,改ざん確認" }, { "version.keywords": "マルウェア,感染,スキャン" });
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe("mismatch");
  });
  it("リポに正本が無い項目(MISSING)は repo-missing", () => {
    expect(diffListing({ k: MISSING }, { k: "何か" })).toEqual([{ key: "k", kind: "repo-missing" }]);
  });
  it("ASC 側が空・未定義でも mismatch になる(空で公開されるのを止める)", () => {
    expect(diffListing({ k: "x" }, {})).toHaveLength(1);
  });
  it("expected に無い項目は比べない", () => {
    expect(diffListing({ a: "x" }, { a: "x", extra: "z" })).toEqual([]);
  });
});

describe("clampReviewNotes", () => {
  it("4000字以内はそのまま", () => {
    expect(clampReviewNotes("a".repeat(4000))).toHaveLength(4000);
  });
  it("超えたら 4000 以内に切り、印を付ける", () => {
    const r = clampReviewNotes("a".repeat(5000));
    expect(r.length).toBeLessThanOrEqual(4000);
    expect(r.endsWith("[truncated]")).toBe(true);
  });
});

describe("describeDiffs", () => {
  it("1行ずつ、長い値は切る", () => {
    const lines = describeDiffs([{ key: "k", kind: "mismatch", expected: "x".repeat(100), actual: "y" }]);
    expect(lines[0]).toContain("100字");
  });
});
