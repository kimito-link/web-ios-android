import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { describeCoverageGap, findReadCoverage } from "./transcript-reads.mjs";

// 合成した会話ログ: Read の tool_use と tool_result(行番号付き)を並べる。
const TARGET = resolve(join(tmpdir(), "CLAUDE.md"));
const lines = (n, f = (i) => `行${i}`) => Array.from({ length: n }, (_, i) => f(i + 1));
const numbered = (arr, start) => arr.map((t, i) => `${start + i}\t${t}`).join("\n");

function transcript(reads) {
  const rows = [];
  reads.forEach((r, k) => {
    const id = `t${k}`;
    rows.push({ message: { content: [{ type: "tool_use", id, name: "Read", input: { file_path: TARGET } }] } });
    rows.push({ message: { content: [{ type: "tool_result", tool_use_id: id, content: numbered(r.lines, r.start) }] } });
  });
  const dir = mkdtempSync(join(tmpdir(), "tr-"));
  const p = join(dir, "t.jsonl");
  writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n"));
  return p;
}
const cur = lines(10).join("\n");

describe("findReadCoverage（読んだ行が今の内容と一致しているか）", () => {
  it("1回で全文を読めば complete", () => {
    const t = transcript([{ start: 1, lines: lines(10) }]);
    expect(findReadCoverage(t, TARGET, cur).complete).toBe(true);
  });
  it("後半を先に、前半を後に読んでも complete（以前は先頭から読み直すと後半が捨てられた）", () => {
    const t = transcript([{ start: 6, lines: lines(10).slice(5) }, { start: 1, lines: lines(10).slice(0, 5) }]);
    expect(findReadCoverage(t, TARGET, cur).complete).toBe(true);
  });
  it("一部だけ読んだなら、足りない行範囲を返す", () => {
    const t = transcript([{ start: 1, lines: lines(10).slice(0, 4) }]);
    const c = findReadCoverage(t, TARGET, cur);
    expect(c.complete).toBe(false);
    expect(c.readAny).toBe(true);
    expect(c.staleOrUnread).toEqual([[5, 10]]);
  });
  it("読んだ後に1行書き換わったら、その行だけを古いとして返す", () => {
    const t = transcript([{ start: 1, lines: lines(10) }]);
    const changed = lines(10, (i) => (i === 4 ? "書き換え後" : `行${i}`)).join("\n");
    expect(findReadCoverage(t, TARGET, changed).staleOrUnread).toEqual([[4, 4]]);
  });
  it("書き換え後に、その行だけ読み直せば complete（全文を読み直さなくてよい）", () => {
    const changedLines = lines(10, (i) => (i === 4 ? "書き換え後" : `行${i}`));
    const t = transcript([{ start: 1, lines: lines(10) }, { start: 4, lines: [changedLines[3]] }]);
    expect(findReadCoverage(t, TARGET, changedLines.join("\n")).complete).toBe(true);
  });
  it("一度も読んでいなければ readAny=false で全行が未読", () => {
    const t = transcript([]);
    const c = findReadCoverage(t, TARGET, cur);
    expect(c.readAny).toBe(false);
    expect(c.staleOrUnread).toEqual([[1, 10]]);
  });
  it("末尾に行が増えたら、増えた分だけを未読にする", () => {
    const t = transcript([{ start: 1, lines: lines(10) }]);
    expect(findReadCoverage(t, TARGET, lines(12).join("\n")).staleOrUnread).toEqual([[11, 12]]);
  });
  it("CRLF のファイルでも LF の読み取り結果と一致する", () => {
    const t = transcript([{ start: 1, lines: lines(3) }]);
    expect(findReadCoverage(t, TARGET, lines(3).join("\r\n")).complete).toBe(true);
  });
});

describe("describeCoverageGap（拒否文に出す案内）", () => {
  it("読むべき offset と limit を示し、全文の読み直しは不要と言う", () => {
    const msg = describeCoverageGap({ staleOrUnread: [[401, 900]] });
    expect(msg).toContain("offset=400");
    expect(msg).toContain("offset=800");
    expect(msg).toContain("全文を読み直す必要はありません");
    expect(msg).toContain("計 500 行");
  });
});
