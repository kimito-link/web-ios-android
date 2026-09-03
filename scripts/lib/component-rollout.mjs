#!/usr/bin/env node
/**
 * component-rollout.mjs — 配布可能コンポーネント（templates/配下）の適用対象判定（Phase 1: Applicability）。
 *
 * hub-kit-matrix.mjs の「detectProfile → appliesTo述語 → 4値state」という既存パターンを
 * 出荷ゲート以外（UI部品・診断ページ等の配布物）にも拡張したもの。walkFiles/EXCLUDED_DIRS は
 * そのままimportして使う。discoverProjects()（isKitTarget||hasExpoのみを候補にする、
 * 出荷Gate Matrix専用の発見処理）は再利用しない — 純静的HTMLサイトが分母から消えるため。
 *
 * Phase 1のスコープは「対象かどうか（Applicability）」の3値判定のみ。
 *   APPLIES / NOT_APPLICABLE / UNKNOWN
 * 「導入済みか（Adoption/Coverage）」は別フェーズで扱う（このファイルには実装しない）。
 *
 * 正本は各コンポーネントの component.json（例: templates/web/site-chrome/component.json）。
 * appliesTo条件をこのファイルのコード側にハードコードしない — 正本が2箇所にできてドリフトする
 * 事故を、今回の設計そのもので再発させないため（GPT相談 2026-09-03 で指摘・修正）。
 *
 * 第1号: ui/site-chrome。
 */
import { existsSync, readFileSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname, basename, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { walkFiles, EXCLUDED_DIRS } from './hub-kit-matrix.mjs';

const MAX_SITE_ROOT_DEPTH = 3;

/**
 * Canonical digest: UTF-8テキストをLF正規化してからSHA-256する。
 * ★Windows/UnixのCRLF/LF差だけでDRIFTED誤判定になる事故を避けるため（2026-09-03、
 *   GPT相談での指摘）。生バイトのhashは使わない。
 * @param {string} text
 * @returns {string} hex digest
 */
export function canonicalDigest(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * HTML内の <meta http-equiv="Content-Security-Policy" content="..."> から、
 * same-origin外部リソース（script-src-elem/script-src、style-src-elem/style-src）が
 * 許可されているかを判定する。
 *
 * ★Delivery Preflight専用（Applicabilityとは別軸）。2026-09-03、soushin-suggest.link
 *   実apply中に4ページ(features/help/help-sites/thanks)がstrict CSPで
 *   site-chromeの外部JS/CSSを全ブロックし、旧UI削除後に新UIも表示されない壊れた状態を
 *   実際に発生させた。この教訓から、apply前に確認するGateとして追加した。
 * ★既存verify-security-score.mjsはHTTPレスポンスヘッダーのCSP有無のみを見ており、
 *   <meta>埋め込みCSPのディレクティブ解析は行っていない（確認済み、再利用不可）。
 *
 * @param {string} htmlContent
 * @returns {{present: boolean, externalScript: 'ALLOW'|'BLOCK'|'UNKNOWN', externalStyle: 'ALLOW'|'BLOCK'|'UNKNOWN', raw: string|null}}
 */
/**
 * CSPディレクティブ文字列（"default-src 'none'; script-src 'self'; ..."の形）を解析し、
 * same-origin外部リソース（script/style）が許可されるかを判定する共通ロジック。
 * meta CSPとhosting設定CSP（_headers/vercel.json）の両方から使う
 * （2026-09-03、GPT指摘: Delivery Preflight v1.1でCSP文字列解析を共通化）。
 * @param {string} raw
 * @returns {{externalScript: 'ALLOW'|'BLOCK'|'UNKNOWN', externalStyle: 'ALLOW'|'BLOCK'|'UNKNOWN'}}
 */
export function resolveCspAllowanceFromDirectiveString(raw) {
  const directives = {};
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, ...values] = trimmed.split(/\s+/);
    directives[name.toLowerCase()] = values;
  }

  // same-origin外部リソースを許すか判定する。'self' または 'unsafe-inline' があれば
  // <script src="/xxx.js">/<link rel="stylesheet" href="/xxx.css">は通る
  // （'unsafe-inline'はインラインscript/style用の許可だが、'self'が無くdefault-srcも
  //   'none'の場合、外部srcは通らない点に注意して個別に判定する）。
  function resolvesToAllow(directiveNames) {
    for (const name of directiveNames) {
      if (directives[name]) {
        const values = directives[name];
        if (values.includes("'none'")) return 'BLOCK';
        if (values.includes("'self'") || values.includes('*')) return 'ALLOW';
        // unsafe-inlineだけではsrc属性の外部リソース読み込みは許可されない。
        return 'BLOCK';
      }
    }
    return null; // このディレクティブ階層では判定できない
  }

  // script-src-elem → script-src → default-src の優先順でfallbackする（CSP仕様通り）。
  const externalScript = resolvesToAllow(['script-src-elem', 'script-src', 'default-src']) ?? 'UNKNOWN';
  const externalStyle = resolvesToAllow(['style-src-elem', 'style-src', 'default-src']) ?? 'UNKNOWN';

  return { externalScript, externalStyle };
}

/**
 * @returns {{present: boolean, externalScript: 'ALLOW'|'BLOCK'|'UNKNOWN', externalStyle: 'ALLOW'|'BLOCK'|'UNKNOWN', raw: string|null}}
 */
