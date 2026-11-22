// 役割: 「アプリがある Web サービスに、アプリ(App Store・Google Play)への導線があるか」を判定する純関数。
//   使う側: check-app-link.mjs(リポの中を見る・本番のページを見る)と lint-pre-submission の CHECK 37。
// なぜ要るか: りんくの指示(2026-11-22「web系のもので、アプリがあるものは必ずアプリへの導線を入れて欲しい」)。
//   調べたら、ストアに出ているアプリ12件のうち、Web のトップに自分のアプリへのリンクがあったのは3件だけだった。
//   Web に来た人をアプリに送れないと、アプリの入手単価(CPA)が上がり、通知・ホーム画面のアイコンで続く LTV も取りこぼす。
//   ルール本文: docs/ai-rules/15_APP_LINK_FROM_WEB.md
// 見るのは「自分のアプリの App Store / Google Play へのリンクがあるか」と「iPhone の Safari 用のバナー(apple-itunes-app)があるか」まで。
//   置き場所・文言・見た目の良し悪しは判定しない(金型 templates/web/ と KB _docs/web-to-app-install-best-practices.md)。
// fs・ネットワークに触らない。読み込みと取得は呼び出し側がする。

export const RULE_DOC = 'docs/ai-rules/15_APP_LINK_FROM_WEB.md';
export const TEMPLATE_DIR = 'templates/web/';

