#!/usr/bin/env node
/**
 * verify-responsive-design.mjs — 出荷前にレスポンシブ設計の崩れやすいパターンを静的に洗い出す。
 *
 * ★車輪の再発明をしない方針（CLAUDE.md「新しい機能・検査を作るときの4つの基準」参照）:
 *   「本物のブラウザでどう見えるか」の正式な判定は、このスクリプトではなく実ブラウザでの
 *   実測に委ねる（このキットでは responsive-check スキル、または Playwright を推奨。
 *   詳細は _docs/instruments/RESPONSIVE-CHECK.md 参照）。
 *   このスクリプトはCSS標準（CSS Box Alignment / CSS Overflow等）に対する既知の
 *   「崩れやすいパターン」を静的解析で先取りする軽量ゲートに位置づけを絞る。
 *   ブラウザエンジンの再実装（レイアウト計算の自前シミュレーション）は一切行わない。
 *
 * ★何を測るか（CSSファイル・HTML内<style>を静的解析）
 *   1. 固定px幅（横スクロールの温床になりやすい固定 width/min-width）
 *   2. overflow-x制御の欠如（横に広がるコンテナに overflow-x: auto/hidden が無い）
 *   3. viewportメタタグの欠如・誤設定
 *   4. メディアクエリの不在（レスポンシブ対応そのものが無い）
 *   5. 極端に小さいタップ領域になりがちな固定px指定（font-size/padding が極小）
 *
 * ■ 終了コード（instrument-core.mjs と同じ3値規約）
 *   0 = 崩れやすいパターンなし / 1 = 見つかった / 2 = 測れなかった（対象0件等）
 *
 * ■ 使い方
 *   node templates/scripts/verify-responsive-design.mjs [対象ディレクトリ]  # 既定: ./site または ./
 *   node templates/scripts/verify-responsive-design.mjs --selftest           # 毒→赤を確認
 *
 * ■ この検査の限界（過信を防ぐ）
 *   - 静的解析のみ。実際にブラウザで崩れるかどうかは判定しない（本物の判定は実ブラウザ実測）。
 *   - JSで動的に注入されるスタイルは見ない（<style>タグとCSSファイルのみ）。
 *   - 「パターンが無い」ことは「レスポンシブ対応が完璧」を意味しない。
 * ───────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { EXIT, formatProbeReport } from './lib/instrument-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const SELFTEST = process.argv.includes('--selftest');
const argv = process.argv.slice(2).filter((a) => a !== '--selftest');
const TARGET_DIR = argv[0]
  ? resolve(argv[0])
  : existsSync(resolve(ROOT, 'site'))
    ? resolve(ROOT, 'site')
    : ROOT;

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.vercel',
  // ★実際にユーザーが訪れるレスポンシブページではなく、固定サイズの
  //   スクリーンショット撮影用キャンバス（例: site/assets/captures/_sources/**
  //   の #capture-root { width:1180px } はストア申請ウォークスルーの実画面再現素材）。
  //   実測(2026-08-25): これを除外しないとこのキット自身のsite/実行で20件の誤検知が出た。
  'captures',
]);

function* walkFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else yield full;
  }
}

function collectStyleSources(dir) {
  /** @type {{path: string, css: string}[]} */
  const sources = [];
  for (const file of walkFiles(dir)) {
    const ext = extname(file);
    if (ext === '.css') {
      sources.push({ path: file, css: readFileSync(file, 'utf8') });
    } else if (ext === '.html' || ext === '.htm') {
      const html = readFileSync(file, 'utf8');
      const styleMatches = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
      for (const m of styleMatches) sources.push({ path: file, css: m[1] });
    }
  }
  return sources;
}

function collectHtmlFiles(dir) {
  /** @type {{path: string, html: string}[]} */
  const out = [];
  for (const file of walkFiles(dir)) {
    if (extname(file) === '.html' || extname(file) === '.htm') {
      out.push({ path: file, html: readFileSync(file, 'utf8') });
    }
  }
  return out;
}

function rel(p) {
  return p.split(ROOT).join('').replace(/^[\/\\]+/, '');
}

/**
 * ★本体。対象ディレクトリを静的解析し、崩れやすいパターンのリストを返す。
 * @param {string} dir
 */
