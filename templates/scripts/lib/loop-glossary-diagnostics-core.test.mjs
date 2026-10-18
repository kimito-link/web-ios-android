import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CARD_GLOSSARY, buildCardsFromDiagnostics } from "./loop-adapter-diagnostics-core.mjs";
import { MAX_DESC, describeCheck, formatDiagnosticsGlossary, headerCommentLines } from "./loop-glossary-diagnostics-core.mjs";
import { MAX_GLOSSARY_BYTES, assertGlossary } from "./loop-propose-core.mjs";
import { SAMPLE } from "./loop-test-fixtures.mjs";

const DIAG_DIR = fileURLToPath(new URL("../../diagnostics/", import.meta.url));

describe("describeCheck: 先頭コメントの書式ごとに説明を取り出す", () => {
  it("「ファイル名 — ★説明。続き」形式（/** */）", () => {
    const src = "#!/usr/bin/env node\n/**\n * check-a.mjs — ★新しいファイルに先頭コメントがあるかを見る。なぜ要るか…\n */\n";
    expect(describeCheck(src, "check-a.mjs")).toBe("新しいファイルに先頭コメントがあるかを見る");
  });
  it("「// ファイル名 — 説明」形式", () => {
    expect(describeCheck("// check-b.mjs — 大きいファイルの誤追跡を検出する。\n// 原理: …\n", "check-b.mjs")).toBe("大きいファイルの誤追跡を検出する");
  });
  it("ファイル名だけの行のあとに説明が続く形式", () => {
    const src = "/**\n * check-c.mjs\n *   ★コンソールが無いと固まる書き方を見る。\n */\n";
    expect(describeCheck(src, "check-c.mjs")).toBe("コンソールが無いと固まる書き方を見る");
  });
  it("ファイル名が無く、説明の文から始まる形式", () => {
    expect(describeCheck("/**\n * 外の誰かが決めた数字が古くなっていないかを検査する。\n */\n", "check-d.mjs")).toBe("外の誰かが決めた数字が古くなっていないかを検査する");
  });
  it("文が複数行に折り返されていても、最初の「。」までつなぐ", () => {
    const src = "// check-e.mjs — hookが実際に\n// 参照されているかを検出する。\n// 原理…\n";
    expect(describeCheck(src, "check-e.mjs")).toBe("hookが実際に参照されているかを検出する");
  });
  it("長い説明は MAX_DESC で「…」に切る", () => {
    const src = `// check-f.mjs — ${"あ".repeat(100)}。\n`;
    const d = describeCheck(src, "check-f.mjs");
    expect(d.length).toBe(MAX_DESC);
    expect(d.endsWith("…")).toBe(true);
  });
  it("ファイル名だけの行の次の行に句点が無くても、その行を説明にする", () => {
    const src = ["/**", " * check-i.mjs", " * ★句点の無い説明だけが書かれている", " */"].join("\n");
    expect(describeCheck(src, "check-i.mjs")).toBe("句点の無い説明だけが書かれている");
  });
  it("コメントはあるが説明が空（ファイル名だけ）なら null。作り話の空文字にしない", () => {
    expect(describeCheck("// check-h.mjs —", "check-h.mjs")).toBeNull();
    expect(describeCheck("// check-h.mjs", "check-h.mjs")).toBeNull();
  });
  it("先頭コメントが無い・空なら null（作り話をしない）", () => {
    expect(describeCheck("const x = 1;\n", "check-g.mjs")).toBeNull();
    expect(describeCheck("/**\n */\n", "check-g.mjs")).toBeNull();
    expect(headerCommentLines("")).toEqual([]);
  });
});

