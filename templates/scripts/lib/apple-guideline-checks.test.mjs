import { describe, expect, it } from "vitest";
import {
  findCreativeAssetIssues,
  findObfuscationSignals,
  findRemoteCodeExecution,
  OBFUSCATION_IDENT_THRESHOLD,
} from "./apple-guideline-checks.mjs";

describe("findObfuscationSignals", () => {
  it("_0x識別子が閾値以上なら拾い、閾値未満は拾わない", () => {
    const many = Array.from({ length: OBFUSCATION_IDENT_THRESHOLD }, (_, i) => `var _0x${(0x1000 + i).toString(16)}=1;`).join("");
    expect(findObfuscationSignals(many)).toHaveLength(1);
    expect(findObfuscationSignals("var _0x1a2b=1; var _0x1a2c=2;")).toEqual([]);
  });
  it("packer と atob 実行を拾う", () => {
    expect(findObfuscationSignals("eval(function(p,a,c,k,e,d){})")).toHaveLength(1);
    expect(findObfuscationSignals("eval(atob('YWxlcnQoMSk='))")).toHaveLength(1);
    expect(findObfuscationSignals("new Function(atob(x))()")).toHaveLength(1);
  });
  it("普通のコードは拾わない", () => {
    expect(findObfuscationSignals("const a = atob(token); evaluate(a);")).toEqual([]);
  });
});

describe("findRemoteCodeExecution", () => {
  it("eval と fetch が同居したら拾う。片方だけなら拾わない", () => {
    expect(findRemoteCodeExecution("const t=await fetch(u).then(r=>r.text()); eval(t)")).toHaveLength(1);
    expect(findRemoteCodeExecution("await fetch(u)")).toEqual([]);
    expect(findRemoteCodeExecution("eval('1+1')")).toEqual([]);
  });
});

describe("findCreativeAssetIssues", () => {
  it("価格・割引を拾う", () => {
    expect(findCreativeAssetIssues("今だけ 980円").price.length).toBeGreaterThan(0);
    expect(findCreativeAssetIssues("50% OFF").price.length).toBeGreaterThan(0);
    expect(findCreativeAssetIssues("期間限定セール").price.length).toBeGreaterThan(0);
    expect(findCreativeAssetIssues("$4.99").price.length).toBeGreaterThan(0);
  });
  it("検証できない主張を拾う", () => {
    expect(findCreativeAssetIssues("満足度 No.1").claim.length).toBeGreaterThan(0);
    expect(findCreativeAssetIssues("日本一かんたん").claim.length).toBeGreaterThan(0);
  });
  it("素直な文言は拾わない", () => {
    expect(findCreativeAssetIssues("すれ違いを記録して、街の図鑑を埋めよう")).toEqual({ price: [], claim: [] });
  });
});