function scanResponsive(dir) {
  const styleSources = collectStyleSources(dir);
  const htmlFiles = collectHtmlFiles(dir);
  const findings = [];

  if (styleSources.length === 0 && htmlFiles.length === 0) {
    return { verdict: 'inconclusive', detail: `CSS/HTMLが1件も見つかりませんでした: ${rel(dir)}` };
  }

  // 1. viewportメタタグの欠如・誤設定（HTML側）
  for (const { path, html } of htmlFiles) {
    const viewportMatch = html.match(/<meta[^>]+name=["']viewport["'][^>]*>/i);
    if (!viewportMatch) {
      findings.push({
        id: 'viewport-meta-missing',
        file: rel(path),
        detail: 'viewportメタタグがありません（モバイルでレイアウトが崩れる典型原因）',
        howToFix: '<meta name="viewport" content="width=device-width, initial-scale=1.0"> を<head>に追加する',
      });
    } else if (/user-scalable=no|maximum-scale=1(?!\.\d*[1-9])/i.test(viewportMatch[0])) {
      findings.push({
        id: 'viewport-zoom-disabled',
        file: rel(path),
        detail: `拡大縮小を禁止するviewport設定があります: ${viewportMatch[0]}`,
        howToFix: 'user-scalable=no や maximum-scale=1 を外す（アクセシビリティ上、拡大を禁止しない）',
      });
    }
  }

  // 2. メディアクエリの不在（CSS側。1ファイルでも@mediaがあれば対応ありとみなす）
  const hasMediaQuery = styleSources.some((s) => /@media[^{]*\([^)]*width[^)]*\)/i.test(s.css));
  if (styleSources.length > 0 && !hasMediaQuery) {
    findings.push({
      id: 'no-media-query',
      file: styleSources.length === 1 ? rel(styleSources[0].path) : `${styleSources.length}件のCSS/style`,
      detail: '幅に応じた@media クエリが1件も見つかりません（レスポンシブ対応が無い可能性）',
      howToFix: '主要ブレークポイント（例: max-width:768px, max-width:480px）で@mediaを追加する',
    });
  }

  // 3. 固定px幅（横スクロールの温床。width/min-width が大きな固定pxで、%/vw/max-widthの併用が無い）
  for (const { path, css } of styleSources) {
    const fixedWidthMatches = [...css.matchAll(/(?<!min-|max-)\bwidth\s*:\s*(\d{3,})px/g)];
    for (const m of fixedWidthMatches) {
      const px = Number(m[1]);
      if (px >= 600) {
        findings.push({
          id: 'fixed-large-width-px',
          file: rel(path),
          detail: `固定幅 width:${px}px が指定されています（画面幅がそれより狭いと横スクロールの原因になる）`,
          howToFix: 'max-width:100% と併用するか、%/vw/remなど相対単位に置き換える',
        });
      }
    }
  }

  // 4. overflow-x制御の欠如（bodyまたはhtmlセレクタにoverflow-x指定が無い）
  const hasBodyOverflowX = styleSources.some((s) =>
    /(?:html|body)\s*\{[^}]*overflow-x\s*:/i.test(s.css) || /overflow-x\s*:\s*hidden\s*;?\s*\}[^{]*(?:html|body)/i.test(s.css)
  );
  if (styleSources.length > 0 && !hasBodyOverflowX) {
    findings.push({
      id: 'no-overflow-x-guard',
      file: styleSources.length === 1 ? rel(styleSources[0].path) : `${styleSources.length}件のCSS/style`,
      detail: 'html/bodyへの overflow-x 制御が見つかりません（意図しない横スクロールに気づきにくい）',
      howToFix: 'html, body { overflow-x: hidden; max-width: 100%; } を追加する（意図的な横スクロールUIがあれば除外してよい）',
    });
  }

  // 5. 極端に小さいfont-size（タップ領域・可読性）
  for (const { path, css } of styleSources) {
    const tinyFontMatches = [...css.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)];
    for (const m of tinyFontMatches) {
      const px = Number(m[1]);
      if (px > 0 && px < 10) {
        findings.push({
          id: 'font-size-too-small',
          file: rel(path),
          detail: `font-size:${px}px は小さすぎます（モバイルでの可読性低下）`,
          howToFix: '本文は最低12px以上、可能なら14px以上を推奨',
        });
      }
    }
  }

  return {
    verdict: findings.length === 0 ? 'pass' : 'fail',
    findings,
    scanned: { cssSources: styleSources.length, htmlFiles: htmlFiles.length },
  };
}

