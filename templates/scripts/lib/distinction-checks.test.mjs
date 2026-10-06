import { describe, expect, it } from "vitest";
import { blankOutComments } from "../check-tracked-imports.mjs";
import {
  checkConfigMatchesIap,
  checkConfigMatchesIosPublished,
  checkConfigMatchesLoginCopy,
  checkConfigMatchesPlayListing,
  checkConfigMatchesSiwa,
  checkDistinctionMatchesDescription,
  checkDistinctionMatchesScreenshots,
  checkDistinctionPresent,
  checkNoMarketingPageScreenshot,
  checkNoSiblingNamesInCode,
  checkNoStaleCapacitorConfig,
  firstParagraph,
  firstSentence,
  isShortSiblingTerm,
  isUnsetStoreId,
  normalizeForMatch,
} from "./distinction-checks.mjs";

const distinction = {
  oneLiner: "同じ場所を通った人を、Xの人柄つきで見つける すれ違い記録アプリ",
  coreFeatures: ["チェックイン・軌跡", "市区町村の図鑑", "時間差すれ違い"],
};

describe("isUnsetStoreId", () => {
  it("空・null・プレースホルダを未設定と見る", () => {
    expect(isUnsetStoreId(null)).toBe(true);
    expect(isUnsetStoreId("")).toBe(true);
    expect(isUnsetStoreId("<App Storeで作ったアプリのID>")).toBe(true);
    expect(isUnsetStoreId("6796909175")).toBe(false);
  });
});

describe("normalizeForMatch", () => {
  it("全角英数と空白を正規化する", () => {
    expect(normalizeForMatch("チ ェ ッ ク イン")).toBe("チェックイン");
    expect(normalizeForMatch("ＡＢＣ")).toBe("ABC");
  });
});

describe("firstParagraph / firstSentence", () => {
  it("空行までが先頭段落", () => {
    expect(firstParagraph("hello\nworld\n\nnext")).toBe("hello\nworld");
  });
  it("。または改行までが先頭1文", () => {
    expect(firstSentence("短い文。続き")).toBe("短い文。");
    expect(firstSentence("一行目\n二行目")).toBe("一行目");
  });
});

describe("checkDistinctionPresent CHECK 24", () => {
  it("ascAppId が空なら skip", () => {
    expect(checkDistinctionPresent({ ascAppId: "", distinction: null }).status).toBe("skip");
  });
  it("毒: App Store に出すのに distinction が無いと fail", () => {
    const r = checkDistinctionPresent({ ascAppId: "6796909175" });
    expect(r.status).toBe("fail");
    expect(r.guideline).toBe("4.3(a)");
  });
  it("distinction があれば ok", () => {
    expect(checkDistinctionPresent({ ascAppId: "1", distinction }).status).toBe("ok");
  });
});

describe("checkDistinctionMatchesDescription CHECK 25", () => {
  it("distinction が無ければ skip", () => {
    expect(checkDistinctionMatchesDescription({ distinction: null }).status).toBe("skip");
  });
  it("毒: 説明文ファイルが1つも無いと fail", () => {
    const r = checkDistinctionMatchesDescription({ distinction, descriptionFiles: [] });
    expect(r.status).toBe("fail");
  });
  it("毒: 先頭段落に oneLiner が無いと fail", () => {
    const r = checkDistinctionMatchesDescription({
      distinction,
      descriptionFiles: [{ name: "description-ja.txt", text: "別の説明\n\n続き" }],
    });
    expect(r.status).toBe("fail");
  });
  it("先頭段落に oneLiner があれば ok", () => {
    const list = checkDistinctionMatchesDescription({
      distinction,
      descriptionFiles: [
        { name: "description-ja.txt", text: `${distinction.oneLiner}\n詳細。\n\n二段落` },
      ],
    });
    expect(list[0].status).toBe("ok");
  });
  it("リリースノート先頭文が区別軸を含まなければ warn", () => {
    const list = checkDistinctionMatchesDescription({
      distinction,
      descriptionFiles: [{ name: "description-ja.txt", text: distinction.oneLiner }],
      releaseNotesJa: "バグ修正とパフォーマンス改善。",
    });
    expect(list.some((x) => x.status === "warn" && x.name === "distinction-matches-release-notes")).toBe(
      true,
    );
  });
});

