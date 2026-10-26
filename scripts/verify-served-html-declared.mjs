#!/usr/bin/env node
// verify-served-html-declared.mjs — site/ 配下で「配信される HTML ページ」が、どこかに
//   宣言されている（サイトマップのナビに載っている／意図的に非掲載と宣言されている）かを検査する。
//
// 役割: 静的サイト site/ は vercel.json に除外が無く、置いた HTML が全部そのまま配信される。
//   そのため「新しいページを作ったのに、どこからもリンクされず・サイトマップにも無く・
//   意図（誰向けか・なぜ非掲載か）も宣言されないまま本番に出ている」孤児ページが生まれる。
//   実例: site/lp/index.html（B2B代行LP。index からリンク無し・manifest/sitemap.xml に無し）。
// なぜ要るか(council 2026-10-21 P4): 役②（横断心臓部）が decay するのと同型の、可視化面の decay。
//   「配信されているのに宣言が無い」を機械で落とし、ページを足すなら掲載/非掲載の意図も宣言させる。
// 宣言とみなすもの: site/sitemap/sitemap-manifest.json の
//   (a) sections[].links[].srcPath（ナビに掲載）、(b) unlisted[].srcPath（意図的に非掲載と宣言）。
// ラチェット: 既に宣言の無い既存ページ（lp/ 以外の多数）を一斉に赤にはしない。
//   `.served-html-baseline.json` の grandfathered に今ある未宣言ページを記録し、
//   **新たに**増えた未宣言ページだけを赤にする（既存のキットの .shared-parts-baseline.json と同じ流儀。
//   「新しい借金だけ赤」= HANDOFF-new-app §5）。baseline に載せた既存分は report に件数だけ出す。
// ★判定しないこと: ページの中身の質・そのページが本当に要るか（意味判断）。見るのは
//   「配信される HTML が、宣言集合に入っているか」という事実だけ。
//
// 使い方: node scripts/verify-served-html-declared.mjs [site ディレクトリ]  # 省略時は <repo>/site
//         node scripts/verify-served-html-declared.mjs --selftest
// 終了コード: 0=新規の未宣言なし / 1=新規の未宣言を検出（赤） / 2=測定不能（site が無い・manifest が読めない・0ページ）

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const DEFAULT_SITE = join(REPO_ROOT, 'site');
const MANIFEST_REL = join('sitemap', 'sitemap-manifest.json');
const BASELINE_PATH = join(REPO_ROOT, '.served-html-baseline.json');

// assets/ 配下は css/js/データ/スクショ採取の元 HTML 等で「ページ」ではない（配信されても人が読むページではない）。
// 特にスクショ採取元 assets/captures/_sources/*.html はページではないので宣言を求めない。
export const EXCLUDE_PREFIXES = ['assets/'];

// ---- 純ロジック（fs 非依存・単体テスト可） --------------------------------

/** site 相対パスが「宣言を求める配信ページ」か。 @param {string} relPath */
export function isServedPage(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (!p.endsWith('.html')) return false;
  return !EXCLUDE_PREFIXES.some((pre) => p === pre || p.startsWith(pre));
}

/** manifest から「宣言済み」srcPath 集合を集める（ナビ掲載＋意図的非掲載の両方）。 @param {any} manifest */
export function collectDeclared(manifest) {
  const set = new Set();
  const sections = manifest && Array.isArray(manifest.sections) ? manifest.sections : [];
  for (const s of sections) {
    const links = s && Array.isArray(s.links) ? s.links : [];
    for (const l of links) if (l && typeof l.srcPath === 'string') set.add(l.srcPath.replace(/\\/g, '/'));
  }
  const unlisted = manifest && Array.isArray(manifest.unlisted) ? manifest.unlisted : [];
  for (const u of unlisted) if (u && typeof u.srcPath === 'string') set.add(u.srcPath.replace(/\\/g, '/'));
  return set;
}

/**
 * 配信ページ・宣言集合・baseline を突き合わせる。
 * @param {{ servedPaths: string[], declaredSet: Set<string>, baselineSet: Set<string> }} x
 * @returns {{ undeclared: string[], newUndeclared: string[], grandfathered: string[], staleBaseline: string[] }}
 */
export function judge({ servedPaths, declaredSet, baselineSet }) {
  const undeclared = servedPaths.filter((p) => !declaredSet.has(p));
  const newUndeclared = undeclared.filter((p) => !baselineSet.has(p));
  const grandfathered = undeclared.filter((p) => baselineSet.has(p));
  // baseline にあるが、もう配信されていない or 宣言済みになった = 掃除候補（赤にはしない・report のみ）。
  const servedSet = new Set(servedPaths);
  const staleBaseline = [...baselineSet].filter((p) => !servedSet.has(p) || declaredSet.has(p));
  return { undeclared, newUndeclared, grandfathered, staleBaseline };
}

// ---- I/O（直接実行時のみ） -----------------------------------------------

