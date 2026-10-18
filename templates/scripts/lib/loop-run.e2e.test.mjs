// ランナー（loop-run.mjs）の結合テスト。入口→アダプタ→カード検査→（症状があれば）提案書→受信箱 を、偽の Ollama で一続きに通す。
// 確認すること: 症状なしなら AI を呼ばない／同じ症状は重複で止まる／人間が却下しても重複で止まる／no_effect なら再提案／
//   Ollama に届かなければ止まる（外部へ落ちない）／アダプタ・入口が壊れたら先へ進まない／受信箱とrun.jsonにデータが載らない。
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_PASS, ANSWER, SAMPLE, envNoAi, runAsync, startStub } from "./loop-test-fixtures.mjs";

const S = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));
const ADAPTER = S("loop-adapter-diagnostics.mjs");
const RUNNER = S("loop-run.mjs");

/** 作業ディレクトリ・入口（固定の文字列を出すコマンド）・アダプタ・偽Ollamaを用意して、ランナーを走らせる道具を返す。 */
async function setup(answer = ANSWER) {
  const dir = mkdtempSync(join(tmpdir(), "loop-run-"));
  const diagFile = join(dir, "diag.txt");
  writeFileSync(diagFile, SAMPLE);
  const stub = await startStub(answer);
  const root = join(dir, "_loop", "demo");
  const sourceOf = (file) => JSON.stringify([process.execPath, "-e", "process.stdout.write(require('fs').readFileSync(process.argv[1],'utf8'))", file]);
  const args = (extra = []) => [
    RUNNER, "--project", "demo", "--cwd", dir, "--root", root, "--model", "stub-model",
    "--adapter", JSON.stringify([process.execPath, ADAPTER, "--project", "demo"]),
    "--source", sourceOf(diagFile), "--ollama", `http://127.0.0.1:${stub.port}`, ...extra,
  ];
  const run = (extra) => runAsync(args(extra), undefined, envNoAi(), dir);
  const cleanup = () => { stub.server.close(); rmSync(dir, { recursive: true, force: true }); };
  return { dir, root, diagFile, stub, args, run, cleanup, sourceOf };
}
const readLedger = (root) => readFileSync(join(root, "decisions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

describe("ランナー: 提案までの一続き", () => {
  it("症状があれば、提案書を置き・台帳に proposed・受信箱に追記・state を保存する。run.json にデータが載らない", async () => {
    const t = await setup();
    try {
      const r = await t.run();
      expect(r.err).toBe("");
      expect(r.status).toBe(0);
      expect(r.out).toMatch(/RESULT: proposed P0001-/);
      const [entry] = readLedger(t.root);
      expect(entry).toMatchObject({ decision: "proposed", by: "ai:stub-model" });
      const inbox = readFileSync(join(t.root, "INBOX.md"), "utf8");
      expect(inbox).toContain(entry.proposal);
      expect(inbox).toContain("check-foo");
      expect(JSON.parse(readFileSync(join(t.root, "state.json"), "utf8")).bySignature["check-foo+diagnostics-summary"]).toBe(entry.proposal);
      const runDir = join(t.root, "runs", readdirSync(join(t.root, "runs"))[0]);
      const runJson = readFileSync(join(runDir, "run.json"), "utf8");
      expect(JSON.parse(runJson)).toMatchObject({ action: "propose", symptomCount: 2, unmeasuredCount: 1 });
      for (const leak of ["secret-file", "yamada", "example.com", "何かの本文"]) {
        expect(runJson + inbox).not.toContain(leak);
      }
      expect(t.stub.seen).toHaveLength(1);
    } finally {
      t.cleanup();
    }
  }, 90000);

  it("症状が無ければ AI を呼ばず、提案書も台帳も作らない", async () => {
    const t = await setup();
    try {
      writeFileSync(t.diagFile, ALL_PASS);
      const r = await t.run();
      expect(r.status).toBe(0);
      expect(r.out).toContain("RESULT: no-symptoms");
      expect(t.stub.seen).toHaveLength(0);
      expect(existsSync(join(t.root, "decisions.jsonl"))).toBe(false);
      expect(existsSync(join(t.root, "INBOX.md"))).toBe(false);
    } finally {
      t.cleanup();
    }
  }, 90000);

  it("同じ症状をもう一度走らせると、重複として止まり AI を呼ばない", async () => {
    const t = await setup();
    try {
      expect((await t.run()).status).toBe(0);
      const r2 = await t.run();
      expect(r2.status).toBe(0);
      expect(r2.out).toContain("RESULT: skip-duplicate");
      expect(t.stub.seen).toHaveLength(1);
      expect(readLedger(t.root)).toHaveLength(1);
    } finally {
      t.cleanup();
    }
  }, 90000);

  it("人間が却下しても重複で止まる。効果なし(no_effect)になれば再提案する。--force でも再提案する", async () => {
    const t = await setup();
    const rec = (decision, proposal) => spawnSync(process.execPath, [S("record-loop-decision.mjs"), "--ledger", join(t.root, "decisions.jsonl"), "--proposal", proposal, "--decision", decision, "--by", "human:link", "--reason", "判断した"], { encoding: "utf8", env: envNoAi() });
    try {
      expect((await t.run()).status).toBe(0);
      const p1 = readLedger(t.root)[0].proposal;
      expect(rec("rejected", p1).status).toBe(0);
      expect((await t.run()).out).toContain("RESULT: skip-duplicate");
      expect((await t.run(["--force"])).out).toMatch(/RESULT: proposed P0002-/);
      expect(t.stub.seen).toHaveLength(2);
    } finally {
      t.cleanup();
    }
  }, 120000);

  it("approved のあと no_effect を記録すれば、新しい提案が出る", async () => {
    const t = await setup();
    const rec = (decision, proposal) => spawnSync(process.execPath, [S("record-loop-decision.mjs"), "--ledger", join(t.root, "decisions.jsonl"), "--proposal", proposal, "--decision", decision, "--by", "human:link", "--reason", "判断した"], { encoding: "utf8", env: envNoAi() });
    try {
      expect((await t.run()).status).toBe(0);
      const p1 = readLedger(t.root)[0].proposal;
      expect(rec("approved", p1).status).toBe(0);
      expect(rec("no_effect", p1).status).toBe(0);
      expect((await t.run()).out).toMatch(/RESULT: proposed P0002-/);
    } finally {
      t.cleanup();
    }
  }, 120000);
});

describe("ランナー: 止まるべきときに止まる（fail-closed・外へ落ちない）", () => {
  it("Ollama に届かなければ exit 2。台帳も受信箱も作らない", async () => {
    const t = await setup();
    try {
      const r = await runAsync(t.args(["--ollama", "http://127.0.0.1:1"]), undefined, envNoAi(), t.dir);
      expect(r.status).toBe(2);
      expect(r.err).toContain("外部AIへは落とさず");
      expect(existsSync(join(t.root, "decisions.jsonl"))).toBe(false);
      expect(existsSync(join(t.root, "INBOX.md"))).toBe(false);
    } finally {
      t.cleanup();
    }
  }, 90000);

  it("ローカル以外の送り先は、何も走らせる前に拒否（exit 1・理由を正しく言う・入口もアダプタも動かさない）", async () => {
    const t = await setup();
    try {
      const r = await runAsync(t.args(["--ollama", "http://example.com"]), undefined, envNoAi(), t.dir);
      expect(r.status).toBe(1);
      expect(r.err).toContain("ローカル");
      expect(r.err).not.toContain("形式検査");
      expect(existsSync(join(t.root, "runs"))).toBe(false);
      expect(existsSync(join(t.root, "decisions.jsonl"))).toBe(false);
    } finally {
      t.cleanup();
    }
  }, 90000);

  it("入口コマンドの出力が空なら exit 2（測れていない）。アダプタも走らない", async () => {
    const t = await setup();
    try {
      writeFileSync(t.diagFile, "");
      const r = await t.run();
      expect(r.status).toBe(2);
      expect(r.err).toContain("入口コマンドの出力が空");
      expect(t.stub.seen).toHaveLength(0);
    } finally {
      t.cleanup();
    }
  }, 90000);

  it("診断のまとめが無い入力ではアダプタが exit 2 → ランナーも exit 2", async () => {
    const t = await setup();
    try {
      writeFileSync(t.diagFile, "ただのログ");
      const r = await t.run();
      expect(r.status).toBe(2);
      expect(t.stub.seen).toHaveLength(0);
    } finally {
      t.cleanup();
    }
  }, 90000);

  it("アダプタがカードを検査に通せなければ exit 1（先へ進まない）", async () => {
    const t = await setup();
    try {
      writeFileSync(t.diagFile, `--- 診断結果まとめ ---\n✗ check-${"a".repeat(70)}: fail\n`);
      const r = await t.run();
      expect(r.status).toBe(1);
      expect(t.stub.seen).toHaveLength(0);
    } finally {
      t.cleanup();
    }
  }, 90000);

  it("アダプタが検査に通らないカードを直接書いて exit 0 で終わっても、ランナーが再検査して exit 1（二重の防壁）", async () => {
    const t = await setup();
    try {
      const code = "require('fs').writeFileSync(require('path').join(process.env.LOOP_OUT_DIR,'x.json'), JSON.stringify({schema:1,id:'x',project:'demo',source:'s',verdict:'fail',version:'1',at:'2026-10-18T06:00:00Z',metrics:{},commentText:'個人情報'}))";
      const r = await runAsync([RUNNER, "--project", "demo", "--cwd", t.dir, "--root", t.root, "--model", "m", "--adapter", JSON.stringify([process.execPath, "-e", code]), "--ollama", `http://127.0.0.1:${t.stub.port}`], undefined, envNoAi(), t.dir);
      expect(r.status).toBe(1);
      expect(r.err).toContain("症状カードが検査に通らない");
      expect(t.stub.seen).toHaveLength(0);
    } finally {
      t.cleanup();
    }
  }, 90000);

  it("モデルの提案書が形式検査に通らなければ exit 1・_invalid に隔離・台帳と受信箱は空のまま", async () => {
    const t = await setup(ANSWER.replace("（ファイル名は未確認）", "（ファイルやモジュール名）"));
    try {
      const r = await t.run();
      expect(r.status).toBe(1);
      expect(existsSync(join(t.root, "decisions.jsonl"))).toBe(false);
      expect(existsSync(join(t.root, "INBOX.md"))).toBe(false);
      expect(readdirSync(join(t.root, "proposals", "_invalid")).length).toBeGreaterThan(0);
    } finally {
      t.cleanup();
    }
  }, 90000);

  it("必須の引数が無ければ exit 2。--adapter が JSON の配列でなければ exit 2", async () => {
    const t = await setup();
    try {
      expect((await runAsync([RUNNER, "--project", "demo"], undefined, envNoAi(), t.dir)).status).toBe(2);
      const r = await runAsync([RUNNER, "--project", "demo", "--model", "m", "--adapter", "node x.mjs", "--cwd", t.dir, "--root", t.root], undefined, envNoAi(), t.dir);
      expect(r.status).toBe(2);
      expect(r.err).toContain("JSON の配列");
    } finally {
      t.cleanup();
    }
  });

  it("設定ファイル(--config)から同じことができる。フラグが優先", async () => {
    const t = await setup();
    try {
      const cfgPath = join(t.dir, "loop.config.json");
      writeFileSync(cfgPath, JSON.stringify({ project: "demo", model: "stub-model", cwd: t.dir, root: t.root, adapter: [process.execPath, ADAPTER, "--project", "demo"], source: JSON.parse(t.sourceOf(t.diagFile)), ollama: `http://127.0.0.1:${t.stub.port}` }));
      const r = await runAsync([RUNNER, "--config", cfgPath], undefined, envNoAi(), t.dir);
      expect(r.status).toBe(0);
      expect(r.out).toMatch(/RESULT: proposed/);
    } finally {
      t.cleanup();
    }
  }, 90000);
});
