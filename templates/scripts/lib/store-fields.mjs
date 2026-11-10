// 役割: ストアの入力欄の対応表（store-fields.json）を使う純関数。fs・ネットに触らない。
//   1. evaluateStoreFields … このアプリのリポで「埋まっていない欄」を数える（check-store-fields.mjs / lint CHECK 35）
//   2. extract* / diffKnown … 各ストアの公式の項目一覧から欄の名前を取り出し、表の known と比べる（watch-store-fields.mjs）
// なぜ要るか: 任意の欄（App Store の「ヘッダと検索結果」・iPhone Duo のスクショ・Play の動画・CWS のプロモーション タイル）は
//   無くても提出が通るので、言われるまで空のまま公開されていた（2026-10-18 malwarecheck、2026-11-09 動員ちゃれんじ）。
//   りんくの指示（2026-11-09）「必要な画像は入れてほしい。入力項目が増えたら言わなくても入れてほしい。CVR にも影響する」。
//   ⟹ 欄を全部表にし、空の欄を機械で数え、ストア側で欄が増えたら機械で気づく。
// ★見るのは「素材がリポにあるか」まで。ストアの画面に実際に上がっているか・中身が良いかは見ない（画面で確かめる）。

const IMAGE_OR_VIDEO = /\.(png|jpe?g|webp|mp4|mov|m4v)$/i;

