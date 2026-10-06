// @ts-check
/**
 * distinction-checks.mjs — lint-pre-submission CHECK 24〜30 の判定（純関数）。
 *
 * fs に触らない。入力は文字列/オブジェクト。lint 本体が読み込み・呼び出し・出力する。
 * 閾値は DESIGN-apple-4-3a-spam-response-2026-10-06.md §C1/C2 と .dispatch-T3.md の指定どおり。
 */

export const DISTINCTION_CODE_DIRS = Object.freeze([
  'app',
  'components',
  'lib',
  'modules',
  'hooks',
  'constants',
  'src',
]);
export const DISTINCTION_CODE_EXTS = Object.freeze(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
export const MARKETING_PATHS = Object.freeze(['/lp', '/landing', '/about', '/promo', '/marketing']);
export const LOGIN_FREE_RE = /(アカウント|登録|ログイン).{0,6}(不要|なし|いりません|必要ありません)/;

/**
 * ストア ID が「未設定」か。プレースホルダ（`<...>`）も空扱い（既存 CHECK 2 と同じ）。
 * @param {unknown} v
 */
export function isUnsetStoreId(v) {
  if (v == null) return true;
  const s = String(v).trim();
  return s === '' || s.startsWith('<');
}

/**
 * 全角半角を NFKC で揃え、空白を除く（CHECK 26 の部分一致用）。
 * @param {unknown} s
 */
export function normalizeForMatch(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '');
}

/** @param {unknown} text */
export function firstParagraph(text) {
  const n = String(text ?? '').replace(/\r\n/g, '\n');
  const parts = n.split(/\n[ \t]*\n/);
  return (parts[0] || '').trim();
}

/** @param {unknown} text */
export function firstSentence(text) {
  const n = String(text ?? '').replace(/\r\n/g, '\n').trimStart();
  const cut = n.search(/。|\n/);
  if (cut === -1) return n.trim();
  if (n[cut] === '。') return n.slice(0, cut + 1).trim();
  return n.slice(0, cut).trim();
}

/**
 * @param {unknown} v
 * @param {string[]} [out]
 * @returns {string[]}
 */
export function collectStrings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) {
    for (const x of v) collectStrings(x, out);
  } else if (v && typeof v === 'object') {
    for (const x of Object.values(v)) collectStrings(x, out);
  }
  return out;
}

function result(status, name, detail, guideline) {
  const r = { status, name, detail };
  if (guideline) r.guideline = guideline;
  return r;
}