/* ── --selftest ─────────────────────────────────────────── */
if (SELFTEST) {
  const fails = [];
  const tmpDir = mkdtempSync(join(tmpdir(), 'verify-responsive-selftest-'));

  try {
    // 毒1: viewportメタタグ無し・固定幅・メディアクエリ無し・overflow-x制御無し → 複数検知するはず
    writeFileSync(join(tmpDir, 'poison.html'), `<!DOCTYPE html><html><head>
      <style>.box { width: 900px; } body { font-size: 8px; }</style>
    </head><body><div class="box">test</div></body></html>`);
    const r1 = scanResponsive(tmpDir);
    if (r1.verdict !== 'fail' || r1.findings.length < 4) {
      fails.push(`崩れやすいパターンを検知できない(得た: verdict=${r1.verdict}, 件数=${r1.findings?.length})`);
    }
    rmSync(join(tmpDir, 'poison.html'));

    // 毒2: viewport・メディアクエリ・overflow-x制御すべてあり → passになるはず
    writeFileSync(join(tmpDir, 'clean.html'), `<!DOCTYPE html><html><head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        html, body { overflow-x: hidden; max-width: 100%; }
        .box { max-width: 100%; }
        @media (max-width: 768px) { .box { padding: 8px; } }
      </style>
    </head><body><div class="box">test</div></body></html>`);
    const r2 = scanResponsive(tmpDir);
    if (r2.verdict !== 'pass') {
      fails.push(`正常なレスポンシブ設定を誤検知した(得た: verdict=${r2.verdict}, findings=${JSON.stringify(r2.findings)})`);
    }
    rmSync(join(tmpDir, 'clean.html'));

    // 毒3: 対象0件 → inconclusive であるべき
    const emptyDir = join(tmpDir, 'empty');
    mkdirSync(emptyDir);
    const r3 = scanResponsive(emptyDir);
    if (r3.verdict !== 'inconclusive') fails.push(`対象0件を緑/赤にした(得た: ${r3.verdict})`);
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  if (fails.length) {
    console.error('[verify-responsive-design] selftest 失敗（検知器が効いていません）:');
    for (const f of fails) console.error('  - ' + f);
    process.exit(EXIT.FAIL);
  }
  console.log('[verify-responsive-design] selftest OK');
  process.exit(EXIT.PASS);
}

/* ── 通常実行 ───────────────────────────────────────────── */
const result = scanResponsive(TARGET_DIR);

if (result.verdict === 'inconclusive') {
  console.log(formatProbeReport([{
    probe: `レスポンシブ静的チェック (${rel(TARGET_DIR)})`,
    verdict: 'inconclusive',
    detail: result.detail,
    howToFix: '対象ディレクトリを指定する（node verify-responsive-design.mjs path/to/site）',
    limitation: '静的解析のみ。実際の描画崩れは実ブラウザでの実測が必要（RESPONSIVE-CHECK.md参照）',
  }]));
  process.exit(EXIT.INCONCLUSIVE);
}

if (result.verdict === 'fail') {
  const lines = result.findings.map((f) => `[${f.file}] ${f.detail}`).join(' / ');
  const fixes = [...new Set(result.findings.map((f) => f.howToFix))].join(' / ');
  console.log(formatProbeReport([{
    probe: `レスポンシブ静的チェック (${rel(TARGET_DIR)})`,
    verdict: 'fail',
    evidence: { 走査対象: result.scanned.cssSources + result.scanned.htmlFiles, 検出件数: result.findings.length },
    detail: lines,
    howToFix: fixes,
    limitation: '静的解析のみ。直した後は実ブラウザで375/768/1024/1440pxを実測して確認すること（RESPONSIVE-CHECK.md参照）',
  }]));
  process.exit(EXIT.FAIL);
}

console.log(formatProbeReport([{
  probe: `レスポンシブ静的チェック (${rel(TARGET_DIR)})`,
  verdict: 'pass',
  evidence: { 走査対象: result.scanned.cssSources + result.scanned.htmlFiles, 検出件数: 0 },
  limitation: '静的解析のみ。崩れやすい既知パターンが無いことの確認であり、実際の見た目を保証しない。出荷前に実ブラウザでの実測を推奨（RESPONSIVE-CHECK.md参照）',
}]));
process.exit(EXIT.PASS);