describe("checkDistinctionMatchesScreenshots CHECK 26", () => {
  it("distinction が無ければ skip", () => {
    expect(checkDistinctionMatchesScreenshots({ distinction: null, screenshotPlan: {} }).status).toBe(
      "skip",
    );
  });
  it("plan が無ければ skip", () => {
    expect(checkDistinctionMatchesScreenshots({ distinction, screenshotPlan: null }).status).toBe("skip");
  });
  it("毒: coreFeatures が1件しか出ないと fail", () => {
    const list = checkDistinctionMatchesScreenshots({
      distinction,
      screenshotPlan: {
        publicPages: [{ slot: 1, path: "/map" }],
        authTabs: [],
        framedCaptions: { "1": { headline: "チェックイン・軌跡", sub: "ここ" } },
      },
    });
    expect(list.some((x) => x.name === "distinction-matches-screenshots" && x.status === "fail")).toBe(
      true,
    );
  });
  it("毒: framedCaptions のキーが slot と不一致なら fail", () => {
    const list = checkDistinctionMatchesScreenshots({
      distinction,
      screenshotPlan: {
        publicPages: [{ slot: 1, path: "/map" }, { slot: 2, path: "/zukan" }],
        framedCaptions: {
          "1": { headline: "チェックイン・軌跡", sub: "市区町村の図鑑" },
        },
      },
    });
    expect(list.some((x) => x.name === "screenshot-caption-slots" && x.status === "fail")).toBe(true);
  });
  it("2件以上出現かつキー一致なら ok", () => {
    const list = checkDistinctionMatchesScreenshots({
      distinction,
      screenshotPlan: {
        publicPages: [{ slot: 1, path: "/map" }, { slot: 2, path: "/zukan" }],
        framedCaptions: {
          "1": { headline: "チェックイン・軌跡", sub: "歩く" },
          "2": { headline: "市区町村の図鑑", sub: "集める" },
        },
      },
    });
    expect(list.every((x) => x.status === "ok")).toBe(true);
  });
});

describe("checkNoSiblingNamesInCode CHECK 27", () => {
  const teamApps = [
    {
      displayName: "君斗りんくのすれ違ひ通信",
      shortName: "surechigai",
      productionDomain: "surechigai.kimito.link",
      bundleId: "com.kimito.link.surechigai",
    },
    {
      displayName: "君斗りんくの動員ちゃれんじ",
      shortName: "doin-challenge",
      productionDomain: "doin.kimito.link",
      bundleId: "com.kimito.link.doinchallenge",
    },
  ];
  const base = {
    distinction,
    teamApps,
    bundleId: "com.kimito.link.surechigai",
    blankOutComments,
  };

  it("distinction が無ければ skip", () => {
    expect(
      checkNoSiblingNamesInCode({ distinction: null, teamApps, blankOutComments }).status,
    ).toBe("skip");
  });
  it("毒: team-apps.json が無いと測れないので fail", () => {
    const r = checkNoSiblingNamesInCode({ distinction, teamApps: null, blankOutComments });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/asc-list-team-apps/);
  });
  it("毒: 姉妹アプリ名が文字列リテラル中にあると fail", () => {
    const list = checkNoSiblingNamesInCode({
      ...base,
      files: [{ path: "lib/copy.ts", text: 'export const x = "君斗りんくの動員ちゃれんじ";\n' }],
    });
    const fail = list.find((x) => x.name === "no-sibling-names-in-code");
    expect(fail.status).toBe("fail");
    expect(fail.detail).toMatch(/lib\/copy\.ts:1/);
  });
  it("コメント中の出現は warn", () => {
    const list = checkNoSiblingNamesInCode({
      ...base,
      files: [{ path: "lib/copy.ts", text: "// 君斗りんくの動員ちゃれんじ の話\nexport const x = 1;\n" }],
    });
    expect(list.find((x) => x.name === "no-sibling-names-in-code").status).toBe("ok");
    expect(list.find((x) => x.name === "no-sibling-names-in-comments").status).toBe("warn");
  });
  it("allowedSiblingMentions と自分自身は許可", () => {
    const list = checkNoSiblingNamesInCode({
      ...base,
      distinction: { ...distinction, allowedSiblingMentions: ["君斗りんくの動員ちゃれんじ"] },
      files: [
        {
          path: "lib/copy.ts",
          text: 'export const me = "君斗りんくのすれ違ひ通信";\nexport const sib = "君斗りんくの動員ちゃれんじ";\n',
        },
      ],
    });
    expect(list.find((x) => x.name === "no-sibling-names-in-code").status).toBe("ok");
  });
  it("2文字以下の語は比較しない", () => {
    expect(isShortSiblingTerm("動員")).toBe(true);
    expect(isShortSiblingTerm("surechigai")).toBe(false);
  });
});

