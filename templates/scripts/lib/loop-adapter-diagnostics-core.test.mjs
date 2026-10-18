import { describe, expect, it } from "vitest";
import { buildCardsFromDiagnostics, idOfCheck, parseDiagnosticsSummary, safeToken } from "./loop-adapter-diagnostics-core.mjs";
import { validateSymptomCard } from "./symptom-card-core.mjs";

// run.mjs の実際の出力の形（検査名は実在のもの）。まとめの前後に、本文や診断メッセージが付く。
export const SAMPLE = `[diagnostics] 対象: C:\\repo

[check-foo] 何かの本文。ファイル名 secret-file.txt や yamada@example.com が出ることもある。

--- 診断結果まとめ ---
✓ check-tracked-imports: pass
✓ check-lockfile-sync: pass
✗ check-foo: fail
? check-bar-baz: unmeasured
- check-symptom-index: skip
✓ check-selftest-coverage(scripts): pass

[diagnostics] 1件のチェックで問題を検出。上記の対処を確認してください。
`;
const ctx = { project: "demo", version: "1.2.3", now: new Date("2026-10-18T06:00:00Z") };

describe("parseDiagnosticsSummary", () => {
  it("まとめの行だけを読む（本文・まとめの後ろのメッセージは読まない）", () => {
    const r = parseDiagnosticsSummary(SAMPLE);
    expect(r.found).toBe(true);
    expect(r.checks.map((c) => `${c.name}:${c.status}`)).toEqual([
      "check-tracked-imports:pass", "check-lockfile-sync:pass", "check-foo:fail", "check-bar-baz:unmeasured", "check-symptom-index:skip", "check-selftest-coverage(scripts):pass",
    ]);
    expect(r.unparsed).toBe(0);
  });
  it("検査名の形でない行は捨て、件数だけ数える（内容は出さない）", () => {
    const r = parseDiagnosticsSummary("--- 診断結果まとめ ---\n✗ yamada@example.com: fail\n✓ check-ok: pass\n✗ Check-Upper: fail\n");
    expect(r.checks.map((c) => c.name)).toEqual(["check-ok"]);
    expect(r.unparsed).toBe(2);
  });
  it("まとめが無ければ found=false", () => {
    expect(parseDiagnosticsSummary("何かのログ").found).toBe(false);
    expect(parseDiagnosticsSummary("").found).toBe(false);
  });
});

describe("buildCardsFromDiagnostics", () => {
  const cards = buildCardsFromDiagnostics(SAMPLE, ctx);
  it("fail と unmeasured の検査だけがカードになり、全体の健全性カードが付く", () => {
    expect(cards.map((c) => `${c.id}:${c.verdict}`)).toEqual(["check-foo:fail", "check-bar-baz:unmeasured", "diagnostics-summary:fail"]);
    expect(cards.at(-1).metrics).toEqual({ checksTotal: 6, passCount: 3, failCount: 1, unmeasuredCount: 1, skipCount: 1, unparsedCount: 0 });
  });
  it("全部 pass なら健全性カード1枚（ok）。unmeasured だけなら unmeasured", () => {
    const ok = buildCardsFromDiagnostics("--- 診断結果まとめ ---\n✓ check-a: pass\n✓ check-b: pass\n", ctx);
    expect(ok.map((c) => `${c.id}:${c.verdict}`)).toEqual(["diagnostics-summary:ok"]);
    const um = buildCardsFromDiagnostics("--- 診断結果まとめ ---\n✓ check-a: pass\n? check-b: unmeasured\n", ctx);
    expect(um.at(-1).verdict).toBe("unmeasured");
  });
  it("まとめが無い・検査が0件なら空（測れていない。緑にしない）", () => {
    expect(buildCardsFromDiagnostics("ログだけ", ctx)).toEqual([]);
    expect(buildCardsFromDiagnostics("--- 診断結果まとめ ---\n", ctx)).toEqual([]);
  });
  it("作ったカードは全部、症状カード検査（正本）に通る", () => {
    for (const c of cards) expect(validateSymptomCard(c, { byteLength: JSON.stringify(c).length }).violations).toEqual([]);
  });
  it("入力の本文・ファイル名・メールが、カードのどこにも出ない", () => {
    const out = JSON.stringify(cards);
    for (const leak of ["secret-file", "yamada", "example.com", "何かの本文", "C:"]) expect(out).not.toContain(leak);
  });
  it("検査名に括弧がついても id の形に収まる", () => {
    expect(idOfCheck("check-selftest-coverage(scripts)")).toBe("check-selftest-coverage-scripts");
    const c = buildCardsFromDiagnostics("--- 診断結果まとめ ---\n✗ check-selftest-coverage(scripts): fail\n", ctx);
    expect(validateSymptomCard(c[0]).ok).toBe(true);
  });
});

describe("safeToken", () => {
  it("英数 . _ - 以外を - にし、先頭の記号を落とす。空なら fallback", () => {
    expect(safeToken("@scope/pkg name", "x")).toBe("scope-pkg-name");
    expect(safeToken("日本語", "fallback")).toBe("fallback");
    expect(safeToken("1.2.3", "x")).toBe("1.2.3");
  });
});
