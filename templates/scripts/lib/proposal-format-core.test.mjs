import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_BYTES, validateProposal } from "./proposal-format-core.mjs";

const card = { schema: 1, id: "comment-lag", project: "tsuioku", source: "adapter", verdict: "warn", version: "1.2.3", at: "2026-10-18T05:30:00Z", metrics: { commentCount: 120, p95Ms: 840 } };

const good = () => `schema: 1
proposal: P0001-comment-lag
project: tsuioku
cards: comment-lag
writer: ai:qwen3-local

## 症状
コメント表示が遅れる。

## 観測
- コメント件数 120 件、p95 は 840 ms。

## 原因仮説
- 【推測】描画のたびに全件を再計算している。確度: 中。反証: 件数を半分にして p95 が変わらなければ誤り。
- 【確証】p95 が閾値を超えている。確度: 高。根拠: card:comment-lag。反証: 再測定で閾値内なら誤り。

## 版の提案
- 変更: 再計算を差分更新に変える
- 触るファイル候補: src/lib/commentTimelineMirror.js
- やらないこと: 表示仕様の変更

## 検証手順
実機で件数120のとき p95 を測る。
`;
const rules = (t, o) => validateProposal(t, o).violations.map((x) => `${x.where}:${x.rule}`);
const replaceIn = (t, a, b) => { if (!t.includes(a)) throw new Error("test setup: " + a); return t.replace(a, b); };

describe("正常な提案書", () => {
  it("通る（カード・台帳の照合つきでも）", () => {
    expect(validateProposal(good()).ok).toBe(true);
    expect(validateProposal(good(), { cards: [card], ledger: [] }).ok).toBe(true);
  });
});

describe("ヘッダーと見出し", () => {
  it("ヘッダーの欠落・不正・未知キー", () => {
    expect(rules(replaceIn(good(), "schema: 1\n", ""))).toContain("header.schema:schema-must-be-1");
    expect(rules(replaceIn(good(), "writer: ai:qwen3-local", "writer: たろう"))[0]).toContain("header.writer");
    expect(rules(replaceIn(good(), "cards: comment-lag", "cards: "))).toContain("header.cards:at-least-one-card");
    expect(rules(replaceIn(good(), "writer:", "extra: x\nwriter:")).some((r) => r.includes("unknown-key"))).toBe(true);
  });
  it("見出しの順序違い・欠落・増加を拒否", () => {
    expect(rules(replaceIn(good(), "## 検証手順", "## おまけ")).some((r) => r.startsWith("sections:"))).toBe(true);
    expect(rules(good() + "\n## 追加\nx\n").some((r) => r.startsWith("sections:"))).toBe(true);
  });
  it("空のセクションを拒否", () => {
    expect(rules(replaceIn(good(), "コメント表示が遅れる。", ""))).toContain("## 症状:empty");
  });
});

