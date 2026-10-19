import { describe, expect, it } from "vitest";
import { checkListingSourceFiles } from "./listing-source-files.mjs";

const full = { "description-ja.txt": "説明", "keywords-ja.txt": "a,b,c", "subtitle-ja.txt": "サブ" };

describe("checkListingSourceFiles", () => {
  it("3つ揃っていれば ok", () => {
    expect(checkListingSourceFiles({ files: full }).status).toBe("ok");
  });
  it("1つ無ければ fail し、どれが無いかを示す(旧値の持ち越し・空公開を提出前に止める)", () => {
    const r = checkListingSourceFiles({ files: { ...full, "keywords-ja.txt": undefined } });
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("keywords-ja.txt");
  });
  it("空白だけのファイルは無いのと同じ", () => {
    expect(checkListingSourceFiles({ files: { ...full, "description-ja.txt": "  \n " } }).status).toBe("fail");
  });
  it("キーワードが100文字を超えたら fail", () => {
    expect(checkListingSourceFiles({ files: { ...full, "keywords-ja.txt": "あ".repeat(101) } }).status).toBe("fail");
    expect(checkListingSourceFiles({ files: { ...full, "keywords-ja.txt": "あ".repeat(100) } }).status).toBe("ok");
  });
  it("iOS に出さないアプリは skip", () => {
    expect(checkListingSourceFiles({ files: {}, iosTargeted: false }).status).toBe("skip");
  });
});