describe("実物のキットの検査（templates/diagnostics）", () => {
  const files = readdirSync(DIAG_DIR).filter((f) => /^check-[a-z0-9-]+\.mjs$/.test(f));
  it("全部の検査から説明が取れる（先頭コメントの書き方が変わったら赤）", () => {
    expect(files.length).toBeGreaterThan(20);
    const missing = files.filter((f) => describeCheck(readFileSync(join(DIAG_DIR, f), "utf8"), f) === null);
    expect(missing).toEqual([]);
  });
  it("全検査の用語集が、用語集の上限(4KiB)に収まり、検査（秘密・メール）を通る", () => {
    const checks = files.map((f) => ({ name: f.replace(/\.mjs$/, ""), desc: describeCheck(readFileSync(join(DIAG_DIR, f), "utf8"), f) }));
    const text = formatDiagnosticsGlossary(checks, CARD_GLOSSARY);
    expect(Buffer.byteLength(text)).toBeLessThan(MAX_GLOSSARY_BYTES);
    expect(() => assertGlossary(text)).not.toThrow();
  });
});

describe("固定の説明（CARD_GLOSSARY）は、アダプタが出すものを全部カバーする", () => {
  const cards = buildCardsFromDiagnostics(SAMPLE, { project: "demo", version: "1", now: new Date("2026-10-18T06:00:00Z") });
  it("カードの指標キーが全部載る", () => {
    for (const k of new Set(cards.flatMap((c) => Object.keys(c.metrics)))) expect(Object.keys(CARD_GLOSSARY)).toContain(k);
  });
  it("固定のカード id（diagnostics-summary）も載る", () => {
    expect(Object.keys(CARD_GLOSSARY)).toContain("diagnostics-summary");
  });
});

describe("CLI（loop-glossary-diagnostics.mjs）", () => {
  const cli = fileURLToPath(new URL("../loop-glossary-diagnostics.mjs", import.meta.url));
  const run = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", cwd });
  const makeChecks = (dir, n, descLen = 10) => {
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < n; i++) writeFileSync(join(dir, `check-x${String(i).padStart(3, "0")}.mjs`), `// check-x${String(i).padStart(3, "0")}.mjs — ${"あ".repeat(descLen)}。\n`);
  };

  it("書く: 説明つきの用語集を _loop/<project>/glossary.txt に出す", () => {
    const dir = mkdtempSync(join(tmpdir(), "gd-"));
    try {
      makeChecks(join(dir, "diag"), 3);
      const r = run(["--project", "demo", "--dir", "diag"], dir);
      expect(r.status).toBe(0);
      const text = readFileSync(join(dir, "_loop", "demo", "glossary.txt"), "utf8");
      expect(text).toContain("check-x001: ");
      expect(text).toContain("diagnostics-summary");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("--cards で、カードに出る検査だけに絞る", () => {
    const dir = mkdtempSync(join(tmpdir(), "gd-"));
    try {
      makeChecks(join(dir, "diag"), 3);
      mkdirSync(join(dir, "cards"));
      writeFileSync(join(dir, "cards", "a.json"), JSON.stringify({ id: "check-x001" }));
      writeFileSync(join(dir, "cards", "b.json"), JSON.stringify({ id: "check-x002-scripts" }));
      const r = run(["--stdout", "--dir", "diag", "--cards", "cards"], dir);
      expect(r.stdout).toContain("check-x001: ");
      expect(r.stdout).toContain("check-x002: ");
      expect(r.stdout).not.toContain("check-x000: ");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("大きすぎる用語集は exit 1・何も書かない（--cards で絞るよう案内）", () => {
    const dir = mkdtempSync(join(tmpdir(), "gd-"));
    try {
      makeChecks(join(dir, "diag"), 60, 40);
      const r = run(["--project", "demo", "--dir", "diag"], dir);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("--cards");
      expect(existsSync(join(dir, "_loop"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("検査のディレクトリが無い・引数が無いなら exit 2", () => {
    const dir = mkdtempSync(join(tmpdir(), "gd-"));
    try {
      expect(run(["--project", "demo", "--dir", "nothing"], dir).status).toBe(2);
      expect(run([], dir).status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
