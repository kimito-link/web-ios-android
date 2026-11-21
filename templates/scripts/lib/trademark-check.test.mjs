import { describe, expect, it } from "vitest";
import { checkTrademarkRecord, trademarkRecordTemplate } from "./trademark-check.mjs";

const good = {
  name: "動員ちゃれんじ",
  checkedAt: "2026-11-21",
  classes: [9, 42, 35],
  searches: [{ db: "J-PlatPat", field: "称呼(類似検索)", query: "ドウインチャレンジ", hits: 1 }],
  verdict: "own",
};
const today = "2026-11-22";

describe("checkTrademarkRecord", () => {
  it("名前が一致し 9・42 を調べて conflict でなければ ok", () => {
    expect(checkTrademarkRecord({ record: good, displayName: "動員ちゃれんじ", today }).status).toBe("ok");
  });
  it("記録が無ければ fail(提出前に止める)", () => {
    const r = checkTrademarkRecord({ record: null, displayName: "新アプリ", today });
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("J-PlatPat");
  });
  it("アプリ名も記録も無ければ skip", () => {
    expect(checkTrademarkRecord({ record: null, today }).status).toBe("skip");
  });
  it("改名したのに古い名前の記録のままなら fail", () => {
    const r = checkTrademarkRecord({ record: good, displayName: "動員チャレンジ2", today });
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("調べ直す");
  });
  it("全角・空白の違いは同じ名前として扱う", () => {
    expect(checkTrademarkRecord({ record: { ...good, name: "ＡＢＣ Note" }, displayName: "ABCNote", today }).status).toBe("ok");
  });
  it("第42類が抜けていたら fail", () => {
    const r = checkTrademarkRecord({ record: { ...good, classes: [9] }, displayName: good.name, today });
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("第42類");
  });
  it("conflict なら fail", () => {
    expect(checkTrademarkRecord({ record: { ...good, verdict: "conflict" }, displayName: good.name, today }).status).toBe("fail");
  });
  it("verdict が空・searches が空なら fail", () => {
    expect(checkTrademarkRecord({ record: { ...good, verdict: "" }, displayName: good.name, today }).status).toBe("fail");
    expect(checkTrademarkRecord({ record: { ...good, searches: [] }, displayName: good.name, today }).status).toBe("fail");
  });
  it("180日を超えた記録は warn", () => {
    expect(checkTrademarkRecord({ record: { ...good, checkedAt: "2026-01-01" }, displayName: good.name, today }).status).toBe("warn");
  });
  it("読めない記録は fail", () => {
    expect(checkTrademarkRecord({ record: null, recordError: "Unexpected token", displayName: "x", today }).status).toBe("fail");
  });
  it("雛形のままでは通らない(verdict・searches を埋めさせる)", () => {
    const tpl = trademarkRecordTemplate({ displayName: "新アプリ", today });
    expect(checkTrademarkRecord({ record: tpl, displayName: "新アプリ", today }).status).toBe("fail");
  });
});
