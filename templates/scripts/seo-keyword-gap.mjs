#!/usr/bin/env node
// 「検索語1つ → それに答えるページ1枚」の洗い出し（どのサイトでも使う共通の道具）。
// 使い方・考え方: templates/scripts/README-seo-keyword-gap.md
//
//   node templates/scripts/seo-keyword-gap.mjs --base https://malwarecheck.site \
//     --seed "ホームページ 改ざん" --seed "マルウェア チェック"
//   node templates/scripts/seo-keyword-gap.mjs --base https://reviewcheck.jp --gsc queries.csv
//
// 検索語の出どころ:
//   --gsc <CSV>  Search Console の「検索パフォーマンス → クエリ」を書き出した CSV（あればこちらが本命）
//   --seed <語>  Google の検索候補（オートコンプリート・無料）で広げる。Search Console が無いとき用
// ページ: <base>/sitemap.xml に載っているページの title と h1。
// 出力: GAP（受けるページが無い検索語）を先に、OK（受けているページ）を後に。--json で JSON。
// 終了コード: 0=出せた / 2=sitemap が読めない・検索語が0件（何も比べていないのに「GAP なし」と見せない）

import { readFileSync } from "node:fs";
import {
  buildGapReport,
  parseGscCsv,
  parseSitemapLocs,
  parseSuggest,
  parseTitleH1,
  pickGscOpportunities,
} from "./lib/seo-keyword-gap-core.mjs";

const argv = process.argv.slice(2);
const getAll = (name) => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : [])).filter(Boolean);
const get = (name) => getAll(name)[0];
const base = (get("--base") ?? "").replace(/\/$/, "");
const seeds = getAll("--seed");
const gsc = get("--gsc");
const maxPages = Number(get("--max-pages") ?? 80);
const asJson = argv.includes("--json");

if (!base || (!seeds.length && !gsc)) {
  console.error("使い方: --base <https://サイト> と、--seed <語>（複数可）か --gsc <CSV> のどちらか");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function text(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function suggest(q) {
  const u = `https://suggestqueries.google.com/complete/search?client=firefox&hl=ja&q=${encodeURIComponent(q)}`;
  try {
    return parseSuggest(await text(u));
  } catch {
    return [];
  }
}

// 1) 検索語
let keywords = [];
if (gsc) {
  keywords = pickGscOpportunities(parseGscCsv(readFileSync(gsc, "utf8"))).map((r) => r.query);
}
for (const s of seeds) {
  const got = await suggest(s);
  keywords.push(...(got.length ? got : [s]));
  await sleep(300); // 連続で叩かない
}
if (keywords.length === 0) {
  console.error("検索語が0件でした（CSV の見出しか、--seed を確かめてください）");
  process.exit(2);
}

// 2) ページ
let locs;
try {
  locs = parseSitemapLocs(await text(`${base}/sitemap.xml`));
} catch (e) {
  console.error(`sitemap.xml が読めませんでした: ${e.message}`);
  process.exit(2);
}
const pages = [];
for (const url of locs.slice(0, maxPages)) {
  try {
    pages.push({ url, ...parseTitleH1(await text(url)) });
  } catch (e) {
    pages.push({ url, title: "", h1: "", error: e.message });
  }
}

// 3) 突き合わせ
const report = buildGapReport(keywords, pages.filter((p) => !p.error));
const broken = pages.filter((p) => p.error);

if (asJson) {
  console.log(JSON.stringify({ base, pages: pages.length, broken, report }, null, 2));
} else {
  console.log(`# ${base}  ページ ${pages.length} 枚・検索語 ${report.length} 件`);
  if (broken.length) {
    console.log(`\n## サイトマップにあるのに開けないページ（先に直す）`);
    for (const b of broken) console.log(`- ${b.url}  (${b.error})`);
  }
  console.log(`\n## 受けるページが無い検索語（GAP）`);
  for (const r of report.filter((x) => x.status === "GAP")) console.log(`- ${r.keyword}`);
  console.log(`\n## 受けているページがある検索語（OK）`);
  for (const r of report.filter((x) => x.status === "OK")) console.log(`- ${r.keyword}  → ${r.url.replace(base, "")}`);
}
