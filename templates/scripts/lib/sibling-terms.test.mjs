import { describe, expect, it } from "vitest";
import { checkNoSiblingNamesInCode, siblingTerms } from "./distinction-checks.mjs";

// 実リポ（S/D）で較正した落とし穴の再現テスト（2026-10-06）。
const TEAM = [
  { bundleId: "com.kimito.link.surechigai", displayName: "君斗りんくのすれ違ひ通信", shortName: "surechigai", productionDomain: "surechigai.kimito.link" },
  { bundleId: "com.kimito.link.doinchallenge", displayName: "君斗りんくの動員ちゃれんじ", shortName: "doin-challenge", productionDomain: "doin.kimito.link" },
  { bundleId: "com.kimito.link.linktree", displayName: "kimito.link（キミトリンク）", shortName: "KimitoLink", productionDomain: "kimito.link" },
  { bundleId: "<アプリの住所 例: com.あなたの会社.アプリ名>", displayName: "<アプリ名（日本語）>", shortName: "<短い名前>", productionDomain: "<本番サイトのドメイン>" },
];

describe("siblingTerms", () => {
  const terms = siblingTerms(TEAM, { bundleId: "com.kimito.link.surechigai", ownProductionDomain: "surechigai.kimito.link" });
  it("表示名の共通接頭辞を除いた形（動員ちゃれんじ）も比較語に入る", () => {
    expect(terms).toContain("君斗りんくの動員ちゃれんじ");
    expect(terms).toContain("動員ちゃれんじ");
  });
  it("自分のドメインの親（kimito.link）は共通基盤として自動で除く", () => {
    expect(terms).not.toContain("kimito.link");
  });
  it("自分自身と、テンプレのプレースホルダは含めない", () => {
    expect(terms).not.toContain("surechigai");
    expect(terms.some((t) => t.startsWith("<"))).toBe(false);
  });
  it("allowedSiblingMentions で明示した語は除く", () => {
    const t2 = siblingTerms(TEAM, { bundleId: "com.kimito.link.surechigai", ownProductionDomain: "surechigai.kimito.link", allowed: new Set(["KimitoLink"]) });
    expect(t2).not.toContain("KimitoLink");
  });
});

describe("checkNoSiblingNamesInCode（S に D 名義が出荷された実例の再現）", () => {
  const blank = (s) => s.replace(/\/\/.*$/gm, (m) => " ".repeat(m.length));
  it("【毒】接頭辞を除いた『動員ちゃれんじ』が文字列に出れば fail", () => {
    const r = checkNoSiblingNamesInCode({
      distinction: {},
      teamApps: TEAM,
      bundleId: "com.kimito.link.surechigai",
      ownProductionDomain: "surechigai.kimito.link",
      files: [{ path: "components/login-success-modal.tsx", text: 'const m = "動員ちゃれんじへようこそ！";' }],
      blankOutComments: blank,
    });
    expect([].concat(r).some((x) => x.status === "fail")).toBe(true);
  });
  it("コメント中だけなら warn（fail にしない）", () => {
    const r = [].concat(
      checkNoSiblingNamesInCode({
        distinction: {},
        teamApps: TEAM,
        bundleId: "com.kimito.link.surechigai",
        ownProductionDomain: "surechigai.kimito.link",
        files: [{ path: "a.ts", text: "// 動員ちゃれんじ由来\nconst x = 1;" }],
        blankOutComments: blank,
      }),
    );
    expect(r.some((x) => x.status === "fail")).toBe(false);
    expect(r.some((x) => x.status === "warn")).toBe(true);
  });
  it("自分のドメイン（surechigai.kimito.link）の文字列は fail にしない", () => {
    const r = [].concat(
      checkNoSiblingNamesInCode({
        distinction: {},
        teamApps: TEAM,
        bundleId: "com.kimito.link.surechigai",
        ownProductionDomain: "surechigai.kimito.link",
        files: [{ path: "a.ts", text: 'const u = "https://surechigai.kimito.link/privacy";' }],
        blankOutComments: blank,
      }),
    );
    expect(r.some((x) => x.status === "fail")).toBe(false);
  });
});