export function analyzeCspMetaTag(htmlContent) {
  // ★content属性値はダブルクォートで囲まれる想定だが、CSP値自体に'none'等の
  //   シングルクォートを含むため、[^"']+ではシングルクォートで早期終端する誤りを
  //   実データ(soushin-suggest.link)で踏んだ。クォート文字を後方参照で揃えて対応する。
  const metaMatch = htmlContent.match(
    /<meta\s+http-equiv=(["'])Content-Security-Policy\1\s+content=(["'])([\s\S]+?)\2\s*\/?>/i
  );
  if (!metaMatch) {
    return { present: false, externalScript: 'ALLOW', externalStyle: 'ALLOW', raw: null };
  }

  const raw = metaMatch[3];
  const { externalScript, externalStyle } = resolveCspAllowanceFromDirectiveString(raw);
  return { present: true, externalScript, externalStyle, raw };
}

/**
 * hosting設定（_headers = Cloudflare Pages形式、vercel.json = Vercel形式）から、
 * HTTPレスポンスヘッダーとして配信されるContent-Security-Policyを読み取る。
 *
 * ★meta CSPが無いことは「CSP無し」を意味しない。HTTPレスポンスヘッダー側のCSPが
 *   別に存在しうる（2026-09-03実データ: surechigai-romi.link-deploy-886aeff/vercel.json
 *   に script-src 'self' ... を含むCSPが実在した）。これを見ずにmeta無し=ALLOWと
 *   丸めると、Mass Rolloutでfalse READYになる。
 * ★新しい巨大なdeployment detectorは作らない。_headers/vercel.jsonという既存の
 *   設定ファイルをそのまま読むだけ（Cloudflare Pages/Vercelの実配置パターンを
 *   カバー。netlify.tomlは将来必要になったら追加する）。
 *
 * @param {string} siteRootDir サイトのpublicディレクトリ（_headersの探索起点）
 * @param {string} repoRootDir リポジトリルート（vercel.jsonの探索起点）
 * @returns {{present: boolean, source: '_headers'|'vercel.json'|null, externalScript: 'ALLOW'|'BLOCK'|'UNKNOWN', externalStyle: 'ALLOW'|'BLOCK'|'UNKNOWN', raw: string|null}}
 */
export function analyzeHostingHeadersCsp(siteRootDir, repoRootDir) {
  // _headers（Cloudflare Pages）: 全体（/*）に効くCSP行を探す。
  //   構文は "# comment" / "パスパターン" 行 / インデントされた "Key: Value" 行の並び。
  const headersPath = join(siteRootDir, '_headers');
  if (existsSync(headersPath)) {
    const content = readFileSync(headersPath, 'utf8');
    const cspLine = content
      .split('\n')
      .find((line) => /^\s+Content-Security-Policy:/i.test(line));
    if (cspLine) {
      const raw = cspLine.replace(/^\s*Content-Security-Policy:\s*/i, '').trim();
      const { externalScript, externalStyle } = resolveCspAllowanceFromDirectiveString(raw);
      return { present: true, source: '_headers', externalScript, externalStyle, raw };
    }
  }

  // vercel.json: headers[].headers[] 配列からContent-Security-Policyキーを探す。
  const vercelJsonPath = join(repoRootDir, 'vercel.json');
  if (existsSync(vercelJsonPath)) {
    try {
      const config = JSON.parse(readFileSync(vercelJsonPath, 'utf8'));
      for (const rule of config.headers || []) {
        const cspHeader = (rule.headers || []).find((h) => h.key?.toLowerCase() === 'content-security-policy');
        if (cspHeader) {
          const { externalScript, externalStyle } = resolveCspAllowanceFromDirectiveString(cspHeader.value);
          return { present: true, source: 'vercel.json', externalScript, externalStyle, raw: cspHeader.value };
        }
      }
    } catch {
      return { present: false, source: null, externalScript: 'UNKNOWN', externalStyle: 'UNKNOWN', raw: null };
    }
  }

  // ★どちらの設定ファイルも見つからない、またはCSP行が無い場合、「CSPが本当に無い」のか
  //   「別のホスティング方式(Netlify等)でこのツールが対応していないだけ」なのか区別できない。
  //   ALLOWへ丸めずUNKNOWNとする。
  return { present: false, source: null, externalScript: 'UNKNOWN', externalStyle: 'UNKNOWN', raw: null };
}

/**
 * 1ページについて、meta CSPとhosting設定CSPの両方を考慮したDelivery判定を行う。
 * 両方に制約がある場合、両方を満たす（ALLOW）場合のみALLOWとする。どちらかがBLOCKなら
 * BLOCK、UNKNOWNが残ればUNKNOWN（ALLOWへ丸めない）。
 * @param {{externalScript: string, externalStyle: string}} metaResult
 * @param {{externalScript: string, externalStyle: string}} hostingResult
 * @returns {{externalScript: 'ALLOW'|'BLOCK'|'UNKNOWN', externalStyle: 'ALLOW'|'BLOCK'|'UNKNOWN'}}
 */
function combineCspVerdicts(metaResult, hostingResult) {
  function combine(a, b) {
    if (a === 'BLOCK' || b === 'BLOCK') return 'BLOCK';
    if (a === 'UNKNOWN' || b === 'UNKNOWN') return 'UNKNOWN';
    return 'ALLOW';
  }
  return {
    externalScript: combine(metaResult.externalScript, hostingResult.externalScript),
    externalStyle: combine(metaResult.externalStyle, hostingResult.externalStyle),
  };
}

/**
 * 1 siteRootについて、expectedなHTMLページ全部のCSP（meta + hosting設定）が、
 * site-chromeの外部JS/CSSを配布可能かをread-onlyで判定する（Delivery Preflight v1.1）。
 * UNKNOWNをPASSへ丸めない。1ページでもBLOCKがあれば全体をBLOCKとして返す。
 *
 * @param {Array<{path: string, content: string}>} pages 対象ページ（絶対パス+中身）
 * @param {{siteRootDir: string, repoRootDir: string}} [hostingContext] _headers/vercel.json探索用。
 *   省略時はhosting設定CSPをUNKNOWNとして扱う（後方互換）。
 * @returns {{verdict: 'READY'|'BLOCKED'|'UNKNOWN', perPage: Array<object>, hosting: object|null}}
 */
export function checkCspDeliveryPreflight(pages, hostingContext) {
  const hosting = hostingContext
    ? analyzeHostingHeadersCsp(hostingContext.siteRootDir, hostingContext.repoRootDir)
    : { present: false, source: null, externalScript: 'UNKNOWN', externalStyle: 'UNKNOWN', raw: null };

  const perPage = pages.map((p) => {
    const metaAnalysis = analyzeCspMetaTag(p.content);
    const combined = combineCspVerdicts(metaAnalysis, hosting);
    return { path: p.path, meta: metaAnalysis, hosting, ...combined };
  });

  const hasBlock = perPage.some((p) => p.externalScript === 'BLOCK' || p.externalStyle === 'BLOCK');
  const hasUnknown = perPage.some((p) => p.externalScript === 'UNKNOWN' || p.externalStyle === 'UNKNOWN');

  let verdict;
  if (hasBlock) verdict = 'BLOCKED';
  else if (hasUnknown) verdict = 'UNKNOWN';
  else verdict = 'READY';

  return { verdict, perPage, hosting };
}

/**
 * manifest.jsonのUI参照キー（値がそのままファイル名/相対パス、またはpage/default_popupの
 * ネストされたオブジェクト）を、実際にsiteRoot内に存在するHTMLファイル名の集合に対して
 * 参照しているか調べる。
 * @param {object} manifest
 * @param {Set<string>} htmlBasenames
 * @returns {boolean}
 */
function manifestReferencesLocalHtml(manifest, htmlBasenames) {
  const candidates = [];
  if (manifest.action?.default_popup) candidates.push(manifest.action.default_popup);
  if (manifest.browser_action?.default_popup) candidates.push(manifest.browser_action.default_popup);
  if (typeof manifest.options_page === 'string') candidates.push(manifest.options_page);
  if (typeof manifest.options_ui?.page === 'string') candidates.push(manifest.options_ui.page);
  if (typeof manifest.devtools_page === 'string') candidates.push(manifest.devtools_page);
  if (manifest.chrome_url_overrides && typeof manifest.chrome_url_overrides === 'object') {
    candidates.push(...Object.values(manifest.chrome_url_overrides));
  }

  return candidates.some((c) => {
    if (typeof c !== 'string') return false;
    const basename = c.split('/').pop();
    return htmlBasenames.has(basename);
  });
}

/**
 * サイトの事実（FACT）を検出する。detectProfile()と対になる、Web向けの判定材料。
 * ドット区切りのフラットキーで返す（component.json の appliesTo.requires/excludes と
 * 直接対応させるため）。
 * @param {string} siteRootDir
 * @returns {{'staticHtml.multiPage': boolean|null, 'staticHtml.buildless': boolean|null, 'browserExtension.uiContext': boolean|null, readErrors: string[]}}
 */
export function detectSiteFacts(siteRootDir) {
  const { files, errors } = walkFiles(siteRootDir);

  const htmlFiles = files.filter((f) => extname(f) === '.html');
  const htmlCount = htmlFiles.length;
  const htmlBasenames = new Set(htmlFiles.map((f) => basename(f)));

  // 読み取り不能な領域があった場合、multiPageの判定材料が欠けている可能性があるためnull(unknown)にする。
  const staticHtmlMultiPage = errors.length > 0 ? null : htmlCount >= 2;

  const FRAMEWORK_MARKERS = ['next', 'react', 'vite', 'astro', '@remix-run/dev', 'gatsby'];
  let buildless = null;
  const pkgPath = join(siteRootDir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const hasFrameworkMarker = FRAMEWORK_MARKERS.some((m) => Object.keys(deps).includes(m));
      buildless = !hasFrameworkMarker;
    } catch {
      buildless = null; // 壊れたpackage.jsonはunknown（ビルド方式を確定できない）
    }
  } else {
    // package.json自体が無いディレクトリは、Node系ビルドツールを持たないと判断してよい。
    buildless = true;
  }

  // ★browserExtension.uiContext: ファイル名（popup.html等）ではなく、Chrome/Firefox拡張の
  //   manifest.jsonが実際にsiteRoot内のHTMLをUI画面として参照しているかで判定する
  //   （2026-09-03、GPT相談: manifestが同じrepoにあるだけで除外するのは広すぎる。
  //   「manifestがそのtarget内HTMLを拡張UIとして参照している」まで確認する）。
  let browserExtensionUiContext = false;
  const manifestPath = join(siteRootDir, 'manifest.json');
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      // manifest_versionの存在で「拡張のmanifest」であることを確認する
      // （webmanifest等、無関係なmanifest.jsonとの混同を避ける）。
      if (typeof manifest.manifest_version === 'number') {
        browserExtensionUiContext = manifestReferencesLocalHtml(manifest, htmlBasenames);
      }
    } catch {
      browserExtensionUiContext = false; // 壊れたmanifest.jsonは拡張UIとして扱わない
    }
  }

  return {
    'staticHtml.multiPage': staticHtmlMultiPage,
    'staticHtml.buildless': buildless,
    'browserExtension.uiContext': browserExtensionUiContext,
    htmlCount,
    readErrors: errors,
  };
}

