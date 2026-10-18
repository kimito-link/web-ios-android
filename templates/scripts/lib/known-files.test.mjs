// 「触るファイル候補」の実在照合（knownFiles）と、モデル出力の末尾の英語の挨拶の除去の回帰テスト。
// 背景: 実測で、7B が存在しないファイル名（heavy.js, mirror.js）を創作し、末尾に "Please let me know…" を付けた。
import { describe, expect, it } from "vitest";
import { extractBody } from "./loop-propose-core.mjs";
import { validateProposal } from "./proposal-format-core.mjs";

const card = { schema: 1, id: "lane-painted-zero", project: "tsuioku", source: "adapter", verdict: "fail", version: "1.2.3", at: "2026-10-18T05:30:00Z", metrics: { livesCount: 1 } };
const withFiles = (files) => `schema: 1
proposal: P0001-lane-painted-zero
project: tsuioku
cards: lane-painted-zero
writer: ai:m

## 症状
レーンが空。

## 観測
- 配信件数は 1。

## 原因仮説
- 【推測】供給側が空。確度: 中。反証: 供給側が満ちていても空なら誤り。

## 版の提案
- 変更: 供給側の件数を確認する
- 触るファイル候補: ${files}
- やらないこと: 見た目の変更

## 検証手順
実機で確認する。
`;
const repo = ["src/lib/symptomVerdicts.js", "src/extension/status-entry.js", "scripts/status-live.mjs"];
const rules = (t, o) => validateProposal(t, o).violations.map((x) => `${x.where}:${x.rule}`);

describe("触るファイル候補の実在照合", () => {
  it("実在するファイル（パス・ファイル名だけ・複数）は通る", () => {
    expect(validateProposal(withFiles("src/lib/symptomVerdicts.js, status-entry.js"), { cards: [card], knownFiles: repo }).ok).toBe(true);
  });
  it("存在しないファイル名の創作を拒否する（どれが無いかを示す）", () => {
    expect(rules(withFiles("heavy.js, mirror.js"), { cards: [card], knownFiles: repo })).toEqual([
      "## 版の提案:file-not-found(heavy.js)",
      "## 版の提案:file-not-found(mirror.js)",
    ]);
  });
  it("実在する名前と創作の混在は、創作だけを拒否", () => {
    expect(rules(withFiles("status-live.mjs, ghost.ts"), { cards: [card], knownFiles: repo })).toEqual(["## 版の提案:file-not-found(ghost.ts)"]);
  });
  it("ファイル名を書かない文章（未確認と明記）は通る。数字や v1.2 はファイル名と見なさない", () => {
    expect(validateProposal(withFiles("取得経路まわりのモジュール（ファイル名は未確認）。v1.2 の挙動"), { cards: [card], knownFiles: repo }).ok).toBe(true);
  });
  it("knownFiles を渡さなければ照合しない（従来どおり）", () => {
    expect(validateProposal(withFiles("heavy.js"), { cards: [card] }).ok).toBe(true);
  });
  it("別ディレクトリの同名ファイルを、パス付きで偽って書いたら拒否", () => {
    expect(rules(withFiles("other/dir/symptomVerdicts.js"), { cards: [card], knownFiles: repo })).toEqual(["## 版の提案:file-not-found(other/dir/symptomVerdicts.js)"]);
  });
});

describe("extractBody: 末尾の英語の挨拶を落とす", () => {
  const body = "## 症状\nx\n\n## 検証手順\n確認する。";
  it("Please let me know… などを落とす（本文は残す）", () => {
    expect(extractBody(body + "\n\nPlease let me know if you need any further assistance.")).toBe(body);
    expect(extractBody(body + "\n\nI hope this helps!\nFeel free to ask.")).toBe(body);
  });
  it("日本語の本文の最後の行は落とさない", () => {
    expect(extractBody(body)).toBe(body);
  });
});

describe("雛形の穴埋めが残っていたら拒否（実測: 7B が (ファイルやモジュール名) をそのまま出した）", () => {
  it("全角・半角どちらの括弧でも拒否する", () => {
    expect(rules(withFiles("（ファイルやモジュール名）"), { cards: [card] })).toContain("body:placeholder-not-replaced(ファイルやモジュール名)");
    expect(rules(withFiles("(ファイルやモジュール名)"), { cards: [card] })).toContain("body:placeholder-not-replaced(ファイルやモジュール名)");
  });
  it("置き換えた文章は通る（括弧そのものは禁止しない）", () => {
    expect(validateProposal(withFiles("取得経路のモジュール（ファイル名は未確認）"), { cards: [card] }).ok).toBe(true);
  });
  it("雛形（buildPrompt）の穴埋めは、すべて SKELETON_PLACEHOLDERS にある（検査と雛形がずれない）", async () => {
    const { buildPrompt } = await import("./loop-propose-core.mjs");
    const { SKELETON_PLACEHOLDERS } = await import("./proposal-format-core.mjs");
    const user = buildPrompt({ cards: [card] }).user;
    const skeleton = user.slice(user.indexOf("## 症状"));
    const found = [...skeleton.matchAll(/（([^）]+)）/g)].map((m) => m[1]);
    expect(found.length).toBeGreaterThan(5);
    for (const f of found) expect(SKELETON_PLACEHOLDERS).toContain(f);
  });
  it("雛形をそのまま返したモデル出力は、形式検査に通らない", async () => {
    const { buildPrompt, assembleProposal, extractBody } = await import("./loop-propose-core.mjs");
    const user = buildPrompt({ cards: [card] }).user;
    const echoed = assembleProposal({ proposalId: "P0001-x", project: "tsuioku", cardIds: [card.id], writer: "ai:m", body: extractBody(user.slice(user.indexOf("## 症状"))) });
    expect(rules(echoed, { cards: [card] }).some((r) => r.includes("placeholder-not-replaced"))).toBe(true);
  });
});
