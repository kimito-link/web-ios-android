// 自己改善ループの結合テスト: 第2のアダプタ（汎用診断）→ カード検査 → 提案書づくり → 形式検査 → 台帳(proposed) → 人間の承認(approved)。
// 目的: ループ本体（symptom-card-core・loop-propose・proposal-format-core・loop-ledger）に手を入れずに、2つ目の入口で最後まで通ることを示す（共通化の証拠）。
// ローカルAIは、127.0.0.1 の偽の Ollama サーバー（決まった提案書を返す）で代用する。実モデルの質は測らない（それは SPEC-loop-propose-v1.md の実測）。
import { describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SAMPLE } from "./loop-adapter-diagnostics-core.test.mjs";

const S = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));
const envNoAi = () => { const e = { ...process.env }; delete e.CLAUDE_CODE_SESSION_ID; return e; };

/** 偽の Ollama。受け取った /api/chat の本文を記録し、決まった提案書の本文を NDJSON で返す。 */
function startStub(answer) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      res.write(JSON.stringify({ message: { content: answer.slice(0, 20) }, done: false }) + "\n");
      res.write(JSON.stringify({ message: { content: answer.slice(20) }, done: false }) + "\n");
      res.end(JSON.stringify({ done: true }) + "\n");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, seen, port: server.address().port })));
}
const runAsync = (args, input, env) => new Promise((resolve) => {
  const p = spawn(process.execPath, args, { env: env ?? envNoAi() });
  let out = ""; let err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", (status) => resolve({ status, out, err }));
  if (input !== undefined) p.stdin.end(input); else p.stdin.end();
});

// 偽の提案書の本文。観測の数字は、診断カードの metrics にある値だけ（総数6・失敗1・測れず1）。
const ANSWER = `## 症状
検査 check-foo が失敗している。

## 観測
- 検査は 6 件、失敗は 1 件、測れていないのは 1 件。

## 原因仮説
- 【確証】失敗が 1 件ある。確度: 高。根拠: card:check-foo。反証: 再実行で失敗が消えれば誤り。
- 【推測】check-foo の前提が変わった。確度: 中。反証: 前提を戻しても失敗するなら誤り。

## 版の提案
- 変更: check-foo の失敗の原因を特定する
- 触るファイル候補: （ファイル名は未確認）
- やらないこと: 他の検査の変更

## 検証手順
check-foo を再実行して結果を確かめる。
`;

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