/**
 * component.json（appliesTo.requires/excludes: FACTキーの配列）を読み、facts に対して
 * 3値判定する。判定ロジックはこの関数だけに存在する（component.json側にもコード側にも
 * 条件を複製しない）。
 *
 * requires: 全て true であることを要求するFACT（1つでもfalseならNOT_APPLICABLE）
 * excludes: 1つでも true があってはならないFACT（trueが1つでもあればNOT_APPLICABLE）。
 *   汎用的な除外条件のための機構（2026-09-03、GPT相談: Chrome拡張UI等、requires側の
 *   条件だけでは表現できない「これに該当したら対象外」を、site-chrome専用のコードに
 *   ハードコードせず一般化する）。3値（APPLIES/NOT_APPLICABLE/UNKNOWN）は増やさない。
 *
 * @param {{appliesTo:{requires?:string[], excludes?:string[]}}} componentMeta
 * @param {Record<string, boolean|null>} facts
 * @returns {'APPLIES'|'NOT_APPLICABLE'|'UNKNOWN'}
 */
export function evaluateApplicability(componentMeta, facts) {
  const requires = componentMeta?.appliesTo?.requires || [];
  const excludes = componentMeta?.appliesTo?.excludes || [];
  let sawUnknown = false;

  for (const key of requires) {
    const value = facts[key];
    if (value === null || value === undefined) {
      sawUnknown = true;
      continue;
    }
    if (value === false) {
      return 'NOT_APPLICABLE'; // 明確にfalseが1つでもあれば、unknownの有無に関わらず対象外
    }
  }

  for (const key of excludes) {
    const value = facts[key];
    if (value === null || value === undefined) {
      sawUnknown = true;
      continue;
    }
    if (value === true) {
      return 'NOT_APPLICABLE'; // 除外条件に明確に該当すれば対象外
    }
  }

  return sawUnknown ? 'UNKNOWN' : 'APPLIES';
}

