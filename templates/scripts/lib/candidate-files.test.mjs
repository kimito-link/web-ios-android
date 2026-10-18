// pickCandidateFiles（実在するファイルの候補をAIに渡す）と、プロンプトへの反映の回帰テスト。
// 背景: 実測で、qwen2.5:7b-instruct が「触るファイル候補」に scripts/check-doc-rot.py のような存在しないファイル名を創作し、9回中8回が形式検査で落ちた。
import { describe, expect, it } from "vitest";
import { buildPrompt, pickCandidateFiles } from "./loop-propose-core.mjs";

const files = [
  "templates/diagnostics/check-doc-rot.mjs",
  "templates/diagnostics/check-doc-rot.test.mjs",
  "templates/diagnostics/check-gates-are-wired.mjs",
  "templates/scripts/lib/other.mjs",
  "src/lib/symptomVerdicts.js",
  "src/lib/symptomVerdicts.test.js",
  "src/lib/unrelated.js",
  "docs/notes.md",
  "tests/e2e/thumb.spec.js",
];
const contents = {
  "src/lib/symptomVerdicts.js": "out.push({ id: 'thumb-white', symptom: 'サムネが白い' })",
  "src/lib/symptomVerdicts.test.js": "expect(ids).toContain('thumb-white')",
  "tests/e2e/thumb.spec.js": "thumb-white を確認する",
  "src/lib/unrelated.js": "// 関係ない",
  "docs/notes.md": "thumb-white の説明",
};
const readText = (f) => contents[f] ?? null;
const card = (id, verdict = "fail") => ({ id, verdict });
const pick = (cards, o = {}) => pickCandidateFiles({ files, cards, readText, ...o });

describe("pickCandidateFiles", () => {
  it("ファイル名がカードID（検査名）と一致するものを、テストより先に選ぶ", () => {
    const r = pick([card("check-doc-rot")]);
    expect(r[0]).toBe("templates/diagnostics/check-doc-rot.mjs");
    expect(r).toContain("templates/diagnostics/check-doc-rot.test.mjs");
    expect(r.indexOf("templates/diagnostics/check-doc-rot.mjs")).toBeLessThan(r.indexOf("templates/diagnostics/check-doc-rot.test.mjs"));
  });
  it("検査名の末尾 -scripts は、同名の検査として探す", () => {
    expect(pick([card("check-gates-are-wired-scripts")])[0]).toBe("templates/diagnostics/check-gates-are-wired.mjs");
  });
  it("ファイル名に無い症状IDは、コードの中身から見つける（コード→テストの順。文書や関係ないファイルは入らない）", () => {
    const r = pick([card("thumb-white")]);
    expect(r[0]).toBe("src/lib/symptomVerdicts.js");
    expect(r).toContain("src/lib/symptomVerdicts.test.js");
    expect(r).not.toContain("src/lib/unrelated.js");
    expect(r).not.toContain("docs/notes.md");
  });
  it("ok のカードは対象にしない", () => {
    expect(pick([card("check-doc-rot", "ok")])).toEqual([]);
  });
  it("見つからなければ空（作り話をしない）", () => {
    expect(pick([card("no-such-symptom")])).toEqual([]);
  });
  it("1カードあたり perId 件・全体で max 件までに絞る。重複は1回だけ", () => {
    expect(pick([card("check-doc-rot")], { perId: 1 })).toHaveLength(1);
    const r = pick([card("check-doc-rot"), card("thumb-white")], { max: 2 });
    expect(r).toHaveLength(2);
    expect(new Set(pick([card("thumb-white"), card("thumb-white")])).size).toBe(pick([card("thumb-white"), card("thumb-white")]).length);
  });
  it("読めないファイル（null）で落ちない", () => {
    expect(() => pickCandidateFiles({ files, cards: [card("thumb-white")], readText: () => null })).not.toThrow();
  });
});

describe("buildPrompt: 実在するファイルの候補", () => {
  it("候補があれば、一覧の節（選ぶ旨つき）が入り、カードより前に置かれる", () => {
    const { user, system } = buildPrompt({ cards: [card("x")], candidateFiles: ["a/b.mjs", "c.js"] });
    expect(user).toContain("実在するファイル");
    expect(user).toContain("- a/b.mjs");
    expect(user.indexOf("実在するファイル")).toBeLessThan(user.indexOf("症状カード"));
    expect(system).toContain("一覧");
    expect(system).toContain("ファイル名は未確認");
  });
  it("候補が空・無しなら一覧の節は出ない（創作しない旨の規則は残る）", () => {
    expect(buildPrompt({ cards: [card("x")], candidateFiles: [] }).user).not.toContain("実在するファイル");
    expect(buildPrompt({ cards: [card("x")] }).system).toContain("ファイル名を創作せず");
  });
});

describe("道具（ループ自身の部品）と土台のカードは、候補探しに使わない", () => {
  const files2 = [
    "src/lib/symptomVerdicts.js",
    "scripts/loop-adapter-status-live.mjs",
    "scripts/loop-adapter-status-live.test.js",
    "templates/scripts/loop-run.mjs",
    "loop.config.json",
    "_loop/tsuioku/glossary.txt",
    "src/game-loop.js",
  ];
  const contents2 = {
    "src/lib/symptomVerdicts.js": "id: 'thumb-white'",
    "scripts/loop-adapter-status-live.mjs": "id: 'status-snapshot' thumb-white",
    "scripts/loop-adapter-status-live.test.js": "thumb-white status-snapshot",
    "templates/scripts/loop-run.mjs": "thumb-white",
    "loop.config.json": "thumb-white",
    "src/game-loop.js": "status-snapshot thumb-white",
  };
  const rt = (f) => contents2[f] ?? null;
  it("ループの部品（loop-*.mjs・loop.config.json・_loop/）は候補に入らない。名前が似ているだけの製品のファイルは入る", () => {
    const r = pickCandidateFiles({ files: files2, cards: [card("thumb-white")], readText: rt });
    expect(r).toContain("src/lib/symptomVerdicts.js");
    expect(r).toContain("src/game-loop.js");
    for (const f of r) expect(f).not.toMatch(/(^|\/)loop-|loop\.config|_loop/);
  });
  it("土台のカード（status-snapshot・diagnostics-summary）は、ファイル探しの手がかりにしない", () => {
    expect(pickCandidateFiles({ files: files2, cards: [card("status-snapshot", "fail"), card("diagnostics-summary", "fail")], readText: rt })).toEqual([]);
  });
});

describe("プロンプトの規則: unmeasured は不具合とは限らない", () => {
  it("直す対象は fail を優先し、unmeasured は別扱いにする旨が system にある", () => {
    const { system } = buildPrompt({ cards: [card("x")] });
    expect(system).toContain("unmeasured");
    expect(system).toContain("fail のカードを優先");
  });
});
