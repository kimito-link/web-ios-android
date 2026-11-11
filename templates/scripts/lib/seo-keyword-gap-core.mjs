// 「検索語1つ → それに答えるページ1枚」の洗い出し（純粋関数だけ。通信は seo-keyword-gap.mjs 側）。
// 設計: templates/scripts/README-seo-keyword-gap.md

/** 比べるときに無視する記号・空白（全角・半角）。 */
const IGNORE = /[\s　・、。，．,.|｜\-–—:：()（）「」『』【】!！?？/／]/g;

/** 比較用に小文字化して記号と空白を落とす。 */
export function normalize(text) {
  return String(text ?? "").toLowerCase().replace(IGNORE, "");
}

/** 検索語を語に分ける（空白区切り。空の語は捨てる）。 */
export function tokens(keyword) {
  return String(keyword ?? "")
    .split(/[\s　]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * 検索語に答えるページを探す。語がすべて title か h1 に入っているページを「受けている」とみなす。
 * ★本文までは見ない: 題名と見出しに無い語では、検索結果で選ばれにくいため。
 * @param {string} keyword
 * @param {{url:string,title:string,h1:string}[]} pages
 * @returns {{url:string,title:string,h1:string}|null}
 */
export function findPageFor(keyword, pages) {
  const ts = tokens(keyword).map(normalize).filter(Boolean);
  if (ts.length === 0) return null;
  for (const p of pages) {
    const hay = normalize(`${p.title} ${p.h1}`);
    if (ts.every((t) => hay.includes(t))) return p;
  }
  return null;
}

/** sitemap.xml から <loc> を取り出す（sitemap index の子 sitemap も loc として返る）。 */
export function parseSitemapLocs(xml) {
  return [...String(xml ?? "").matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => decodeXml(m[1]));
}

/** HTML から title と最初の h1 の文字を取り出す。 */
export function parseTitleH1(html) {
  const s = String(html ?? "");
  const title = (s.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] ?? "";
  const h1 = (s.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] ?? "";
  return { title: clean(title), h1: clean(h1) };
}

/** Google のオートコンプリート（client=firefox）の応答から候補を取り出す。形が違えば空配列。 */
export function parseSuggest(body) {
  try {
    const j = JSON.parse(body);
    return Array.isArray(j) && Array.isArray(j[1]) ? j[1].filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Search Console の「検索パフォーマンス → クエリ」を書き出した CSV を読む。
 * 見出しは日本語（上位のクエリ・表示回数・掲載順位）と英語（Top queries・Impressions・Position）の両方を受ける。
 * @returns {{query:string, impressions:number, position:number}[]}
 */
export function parseGscCsv(csv) {
  const rows = String(csv ?? "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (rows.length < 2) return [];
  const head = splitCsvLine(rows[0]).map((h) => h.trim().toLowerCase());
  const qi = head.findIndex((h) => /クエリ|quer(y|ies)/.test(h));
  const ii = head.findIndex((h) => /表示回数|impressions/.test(h));
  const pi = head.findIndex((h) => /掲載順位|position/.test(h));
  if (qi < 0) return [];
  return rows.slice(1).map((line) => {
    const c = splitCsvLine(line);
    return {
      query: (c[qi] ?? "").trim(),
      impressions: Number(String(c[ii] ?? "0").replace(/,/g, "")) || 0,
      position: Number(String(c[pi] ?? "0").replace(/,/g, "")) || 0,
    };
  }).filter((r) => r.query);
}

/**
 * Search Console のクエリのうち「見られているのに上位にいない」もの（＝ページを作る候補）。
 * 既定: 表示回数 1 以上・掲載順位 8 位より下。表示回数の多い順。
 */
export function pickGscOpportunities(rows, { minImpressions = 1, minPosition = 8 } = {}) {
  return rows
    .filter((r) => r.impressions >= minImpressions && r.position > minPosition)
    .sort((a, b) => b.impressions - a.impressions);
}

/**
 * 検索語ごとに「受けるページがあるか」を判定して並べる。GAP（ページが無い）を先に出す。
 * @param {string[]} keywords
 * @param {{url:string,title:string,h1:string}[]} pages
 */
export function buildGapReport(keywords, pages) {
  const seen = new Set();
  const out = [];
  for (const k of keywords) {
    const key = normalize(k);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const hit = findPageFor(k, pages);
    out.push({ keyword: k, status: hit ? "OK" : "GAP", url: hit?.url ?? null });
  }
  return out.sort((a, b) => (a.status === b.status ? 0 : a.status === "GAP" ? -1 : 1));
}

function clean(s) {
  return decodeXml(String(s).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function decodeXml(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'");
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