const IOS_LINK = /(?:apps|itunes)\.apple\.com\/(?:[a-z]{2}\/)?app\/(?:[^/"'\s<>()\\]*\/)?id(\d{6,12})/g;
const PLAY_LINK = /play\.google\.com\/store\/apps\/details\?(?:[^"'\s<>]*?&(?:amp;)?)?id=([A-Za-z0-9_.]+)/g;
const BANNER_META = /apple-itunes-app[^>]*?app-id=(\d{6,12})/g; // <meta name="apple-itunes-app" content="app-id=...">
const BANNER_NEXT = /itunes\s*:\s*\{[^}]*?appId\s*:\s*['"`](\d{6,12})/g; // Next.js の metadata.itunes.appId

const all = (re, text) => [...String(text ?? '').matchAll(re)].map((m) => m[1]);

/**
 * 出来上がったページ(HTML)から、ストアへのリンクとバナーを拾う。
 * @param {string} html
 * @returns {{ iosIds: string[], playPackages: string[], bannerIds: string[] }}
 */
export function extractStoreLinks(html) {
  const uniq = (a) => [...new Set(a)];
  return {
    iosIds: uniq(all(IOS_LINK, html)),
    playPackages: uniq(all(PLAY_LINK, html)),
    bannerIds: uniq([...all(BANNER_META, html), ...all(BANNER_NEXT, html)]),
  };
}

/**
 * リポのソース(書きかけの JSX・テンプレート文字列を含む)に、自分のアプリへの導線があるかを見る。
 * `https://apps.apple.com/jp/app/id${ASC_ID}` のように組み立てる書き方も拾うため、
 * 「同じファイルにストアのドメインと自分の ID の両方がある」も見つかった扱いにする。
 * @param {{ path: string, text: string }[]} files
 * @param {{ ascAppId?: string|null, playPackageName?: string|null }} app
 * @returns {{ ios: string|null, play: string|null, banner: string|null }} 見つかったファイルのパス(無ければ null)
 */
export function findAppLinksInSources(files, { ascAppId, playPackageName }) {
  const out = { ios: null, play: null, banner: null };
  for (const { path, text } of files) {
    const t = String(text ?? '');
    const found = extractStoreLinks(t);
    if (ascAppId && !out.ios && (found.iosIds.includes(ascAppId) || (/(?:apps|itunes)\.apple\.com/.test(t) && t.includes(ascAppId)))) out.ios = path;
    if (playPackageName && !out.play && (found.playPackages.includes(playPackageName) || (t.includes('play.google.com') && t.includes(playPackageName)))) out.play = path;
    if (ascAppId && !out.banner && (found.bannerIds.includes(ascAppId) || (/apple-itunes-app|itunes\s*:/.test(t) && t.includes(ascAppId)))) out.banner = path;
  }
  return out;
}

/** app.config.json の stores から、導線の判定に使う ID を取り出す(プレースホルダ・空は null)。 */
export function storeIdsFromConfig(config) {
  const s = config?.stores ?? {};
  const asc = String(s.ascAppId ?? '').trim();
  const pkg = String(s.playPackageName ?? '').trim();
  return {
    ascAppId: /^\d{6,12}$/.test(asc) ? asc : null,
    playPackageName: /^[A-Za-z][\w]*(\.[A-Za-z_][\w]*)+$/.test(pkg) ? pkg : null,
  };
}

/**
 * 判定。live は「そのストアで公開中か」(true / false / null=分からない)。
 * - 公開中なのに導線が無い → fail
 * - 公開中か分からない(ネットに出られない等)のに導線が無い → warn
 * - まだ公開前 → そのストアは問わない(公開前のリンクは 404 になる)
 * - iPhone 版が公開中なのに Safari 用のバナーが無い → warn
 * @param {{
 *   label?: string,
 *   app: { ascAppId?: string|null, playPackageName?: string|null },
 *   live: { ios?: boolean|null, play?: boolean|null },
 *   found: { ios: boolean, play: boolean, banner?: boolean },
 *   hasWeb?: boolean,
 * }} p
 * @returns {{ status: 'ok'|'warn'|'fail'|'skip', name: string, guideline: string, detail: string, missing: string[] }}
 */
export function checkAppLinks({ label = 'このサービス', app, live = {}, found, hasWeb = true }) {
  const base = { name: 'app-link', guideline: 'app-link-from-web', missing: [] };
  const how = `金型 ${TEMPLATE_DIR}(公式バッジ・端末で出し分け・Smart App Banner)で入れる。決まり: ${RULE_DOC}`;
  if (!app?.ascAppId && !app?.playPackageName) return { ...base, status: 'skip', detail: `${label}: アプリの ID が無い(アプリが無い・まだ作っていない)` };
  if (!hasWeb) return { ...base, status: 'skip', detail: `${label}: Web のページが無い(アプリだけのリポ)` };

  const stores = [
    { key: 'ios', has: !!app.ascAppId, live: live.ios, found: found.ios, name: `App Store(id${app.ascAppId})` },
    { key: 'play', has: !!app.playPackageName, live: live.play, found: found.play, name: `Google Play(${app.playPackageName})` },
  ].filter((s) => s.has);

  const fails = stores.filter((s) => s.live === true && !s.found).map((s) => s.name);
  const unknown = stores.filter((s) => (s.live === null || s.live === undefined) && !s.found).map((s) => s.name);
  const notYet = stores.filter((s) => s.live === false && !s.found).map((s) => s.name);
  const bannerMissing = app.ascAppId && live.ios === true && found.banner === false;

  if (fails.length) {
    return { ...base, status: 'fail', missing: fails, detail: `${label}: アプリが公開中なのに Web から ${fails.join('・')} への導線が無い。${how}` };
  }
  if (unknown.length) {
    return { ...base, status: 'warn', missing: unknown, detail: `${label}: ${unknown.join('・')} への導線が見つからない(公開中かは確かめられなかった)。公開中なら入れる。${how}` };
  }
  const okStores = stores.filter((s) => s.found).map((s) => s.name);
  const tail = notYet.length ? `(${notYet.join('・')} は公開前なので、公開したら入れる)` : '';
  if (bannerMissing) {
    return { ...base, status: 'warn', missing: ['apple-itunes-app'], detail: `${label}: ${okStores.join('・') || 'ストア'}への導線はあるが、iPhone の Safari 用バナー <meta name="apple-itunes-app" content="app-id=${app.ascAppId}"> が無い${tail}` };
  }
  if (!okStores.length) return { ...base, status: 'skip', detail: `${label}: どのストアもまだ公開前${tail}` };
  return { ...base, status: 'ok', detail: `${label}: ${okStores.join('・')} への導線あり${tail}` };
}
