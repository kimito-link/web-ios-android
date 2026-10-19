import { describe, expect, it } from "vitest";
import { checkNoFormerNames } from "./former-names-check.mjs";

const former = [{ name: "マルウェアチェック.site", surfaces: ["ios"] }];
const f = (path, text) => ({ path, text });

describe("checkNoFormerNames", () => {
  it("formerNames が無ければ skip", () => {
    expect(checkNoFormerNames({ formerNames: undefined }).status).toBe("skip");
  });
  it("宣言した面(ios)に旧名が残っていれば fail し、場所を示す(2026-10-18 の取り残しの再現)", () => {
    const r = checkNoFormerNames({
      formerNames: former,
      displayName: "サイト侵害チェック",
      files: [f("apps/mobile/www/index.html", "<html>\n<title>マルウェアチェック.site</title>"), f("apps/mobile/package.json", '{"description":"マルウェアチェック.site iOS"}')],
    });
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("apps/mobile/www/index.html:2");
    expect(r.detail).toContain("apps/mobile/package.json:1");
  });
  it("宣言していない面(web)に旧名が残るのは検査しない(意図的に残す面)", () => {
    const r = checkNoFormerNames({ formerNames: former, displayName: "新", files: [f("apps/web/app/page.tsx", "マルウェアチェック.site")] });
    expect(r.status).toBe("ok");
  });
  it("全角・半角や大文字小文字の違いでも拾う", () => {
    const r = checkNoFormerNames({ formerNames: [{ name: "Old Name", surfaces: ["ios"] }], displayName: "New", files: [f("store-assets/appstore/description-ja.txt", "ＯＬＤ　ｎａｍｅ")] });
    expect(r.status).toBe("fail"); // 全角スペースは NFKC で半角になるので一致＝旧名が残っている
  });
  it("surfaces が無い・未知の面・今の名前と同じは台帳の誤りとして fail", () => {
    expect(checkNoFormerNames({ formerNames: [{ name: "x" }] }).status).toBe("fail");
    expect(checkNoFormerNames({ formerNames: [{ name: "x", surfaces: ["mars"] }] }).status).toBe("fail");
    expect(checkNoFormerNames({ formerNames: [{ name: "同じ", surfaces: ["ios"] }], displayName: "同じ" }).status).toBe("fail");
  });
  it("残りが無ければ ok", () => {
    expect(checkNoFormerNames({ formerNames: former, displayName: "サイト侵害チェック", files: [f("apps/mobile/www/index.html", "<title>サイト侵害チェック</title>")] }).status).toBe("ok");
  });
});
