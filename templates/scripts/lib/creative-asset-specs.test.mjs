import { describe, expect, it } from "vitest";
import { checkCreativeImage, kindFromFileName, readImageInfo } from "./creative-asset-specs.mjs";

// 最小の PNG/JPEG を合成する(寸法・種別だけを読むので画素は不要)。
function png(w, h, colorType = 2, extraChunks = []) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write("IHDR", 4, "latin1");
  ihdr.writeUInt32BE(w, 8); ihdr.writeUInt32BE(h, 12); ihdr[16] = 8; ihdr[17] = colorType;
  const chunks = extraChunks.map((t) => { const c = Buffer.alloc(12); c.writeUInt32BE(0, 0); c.write(t, 4, "latin1"); return c; });
  const idat = Buffer.alloc(12); idat.write("IDAT", 4, "latin1");
  return Buffer.concat([sig, ihdr, ...chunks, idat]);
}
function jpeg(w, h) {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.alloc(11); sof[0] = 0xff; sof[1] = 0xc0; sof.writeUInt16BE(8, 2); sof[4] = 8; sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7);
  return Buffer.concat([soi, app0, sof, Buffer.alloc(8)]);
}

describe("readImageInfo", () => {
  it("PNG の寸法と透明度を読む", () => {
    expect(readImageInfo(png(3840, 1646))).toMatchObject({ format: "png", width: 3840, height: 1646, hasAlpha: false });
    expect(readImageInfo(png(10, 10, 6)).hasAlpha).toBe(true); // RGBA
    expect(readImageInfo(png(10, 10, 2, ["tRNS"])).hasAlpha).toBe(true); // tRNS
  });
  it("JPEG の寸法を読む", () => {
    expect(readImageInfo(jpeg(3840, 2560))).toMatchObject({ format: "jpeg", width: 3840, height: 2560 });
  });
  it("画像でなければ null", () => {
    expect(readImageInfo(Buffer.from("hello world, not an image at all!!"))).toBeNull();
  });
});

describe("checkCreativeImage", () => {
  it("ヘッダー 3840x1646 は合格、1枚ずれは不合格", () => {
    expect(checkCreativeImage("header", readImageInfo(png(3840, 1646)))).toEqual([]);
    expect(checkCreativeImage("header", readImageInfo(png(3840, 1645)))[0]).toContain("仕様外");
  });
  it("ヘッダー 5244x2950 は PNG のみ", () => {
    expect(checkCreativeImage("header", readImageInfo(png(5244, 2950)))).toEqual([]);
    expect(checkCreativeImage("header", readImageInfo(jpeg(5244, 2950)))[0]).toContain("仕様外");
  });
  it("検索結果は 3:2 で範囲内なら合格", () => {
    expect(checkCreativeImage("search", readImageInfo(jpeg(1920, 1280)))).toEqual([]);
    expect(checkCreativeImage("search", readImageInfo(jpeg(3840, 2560)))).toEqual([]);
    expect(checkCreativeImage("search", readImageInfo(jpeg(1800, 1200)))[0]).toContain("仕様外"); // 小さすぎ
    expect(checkCreativeImage("search", readImageInfo(jpeg(3840, 2400)))[0]).toContain("仕様外"); // 比率違い
  });
  it("透明度があれば寸法が合っていても不合格", () => {
    const r = checkCreativeImage("header", readImageInfo(png(3840, 1646, 6)));
    expect(r.some((m) => m.includes("アルファ"))).toBe(true);
  });
  it("読めない画像は不合格", () => {
    expect(checkCreativeImage("header", null)[0]).toContain("読めない");
  });
});

describe("kindFromFileName", () => {
  it("header.* と search-results.* / search.* を種別にする", () => {
    expect(kindFromFileName("header.png")).toBe("header");
    expect(kindFromFileName("Search-Results.JPG")).toBe("search");
    expect(kindFromFileName("search.jpeg")).toBe("search");
    expect(kindFromFileName("icon.png")).toBeNull();
  });
});
