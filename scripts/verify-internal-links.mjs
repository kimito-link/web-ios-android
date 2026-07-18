#!/usr/bin/env node
// サイト内リンク切れ検証 — 「site/**/*.html のリンクが実在しない/idが無い」を機械的に検出する
// (設計: _docs/DESIGN-site-page-split-ai-discoverability-2026-07-17.md §G-1)。
//
// scripts/verify-claims-coverage.mjs と同思想・依存ゼロのNode。対象はsite/**/*.htmlの
// href/src相対リンク全体（LP訴求ではなくサイト構造そのものの健全性）。
//
// RULE 1: href/srcの相対リンクについて、ディレクトリ参照(末尾/または拡張子なし)は
//         index.htmlに解決してファイル存在を検証する。
// RULE 2: `page#anchor`形式のリンクは、参照先HTML内に`id="anchor"`が実在するか検証する。
// RULE 3: howto/のアンカー互換リダイレクト対象4id（github/vercel/domain/cloudflare）は
//         「予約id」として、howto/index.html内に実在するかも別途検証する
//         （ハブページの目次カードidが消えると互換リダイレクトの受け皿も壊れるため）。
//
// 対象外: http(s)://で始まる外部リンク、mailto:、tel:、javascript:。
//
// 実行: node scripts/verify-internal-links.mjs
// exit 0 = リンク切れなし / exit 1 = リンク切れ検出（fail-closed）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE_DIR = path.join(ROOT, 'site');

const ANSI_RED = '\x1b[31m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_DIM = '\x1b[2m';
const ANSI_RESET = '\x1b[0m';

const failures = [];
function fail(where, message) {
  failures.push({ where, message });
}
function ok(msg, detail) {
  console.log(`${ANSI_GREEN}✓${ANSI_RESET} ${msg}${detail ? `  ${ANSI_DIM}${detail}${ANSI_RESET}` : ''}`);
}

if (!fs.existsSync(SITE_DIR)) {
  console.error(`site dir not found: ${SITE_DIR}`);
  process.exit(1);
}

/** site/配下の *.html を再帰的に列挙する（node_modules等は無い前提の静的サイト）。 */
function listHtmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listHtmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

const htmlFiles = listHtmlFiles(SITE_DIR);

/** href/src 属性値を抽出する（簡易パーサ・正規表現ベース）。 */
const LINK_RE = /(?:href|src)="([^"]+)"/g;

/** 外部/非HTTPリンクはスキップする。 */
function isSkippable(href) {
  return (
    /^https?:\/\//.test(href) ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:') ||
    href.startsWith('javascript:') ||
    href.startsWith('#') === false && href === '' // 空hrefは無視
  );
}

/** ディレクトリ/ファイル参照をファイルシステム上のパスに解決する。
 *  サイトルート絶対パス（"/" 始まり）は site/ を起点に解決する。
 */
function resolveLinkTarget(fromFile, hrefPath) {
  const base = hrefPath.startsWith('/') ? SITE_DIR : path.dirname(fromFile);
  const rel = hrefPath.startsWith('/') ? hrefPath.slice(1) : hrefPath;
  let target = path.resolve(base, rel);
  if (hrefPath.endsWith('/') || (!path.extname(hrefPath) && hrefPath !== '')) {
    target = path.join(target, 'index.html');
  }
  return target;
}

/** HTML内の id="..." を全て集める。 */
function collectIds(htmlContent) {
  const ids = new Set();
  const idRe = /\bid="([^"]+)"/g;
  let m;
  while ((m = idRe.exec(htmlContent))) ids.add(m[1]);
  return ids;
}

const idCache = new Map();
function getIdsFor(absHtmlPath) {
  if (idCache.has(absHtmlPath)) return idCache.get(absHtmlPath);
  let ids = new Set();
  if (fs.existsSync(absHtmlPath)) {
    ids = collectIds(fs.readFileSync(absHtmlPath, 'utf8'));
  }
  idCache.set(absHtmlPath, ids);
  return ids;
}

let totalLinks = 0;
for (const file of htmlFiles) {
  const rel = path.relative(ROOT, file);
  const content = fs.readFileSync(file, 'utf8');
  for (const m of content.matchAll(LINK_RE)) {
    const href = m[1];
    if (isSkippable(href)) continue;
    if (href.startsWith('#')) {
      // 同一ページ内アンカー。このページ自身にidがあるか確認する。
      const anchor = href.slice(1);
      if (!anchor) continue;
      const ids = getIdsFor(file);
      totalLinks += 1;
      if (!ids.has(anchor)) {
        fail(rel, `同一ページ内アンカー #${anchor} が見つからない`);
      }
      continue;
    }
    totalLinks += 1;

    const [beforeAnchor, anchorPart] = href.split('#');
    const pathPart = beforeAnchor.split('?')[0]; // クエリ文字列（例: common.css?v=1）を除去
    const target = resolveLinkTarget(file, pathPart);

    if (!fs.existsSync(target)) {
      fail(rel, `リンク切れ: ${href} → ${path.relative(ROOT, target)} が存在しない`);
      continue;
    }

    if (anchorPart) {
      const ids = getIdsFor(target);
      if (!ids.has(anchorPart)) {
        fail(rel, `リンク切れ: ${href} → ${path.relative(ROOT, target)} に id="${anchorPart}" が無い`);
      }
    }
  }
}
ok(`${htmlFiles.length}ファイル・${totalLinks}リンクを検査`);

// ---------------------------------------------------------------------------
// RULE 3 — howto/のアンカー互換リダイレクト予約id
// ---------------------------------------------------------------------------
const howtoIndexPath = path.join(SITE_DIR, 'howto', 'index.html');
const RESERVED_HOWTO_IDS = ['github', 'vercel', 'domain', 'cloudflare'];
if (fs.existsSync(howtoIndexPath)) {
  const ids = getIdsFor(howtoIndexPath);
  for (const id of RESERVED_HOWTO_IDS) {
    if (!ids.has(id)) {
      fail(
        'site/howto/index.html',
        `アンカー互換リダイレクトの予約id "${id}" が無い。旧リンク howto/#${id} が着地先を失う`,
      );
    } else {
      ok(`howto/ 予約id "${id}" 実在`);
    }
  }
} else {
  console.log(`${ANSI_DIM}- site/howto/index.html が無い(RULE 3 skip)${ANSI_RESET}`);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
console.log('');
if (failures.length > 0) {
  console.log(`${ANSI_RED}--- internal link drift (${failures.length}) ---${ANSI_RESET}`);
  for (const f of failures) console.log(`${ANSI_RED}✗${ANSI_RESET} ${f.where}: ${f.message}`);
  console.log('');
  console.log(`${ANSI_RED}verify-internal-links failed.${ANSI_RESET} サイト内リンクが壊れている。`);
  process.exit(1);
}
console.log(`${ANSI_GREEN}internal link drift なし${ANSI_RESET}`);