function depsOf(pkg) {
  return { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
}

function hasDistinction(distinction) {
  return distinction != null && typeof distinction === 'object';
}

/**
 * @param {{ ascAppId?: unknown, distinction?: unknown }} input
 */
export function checkDistinctionPresent({ ascAppId, distinction } = {}) {
  const name = 'distinction-present';
  if (isUnsetStoreId(ascAppId)) {
    return result('skip', name, 'stores.ascAppId が空（App Store に出さない）');
  }
  if (!hasDistinction(distinction)) {
    return result(
      'fail',
      name,
      'stores.ascAppId があるのに distinction が無い。App Store に出すアプリは区別軸を宣言すること',
      '4.3(a)',
    );
  }
  return result('ok', name, 'distinction あり');
}

/**
 * @param {{
 *   distinction?: { oneLiner?: string, coreFeatures?: string[] } | null,
 *   descriptionFiles?: { name: string, text: string }[] | null,
 *   releaseNotesJa?: string | null,
 * }} input
 */
export function checkDistinctionMatchesDescription({
  distinction,
  descriptionFiles = null,
  releaseNotesJa = null,
} = {}) {
  const name = 'distinction-matches-description';
  if (!hasDistinction(distinction)) {
    return result('skip', name, 'distinction が無い');
  }
  const oneLiner = String(distinction?.oneLiner ?? '');
  const files = Array.isArray(descriptionFiles) ? descriptionFiles : [];
  if (files.length === 0) {
    return result(
      'fail',
      name,
      'store-assets/appstore/description-*.txt が1つも無い（検査できないものは通さない）',
      '4.3(a)',
    );
  }
  const misses = [];
  for (const f of files) {
    const para = firstParagraph(f?.text);
    if (!oneLiner || !para.includes(oneLiner)) {
      misses.push(f?.name || '(unnamed)');
    }
  }
  if (misses.length > 0) {
    return result(
      'fail',
      name,
      `説明文の先頭段落に distinction.oneLiner が完全一致で含まれない: ${misses.join(', ')}`,
      '4.3(a)',
    );
  }

  const out = [result('ok', name, `${files.length}件の説明文先頭段落に oneLiner あり`)];
  if (releaseNotesJa != null && String(releaseNotesJa).length > 0) {
    const sentence = firstSentence(releaseNotesJa);
    const features = Array.isArray(distinction?.coreFeatures) ? distinction.coreFeatures : [];
    const hasOne = Boolean(oneLiner) && sentence.includes(oneLiner);
    const hasFeature = features.some((w) => w && sentence.includes(String(w)));
    if (!hasOne && !hasFeature) {
      out.push(
        result(
          'warn',
          'distinction-matches-release-notes',
          'release-notes/CURRENT-ja.txt の先頭1文が oneLiner も coreFeatures の語も含まない',
          '4.3(a)',
        ),
      );
    } else {
      out.push(result('ok', 'distinction-matches-release-notes', 'リリースノート先頭文が区別軸を含む'));
    }
  }
  return out;
}

/**
 * @param {{ distinction?: { coreFeatures?: string[] } | null, screenshotPlan?: object | null }} input
 */
export function checkDistinctionMatchesScreenshots({ distinction, screenshotPlan = null } = {}) {
  const name = 'distinction-matches-screenshots';
  if (!hasDistinction(distinction)) {
    return result('skip', name, 'distinction が無い');
  }
  if (screenshotPlan == null) {
    return result('skip', name, 'store-assets/screenshot-plan.json が無い');
  }
  const captions =
    screenshotPlan.framedCaptions && typeof screenshotPlan.framedCaptions === 'object'
      ? screenshotPlan.framedCaptions
      : {};
  const captionText = normalizeForMatch(collectStrings(captions).join('\n'));
  const features = Array.isArray(distinction?.coreFeatures) ? distinction.coreFeatures : [];
  const hits = features.filter((w) => {
    const n = normalizeForMatch(w);
    return n.length > 0 && captionText.includes(n);
  });
  const out = [];
  if (hits.length < 2) {
    out.push(
      result(
        'fail',
        name,
        `framedCaptions 全体で coreFeatures の語が ${hits.length} 件（2件以上必要）`,
        '4.3(a)',
      ),
    );
  } else {
    out.push(result('ok', name, `framedCaptions に coreFeatures が ${hits.length} 件出現`));
  }

  const slots = new Set();
  for (const row of [...(screenshotPlan.publicPages || []), ...(screenshotPlan.authTabs || [])]) {
    if (row && row.slot != null && row.slot !== '') slots.add(String(row.slot));
  }
  const keys = new Set(Object.keys(captions));
  const missingInCaptions = [...slots].filter((s) => !keys.has(s));
  const extraInCaptions = [...keys].filter((k) => !slots.has(k));
  if (missingInCaptions.length > 0 || extraInCaptions.length > 0) {
    const bits = [];
    if (missingInCaptions.length) bits.push(`キャプション欠落 slot=${missingInCaptions.join(',')}`);
    if (extraInCaptions.length) bits.push(`計画に無いキー=${extraInCaptions.join(',')}`);
    out.push(result('fail', 'screenshot-caption-slots', bits.join(' / '), '4.3(a)'));
  } else {
    out.push(result('ok', 'screenshot-caption-slots', `framedCaptions キー ${keys.size} 件が slot と一致`));
  }
  return out;
}

/**
 * 文字列リテラルの範囲（コメントを除く）。blankOutComments と同じ引用符ルール。
 * @param {string} text
 * @returns {{ start: number, end: number }[]}
 */
export function stringLiteralRanges(text) {
  const s = String(text || '');
  const ranges = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const next = s[i + 1];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      const start = i;
      i++;
      while (i < s.length) {
        if (s[i] === '\\') {
          i += 2;
          continue;
        }
        if (s[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      ranges.push({ start, end: i });
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    i++;
  }
  return ranges;
}

function lineAt(text, index) {
  return String(text || '').slice(0, index).split('\n').length;
}

function findIndexes(hay, needle) {
  const out = [];
  if (!needle) return out;
  let i = 0;
  while (i <= hay.length - needle.length) {
    const j = hay.indexOf(needle, i);
    if (j < 0) break;
    out.push(j);
    i = j + needle.length;
  }
  return out;
}

function isBlankedRange(blanked, start, len) {
  const slice = blanked.slice(start, start + len);
  if (slice.length !== len) return false;
  for (const ch of slice) {
    if (ch !== ' ' && ch !== '\n' && ch !== '\r') return false;
  }
  return len > 0;
}

function inAnyRange(ranges, index) {
  for (const r of ranges) {
    if (index >= r.start && index < r.end) return true;
  }
  return false;
}

/**
 * 2文字以下は誤検知するので比較対象にしない（コードポイント単位）。
 * @param {string} term
 */
export function isShortSiblingTerm(term) {
  return [...String(term || '')].length <= 2;
}

/**
 * @param {{
 *   distinction?: { allowedSiblingMentions?: string[] } | null,
 *   teamApps?: { displayName?: string, shortName?: string, productionDomain?: string, bundleId?: string }[] | null,
 *   bundleId?: string | null,
 *   files?: { path: string, text: string }[],
 *   blankOutComments: (text: string) => string,
 * }} input
 */
export function checkNoSiblingNamesInCode({
  distinction,
  teamApps = null,
  bundleId = null,
  files = [],
  blankOutComments,
} = {}) {
  const name = 'no-sibling-names-in-code';
  if (!hasDistinction(distinction)) {
    return result('skip', name, 'distinction が無い');
  }
  if (typeof blankOutComments !== 'function') {
    return result('fail', name, 'blankOutComments が渡されていない（測れない）', '4.3(a)');
  }
  if (teamApps == null) {
    return result(
      'fail',
      name,
      '測れない。`asc-list-team-apps.mjs` で生成してください',
      '4.3(a)',
    );
  }
  if (!Array.isArray(teamApps)) {
    return result('fail', name, 'store-assets/team-apps.json が配列ではない', '4.3(a)');
  }
  const allowed = new Set(
    (Array.isArray(distinction?.allowedSiblingMentions) ? distinction.allowedSiblingMentions : []).map(
      String,
    ),
  );
  const terms = [];
  for (const app of teamApps) {
    if (!app) continue;
    if (bundleId && app.bundleId && String(app.bundleId) === String(bundleId)) continue;
    for (const key of ['displayName', 'shortName', 'productionDomain']) {
      const t = app[key];
      if (typeof t !== 'string') continue;
      if (isShortSiblingTerm(t)) continue;
      if (allowed.has(t)) continue;
      if (!terms.includes(t)) terms.push(t);
    }
  }
  if (terms.length === 0) {
    return result('ok', name, '比較対象の姉妹アプリ名義が無い');
  }

  const stringHits = [];
  const commentHits = [];
  for (const f of Array.isArray(files) ? files : []) {
    const text = String(f?.text ?? '');
    const rel = f?.path || '(unknown)';
    const blanked = blankOutComments(text);
    const strRanges = stringLiteralRanges(text);
    for (const term of terms) {
      for (const idx of findIndexes(text, term)) {
        const loc = `${rel}:${lineAt(text, idx)}`;
        if (isBlankedRange(blanked, idx, term.length)) {
          commentHits.push(`${loc} "${term}"`);
        } else if (inAnyRange(strRanges, idx)) {
          stringHits.push(`${loc} "${term}"`);
        }
      }
    }
  }

  const out = [];
  if (stringHits.length > 0) {
    out.push(
      result(
        'fail',
        name,
        `姉妹アプリ名義が文字列リテラル中にある: ${stringHits.slice(0, 10).join(', ')}${
          stringHits.length > 10 ? ` ほか${stringHits.length - 10}件` : ''
        }`,
        '4.3(a)',
      ),
    );
  } else {
    out.push(result('ok', name, `姉妹アプリ名義の文字列リテラル 0件（比較 ${terms.length} 語）`));
  }
  if (commentHits.length > 0) {
    out.push(
      result(
        'warn',
        'no-sibling-names-in-comments',
        `コメント中に姉妹アプリ名義: ${commentHits.slice(0, 10).join(', ')}${
          commentHits.length > 10 ? ` ほか${commentHits.length - 10}件` : ''
        }`,
        '4.3(a)',
      ),
    );
  }
  return out;
}

/**
 * @param {string} rawPath
 * @returns {'root' | 'marketing' | null}
 */
export function classifyPublicPath(rawPath) {
  let p = String(rawPath ?? '');
  if (!p) return null;
  if (!p.startsWith('/')) p = `/${p}`;
  const trimmed = p.replace(/\/+$/, '') || '/';
  if (trimmed === '/') return 'root';
  for (const b of MARKETING_PATHS) {
    if (trimmed === b || trimmed.startsWith(`${b}/`)) return 'marketing';
  }
  return null;
}

/**
 * @param {{ screenshotPlan?: { publicPages?: { path?: string }[] } | null }} input
 */
export function checkNoMarketingPageScreenshot({ screenshotPlan = null } = {}) {
  const name = 'no-marketing-page-screenshot';
  if (screenshotPlan == null) {
    return result('skip', name, 'store-assets/screenshot-plan.json が無い');
  }
  const pages = Array.isArray(screenshotPlan.publicPages) ? screenshotPlan.publicPages : [];
  const marketing = [];
  let root = false;
  for (const page of pages) {
    const kind = classifyPublicPath(page?.path);
    if (kind === 'marketing') marketing.push(page.path);
    else if (kind === 'root') root = true;
  }
  if (marketing.length > 0) {
    return result(
      'fail',
      name,
      `publicPages[].path がマーケ系（使用中の画面でない）: ${marketing.join(', ')}`,
      '2.3.3',
    );
  }
  if (root) {
    return result(
      'warn',
      name,
      'publicPages[].path が "/" ちょうど。LP ではなく使用中画面か確認すること',
      '2.3.3',
    );
  }
  return result('ok', name, 'publicPages にマーケ系 path なし');
}

/**
 * @param {{
 *   hasAppConfigTs?: boolean,
 *   hasCapacitorConfig?: boolean,
 *   packageJson?: { dependencies?: object, devDependencies?: object } | null,
 * }} input
 */
export function checkNoStaleCapacitorConfig({
  hasAppConfigTs = false,
  hasCapacitorConfig = false,
  packageJson = null,
} = {}) {
  const name = 'no-stale-capacitor-config';
  const deps = depsOf(packageJson);
  const hasExpoDep = Object.prototype.hasOwnProperty.call(deps, 'expo');
  const isExpo = Boolean(hasAppConfigTs) || hasExpoDep;
  if (!isExpo) {
    return result('skip', name, 'Expo prebuild アプリではない');
  }
  const hasCapCore = Object.prototype.hasOwnProperty.call(deps, '@capacitor/core');
  if (hasCapacitorConfig && !hasCapCore) {
    return result(
      'fail',
      name,
      'Expo prebuild なのに capacitor.config.(json|ts) が残骸として残っている（@capacitor/core 依存なし）。CHECK 2/9/18 が無関係な判定をする',
      'process',
    );
  }
  if (!hasCapacitorConfig) {
    return result('ok', name, 'capacitor.config 残骸なし');
  }
  return result('ok', name, '@capacitor/core があるので capacitor.config は残骸ではない');
}

function hasIapDependency(packageJson) {
  const deps = depsOf(packageJson);
  return Object.keys(deps).some(
    (k) => k === 'react-native-purchases' || k.startsWith('@revenuecat/'),
  );
}

/**
 * @param {{ hasInAppPurchase?: unknown, packageJson?: object | null }} input
 */
export function checkConfigMatchesIap({ hasInAppPurchase, packageJson = null } = {}) {
  const name = 'config-matches-iap';
  if (hasInAppPurchase !== false) {
    return result('skip', name, 'businessModel.hasInAppPurchase が false ではない');
  }
  if (hasIapDependency(packageJson)) {
    return result(
      'fail',
      name,
      'hasInAppPurchase=false なのに react-native-purchases / @revenuecat/* が package.json にある',
      'meta',
    );
  }
  return result('ok', name, 'IAP 依存と hasInAppPurchase=false が矛盾しない');
}

/**
 * @param {{ loginRequired?: unknown, summaryJa?: unknown }} input
 */
export function checkConfigMatchesLoginCopy({ loginRequired, summaryJa } = {}) {
  const name = 'config-matches-login-copy';
  if (loginRequired !== true) {
    return result('skip', name, 'auth.loginRequired が true ではない');
  }
  const text = String(summaryJa ?? '');
  if (LOGIN_FREE_RE.test(text)) {
    return result(
      'warn',
      name,
      'auth.loginRequired=true なのに businessModel.summaryJa が「登録不要」系の文言',
      'meta',
    );
  }
  return result('ok', name, 'loginRequired と summaryJa が矛盾しない');
}

/**
 * @param {{ siwaEnabled?: unknown, thirdPartyProvidersOnIos?: unknown }} input
 */
export function checkConfigMatchesSiwa({ siwaEnabled, thirdPartyProvidersOnIos } = {}) {
  const name = 'config-matches-siwa';
  if (siwaEnabled !== false) {
    return result('skip', name, 'auth.siwaEnabled が false ではない');
  }
  const providers = Array.isArray(thirdPartyProvidersOnIos) ? thirdPartyProvidersOnIos : [];
  if (providers.length === 0) {
    return result('skip', name, 'thirdPartyProvidersOnIos が空');
  }
  const hasApple = providers.map(String).includes('apple');
  if (!hasApple) {
    return result(
      'fail',
      name,
      "siwaEnabled=false なのに thirdPartyProvidersOnIos が空でなく 'apple' を含まない（4.8）",
      '4.8',
    );
  }
  return result('ok', name, 'thirdPartyProvidersOnIos に apple がある');
}

/**
 * @param {{ playAppId?: unknown, playStatus?: number | null, controlStatus?: number | null }} input
 */
export function checkConfigMatchesPlayListing({
  playAppId,
  playStatus = null,
  controlStatus = null,
} = {}) {
  const name = 'config-matches-play-listing';
  if (!isUnsetStoreId(playAppId)) {
    return result('skip', name, 'stores.playAppId がある（空のときだけ公開ページと突き合わせる）');
  }
  if (playStatus == null || controlStatus == null) {
    return result('skip', name, 'LINT_NETWORK=1 のときだけ実行');
  }
  if (controlStatus !== 404) {
    return result(
      'skip',
      name,
      `対照 id com.kimito.link.notexist999 が 404 でない（${controlStatus}）。判定しない`,
    );
  }
  if (playStatus === 200) {
    return result(
      'fail',
      name,
      'stores.playAppId が空/null なのに Play 公開ページが HTTP 200',
      'meta',
    );
  }
  return result('ok', name, `Play 公開ページは HTTP ${playStatus}（playAppId 空と一致）`);
}

/**
 * @param {{ iosPublished?: unknown, resultCount?: number | null }} input
 */
export function checkConfigMatchesIosPublished({ iosPublished, resultCount = null } = {}) {
  const name = 'config-matches-ios-published';
  if (resultCount == null) {
    return result('skip', name, 'LINT_NETWORK=1 のときだけ実行');
  }
  const declared = iosPublished === true;
  const live = Number(resultCount) > 0;
  if (declared !== live) {
    return result(
      'fail',
      name,
      `stores.iosPublished=${String(iosPublished)} なのに iTunes Lookup resultCount=${resultCount}`,
      'meta',
    );
  }
  return result('ok', name, `iosPublished=${declared} と resultCount=${resultCount} が一致`);
}