// どのストアに出すアプリか。env STORE_TARGETS（カンマ区切り: appstore,play,cws）があればそれを優先する。
export function detectStoreTargets({ config = {}, envTargets = '', hasPath = () => false } = {}) {
  const fromEnv = String(envTargets || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (fromEnv.length) return fromEnv;
  const t = [];
  const set = (v) => typeof v === 'string' && v.trim() && !/^(TODO|TBD|<.*>|xxx)/i.test(v.trim());
  if (set(config?.stores?.ascAppId) || hasPath('ios')) t.push('appstore');
  if (set(config?.stores?.playAppId) || set(config?.stores?.playPackageName) || hasPath('android')) t.push('play');
  if (hasPath('manifest.json') || hasPath('extension/manifest.json')) t.push('cws');
  return t;
}

function getPath(obj, key) {
  return String(key).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// 1欄が埋まっているか。has: { files:[...] } | { dirs:[...], min } | { config:'a.b' | ['a.b','c.d'] }
// io: { fileNonEmpty(rel)->bool, listDir(rel)->string[]|null }
export function isFieldFilled(field, { config = {}, io }) {
  const has = field.has || {};
  if (has.config) {
    // 配列なら「どれか1つが入っていればよい」（提出スクリプトが本番URLで代用する欄など）
    return [].concat(has.config).some((key) => {
      const v = getPath(config, key);
      return typeof v === 'string' ? v.trim() !== '' && !/^(TODO|TBD|<.*>)/i.test(v.trim()) : v != null;
    });
  }
  if (has.files) return has.files.some((f) => io.fileNonEmpty(f));
  if (has.dirs) {
    const min = has.min ?? 1;
    return has.dirs.some((d) => (io.listDir(d) || []).filter((n) => IMAGE_OR_VIDEO.test(n)).length >= min);
  }
  return false;
}

// 返り値: [{ store, storeLabel, id, label, level, fill, make, note, when, filled }]
export function evaluateStoreFields(inventory, { targets = [], config = {}, io }) {
  const rows = [];
  for (const store of targets) {
    const s = inventory?.stores?.[store];
    if (!s) continue;
    for (const f of s.fields) {
      rows.push({ store, storeLabel: s.label, ...pick(f), filled: isFieldFilled(f, { config, io }) });
    }
  }
  return rows;
}

function pick(f) {
  const { id, label, level, fill, make, note, when } = f;
  return { id, label, level, fill, make, note, when };
}

// ---------------------------------------------------------------------------
// ストア側の「欄の一覧」を取り出す
// ---------------------------------------------------------------------------

const uniqSorted = (xs) => [...new Set(xs.filter(Boolean))].sort();

// 商品ページの見え方に関わる ASC の資源の名前（Response/Request 等の付属型は除く）。
// ★名前に Header / Creative / SearchResult / ProductPage が入る新しい資源が足されたら、ここで拾える。
const ASC_PRODUCT_PAGE = /^(App(Event|Preview|Screenshot|CustomProductPage|ClipHeaderImage|StoreVersionExperiment)|.*(Header|Creative|SearchResult|ProductPage))/;
const ASC_AUX_SUFFIX = /(Response|Request|InlineCreate|Relationship|LinkageResponse|Attributes|Query|WithoutIncludes)$|Linkages|^Http/;

export function extractAscOpenApi(spec) {
  const s = spec?.components?.schemas || {};
  const attrs = (name) => Object.keys(s[name]?.properties?.attributes?.properties || {});
  return {
    AppStoreVersionLocalization: uniqSorted(attrs('AppStoreVersionLocalization')),
    AppInfoLocalization: uniqSorted(attrs('AppInfoLocalization')),
    ScreenshotDisplayType: uniqSorted(s.ScreenshotDisplayType?.enum || []),
    PreviewType: uniqSorted(s.PreviewType?.enum || []),
    productPageSchemas: uniqSorted(Object.keys(s).filter((k) => ASC_PRODUCT_PAGE.test(k) && !ASC_AUX_SUFFIX.test(k))),
  };
}

export function extractPlayDiscovery(doc) {
  const s = doc?.schemas || {};
  const imageType = doc?.resources?.edits?.resources?.images?.methods?.upload?.parameters?.imageType?.enum || [];
  return {
    Listing: uniqSorted(Object.keys(s.Listing?.properties || {})),
    AppDetails: uniqSorted(Object.keys(s.AppDetails?.properties || {})),
    imageType: uniqSorted(imageType),
  };
}

function decodeEntities(t) {
  return t
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

// 仕様ページの「見出し・表の見出し・太字・短い HTML コメント」を欄の名前として取り出す。
// ★Apple の端末一覧は <!-- iPhone Duo --> のような HTML コメントで区切られているので、コメントも拾う（2026-11-09 実測）。
export function extractPageLabels(html, { start = '', end = '' } = {}) {
  let t = String(html || '');
  const i = start ? t.indexOf(start) : -1;
  if (i >= 0) {
    const j = end ? t.indexOf(end, i) : -1;
    t = t.slice(i, j > i ? j : undefined);
  }
  const out = [];
  const clean = (x) => decodeEntities(x.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().replace(/:$/, '').trim();
  for (const m of t.matchAll(/<(h[2-4]|th|strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi)) out.push(clean(m[2]));
  for (const m of t.matchAll(/<!--([\s\S]*?)-->/g)) {
    const c = clean(m[1]);
    if (c.length <= 60 && !/[{}<>=;]/.test(c)) out.push(c);
  }
  // 文の切れ端（「after」「least 1」のような小文字だけの語）は欄の名前ではないので落とす（iPhone のような語は残る）。
  return uniqSorted(out.filter((x) => x.length >= 2 && x.length <= 80 && !/^[a-z]+( \d+)?$/.test(x)));
}

// known と current を比べる。返り値: { added:{key:[...]}, removed:{key:[...]}, changed:bool }
export function diffKnown(known = {}, current = {}) {
  const added = {};
  const removed = {};
  for (const key of uniqSorted([...Object.keys(known), ...Object.keys(current)])) {
    const k = new Set(known[key] || []);
    const c = new Set(current[key] || []);
    const a = [...c].filter((x) => !k.has(x));
    const r = [...k].filter((x) => !c.has(x));
    if (a.length) added[key] = a;
    if (r.length) removed[key] = r;
  }
  return { added, removed, changed: Object.keys(added).length + Object.keys(removed).length > 0 };
}
