import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_ABS_NUMBER, MAX_BYTES, MAX_METRICS, validateSymptomCard } from "./symptom-card-core.mjs";

const good = () => ({
  schema: 1,
  id: "comment-lag",
  project: "tsuioku",
  source: "status-live-adapter",
  verdict: "warn",
  version: "1.2.3",
  buildId: "a1b2c3d",
  at: "2026-10-18T05:30:00+09:00",
  metrics: { commentCount: 120, p95Ms: 840, ok: true },
});
const rules = (card, opts) => validateSymptomCard(card, opts).violations.map((x) => `${x.path}:${x.rule}`);

describe("正常なカード", () => {
  it("通る（buildId は省略できる）", () => {
    expect(validateSymptomCard(good()).ok).toBe(true);
    const c = good();
    delete c.buildId;
    expect(validateSymptomCard(c).ok).toBe(true);
  });
});

describe("許可リスト: 知らないものは全部拒否（fail-closed）", () => {
  it("未知の最上位キー（新しいフィールドが増えても漏れない）", () => {
    expect(rules({ ...good(), commentText: "x" })).toContain("$.commentText:unknown-key");
    expect(rules({ ...good(), avatarUrl: "x" })).toContain("$.avatarUrl:unknown-key");
  });
  it("必須キーの欠落・schema違い・verdict違い", () => {
    const c = good();
    delete c.id;
    expect(rules(c)).toContain("$.id:missing");
    expect(rules({ ...good(), schema: 2 })).toContain("$.schema:schema-must-be-1");
    expect(rules({ ...good(), verdict: "great" })).toContain("$.verdict:verdict-not-allowed");
    const m = good();
    delete m.metrics;
    expect(rules(m)).toContain("$.metrics:missing");
  });
  it("オブジェクトでない入力", () => {
    for (const x of [null, [], "x", 1]) expect(validateSymptomCard(x).ok).toBe(false);
  });
});

describe("metrics は数値と真偽値だけ（自由記述が入りようがない）", () => {
  it("文字列・配列・オブジェクト・null を拒否", () => {
    for (const val of ["本文です", ["a"], { a: 1 }, null]) {
      expect(rules({ ...good(), metrics: { note: val } })).toContain("$.metrics.note:metric-value-must-be-number-or-boolean");
    }
  });
  it("個人・秘密を示す語を含むキー名を拒否", () => {
    for (const k of ["userId", "displayName", "commentText", "avatarUrl", "apiKey", "authToken", "user_id", "text"]) {
      expect(rules({ ...good(), metrics: { [k]: 1 } }).some((r) => r.endsWith("forbidden-word"))).toBe(true);
    }
  });
  it("集計値のキー名は通す（件数の指標を誤って落とさない）", () => {
    for (const k of ["commentCount", "userCount", "activeUsers", "mailCount", "p95Ms", "giftTotal", "paid"]) {
      expect(validateSymptomCard({ ...good(), metrics: { [k]: 1 } }).ok).toBe(true);
    }
  });
  it("キー形式違反（大文字始まり・記号・長すぎ）", () => {
    for (const k of ["Count", "a-b", "a.b", "x".repeat(49)]) expect(rules({ ...good(), metrics: { [k]: 1 } }).some((r) => r.endsWith("metric-key-format"))).toBe(true);
  });
  it("NaN/Infinity と巨大な数（数値のIDや電話番号の混入を粗く防ぐ）", () => {
    expect(rules({ ...good(), metrics: { a: NaN } })).toContain("$.metrics.a:number-not-finite");
    expect(rules({ ...good(), metrics: { a: MAX_ABS_NUMBER + 1 } }).some((r) => r.includes("number-too-large"))).toBe(true);
    expect(validateSymptomCard({ ...good(), metrics: { a: MAX_ABS_NUMBER } }).ok).toBe(true);
  });
  it("件数の上限", () => {
    const metrics = Object.fromEntries(Array.from({ length: MAX_METRICS + 1 }, (_, i) => [`m${i}`, i]));
    expect(rules({ ...good(), metrics }).some((r) => r.includes("too-many-metrics"))).toBe(true);
  });
});

describe("文字列フィールドは短い・形が決まったものだけ", () => {
  it("メール・URL・空白を含む文字列・日本語の名前を拒否", () => {
    for (const [k, val] of [["id", "taro@example.com"], ["project", "https://example.com"], ["source", "山田 太郎"], ["version", "1.0 beta"], ["buildId", "a/b"]]) {
      expect(rules({ ...good(), [k]: val })).toContain(`$.${k}:format`);
    }
  });
  it("秘密らしき形（sk-・長い不透明文字列・鍵の変数名）を拒否", () => {
    expect(rules({ ...good(), buildId: "A".repeat(40) })).toContain("$.buildId:long-opaque-string");
    expect(rules({ ...good(), id: "sk-abcdefgh12345" }).some((r) => r.includes("secret-like(sk-)"))).toBe(true);
    expect(rules({ ...good(), source: "OPENAI_API_KEY" }).some((r) => r.includes("secret-variable-name"))).toBe(true);
  });
  it("時刻は ISO8601 だけ", () => {
    expect(rules({ ...good(), at: "昨日" })).toContain("$.at:format");
    expect(validateSymptomCard({ ...good(), at: "2026-10-18T05:30:00Z" }).ok).toBe(true);
  });
});

describe("大きさの上限と、ログに値を残さないこと", () => {
  it("バイト数の上限", () => {
    expect(rules(good(), { byteLength: MAX_BYTES + 1 }).some((r) => r.includes("too-large"))).toBe(true);
  });
  it("違反メッセージに問題の値（個人情報・秘密）が載らない", () => {
    const secret = "taro.yamada@example.com";
    const token = "sk-SECRETSECRET12345678";
    const out = JSON.stringify(
      validateSymptomCard({ ...good(), id: secret, buildId: token, "山田太郎のコメント本文": 1, metrics: { "ユーザー名": 1, text: "こんにちは" } }).violations,
    );
    expect(out).not.toContain(secret);
    expect(out).not.toContain("SECRETSECRET");
    expect(out).not.toContain("山田太郎");
    expect(out).not.toContain("こんにちは");
  });
});

describe("CLI（3値 exit）", () => {
  const cli = fileURLToPath(new URL("../check-symptom-card.mjs", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  it("合格=0 / 違反=1 / 対象なし=2 / 壊れたJSON=1", () => {
    const dir = mkdtempSync(join(tmpdir(), "symptom-"));
    try {
      writeFileSync(join(dir, "ok.json"), JSON.stringify(good()));
      expect(run(dir).status).toBe(0);
      writeFileSync(join(dir, "bad.json"), JSON.stringify({ ...good(), extra: 1 }));
      const r = run(dir);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("unknown-key");
      writeFileSync(join(dir, "broken.json"), "{not json");
      expect(run(join(dir, "broken.json")).status).toBe(1);
      expect(run(join(dir, "nothing-here")).status).toBe(2);
      expect(run().status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
