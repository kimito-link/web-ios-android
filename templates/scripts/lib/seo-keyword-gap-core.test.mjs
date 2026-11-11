import { describe, expect, it } from "vitest";
import {
  buildGapReport,
  findPageFor,
  normalize,
  parseGscCsv,
  parseSitemapLocs,
  parseSuggest,
  parseTitleH1,
  pickGscOpportunities,
} from "./seo-keyword-gap-core.mjs";

const PAGES = [
  { url: "https://x/a/", title: "WordPress改ざん復旧｜サイト改ざん・乗っ取りチェック", h1: "" },
  { url: "https://x/b/", title: "口コミ返信サポート", h1: "Google口コミ返信の例文" },
];

describe("normalize", () => {
  it("大文字・全角空白・記号を落とす", () => {
    expect(normalize("WordPress　改ざん・復旧｜X")).toBe("wordpress改ざん復旧x");
  });
});

describe("findPageFor", () => {
  it("語がすべて title か h1 にあれば、そのページ", () => {
    expect(findPageFor("wordpress 改ざん", PAGES)?.url).toBe("https://x/a/");
    expect(findPageFor("口コミ 返信 例文", PAGES)?.url).toBe("https://x/b/");
  });

  it("1語でも欠ければ受けていない", () => {
    expect(findPageFor("ホームページ 改ざん", PAGES)).toBeNull();
  });

  it("空の検索語は null", () => {
    expect(findPageFor("  ", PAGES)).toBeNull();
  });
});

describe("parse 系", () => {
  it("sitemap の loc を取り、&amp; を戻す", () => {
    const xml = "<urlset><url><loc>https://x/?a=1&amp;b=2</loc></url><url><loc> https://x/c/ </loc></url></urlset>";
    expect(parseSitemapLocs(xml)).toEqual(["https://x/?a=1&b=2", "https://x/c/"]);
  });

  it("title と h1 の中のタグを落とす", () => {
    expect(parseTitleH1("<title>A &amp; B</title><h1 class=x>見出し<br>二行目</h1>")).toEqual({ title: "A & B", h1: "見出し二行目" });
  });

  it("サジェストの形が違えば空配列（壊れた応答を候補にしない）", () => {
    expect(parseSuggest('["q",["q a","q b"],[]]')).toEqual(["q a", "q b"]);
    expect(parseSuggest("<html>")).toEqual([]);
    expect(parseSuggest('{"a":1}')).toEqual([]);
  });

  it("Search Console の CSV（日本語の見出し・引用符・桁区切り）を読む", () => {
    const csv = '﻿上位のクエリ,クリック数,表示回数,CTR,掲載順位\n"ホームページ 改ざん",3,"1,204",0.2%,14.2\nmalware check,0,5,0%,3\n';
    expect(parseGscCsv(csv)).toEqual([
      { query: "ホームページ 改ざん", impressions: 1204, position: 14.2 },
      { query: "malware check", impressions: 5, position: 3 },
    ]);
  });

  it("英語の見出しも読む", () => {
    const csv = "Top queries,Clicks,Impressions,CTR,Position\nfoo,1,10,1%,20\n";
    expect(parseGscCsv(csv)).toEqual([{ query: "foo", impressions: 10, position: 20 }]);
  });
});

describe("pickGscOpportunities", () => {
  it("見られているのに8位より下のものだけ、表示回数の多い順", () => {
    const rows = [
      { query: "a", impressions: 5, position: 20 },
      { query: "b", impressions: 50, position: 12 },
      { query: "c", impressions: 100, position: 2 },
      { query: "d", impressions: 0, position: 30 },
    ];
    expect(pickGscOpportunities(rows).map((r) => r.query)).toEqual(["b", "a"]);
  });
});

describe("buildGapReport", () => {
  it("重複を1つにし、GAP を先に並べる", () => {
    const r = buildGapReport(["wordpress 改ざん", "ホームページ 改ざん", "WordPress　改ざん"], PAGES);
    expect(r).toEqual([
      { keyword: "ホームページ 改ざん", status: "GAP", url: null },
      { keyword: "wordpress 改ざん", status: "OK", url: "https://x/a/" },
    ]);
  });
});
