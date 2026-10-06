import { describe, expect, it } from "vitest";
import {
  analyzeTeam,
  exitCodeFor,
  featureOverlap,
  jaccard,
  ngramSet,
  normalizeForNgram,
} from "./team-distinction-core.mjs";

const app = (name, features, one, desc, notes) => ({
  name,
  distinction: { oneLiner: one, coreFeatures: features },
  descriptionText: desc,
  releaseNotesText: notes,
});

describe("jaccard / ngram", () => {
  it("同一は 1、全く違えば 0、空は null（0 と区別）", () => {
    const a = ngramSet(normalizeForNgram("足あとを残して図鑑を埋める"), 5);
    expect(jaccard(a, a)).toBe(1);
    expect(jaccard(a, ngramSet(normalizeForNgram("ライブの参加予定を集める"), 5))).toBe(0);
    expect(jaccard(new Set(), a)).toBeNull();
  });
  it("定型句は比較から除く", () => {
    expect(normalizeForNgram("アプリ内課金はありません")).toBe("");
  });
});

describe("featureOverlap", () => {
  it("全角半角・空白を正規化して交わりを返す", () => {
    expect(featureOverlap(["ＡＢＣ 機能"], ["abc機能"])).toEqual(["ＡＢＣ 機能"]);
    expect(featureOverlap(["a"], ["b"])).toEqual([]);
  });
});

describe("analyzeTeam", () => {
  const A = app(
    "A",
    ["位置の記録", "図鑑", "すれ違い"],
    "AはXの人柄つきで場所を記録するアプリです",
    "足あとを残して市区町村の図鑑を埋めるアプリです。同じ場所を通った人と時間差ですれ違えます。",
    "はじめまして。『A』の最初のリリースです。",
  );
  const B = app(
    "B",
    ["ライブ参加表明", "全国マップ", "応援ランキング"],
    "Bはライブの参加予定を全国マップに集めるアプリです",
    "推しのライブへの参加予定を表明して、全国の仲間と応援ランキングを競えるアプリです。",
    "今回は全国マップの見やすさを改善しました。",
  );
  it("別物の2本は fail なし（exit 0）", () => {
    const f = analyzeTeam([A, B]);
    expect(f.some((x) => x.status === "fail")).toBe(false);
    expect(exitCodeFor(f)).toBe(0);
  });
  it("【毒】coreFeatures が重なれば fail", () => {
    const f = analyzeTeam([
      A,
      { ...B, distinction: { ...B.distinction, coreFeatures: ["位置の記録", "x1x", "y2y"] } },
    ]);
    expect(f.find((x) => x.check === "core-features-overlap")?.status).toBe("fail");
  });
  it("【毒】oneLiner が同一なら fail", () => {
    const f = analyzeTeam([A, { ...B, distinction: { ...B.distinction, oneLiner: A.distinction.oneLiner } }]);
    expect(f.some((x) => x.check === "oneliner-identical" && x.status === "fail")).toBe(true);
  });
  it("【毒】説明文が同一なら fail", () => {
    const f = analyzeTeam([A, { ...B, descriptionText: A.descriptionText }]);
    expect(f.find((x) => x.check === "description-jaccard")?.status).toBe("fail");
  });
  it("【毒】リリースノート冒頭が名称以外同型なら fail", () => {
    const f = analyzeTeam([A, { ...B, releaseNotesText: "はじめまして。『B』の最初のリリースです。" }]);
    expect(f.some((x) => x.check === "release-notes-first-sentence" && x.status === "fail")).toBe(true);
  });
  it("distinction 未宣言は unmeasured(exit 2)。緑にしない", () => {
    const f = analyzeTeam([A, { name: "C" }]);
    expect(f.some((x) => x.status === "unmeasured")).toBe(true);
    expect(exitCodeFor(f)).toBe(2);
  });
  it("fail があれば unmeasured があっても exit 1", () => {
    const f = analyzeTeam([A, { ...B, descriptionText: A.descriptionText }, { name: "C" }]);
    expect(exitCodeFor(f)).toBe(1);
  });
});