describe("原因仮説（確証と推測を分ける）", () => {
  it("確証/推測の印・確度・反証が無い項目を拒否", () => {
    expect(rules(replaceIn(good(), "【推測】", "")).some((r) => r.includes("needs-【確証】or【推測】"))).toBe(true);
    expect(rules(replaceIn(good(), "確度: 中。", "")).some((r) => r.includes("needs-確度"))).toBe(true);
    expect(rules(replaceIn(good(), "反証: 件数を半分にして p95 が変わらなければ誤り。", "")).some((r) => r.includes("needs-反証"))).toBe(true);
  });
  it("【確証】に根拠が無いものを拒否（根拠なき断定は無効）", () => {
    expect(rules(replaceIn(good(), "根拠: card:comment-lag。", "")).some((r) => r.includes("確証-needs-根拠"))).toBe(true);
  });
  it("項目が1つも無い", () => {
    const t = good().replace(/## 原因仮説[\s\S]*?(?=## 版の提案)/, "## 原因仮説\n文章だけ\n\n");
    expect(rules(t)).toContain("## 原因仮説:no-items(- で始まる項目が要る)");
  });
});

describe("版の提案（1版1変更）", () => {
  it("変更が2行・0行を拒否、触るファイル候補・やらないことが無いのも拒否", () => {
    expect(rules(replaceIn(good(), "- やらないこと:", "- 変更: もう1つ\n- やらないこと:")).some((r) => r.includes("exactly-one-変更(found 2)"))).toBe(true);
    expect(rules(replaceIn(good(), "- 変更: 再計算を差分更新に変える\n", "")).some((r) => r.includes("found 0"))).toBe(true);
    expect(rules(replaceIn(good(), "- 触るファイル候補: src/lib/commentTimelineMirror.js\n", "")).some((r) => r.includes("触るファイル候補"))).toBe(true);
    expect(rules(replaceIn(good(), "- やらないこと: 表示仕様の変更\n", "")).some((r) => r.includes("やらないこと"))).toBe(true);
  });
});

describe("観測の数字はカードの値だけ", () => {
  it("カードに無い数字を拒否・カードに無いidを拒否", () => {
    expect(rules(replaceIn(good(), "p95 は 840 ms", "p95 は 999 ms"), { cards: [card] })).toContain("## 観測:number-not-in-cards");
    expect(rules(good(), { cards: [] })).toContain("header.cards:card-not-found");
  });
  it("カードを渡さなければ数字は見ない", () => {
    expect(validateProposal(replaceIn(good(), "840", "999")).ok).toBe(true);
  });
  it("コード表記の中の数字は数えない", () => {
    expect(validateProposal(replaceIn(good(), "コメント件数 120 件", "`p95Ms` が `x2` で、120 件"), { cards: [card] }).ok).toBe(true);
  });
});

describe("却下済みの参照", () => {
  it("台帳で rejected でない id を参照したら拒否", () => {
    const t = replaceIn(good(), "## 検証手順", "## 検証手順\n却下済み: D0009\n");
    expect(rules(t, { ledger: [] })).toContain("却下済み:referenced-id-not-rejected-in-ledger");
    expect(validateProposal(t, { ledger: [{ id: "D0009", proposal: "P0000", decision: "rejected" }] }).ok).toBe(true);
  });
});

describe("秘密・サイズ", () => {
  it("秘密・メールらしき形を拒否（値は出力に載らない）", () => {
    const out = JSON.stringify(validateProposal(replaceIn(good(), "遅れる。", "遅れる。taro@example.com sk-SECRETSECRET1234")).violations);
    expect(out).toContain("email-like");
    expect(out).not.toContain("taro@");
    expect(out).not.toContain("SECRETSECRET");
  });
  it("パスやsha短縮は誤検知しない", () => {
    expect(validateProposal(replaceIn(good(), "遅れる。", "遅れる。templates/scripts/lib/symptom-card-core.mjs と a1b2c3d4e5f6")).ok).toBe(true);
  });
  it("サイズ上限", () => {
    expect(rules(good() + "あ".repeat(MAX_BYTES)).some((r) => r.includes("too-large"))).toBe(true);
  });
});

describe("CLI（3値 exit）", () => {
  const cli = fileURLToPath(new URL("../check-proposal.mjs", import.meta.url));
  const run = (...a) => spawnSync(process.execPath, [cli, ...a], { encoding: "utf8" });
  it("合格=0 / 違反=1 / 読めない=2", () => {
    const dir = mkdtempSync(join(tmpdir(), "prop-"));
    try {
      writeFileSync(join(dir, "ok.md"), good());
      mkdirSync(join(dir, "cards"));
      writeFileSync(join(dir, "cards", "c.json"), JSON.stringify(card));
      expect(run(join(dir, "ok.md"), "--cards", join(dir, "cards")).status).toBe(0);
      writeFileSync(join(dir, "bad.md"), good().replace("## 検証手順", "## おまけ"));
      expect(run(join(dir, "bad.md")).status).toBe(1);
      expect(run(join(dir, "nothing.md")).status).toBe(2);
      expect(run().status).toBe(2);
      expect(run(join(dir, "ok.md"), "--cards", join(dir, "no-such-dir")).status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