/** site ディレクトリ配下の *.html を site 相対パス（/区切り）で集める。 */
function listHtml(siteDir) {
  /** @type {string[]} */
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (name.endsWith('.html')) out.push(relative(siteDir, full).replace(/\\/g, '/'));
    }
  };
  walk(siteDir);
  return out.sort();
}

function runSelftest() {
  const declared = collectDeclared({
    sections: [{ links: [{ srcPath: 'index.html' }, { srcPath: 'guide/index.html' }] }],
    unlisted: [{ srcPath: 'lp/index.html', audience: 'b2b', reason: 'x' }],
  });
  const served = ['index.html', 'guide/index.html', 'lp/index.html', 'orphan-new/index.html', 'grand/index.html', 'assets/captures/_sources/chrome/01.html'];
  const servedPages = served.filter(isServedPage);
  const r = judge({ servedPaths: servedPages, declaredSet: declared, baselineSet: new Set(['grand/index.html', 'gone/index.html']) });

  const ok =
    // 除外: _sources の html はページ扱いしない
    !servedPages.includes('assets/captures/_sources/chrome/01.html') &&
    servedPages.length === 5 &&
    // 宣言済み(sections / unlisted)は未宣言に出ない
    !r.undeclared.includes('index.html') &&
    !r.undeclared.includes('guide/index.html') &&
    !r.undeclared.includes('lp/index.html') &&
    // baseline 外の新規未宣言だけが赤
    r.newUndeclared.length === 1 &&
    r.newUndeclared[0] === 'orphan-new/index.html' &&
    // baseline 内は grandfathered（赤にしない）
    r.grandfathered.includes('grand/index.html') &&
    // baseline にあるが配信されていない gone は掃除候補
    r.staleBaseline.includes('gone/index.html');

  // 緑の対照: 新規未宣言がゼロなら newUndeclared 空
  const green = judge({ servedPaths: ['index.html'], declaredSet: new Set(['index.html']), baselineSet: new Set() });
  const greenOk = green.newUndeclared.length === 0;

  if (!ok || !greenOk) {
    console.error('[verify-served-html-declared] --selftest 失敗:', { servedPages, r, green });
    process.exit(1);
  }
  console.log('[verify-served-html-declared] --selftest OK。');
  process.exit(0);
}

const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  if (process.argv.includes('--selftest')) {
    runSelftest();
  } else {
    const siteDir = resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : DEFAULT_SITE);
    if (!existsSync(siteDir)) {
      console.log(`[verify-served-html-declared] site ディレクトリが無い(測定不能): ${siteDir}`);
      process.exit(2);
    }
    const manifestPath = join(siteDir, MANIFEST_REL);
    if (!existsSync(manifestPath)) {
      console.log(`[verify-served-html-declared] sitemap-manifest.json が無い(測定不能): ${manifestPath}`);
      process.exit(2);
    }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      console.log('[verify-served-html-declared] sitemap-manifest.json が JSON として読めない(測定不能)。');
      process.exit(2);
    }

    const servedPaths = listHtml(siteDir).filter(isServedPage);
    if (servedPaths.length === 0) {
      console.log('[verify-served-html-declared] 配信ページ(*.html)が0件(測定不能。緑ではない)。');
      process.exit(2);
    }

    const declaredSet = collectDeclared(manifest);
    let baselineSet = new Set();
    if (existsSync(BASELINE_PATH)) {
      try {
        const b = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
        if (b && Array.isArray(b.grandfathered)) baselineSet = new Set(b.grandfathered.map((s) => String(s).replace(/\\/g, '/')));
      } catch {
        console.log('[verify-served-html-declared] .served-html-baseline.json が読めない(測定不能)。');
        process.exit(2);
      }
    }

    const r = judge({ servedPaths, declaredSet, baselineSet });

    if (r.staleBaseline.length > 0) {
      console.log(`[verify-served-html-declared] ℹ baseline の掃除候補 ${r.staleBaseline.length} 件(宣言済みになった/もう配信されていない。赤ではない): ${r.staleBaseline.join(', ')}`);
    }
    if (r.grandfathered.length > 0) {
      console.log(`[verify-served-html-declared] ℹ 未宣言の既存ページ ${r.grandfathered.length} 件(baseline で据え置き。掲載/非掲載を宣言すると減る)。`);
    }

    if (r.newUndeclared.length > 0) {
      console.error(`[verify-served-html-declared] ★新規の未宣言ページ ${r.newUndeclared.length} 件(配信されるのに、ナビにも unlisted 宣言にも無い):`);
      for (const p of r.newUndeclared) console.error(`  - site/${p}`);
      console.error('  直し方: ナビに載せるなら site/sitemap/sitemap-manifest.json の sections[].links[] に、');
      console.error('  意図的に非掲載なら同ファイルの unlisted[] に {srcPath, audience, reason} を足す。');
      console.error('  既存の据え置き分を正式に増やす場合のみ .served-html-baseline.json に足す(新規ページの逃げ道にしない)。');
      process.exit(1);
    }

    console.log(`[verify-served-html-declared] OK(配信ページ ${servedPaths.length} 件・宣言済み判定・新規の未宣言 0 件)。`);
    process.exit(0);
  }
}
