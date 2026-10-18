// 自己改善ループの結合テスト: 第2のアダプタ（汎用診断）→ カード検査 → 提案書づくり → 形式検査 → 台帳(proposed) → 人間の承認(approved)。
// 目的: ループ本体（symptom-card-core・loop-propose・proposal-format-core・loop-ledger）に手を入れずに、2つ目の入口で最後まで通ることを示す（共通化の証拠）。
// ローカルAIは、127.0.0.1 の偽の Ollama サーバー（決まった提案書を返す）で代用する。実モデルの質は測らない（それは SPEC-loop-propose-v1.md の実測）。
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANSWER, SAMPLE, envNoAi, runAsync, startStub } from "./loop-test-fixtures.mjs";

const S = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));

describe("結合: 第2のアダプタ → 提案 → 承認（ループ本体は変更なし）", () => {
  it("診断の出力から、台帳の approved まで通る", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-e2e-"));
    const { server, seen, port } = await startStub(ANSWER);
    try {
      const cardsDir = join(dir, "symptoms");
      const proposals = join(dir, "proposals");
      const ledger = join(dir, "decisions.jsonl");

      // 1) 第2のアダプタ
      const a = await runAsync([S("loop-adapter-diagnostics.mjs"), "--project", "demo", "--out", cardsDir], SAMPLE);
      expect(a.status).toBe(0);
      expect(readdirSync(cardsDir)).toHaveLength(3);

      // 2) カード検査（ループ本体）
      expect(spawnSync(process.execPath, [S("check-symptom-card.mjs"), cardsDir], { encoding: "utf8" }).status).toBe(0);

      // 3) 提案書づくり（ローカルの偽Ollama）→ 形式検査 → 台帳に proposed
      const p = await runAsync([S("loop-propose.mjs"), "--project", "demo", "--cards", cardsDir, "--model", "stub-model", "--ollama", `http://127.0.0.1:${port}`, "--out", proposals, "--ledger", ledger]);
      expect(p.err).toBe("");
      expect(p.status).toBe(0);
      const files = readdirSync(proposals).filter((f) => f.endsWith(".md"));
      expect(files).toHaveLength(1);
      const name = files[0].replace(/\.md$/, "");
      expect(readFileSync(join(proposals, files[0]), "utf8")).toContain("writer: ai:stub-model");
      let entries = readFileSync(ledger, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(entries.map((e) => `${e.proposal}:${e.decision}:${e.by}`)).toEqual([`${name}:proposed:ai:stub-model`]);

      // AIに渡ったのは、カードの内容だけ（診断の本文・ファイル名・メールは渡っていない）
      const sent = JSON.stringify(seen[0]);
      expect(sent).toContain("check-foo");
      for (const leak of ["secret-file", "yamada", "example.com", "何かの本文"]) expect(sent).not.toContain(leak);
      expect(seen).toHaveLength(1);

      // 4) AIの名では承認できない／AIシェルからも承認できない／人間(human:)の承認は通る
      const rec = (by, env) => spawnSync(process.execPath, [S("record-loop-decision.mjs"), "--ledger", ledger, "--proposal", name, "--decision", "approved", "--by", by, "--reason", "確認した"], { encoding: "utf8", env });
      expect(rec("ai:stub-model", envNoAi()).status).toBe(1);
      expect(rec("human:link", { ...envNoAi(), CLAUDE_CODE_SESSION_ID: "s" }).status).toBe(1);
      expect(rec("human:link", envNoAi()).status).toBe(0);
      entries = readFileSync(ledger, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(entries.map((e) => e.decision)).toEqual(["proposed", "approved"]);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
    expect(existsSync(dir)).toBe(false);
  }, 60000);

  it("診断のまとめが無い入力では、カードを作らず exit 2（空のカードで緑にしない）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-e2e-"));
    try {
      const a = await runAsync([S("loop-adapter-diagnostics.mjs"), "--project", "demo", "--out", join(dir, "c")], "ただのログ");
      expect(a.status).toBe(2);
      expect(existsSync(join(dir, "c"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("カードが検査に通らなければ、何も書かず exit 1（fail-closed。IDが上限を超える検査名で再現）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-e2e-"));
    try {
      const longName = "check-" + "a".repeat(70);
      const a = await runAsync([S("loop-adapter-diagnostics.mjs"), "--project", "demo", "--out", join(dir, "c")], `--- 診断結果まとめ ---\n✗ ${longName}: fail\n`);
      expect(a.status).toBe(1);
      expect(a.err).toContain("fail-closed");
      expect(existsSync(join(dir, "c"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("モデルが雛形の穴埋めを残したら、提案書は置かれず台帳にも書かれない（_invalid に隔離）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-e2e-"));
    const bad = ANSWER.replace("（ファイル名は未確認）", "（ファイルやモジュール名）");
    const { server, port } = await startStub(bad);
    try {
      const cardsDir = join(dir, "symptoms");
      expect((await runAsync([S("loop-adapter-diagnostics.mjs"), "--project", "demo", "--out", cardsDir], SAMPLE)).status).toBe(0);
      const ledger = join(dir, "decisions.jsonl");
      const p = await runAsync([S("loop-propose.mjs"), "--project", "demo", "--cards", cardsDir, "--model", "stub", "--ollama", `http://127.0.0.1:${port}`, "--out", join(dir, "proposals"), "--ledger", ledger]);
      expect(p.status).toBe(1);
      expect(existsSync(ledger)).toBe(false);
      expect(readdirSync(join(dir, "proposals", "_invalid")).some((f) => f.endsWith(".violations.txt"))).toBe(true);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
