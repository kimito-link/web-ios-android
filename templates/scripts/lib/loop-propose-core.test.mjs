import { describe, expect, it } from "vitest";
import { MAX_GLOSSARY_BYTES, assembleProposal, assertGlossary, assertLocalUrl, buildPrompt, extractBody, writerOf } from "./loop-propose-core.mjs";
import { validateProposal } from "./proposal-format-core.mjs";

const card = { schema: 1, id: "thumb-white", project: "tsuioku", source: "adapter", verdict: "fail", version: "1.2.3", at: "2026-10-18T05:30:00Z", metrics: { livesCount: 2, snapshotAgeSec: 10 } };

const BODY = `## 症状
サムネが白い。

## 観測
- 配信件数は 2、速報の経過は 10 秒。

## 原因仮説
- 【推測】取得経路が失敗している。確度: 中。反証: 経路を直して変わらなければ誤り。
- 【確証】症状ID thumb-white が出ている。確度: 高。根拠: card:thumb-white。反証: 再測定で消えれば誤り。

## 版の提案
- 変更: 実サムネの取得経路を確認する
- 触るファイル候補: src/lib/identity.js
- やらないこと: 見た目の変更

## 検証手順
実機で再測定する。
`;

describe("assertLocalUrl（外へ出る経路を作らない）", () => {
  it("ローカルだけ許す", () => {
    for (const u of ["http://127.0.0.1:11434", "http://localhost:11434", "http://[::1]:11434"]) expect(() => assertLocalUrl(u)).not.toThrow();
  });
  it("外部・https・壊れたURL・ローカルに見せかけたホストを拒否", () => {
    for (const u of ["http://example.com", "https://127.0.0.1", "http://127.0.0.1.evil.com", "http://evil.com/127.0.0.1", "http://192.168.0.5:11434", "not a url", "http://0.0.0.0:11434"]) {
      expect(() => assertLocalUrl(u)).toThrow();
    }
  });
});

describe("buildPrompt", () => {
  it("カードのJSONと、守るべき規則（確証/推測・1版1変更・数字はカードだけ）を含む", () => {
    const { system, user } = buildPrompt({ cards: [card] });
    expect(user).toContain('"id": "thumb-white"');
    expect(system).toContain("カードにある数字だけ");
    expect(system).toContain("【確証】");
    expect(system).toContain("変更を2つ以上書かない");
    expect(user).toContain("card:thumb-white");
  });
});

describe("extractBody / assembleProposal", () => {
  it("思考ブロック・コードの囲み・前置き・モデルが付けたヘッダーを落とす", () => {
    const raw = "<think>考え中…## 症状</think>\nはい、書きます。\n```markdown\nschema: 9\n" + BODY + "```\n";
    expect(extractBody(raw)).toBe(BODY.trim());
  });
  it("閉じない <think>（打ち切り）も落とす", () => {
    expect(extractBody("<think>まだ考えている…")).toBe("");
  });
  it("機械が付けたヘッダー＋整形した本文は、形式検査に通る", () => {
    const text = assembleProposal({ proposalId: "P0001-thumb-white", project: "tsuioku", cardIds: ["thumb-white"], writer: writerOf("qwen3.8:27b"), body: extractBody(BODY) });
    expect(validateProposal(text, { cards: [card], ledger: [] }).violations).toEqual([]);
  });
  it("モデルが付けたヘッダーの誤りは、機械のヘッダーで上書きされる", () => {
    const text = assembleProposal({ proposalId: "P0001-thumb-white", project: "tsuioku", cardIds: ["thumb-white"], writer: "ai:m", body: extractBody("schema: 9\nproposal: X\n" + BODY) });
    expect(text.startsWith("schema: 1\nproposal: P0001-thumb-white")).toBe(true);
    expect(validateProposal(text, { cards: [card] }).ok).toBe(true);
  });
});

describe("writerOf", () => {
  it("モデル名を ai:<英数._-> にする（: や / を落とす）", () => {
    expect(writerOf("qwen3.8:27b")).toBe("ai:qwen3.8-27b");
    expect(writerOf("wwhite/whiterabbitneo-v3-7b:q4_k_m")).toBe("ai:wwhite-whiterabbitneo-v3-7b-q4_k_m");
  });
});

describe("用語集（データではなく固定の知識）", () => {
  it("あればプロンプトに入り、カードとは別の節になる", () => {
    const { user } = buildPrompt({ cards: [card], glossary: "thumb-white: サムネが白い（実サムネの取得が0件）" });
    expect(user).toContain("用語集");
    expect(user).toContain("thumb-white: サムネが白い");
    expect(user.indexOf("用語集")).toBeLessThan(user.indexOf("症状カード"));
  });
  it("無ければ用語集の節は出ない", () => {
    expect(buildPrompt({ cards: [card] }).user).not.toContain("用語集");
  });
  it("秘密・メールらしき形と大きすぎるものは拒否（値は出さない）", () => {
    for (const bad of ["連絡先 taro@example.com", "OPENAI_API_KEY を使う", "sk-abcdefgh12345", "あ".repeat(MAX_GLOSSARY_BYTES)]) {
      expect(() => assertGlossary(bad)).toThrow();
    }
    try { assertGlossary("連絡先 taro@example.com"); } catch (e) { expect(String(e.message)).not.toContain("taro"); }
    expect(() => buildPrompt({ cards: [card], glossary: "sk-abcdefgh12345" })).toThrow();
  });
});