describe("checkNoMarketingPageScreenshot CHECK 28", () => {
  it("plan が無ければ skip", () => {
    expect(checkNoMarketingPageScreenshot({ screenshotPlan: null }).status).toBe("skip");
  });
  it("毒: /lp 配下は fail", () => {
    const r = checkNoMarketingPageScreenshot({
      screenshotPlan: { publicPages: [{ slot: 1, path: "/lp/hero" }] },
    });
    expect(r.status).toBe("fail");
    expect(r.guideline).toBe("2.3.3");
  });
  it("/ ちょうどは warn", () => {
    expect(
      checkNoMarketingPageScreenshot({ screenshotPlan: { publicPages: [{ slot: 1, path: "/" }] } })
        .status,
    ).toBe("warn");
  });
  it("使用中画面なら ok", () => {
    expect(
      checkNoMarketingPageScreenshot({
        screenshotPlan: { publicPages: [{ slot: 1, path: "/map" }] },
      }).status,
    ).toBe("ok");
  });
});

describe("checkNoStaleCapacitorConfig CHECK 29", () => {
  it("Expo でなければ skip", () => {
    expect(
      checkNoStaleCapacitorConfig({ hasAppConfigTs: false, hasCapacitorConfig: true, packageJson: {} })
        .status,
    ).toBe("skip");
  });
  it("毒: Expo なのに capacitor.config 残骸（@capacitor/core 無し）は fail", () => {
    const r = checkNoStaleCapacitorConfig({
      hasAppConfigTs: true,
      hasCapacitorConfig: true,
      packageJson: { dependencies: { expo: "~54.0.0" } },
    });
    expect(r.status).toBe("fail");
  });
  it("Expo で残骸が無ければ ok", () => {
    expect(
      checkNoStaleCapacitorConfig({
        hasAppConfigTs: true,
        hasCapacitorConfig: false,
        packageJson: { dependencies: { expo: "1" } },
      }).status,
    ).toBe("ok");
  });
});

describe("checkConfigMatchesReality CHECK 30", () => {
  it("毒: IAP 無し申告なのに RevenueCat 依存は fail", () => {
    const r = checkConfigMatchesIap({
      hasInAppPurchase: false,
      packageJson: { dependencies: { "@revenuecat/purchases-js": "1" } },
    });
    expect(r.status).toBe("fail");
  });
  it("IAP 申告と依存が矛盾しなければ ok", () => {
    expect(checkConfigMatchesIap({ hasInAppPurchase: false, packageJson: { dependencies: {} } }).status).toBe(
      "ok",
    );
  });
  it("hasInAppPurchase が false でなければ skip", () => {
    expect(checkConfigMatchesIap({ hasInAppPurchase: true }).status).toBe("skip");
  });
  it("loginRequired と「登録なし」が食い違うと warn", () => {
    expect(
      checkConfigMatchesLoginCopy({ loginRequired: true, summaryJa: "アカウント登録不要のアプリです" }).status,
    ).toBe("warn");
  });
  it("loginRequired が true でなければ skip", () => {
    expect(checkConfigMatchesLoginCopy({ loginRequired: false, summaryJa: "登録不要" }).status).toBe("skip");
  });
  it("loginRequired と summaryJa が矛盾しなければ ok", () => {
    expect(
      checkConfigMatchesLoginCopy({ loginRequired: true, summaryJa: "ログインして使う位置アプリ" }).status,
    ).toBe("ok");
  });
  it("毒: siwaEnabled=false で第三者ログインに apple が無いと fail", () => {
    const r = checkConfigMatchesSiwa({ siwaEnabled: false, thirdPartyProvidersOnIos: ["twitter"] });
    expect(r.status).toBe("fail");
    expect(r.guideline).toBe("4.8");
  });
  it("siwaEnabled が false でなければ skip", () => {
    expect(checkConfigMatchesSiwa({ siwaEnabled: true, thirdPartyProvidersOnIos: ["twitter"] }).status).toBe(
      "skip",
    );
  });
  it("ネット未指定なら Play/iOS 公開検査は skip", () => {
    expect(checkConfigMatchesPlayListing({ playAppId: "" }).status).toBe("skip");
    expect(checkConfigMatchesIosPublished({ iosPublished: false }).status).toBe("skip");
  });
  it("毒: playAppId 空なのに Play が 200（対照 404）は fail", () => {
    expect(
      checkConfigMatchesPlayListing({ playAppId: "", playStatus: 200, controlStatus: 404 }).status,
    ).toBe("fail");
  });
  it("毒: iosPublished と Lookup が食い違うと fail", () => {
    expect(checkConfigMatchesIosPublished({ iosPublished: false, resultCount: 1 }).status).toBe("fail");
  });
  it("公開状態が一致すれば ok", () => {
    expect(
      checkConfigMatchesPlayListing({ playAppId: "", playStatus: 404, controlStatus: 404 }).status,
    ).toBe("ok");
    expect(checkConfigMatchesIosPublished({ iosPublished: false, resultCount: 0 }).status).toBe("ok");
  });
});