/**
 * component.json をファイルから読む。壊れている/無い場合はnull。
 * @param {string} componentJsonPath
 * @returns {object|null}
 */
export function loadComponentMeta(componentJsonPath) {
  if (!existsSync(componentJsonPath)) return null;
  try {
    return JSON.parse(readFileSync(componentJsonPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * リポジトリ配下から「サイトルート候補」を発見する。project + siteRoot 単位。
 * discoverProjects()（出荷Gate Matrix専用、isKitTarget||hasExpoのみ候補化）は使わない。
 * 判定材料: そのディレクトリ直下に *.html が1つ以上あるか。
 * ★浅い探索（MAX_SITE_ROOT_DEPTH）。node_modules等はEXCLUDED_DIRSで除外。
 * @param {string} repoDir
 * @returns {Array<{siteRoot: string, relativePath: string}>}
 */
export function discoverSiteTargets(repoDir) {
  const targets = [];

  function hasDirectHtml(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    return entries.some((e) => e.isFile() && extname(e.name) === '.html');
  }

  function walk(dir, depth, relativePath) {
    if (depth > MAX_SITE_ROOT_DEPTH) return;
    if (hasDirectHtml(dir)) {
      targets.push({ siteRoot: dir, relativePath: relativePath || '.' });
      return; // このディレクトリをサイトルートとして確定したら、配下は別サイトとして深掘りしない
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      // ★ドットで始まるディレクトリ（.expo-check等のツール中間生成物、.browseruse等の
      //   自動化ツール内部データ）は一律除外する。EXCLUDED_DIRSは名指しリストのため
      //   未知の".xxx"ディレクトリを個別追加し続けるのは対症療法。実データ(2026-09-03、
      //   doin-challenge.com/.expo-check、kimitolink-linktree/.browseruse)で
      //   誤検出を確認して追加。
      if (entry.name.startsWith('.')) continue;
      // ★"dist-"プレフィックスもビルド成果物として機械的に除外する（EXCLUDED_DIRSの
      //   完全一致'dist'では拾えなかった実例: surechigai-romi.link/dist-map,dist-perf等、
      //   2026-09-03実データで確認）。これ以上の命名パターン（prerendered, test/fixtures等）は
      //   機械的に確実とは言えないため除外せず、targetsに残してreasonで要確認と明示する。
      if (entry.name.startsWith('dist-')) continue;
      walk(join(dir, entry.name), depth + 1, relativePath ? `${relativePath}/${entry.name}` : entry.name);
    }
  }

  walk(repoDir, 0, '');
  return targets;
}

/**
 * 1リポジトリについて、登録済み全コンポーネント × 発見した全サイトターゲットの適用可否を判定する。
 * @param {string} repoDir
 * @param {Array<{id: string, componentJsonPath: string}>} componentRegistry
 * @returns {Array<{componentId: string, siteRoot: string, relativePath: string, facts: object, state: string}>}
 */
export function scanRepoApplicability(repoDir, componentRegistry) {
  const targets = discoverSiteTargets(repoDir);
  const results = [];

  for (const target of targets) {
    const facts = detectSiteFacts(target.siteRoot);
    for (const component of componentRegistry) {
      const meta = loadComponentMeta(component.componentJsonPath);
      const state = meta ? evaluateApplicability(meta, facts) : 'UNKNOWN';
      results.push({
        componentId: component.id,
        siteRoot: target.siteRoot,
        relativePath: target.relativePath,
        facts,
        state,
      });
    }
  }

  return results;
}

/**
 * 1 siteRootについて、コンポーネントの導入状況（Adoption）をread-onlyで観測する。
 *
 * ★ファイル全体のhash不一致だけでDRIFTEDにしない。site-chromeはSITE_CONFIG/NAV_ITEMS/
 *   ブランド色をサイトごとに書き換える正式仕様であり、実測（2026-09-03）で正本
 *   (site/scripts/site-chrome.js)と配布テンプレ(site-chrome.template.js)自体が
 *   コメント文言・行数からして既に完全一致しないことを確認済み。「変更してよい領域」と
 *   「一致すべき領域」の境界を機械的に定義できていない間は、Canonical比較そのものを
 *   "not-yet-provable"として扱い、無理にCURRENT/DRIFTEDへ寄せずUNKNOWNに倒す。
 *
 * 4状態:
 *   CURRENT  = 必要な配線が存在し、Canonicalの変更禁止部分が現在版と一致すると証明できる
 *   MISSING  = 必要な実装・配線が存在しない（site-chrome.js相当が無い）
 *   DRIFTED  = 導入済みだが変更禁止部分がCanonicalと違うことを証明できる
 *   UNKNOWN  = 導入らしきものはあるが、driftと許可されたカスタマイズを区別できない、
 *              またはCanonical比較が未実装で測定不能
 *
 * @param {string} siteRootDir
 * @param {object} componentMeta component.jsonのadoptionセクション込みの中身
 * @param {Array<{glob?: string, path?: string}>} [pageExclusions] このsiteRootで確認済みの
 *   ページ単位除外（rollout-overrides.jsonのpageExclusionsから、呼び出し側がproject::siteRootで
 *   絞り込んで渡す）。ここに無いパターンを一般化・推測して除外しない。
 * @returns {{adoption: 'CURRENT'|'MISSING'|'DRIFTED'|'UNKNOWN', evidence: object}}
 */
export function detectAdoption(siteRootDir, componentMeta, pageExclusions = []) {
  const adoptionSpec = componentMeta?.adoption;
  if (!adoptionSpec) {
    return { adoption: 'UNKNOWN', evidence: { reason: 'component.jsonにadoptionセクションが無い' } };
  }

  const { files, errors } = walkFiles(siteRootDir);
  if (errors.length > 0) {
    return { adoption: 'UNKNOWN', evidence: { reason: '読み取り不能なサブディレクトリがある', readErrors: errors } };
  }

  const canonicalFileBasenames = adoptionSpec.canonicalFiles || [];
  const scriptFound = canonicalFileBasenames.some((name) => files.some((f) => basename(f) === name));

  const allHtmlFiles = files.filter((f) => extname(f) === '.html');
  const htmlDiscovered = allHtmlFiles.length;

  const isExcluded = (absPath) => {
    const rel = relative(siteRootDir, absPath).split('\\').join('/');
    return pageExclusions.some((ex) => {
      if (ex.path) return rel === ex.path;
      if (ex.glob) {
        // ★シンプルな "prefix/**" globのみサポート。汎用glob実装は増やさない
        //   （scriptタグ・スロット検出と同じ、必要最小限の文字列一致方針）。
        const prefix = ex.glob.endsWith('/**') ? ex.glob.slice(0, -3) : ex.glob;
        return rel === prefix || rel.startsWith(`${prefix}/`);
      }
      return false;
    });
  };

  const htmlFiles = allHtmlFiles.filter((f) => !isExcluded(f));
  const excludedPages = htmlDiscovered - htmlFiles.length;
  const expectedPages = htmlFiles.length;

  let headerSlotCount = 0;
  let footerSlotCount = 0;
  let scriptRefCount = 0;
  const requiredMarkers = adoptionSpec.requiredMarkers || [];
  const headerMarker = requiredMarkers.find((m) => m.includes('site-header'));
  const footerMarker = requiredMarkers.find((m) => m.includes('site-footer'));
  const scriptFileMarker = canonicalFileBasenames[0];

  for (const htmlFile of htmlFiles) {
    let content;
    try {
      content = readFileSync(htmlFile, 'utf8');
    } catch {
      continue;
    }
    if (headerMarker && content.includes(headerMarker)) headerSlotCount += 1;
    if (footerMarker && content.includes(footerMarker)) footerSlotCount += 1;
    if (scriptFileMarker && content.includes(scriptFileMarker)) scriptRefCount += 1;
  }

  const pagesUsingChrome = Math.min(headerSlotCount, footerSlotCount, scriptRefCount);
  const wiringComplete = expectedPages > 0 && pagesUsingChrome === expectedPages;

  const evidence = {
    scriptFound,
    headerSlotFound: headerSlotCount > 0,
    footerSlotFound: footerSlotCount > 0,
    scriptRefFound: scriptRefCount > 0,
    htmlDiscovered,
    excludedPages,
    expectedPages,
    pagesUsingChrome,
    canonicalComparison: adoptionSpec.canonicalComparisonAvailable ? 'checked' : 'not-yet-provable',
  };

  if (!scriptFound && headerSlotCount === 0 && footerSlotCount === 0) {
    return { adoption: 'MISSING', evidence };
  }

  if (!adoptionSpec.canonicalComparisonAvailable || !adoptionSpec.canonicalSourceDir) {
    // Canonical比較の材料（正本ディレクトリ）が無い間は、配線100%であっても
    // CURRENT/DRIFTEDへ寄せずUNKNOWNに倒す（GPT指摘の判定原則を厳守）。
    return { adoption: 'UNKNOWN', evidence };
  }

  const digestComparison = {};
  let allMatch = true;
  for (const name of canonicalFileBasenames) {
    const canonicalPath = join(adoptionSpec.canonicalSourceDir, name);
    const consumerPath = files.find((f) => basename(f) === name);
    if (!existsSync(canonicalPath) || !consumerPath) {
      digestComparison[name] = 'missing';
      allMatch = false;
      continue;
    }
    const canonicalDigestValue = canonicalDigest(readFileSync(canonicalPath, 'utf8'));
    const consumerDigestValue = canonicalDigest(readFileSync(consumerPath, 'utf8'));
    const match = canonicalDigestValue === consumerDigestValue;
    digestComparison[name] = match ? 'match' : 'mismatch';
    if (!match) allMatch = false;
  }
  evidence.digestComparison = digestComparison;

  if (!wiringComplete) {
    // 配線が完全でない場合、Core一致有無に関わらずCURRENTとは言えない。
    // ただしCanonical比較自体はできているので、drift有無の情報はevidenceに残す。
    return { adoption: allMatch ? 'UNKNOWN' : 'DRIFTED', evidence };
  }

  return { adoption: allMatch ? 'CURRENT' : 'DRIFTED', evidence };
}

/** 自己診断: 毒フィクスチャで5ケースを再現できるか確認する。 */
export function runSelfTest() {
  const failures = [];
  const siteChromeMeta = {
    appliesTo: {
      requires: ['staticHtml.multiPage', 'staticHtml.buildless'],
      excludes: ['browserExtension.uiContext'],
    },
  };

  // ケース1: repo直下の静的HTML複数ページ → APPLIES
  {
    const dir = mkdtempSync(join(tmpdir(), 'component-rollout-test-'));
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    writeFileSync(join(dir, 'about.html'), '<html></html>');
    const facts = detectSiteFacts(dir);
    const state = evaluateApplicability(siteChromeMeta, facts);
    if (state !== 'APPLIES') failures.push(`ケース1期待APPLIES、実際${state}`);
    rmSync(dir, { recursive: true, force: true });
  }

  // ケース2: HTML1ページのみ → NOT_APPLICABLE
  {
    const dir = mkdtempSync(join(tmpdir(), 'component-rollout-test-'));
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    const facts = detectSiteFacts(dir);
    const state = evaluateApplicability(siteChromeMeta, facts);
    if (state !== 'NOT_APPLICABLE') failures.push(`ケース2期待NOT_APPLICABLE、実際${state}`);
    rmSync(dir, { recursive: true, force: true });
  }

  // ケース3: Next.js repo内のapps/lpだけが静的サイト → apps/lpだけAPPLIES、repo直下はNOT_APPLICABLE
  {
    const dir = mkdtempSync(join(tmpdir(), 'component-rollout-test-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }));
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'app', 'page.tsx'), 'export default function Page(){return null}');
    mkdirSync(join(dir, 'apps', 'lp'), { recursive: true });
    writeFileSync(join(dir, 'apps', 'lp', 'index.html'), '<html></html>');
    writeFileSync(join(dir, 'apps', 'lp', 'about.html'), '<html></html>');

    const targets = discoverSiteTargets(dir);
    const lpTarget = targets.find((t) => t.relativePath === 'apps/lp');
    if (!lpTarget) {
      failures.push('ケース3: apps/lpがsite targetとして発見されなかった');
    } else {
      const facts = detectSiteFacts(lpTarget.siteRoot);
      const state = evaluateApplicability(siteChromeMeta, facts);
      if (state !== 'APPLIES') failures.push(`ケース3期待APPLIES(apps/lp)、実際${state}`);
    }
    rmSync(dir, { recursive: true, force: true });
  }

  // ケース4: package.jsonが壊れていてbuild方式を確定できない → UNKNOWN
  {
    const dir = mkdtempSync(join(tmpdir(), 'component-rollout-test-'));
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    writeFileSync(join(dir, 'about.html'), '<html></html>');
    writeFileSync(join(dir, 'package.json'), '{ invalid json');
    const facts = detectSiteFacts(dir);
    const state = evaluateApplicability(siteChromeMeta, facts);
    if (state !== 'UNKNOWN') failures.push(`ケース4期待UNKNOWN、実際${state}`);
    rmSync(dir, { recursive: true, force: true });
  }

  // ケース5: component.jsonのrequired FACTがUNKNOWN（facts自体にキーが無い）→ UNKNOWN
  {
    const facts = { 'staticHtml.multiPage': true }; // staticHtml.buildlessが欠落
    const state = evaluateApplicability(siteChromeMeta, facts);
    if (state !== 'UNKNOWN') failures.push(`ケース5期待UNKNOWN、実際${state}`);
  }

  // ケース11: manifest.jsonのaction.default_popupが実際にpopup.htmlを参照 → NOT_APPLICABLE
  //   （2026-09-03、GPT相談: ファイル名ヒューリスティックではなくmanifest参照で判定する）
  {
    const dir = mkdtempSync(join(tmpdir(), 'component-rollout-test-'));
    writeFileSync(join(dir, 'popup.html'), '<html></html>');
    writeFileSync(join(dir, 'options.html'), '<html></html>');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
      manifest_version: 3,
      action: { default_popup: 'popup.html' },
      options_page: 'options.html',
    }));
    const facts = detectSiteFacts(dir);
    const state = evaluateApplicability(siteChromeMeta, facts);
    if (facts['browserExtension.uiContext'] !== true) failures.push(`ケース11期待uiContext=true、実際${facts['browserExtension.uiContext']}`);
    if (state !== 'NOT_APPLICABLE') failures.push(`ケース11期待NOT_APPLICABLE、実際${state}`);
    rmSync(dir, { recursive: true, force: true });
  }

  // ケース12: manifest.jsonは存在するが、対象HTMLをどのUIキーからも参照していない
  //   （例: 拡張repo内の別の公開マーケティングサイト）→ APPLIES（除外しない）
  {
    const dir = mkdtempSync(join(tmpdir(), 'component-rollout-test-'));
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    writeFileSync(join(dir, 'about.html'), '<html></html>');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
      manifest_version: 3,
      action: { default_popup: 'unrelated-popup.html' }, // 対象siteRoot内には存在しないファイル名
    }));
    const facts = detectSiteFacts(dir);
    const state = evaluateApplicability(siteChromeMeta, facts);
    if (facts['browserExtension.uiContext'] !== false) failures.push(`ケース12期待uiContext=false、実際${facts['browserExtension.uiContext']}`);
    if (state !== 'APPLIES') failures.push(`ケース12期待APPLIES、実際${state}`);
    rmSync(dir, { recursive: true, force: true });
  }

  // ケース13: CSPなし → present=false, ALLOW/ALLOW
  //   （2026-09-03、GPT相談: Delivery Preflight。soushin-suggest.link実applyで
  //   4ページがCSPで全ブロックされ、旧UI削除後に新UIも表示されない事故を実際に起こした）
  {
    const result = analyzeCspMetaTag('<html><head><title>x</title></head><body></body></html>');
    if (result.present !== false) failures.push(`ケース13期待present=false、実際${result.present}`);
    if (result.externalScript !== 'ALLOW') failures.push(`ケース13期待externalScript=ALLOW、実際${result.externalScript}`);
    if (result.externalStyle !== 'ALLOW') failures.push(`ケース13期待externalStyle=ALLOW、実際${result.externalStyle}`);
  }

  // ケース14: default-src 'none'のみ（script-src/style-src未定義）→ 両方BLOCK
  //   （実データ: soushin-suggest.link/public/features/index.htmlと同型。
  //   content属性値にシングルクォート'none'を含むため、クォート文字の後方参照一致が必須
  //   だったことを実データで発見・修正した）
  {
    const html = '<html><head><meta http-equiv="Content-Security-Policy"\n content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'self\' data:; base-uri \'none\'"></head><body></body></html>';
    const result = analyzeCspMetaTag(html);
    if (result.present !== true) failures.push(`ケース14期待present=true、実際${result.present}`);
    if (result.externalScript !== 'BLOCK') failures.push(`ケース14期待externalScript=BLOCK、実際${result.externalScript}`);
    if (result.externalStyle !== 'BLOCK') failures.push(`ケース14期待externalStyle=BLOCK、実際${result.externalStyle}`);
  }

  // ケース15: script-src 'self'; style-src 'self' 'unsafe-inline' → 両方ALLOW
  //   （GPT提案のCSP変更後の想定形）
  {
    const html = '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; base-uri \'none\'"></head><body></body></html>';
    const result = analyzeCspMetaTag(html);
    if (result.externalScript !== 'ALLOW') failures.push(`ケース15期待externalScript=ALLOW、実際${result.externalScript}`);
    if (result.externalStyle !== 'ALLOW') failures.push(`ケース15期待externalStyle=ALLOW、実際${result.externalStyle}`);
  }

  // ケース16: checkCspDeliveryPreflight — 1ページでもBLOCKがあれば全体BLOCKED、
  //   UNKNOWNをPASSへ丸めない
  {
    const pages = [
      { path: 'a.html', content: '<html></html>' }, // CSPなし→ALLOW
      { path: 'b.html', content: '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"></head></html>' }, // BLOCK
    ];
    const result = checkCspDeliveryPreflight(pages);
    if (result.verdict !== 'BLOCKED') failures.push(`ケース16期待verdict=BLOCKED、実際${result.verdict}`);
  }

  // ケース17: style-src-elem 'self'; style-src 'unsafe-inline' → style-src-elemが優先され
  //   ALLOW（2026-09-03、GPT指摘: style-src単体だけを見ると誤判定するCSP Level 3のケース）
  {
    const html = '<html><head><meta http-equiv="Content-Security-Policy" content="style-src-elem \'self\'; style-src \'unsafe-inline\'"></head></html>';
    const result = analyzeCspMetaTag(html);
    if (result.externalStyle !== 'ALLOW') failures.push(`ケース17期待externalStyle=ALLOW、実際${result.externalStyle}`);
  }

  // ケース18: Delivery Preflight v1.1 — meta CSP無し・hosting設定も無し → UNKNOWN
  //   （2026-09-03、GPT指摘: meta無しを無条件ALLOWにするとfalse READYになる。
  //   HTTPレスポンスヘッダー側CSPを確認できない場合はUNKNOWNへ倒す）
  {
    const dir = mkdtempSync(join(tmpdir(), 'component-rollout-hosting-'));
    const pages = [{ path: 'index.html', content: '<html></html>' }];
    const result = checkCspDeliveryPreflight(pages, { siteRootDir: dir, repoRootDir: dir });
    if (result.verdict !== 'UNKNOWN') failures.push(`ケース18期待verdict=UNKNOWN、実際${result.verdict}`);
    rmSync(dir, { recursive: true, force: true });
  }

  // ケース19: _headers（Cloudflare Pages形式）にContent-Security-Policy: default-src 'self'... →
  //   meta無し・hosting ALLOW → 全体ALLOW/READY
  {
    const dir = mkdtempSync(join(tmpdir(), 'component-rollout-hosting-'));
    writeFileSync(
      join(dir, '_headers'),
      '# comment\n/*\n  Content-Security-Policy: default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'\n'
    );
    const pages = [{ path: 'index.html', content: '<html></html>' }];
    const result = checkCspDeliveryPreflight(pages, { siteRootDir: dir, repoRootDir: dir });
    if (result.hosting.source !== '_headers') failures.push(`ケース19期待source=_headers、実際${result.hosting.source}`);
    if (result.verdict !== 'READY') failures.push(`ケース19期待verdict=READY、実際${result.verdict}`);
    rmSync(dir, { recursive: true, force: true });
  }

  // ケース20: vercel.json（Vercel形式）headers[].headers[]にCSP → 実データ形式(surechigai
  //   -romi.link-deploy-886aeffの実例)を模した構造。script-src 'self'を含むためALLOW
  {
    const dir = mkdtempSync(join(tmpdir(), 'component-rollout-hosting-'));
    writeFileSync(
      join(dir, 'vercel.json'),
      JSON.stringify({
        headers: [
          {
            source: '/(.*)',
            headers: [{ key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'" }],
          },
        ],
      })
    );
    const pages = [{ path: 'index.html', content: '<html></html>' }];
    const result = checkCspDeliveryPreflight(pages, { siteRootDir: dir, repoRootDir: dir });
    if (result.hosting.source !== 'vercel.json') failures.push(`ケース20期待source=vercel.json、実際${result.hosting.source}`);
    if (result.verdict !== 'READY') failures.push(`ケース20期待verdict=READY、実際${result.verdict}`);
    rmSync(dir, { recursive: true, force: true });
  }

  // ケース21: meta CSPはALLOW(default 'self'相当)だがhosting設定がBLOCK →
  //   両方を満たさないとREADYにしない。全体BLOCKED
  {
    const dir = mkdtempSync(join(tmpdir(), 'component-rollout-hosting-'));
    writeFileSync(join(dir, '_headers'), '/*\n  Content-Security-Policy: default-src \'none\'\n');
    const pages = [
      { path: 'index.html', content: '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"></head></html>' },
    ];
    const result = checkCspDeliveryPreflight(pages, { siteRootDir: dir, repoRootDir: dir });
    if (result.verdict !== 'BLOCKED') failures.push(`ケース21期待verdict=BLOCKED、実際${result.verdict}`);
    rmSync(dir, { recursive: true, force: true });
  }

  const adoptionMeta = {
    adoption: {
      requiredMarkers: ['site-chrome.js', 'id="site-header"', 'id="site-footer"'],
      canonicalFiles: ['site-chrome.js'],
      canonicalComparisonAvailable: false,
    },
  };

  // ケース6: site-chrome.js無し・スロットも無し → MISSING
  {
    const dir = mkdtempSync(join(tmpdir(), 'component-rollout-test-'));
    writeFileSync(join(dir, 'index.html'), '<html><body>no chrome here</body></html>');
    const { adoption } = detectAdoption(dir, adoptionMeta);
    if (adoption !== 'MISSING') failures.push(`ケース6期待MISSING、実際${adoption}`);
    rmSync(dir, { recursive: true, force: true });
  }

  // ケース7: site-chrome.js・スロット・script参照すべて揃っている → 配線ありだがCanonical比較不可のためUNKNOWN
  {
    const dir = mkdtempSync(join(tmpdir(), 'component-rollout-test-'));
    writeFileSync(join(dir, 'site-chrome.js'), '// stub');
    writeFileSync(
      join(dir, 'index.html'),
      '<html><body><div id="site-header"></div>x<div id="site-footer"></div><script src="site-chrome.js"></script></body></html>'
    );
    const { adoption, evidence } = detectAdoption(dir, adoptionMeta);
    if (adoption !== 'UNKNOWN') failures.push(`ケース7期待UNKNOWN、実際${adoption}`);
    if (evidence.canonicalComparison !== 'not-yet-provable') {
      failures.push(`ケース7期待canonicalComparison=not-yet-provable、実際${evidence.canonicalComparison}`);
    }
    if (!evidence.scriptFound || !evidence.headerSlotFound || !evidence.footerSlotFound) {
      failures.push('ケース7: evidenceのフラグが揃っていない');
    }
    rmSync(dir, { recursive: true, force: true });
  }

  // ケース8: pageExclusions(glob)で除外したページはhtmlDiscoveredには残り、
  //   expectedPagesからは消える。除外後の全ページが配線済みならUNKNOWN(配線100%、Canonical未証明)。
  {
    const dir = mkdtempSync(join(tmpdir(), 'component-rollout-test-'));
    writeFileSync(join(dir, 'site-chrome.js'), '// stub');
    writeFileSync(
      join(dir, 'index.html'),
      '<html><body><div id="site-header"></div>x<div id="site-footer"></div><script src="site-chrome.js"></script></body></html>'
    );
    mkdirSync(join(dir, 'captures', '_sources'), { recursive: true });
    writeFileSync(join(dir, 'captures', '_sources', 'shot1.html'), '<html><body>capture canvas</body></html>');
    writeFileSync(join(dir, 'captures', '_sources', 'shot2.html'), '<html><body>capture canvas</body></html>');

    const pageExclusions = [{ glob: 'captures/_sources/**' }];
    const { adoption, evidence } = detectAdoption(dir, adoptionMeta, pageExclusions);
    if (evidence.htmlDiscovered !== 3) failures.push(`ケース8期待htmlDiscovered=3、実際${evidence.htmlDiscovered}`);
    if (evidence.excludedPages !== 2) failures.push(`ケース8期待excludedPages=2、実際${evidence.excludedPages}`);
    if (evidence.expectedPages !== 1) failures.push(`ケース8期待expectedPages=1、実際${evidence.expectedPages}`);
    if (evidence.pagesUsingChrome !== 1) failures.push(`ケース8期待pagesUsingChrome=1、実際${evidence.pagesUsingChrome}`);
    if (adoption !== 'UNKNOWN') failures.push(`ケース8期待UNKNOWN、実際${adoption}`);
    rmSync(dir, { recursive: true, force: true });
  }

  // ケース9: canonicalComparisonAvailable=true・Core hash完全一致・配線100% → CURRENT
  {
    const canonicalDir = mkdtempSync(join(tmpdir(), 'component-rollout-canonical-'));
    writeFileSync(join(canonicalDir, 'site-chrome.js'), '// canonical core\r\nconsole.log(1);\n');

    const consumerDir = mkdtempSync(join(tmpdir(), 'component-rollout-consumer-'));
    // ★CRLFとLFが混在していても正規化後は同じ内容 → CURRENTになることを確認
    //   （Canonical digestのLF正規化を検証する主目的のケース）。
    writeFileSync(join(consumerDir, 'site-chrome.js'), '// canonical core\nconsole.log(1);\r\n');
    writeFileSync(
      join(consumerDir, 'index.html'),
      '<html><body><div id="site-header"></div>x<div id="site-footer"></div><script src="site-chrome.js"></script></body></html>'
    );

    const meta = {
      adoption: {
        requiredMarkers: ['site-chrome.js', 'id="site-header"', 'id="site-footer"'],
        canonicalFiles: ['site-chrome.js'],
        canonicalComparisonAvailable: true,
        canonicalSourceDir: canonicalDir,
      },
    };
    const { adoption, evidence } = detectAdoption(consumerDir, meta);
    if (adoption !== 'CURRENT') failures.push(`ケース9期待CURRENT、実際${adoption}（digest: ${JSON.stringify(evidence.digestComparison)}）`);
    rmSync(canonicalDir, { recursive: true, force: true });
    rmSync(consumerDir, { recursive: true, force: true });
  }

  // ケース10: Core hashが不一致（consumer側が無断で変更） → DRIFTED
  {
    const canonicalDir = mkdtempSync(join(tmpdir(), 'component-rollout-canonical-'));
    writeFileSync(join(canonicalDir, 'site-chrome.js'), '// canonical core\nconsole.log(1);\n');

    const consumerDir = mkdtempSync(join(tmpdir(), 'component-rollout-consumer-'));
    writeFileSync(join(consumerDir, 'site-chrome.js'), '// consumer edited this without going through config\nconsole.log(2);\n');
    writeFileSync(
      join(consumerDir, 'index.html'),
      '<html><body><div id="site-header"></div>x<div id="site-footer"></div><script src="site-chrome.js"></script></body></html>'
    );

    const meta = {
      adoption: {
        requiredMarkers: ['site-chrome.js', 'id="site-header"', 'id="site-footer"'],
        canonicalFiles: ['site-chrome.js'],
        canonicalComparisonAvailable: true,
        canonicalSourceDir: canonicalDir,
      },
    };
    const { adoption, evidence } = detectAdoption(consumerDir, meta);
    if (adoption !== 'DRIFTED') failures.push(`ケース10期待DRIFTED、実際${adoption}（digest: ${JSON.stringify(evidence.digestComparison)}）`);
    rmSync(canonicalDir, { recursive: true, force: true });
    rmSync(consumerDir, { recursive: true, force: true });
  }

  return failures;
}

if (process.argv[1] && basename(process.argv[1]) === basename(new URL(import.meta.url).pathname)) {
  if (process.argv.includes('--selftest')) {
    const failures = runSelfTest();
    if (failures.length > 0) {
      console.error(`[component-rollout] FAIL\n${failures.map((f) => `  - ${f}`).join('\n')}`);
      process.exit(1);
    }
    console.log('[component-rollout] OK selftest 21/21 passed');
    process.exit(0);
  }
}
