import { describe, expect, it } from "vitest";
import {
  BG_MIN_LUMINANCE,
  DARK_TEXT,
  LIGHT_TEXT,
  TEXT_MIN_CONTRAST,
  checkScreenshotStyle,
  contrast,
  luminance,
  pickTextColor,
  resolveSlotStyle,
} from "./screenshot-style.mjs";

const plan = (extra = {}) => ({
  framedCaptions: { "1": { headline: "仲間の記録が、{ここに}届く。" }, "2": { headline: "がんばりは\n友達と分け合う" } },
  ...extra,
});

describe("色の計算", () => {
  it("濃い紺は暗い、明るい青は明るい", () => {
    expect(luminance("#1E4E8C")).toBeLessThan(BG_MIN_LUMINANCE);
    expect(luminance("#42A5F5")).toBeGreaterThanOrEqual(BG_MIN_LUMINANCE);
  });
  it("白地には濃い字、黒地には白い字", () => {
    expect(pickTextColor("#FFFFFF")).toBe(DARK_TEXT);
    expect(pickTextColor("#000000")).toBe(LIGHT_TEXT);
  });
});

describe("resolveSlotStyle（既定は明るい背景）", () => {
  for (const brand of ["#43C251", "#4FACFE", "#DD6500", "#9C27B0", "#FFEB3B", undefined]) {
    it(`ブランド色 ${brand} でも既定は明るく、字と強調色が読める`, () => {
      const s = resolveSlotStyle({ plan: {}, brandPrimary: brand, slot: "1" });
      expect(luminance(s.bgTop)).toBeGreaterThanOrEqual(BG_MIN_LUMINANCE);
      expect(luminance(s.bgBottom)).toBeGreaterThanOrEqual(BG_MIN_LUMINANCE);
      for (const fg of [s.headlineColor, s.accentColor]) {
        expect(Math.min(contrast(fg, s.bgTop), contrast(fg, s.bgBottom))).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
      }
    });
  }
  it("framedStyle.slots で1枚ずつ色を変えられる", () => {
    const p = { framedStyle: { bgTop: "#FFE082", bgBottom: "#FFCA28", slots: { "2": { bgTop: "#B3E5FC", bgBottom: "#81D4FA" } } } };
    expect(resolveSlotStyle({ plan: p, slot: "1" }).bgTop).toBe("#FFE082");
    expect(resolveSlotStyle({ plan: p, slot: "2" }).bgTop).toBe("#B3E5FC");
  });
});

describe("checkScreenshotStyle", () => {
  it("計画が無ければ skip", () => {
    expect(checkScreenshotStyle({}).status).toBe("skip");
  });
  it("読めない JSON は fail", () => {
    expect(checkScreenshotStyle({ planError: "Unexpected token" }).status).toBe("fail");
  });
  it("良: 既定の色・短い見出しは ok", () => {
    expect(checkScreenshotStyle({ plan: plan(), brandPrimary: "#43C251" }).status).toBe("ok");
  });
  it("毒: 濃い紺の背景は fail（旧既定 #0E2747→#1E4E8C）", () => {
    const r = checkScreenshotStyle({ plan: plan({ framedStyle: { bgTop: "#0E2747", bgBottom: "#1E4E8C" } }) });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/暗い/);
  });
  it("毒: 長い見出しは fail", () => {
    const r = checkScreenshotStyle({
      plan: { framedCaptions: { "1": { headline: "友達から通知が届く！トレーニングの記録をみんなで共有して毎日モチベーションアップ" } } },
    });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/1行 13 字まで/);
  });
  it("毒: 3行の見出し・長い補足は fail", () => {
    const r = checkScreenshotStyle({ plan: { framedCaptions: { "1": { headline: "あ\nい\nう", sub: "補足がとても長い説明文になっていて読まれない文章です" } } } });
    expect(r.problems.length).toBe(2);
  });
  it("毒: 撮影時のキャプション帯(publicPages の title)が長いのも fail", () => {
    const r = checkScreenshotStyle({ plan: { publicPages: [{ slot: 1, title: "これはとても長い見出しで字が多すぎます", subtitle: "" }] } });
    expect(r.status).toBe("fail");
  });
  it("毒: 明るい背景に白い字は fail", () => {
    const r = checkScreenshotStyle({ plan: plan({ framedStyle: { bgTop: "#FFF8E1", bgBottom: "#FFECB3", headlineColor: "#FFFFFF" } }) });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/薄い/);
  });
  it("{波括弧} と改行は字数に数えない", () => {
    expect(checkScreenshotStyle({ plan: { framedCaptions: { "1": { headline: "{一二三四五六七八九十}一二三" } } } }).status).toBe("ok");
  });
  it("自分のアプリの A/B の記録があれば warn に下がる", () => {
    const r = checkScreenshotStyle({
      plan: plan({ framedStyle: { bgTop: "#0E2747", bgBottom: "#1E4E8C", abTestEvidence: "2027-01 PPO で暗い版が +3pt" } }),
    });
    expect(r.status).toBe("warn");
  });
});
