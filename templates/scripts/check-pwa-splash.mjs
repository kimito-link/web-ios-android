#!/usr/bin/env node
/**
 * scripts/check-pwa-splash.mjs
 *
 * ★「ホーム画面に追加」した PWA の**起動画面**を検査する（App Store 版ではない方）。
 *
 * ■ なぜ必要か（2026-08-27 実機動画で実測）
 *   kimito.link のオーナーが「起動画面がいつも上手くいかない」と実機動画を提出。
 *   ホーム画面アイコンをタップすると★**真っ白い画面に小さいグレーのスピナー**が出て、
 *   マスコットの青いスプラッシュが出ていなかった。
 *
 *   ところがサーバー側を実測したら**全部正しかった**:
 *     - manifest に background_color 無し（意図どおり）
 *     - apple-touch-startup-image が 10 解像度すべて配信中（HTTP 200）
 *     - 画像の実物も 1290x2796 / 地色 #00427B / マスコット3人が描かれている
 *   ＝ 材料は揃っているのに iOS が使っていない、という状態だった。
 *
 *   ★そして決定的だったのは「既存のスプラッシュ検査4本が、どれも
 *     この不具合を検出できなかった」こと。既存はすべて
 *     **Capacitor ネイティブ（App Store 版）**向けで、
 *     PWA の起動画面を見る検査は**1本も存在しなかった**。
 *     オーナーが実際に困っているのはこちらだったのに。
 *
 * ■ ★background_color の扱い（2026-10-05 に判定を反転した）
 *   【旧ルール】「manifest に background_color があると iOS 16.4+ が
 *   apple-touch-startup-image を無視する」として、background_color が**無いこと**を
 *   合格条件にしていた（kimito.link の実機観察1件 2026-07-31、surechigai の 78bad1380 =
 *   2026-08-27 で manifest から削除）。
 *   【2026-10-05 の調査】この説には Apple/WebKit の公式記述という一次情報が無く、
 *   リポ内の根拠も kimito.link の実機観察1件（OS 版の記載なし）と静的検査だけだった。
 *   さらに同日の iPhone 実機録画では、background_color を外した状態でも起動の最初が
 *   黒で起動画像は出なかった。＝ この説では現実を説明できない。
 *   一方 Android(Chrome の WebAPK) は name + background_color + icons から OS の起動画面を
 *   生成する（web.dev）。background_color が無いと白になり、アプリ側のベール/本体の地色との
 *   間で色が飛ぶ（surechigai の Android 実機録画で確認）。
 *   【新ルール】「地色1色をそろえる」。manifest.background_color ＝ 起動画像の地色 ＝
 *   アプリ本体の地色（自作ベールがあればその色）。この検査は、background_color が**あり**、
 *   かつ --expect-bg（＝アプリ本体の地色）と一致することを見る。
 *   （iOS で起動画像が出ない原因は未確定。候補は「ホーム画面追加時に画像が固定される」
 *   「href の ?v=」「iOS 26 の挙動」）
 *   設計記録: _docs/DESIGN-pwa-launch-screen-2026-10-05.md
 *
 * ■ ★この検査が守ること
 *   1. manifest に background_color が**あり**、--expect-bg と一致する
 *      （無い/違う色だと、Android の起動画面と本体・ベールの間で色が飛ぶ）。
 *      ★--expect-bg が渡されていないときは、この項目は「測れなかった(inconclusive)」にする
 *        （緑にしない。アプリ本体の地色は検査側が知り得ないので、呼び出し側が渡す）
 *   2. apple-touch-startup-image が**1つ以上**宣言されている
 *   3. 宣言された画像が**実在して開ける**（HTTP 200 / ローカルならファイルがある）
 *   4. その画像の**地色が --expect-bg と一致**する（＝manifest・本体との食い違いを防ぐ）
 *   5. その画像が★**単色ではない**（＝ロゴ/マスコットが実際に描かれている）
 *      ★「地色が正しい真っ青な画像」でも合格してしまう穴を塞ぐため。
 *      ★判定は「中央 60%×60% の矩形を全画素数え、地色と各チャンネル差 >16 の画素が
 *        0.5% 以上あるか」。2026-10-05 までは中央1点(4x4px)だけを見ていたため、
 *        文字ロゴ（ワードマーク）の文字間の隙間が中央に当たると「単色」と誤判定した
 *        （kimito.link の apple-splash-750x1334.png: 中央は白だが中央矩形に非白画素 5.4%）。
 *   6. manifest が HTML に宣言され、配信されている（200 かつ JSON として読める）
 *   7. manifest の theme_color と HTML の <meta name="theme-color"> が同じ値
 *   8. 起動画像の href に「?」（クエリ）が無い（固定名＋クエリは CDN に旧版が残る罠。
 *      内容ハッシュ入りのファイル名にする。参照: surechigai docs/symptoms.md SG-02）
 *   9. manifest.icons に 192 と 512 の PNG があり、--url 指定時は実際に配信されている
 *
 * ■ ★見ないこと（限界。過信を防ぐ）
 *   - ★**実機で本当に出るかは判定できない。** iOS は追加済み PWA の manifest を
 *     強くキャッシュするため、サーバーが正しくても**古いアイコンは直らない**。
 *     直すにはアイコンを削除 → Safari から再度「ホーム画面に追加」が要る。
 *     ＝ この検査が緑でも、手元のアイコンが白いままなことはあり得る。
 *   - Android(TWA) の起動画面は見ない（twa-manifest.json 側の担当）。
 *   - Capacitor ネイティブ版の起動画面も見ない（check-splash-config.mjs 等の担当）。
 *   - media クエリが手元の端末に一致するかは見ない（解像度の網羅性は別問題）。
 *   - theme_color / background_color の「色そのものが適切か」は見ない（一致だけを見る）。
 *   - アイコン画像の絵柄・実寸・maskable の安全領域は見ない（192/512 の宣言と配信だけ）。
 *   - href にクエリが無くても、CDN が古い画像を返していないかは見ない（名前の形だけ）。
 *   - ロゴ/マスコットが**中央 60%×60% の矩形の外にしか無い**画像は検出しない（単色と判定する）。
 *
 * 終了コード: 0=合格 / 1=測れた上での赤 / 2=測れなかった
 *
 * 使い方（★--expect-bg にアプリ本体の地色を渡すこと。無いと manifest の判定は測れなかった扱い）:
 *   node scripts/check-pwa-splash.mjs --url https://example.com --expect-bg '#RRGGBB'
 *   node scripts/check-pwa-splash.mjs --html out/index.html --manifest out/manifest.webmanifest --expect-bg '#RRGGBB'
 *   node scripts/check-pwa-splash.mjs --selftest
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

import {
  EXIT,
  computeExitCode,
  formatProbeReport,
  runSelfTest,
} from './lib/instrument-core.mjs';

const LIMITATION =
  '★実機で本当に出るかは見ません（iOS は追加済み PWA の manifest を強くキャッシュするため、'
  + 'サーバーが正しくてもアイコンを削除→再追加するまで古いままです）。Android(TWA)/ネイティブも対象外。';

function arg(argv, name, def = null) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}

// ─── 純ロジック（fs/network 非依存＝テストしやすい） ────────────────────

/**
 * ★HTML から apple-touch-startup-image の href を抜き出す。
 * @param {string} html
 * @returns {{ href: string, media: string|null }[]}
 */
export function extractStartupImages(html) {
  const out = [];
  const linkRe = /<link\b[^>]*>/gi;
  let m;
  while ((m = linkRe.exec(String(html || ''))) != null) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?apple-touch-startup-image/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    const media = tag.match(/media\s*=\s*["']([^"']+)["']/i);
    if (href) out.push({ href: href[1], media: media ? media[1] : null });
  }
  return out;
}

/**
 * ★manifest の background_color を判定する。
 *
 * 旧ルール（「無いこと」）は 2026-10-05 に根拠が無いと判明したため反転した（先頭コメント参照）。
 * 今は「あり、かつ expected（アプリ本体の地色）と一致」で緑。
 * 大文字小文字・`#` の有無・3桁/8桁表記の差は無視する。
 * ★expected が無いときは判定できない（ok=null）。緑にも赤にもしない。
 *
 * @param {object|null} manifest
 * @param {string|null} [expected] 期待する地色（アプリ本体の地色。--expect-bg）
 * @returns {{ ok: boolean|null, value: unknown, expected: string|null }}
 */
export function judgeManifestBackground(manifest, expected = null) {
  const value = manifest && typeof manifest === 'object' ? manifest.background_color : undefined;
  if (expected == null || String(expected).trim() === '') {
    return { ok: null, value: value ?? null, expected: null };
  }
  const exp = normalizeHex(expected);
  const ok = typeof value === 'string' && value.trim() !== '' && normalizeHex(value) === exp;
  return { ok, value: value ?? null, expected: exp };
}

/** #RRGGBBAA / #RGB を #RRGGBB に正規化する。 */
export function normalizeHex(hex) {
  let h = String(hex || '').trim().toUpperCase().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h.slice(0, 6)}`;
}

/**
 * ★画素サンプルから「単色か」を判定する。
 *
 * ★なぜ要るか: 地色だけ見ると「正しい色で塗っただけの真っ青な画像」が合格する。
 *   それはまさに kimito が 2026-07-31 に踏んだ「ロゴ無しの青一色」そのもの。
 *   ＝ 色が合っていることと、絵が描かれていることは**別**。
 *
 * @param {{r:number,g:number,b:number}[]} samples
 * @param {number} tolerance 同色とみなす差（L1）
 * @returns {boolean} true なら単色＝ロゴが描かれていない疑い
 */
export function looksSolidColor(samples, tolerance = 24) {
  const list = Array.isArray(samples) ? samples : [];
  if (list.length === 0) return true; // ★測れていない＝安全側に倒さない
  const base = list[0];
  return list.every(
    (s) => Math.abs(s.r - base.r) + Math.abs(s.g - base.g) + Math.abs(s.b - base.b) <= tolerance
  );
}

/**
 * ★「単色でない」判定の設定（中央矩形の領域サンプリング）。
 *
 * ★なぜ点ではなく領域か（2026-10-05 実測）: 中央1点(4x4px)だけを見ると、
 *   文字ロゴ（ワードマーク）の文字間の隙間が中央に当たったとき、四隅も中央も地色＝
 *   「単色」と誤判定する。kimito.link の apple-splash-750x1334.png は白地に青いワードマークで、
 *   中央(375,667)は白だが、中央 60% の矩形には非白画素が 5.4% あった。
 *   点を増やしても同じ穴が別の位置で開くので、矩形の全画素を数える。
 */
export const LOGO_REGION = Object.freeze({
  /** 画像中央の何割（幅・高さそれぞれ）を数えるか */
  fraction: 0.6,
  /** 地色と各チャンネル(R/G/B)の差がこれを超える画素を「非地色」とみなす */
  channelDiff: 16,
  /** 非地色画素の割合がこれ未満なら単色（fail） */
  minRatio: 0.005,
  /** 数える前に矩形の長辺をここまで縮める（割合は変わらない。巨大画像の時間対策） */
  maxSide: 256,
});

/**
 * ★画像中央の矩形（fraction×fraction）の座標を返す。純関数。
 * @param {number} W 画像の幅
 * @param {number} H 画像の高さ
 * @param {number} [fraction]
 * @returns {{ left:number, top:number, width:number, height:number }}
 */
export function centerRegion(W, H, fraction = LOGO_REGION.fraction) {
  const w = Math.max(1, Math.min(W, Math.round(W * fraction)));
  const h = Math.max(1, Math.min(H, Math.round(H * fraction)));
  return { left: Math.floor((W - w) / 2), top: Math.floor((H - h) / 2), width: w, height: h };
}

/**
 * ★raw 画素列のうち「地色と違う画素」の数と割合を数える。純関数。
 * @param {Uint8Array|Buffer} data 画素列（1画素 = channels バイト、先頭3つが R,G,B）
 * @param {number} channels 1画素あたりのチャンネル数（3 or 4）
 * @param {{r:number,g:number,b:number}} base 地色
 * @param {number} [channelDiff] 各チャンネルの差がこれを超えたら非地色
 * @returns {{ total:number, nonBase:number, ratio:number }} ratio は total=0 なら NaN
 */
export function countNonBasePixels(data, channels, base, channelDiff = LOGO_REGION.channelDiff) {
  const ch = Number(channels) >= 3 ? Number(channels) : 3;
  const len = data ? data.length : 0;
  const total = Math.floor(len / ch);
  let nonBase = 0;
  for (let i = 0; i + 2 < len; i += ch) {
    if (
      Math.abs(data[i] - base.r) > channelDiff
      || Math.abs(data[i + 1] - base.g) > channelDiff
      || Math.abs(data[i + 2] - base.b) > channelDiff
    ) nonBase += 1;
  }
  return { total, nonBase, ratio: total > 0 ? nonBase / total : NaN };
}

/**
 * ★非地色画素の割合から「単色か」を判定する。純関数。
 * @param {number} ratio countNonBasePixels().ratio
 * @param {number} [minRatio] これ未満なら単色
 * @returns {boolean} true なら単色＝ロゴが描かれていない疑い。ratio が数でなければ true（測れていないを緑にしない）
 */
export function looksSolidByRatio(ratio, minRatio = LOGO_REGION.minRatio) {
  if (!Number.isFinite(ratio)) return true;
  return ratio < minRatio;
}

/** 0〜1 の割合を "5.40%" の形にする（evidence 用）。 */
function pct(ratio) {
  return Number.isFinite(ratio) ? `${(ratio * 100).toFixed(2)}%` : 'n/a';
}

/** ★HTML から <link rel="manifest"> の href を取る（属性の順序に依らない）。無ければ null。 */
export function extractManifestHref(html) {
  const linkRe = /<link\b[^>]*>/gi;
  let m;
  while ((m = linkRe.exec(String(html || ''))) != null) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?manifest\b/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (href) return href[1];
  }
  return null;
}

/** ★HTML から <meta name="theme-color"> の content を全部取る（media 付きの複数宣言も拾う）。 */
export function extractThemeColors(html) {
  const out = [];
  const metaRe = /<meta\b[^>]*>/gi;
  let m;
  while ((m = metaRe.exec(String(html || ''))) != null) {
    const tag = m[0];
    if (!/name\s*=\s*["']?theme-color/i.test(tag)) continue;
    const c = tag.match(/content\s*=\s*["']([^"']*)["']/i);
    if (c) out.push(c[1]);
  }
  return out;
}

/** hex ならそろえ、それ以外（rgb() や色名）は小文字・空白除去だけして比べる。 */
function comparableColor(v) {
  const t = String(v ?? '').trim();
  return /^#?[0-9a-f]{3}([0-9a-f]{3}([0-9a-f]{2})?)?$/i.test(t)
    ? normalizeHex(t)
    : t.toLowerCase().replace(/\s+/g, '');
}

/**
 * ★manifest.theme_color と HTML の meta theme-color が同じ値かを判定する。
 * ok=true: manifest と meta がすべて同じ / false: meta が無い・manifest に無い・値が食い違う
 * @returns {{ ok: boolean, reason: string, manifestValue: unknown, metaValues: string[] }}
 */
export function judgeThemeColor(manifest, metaColors) {
  const metaValues = Array.isArray(metaColors) ? metaColors : [];
  const mv = manifest && typeof manifest === 'object' ? manifest.theme_color : undefined;
  if (metaValues.length === 0) {
    return { ok: false, reason: 'meta-missing', manifestValue: mv ?? null, metaValues };
  }
  if (typeof mv !== 'string' || mv.trim() === '') {
    return { ok: false, reason: 'manifest-missing', manifestValue: mv ?? null, metaValues };
  }
  const base = comparableColor(mv);
  const allSame = metaValues.every((c) => comparableColor(c) === base);
  return { ok: allSame, reason: allSame ? '' : 'mismatch', manifestValue: mv, metaValues };
}

/** ★起動画像の href のうち、クエリ（?）を含むものを返す。 */
export function findQueryHrefs(images) {
  return (Array.isArray(images) ? images : []).filter((i) => String(i.href).includes('?')).map((i) => i.href);
}

/**
 * ★manifest.icons に 192 と 512 の PNG があるかを判定する。
 * sizes は空白区切り（"192x192 512x512"）、PNG は type=image/png または src が .png。
 * @returns {{ ok: boolean, found: {192: string|null, 512: string|null} }}
 */
export function judgeIcons(manifest) {
  const icons = manifest && Array.isArray(manifest.icons) ? manifest.icons : [];
  const found = { 192: null, 512: null };
  for (const ic of icons) {
    if (!ic || typeof ic.src !== 'string') continue;
    const isPng = String(ic.type || '').toLowerCase() === 'image/png' || /\.png$/i.test(ic.src.split(/[?#]/)[0]);
    if (!isPng) continue;
    const sizes = String(ic.sizes || '').split(/\s+/);
    for (const want of [192, 512]) {
      if (!found[want] && sizes.includes(`${want}x${want}`)) found[want] = ic.src;
    }
  }
  return { ok: Boolean(found[192] && found[512]), found };
}

// ─── I/O ───────────────────────────────────────────────────────────────

/** 取得して status と content-type だけ返す（ネットワーク失敗は例外）。 */
async function fetchStatus(url) {
  const res = await fetch(url, { redirect: 'follow' });
  await res.arrayBuffer().catch(() => {});
  return { status: res.status, type: (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() };
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** sharp は画像を実測するときだけ要る（無い環境では inconclusive にする）。 */
async function loadSharp() {
  try {
    const m = await import('sharp');
    return m.default ?? m;
  } catch {
    return null;
  }
}

/**
 * ★起動画像の画素を実測する（四隅の地色＋中央矩形の非地色画素の割合）。
 *   main と selftest が同じ経路を通る（selftest が別の近道を測って緑になるのを防ぐ）。
 * @param {import('sharp')} sharp
 * @param {Buffer} buf
 * @returns {Promise<{
 *   W:number, H:number, hex:string,
 *   corners:{r:number,g:number,b:number}[],
 *   center:{r:number,g:number,b:number},
 *   region:{left:number,top:number,width:number,height:number},
 *   counted:{total:number,nonBase:number,ratio:number},
 *   sampled:string,
 * }>}
 */
async function analyzeSplashPixels(sharp, buf) {
  const meta = await sharp(buf).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const pick = async (left, top) => {
    const d = await sharp(buf).extract({ left, top, width: 4, height: 4 }).raw().toBuffer();
    return { r: d[0], g: d[1], b: d[2] };
  };
  // ★地色は四隅から取る（従来どおり。左上を代表値にする）
  const corners = [
    await pick(2, 2),
    await pick(Math.max(0, W - 8), 2),
    await pick(2, Math.max(0, H - 8)),
    await pick(Math.max(0, W - 8), Math.max(0, H - 8)),
  ];
  const base = corners[0];
  const hex = `#${[base.r, base.g, base.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  // 中央1点は evidence 用（判定には使わない。文字間の隙間に当たると地色になる）
  const center = await pick(Math.floor(W / 2), Math.floor(H / 2));

  // ★中央 60%×60% の矩形を全画素数える。長辺が maxSide を超えるなら縮めてから数える
  const region = centerRegion(W, H);
  let pipeline = sharp(buf).extract(region);
  if (Math.max(region.width, region.height) > LOGO_REGION.maxSide) {
    pipeline = pipeline.resize({ width: LOGO_REGION.maxSide, height: LOGO_REGION.maxSide, fit: 'inside' });
  }
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const counted = countNonBasePixels(data, info.channels, base);
  return { W, H, hex, corners, center, region, counted, sampled: `${info.width}x${info.height}` };
}

async function main(argv) {
  const url = arg(argv, '--url');
  const htmlPath = arg(argv, '--html');
  const manifestPath = arg(argv, '--manifest');
  const expectBg = arg(argv, '--expect-bg');

  /** @type {import('./lib/instrument-core.mjs').ProbeResult[]} */
  const results = [];

  if (!url && !htmlPath) {
    results.push({
      probe: 'PWA 起動画面',
      verdict: 'inconclusive',
      evidence: {},
      detail: '--url も --html も指定されていないため、何も測れませんでした',
      howToFix: "node scripts/check-pwa-splash.mjs --url https://example.com --expect-bg '#RRGGBB'",
      limitation: LIMITATION,
    });
    return results;
  }

  // 1. HTML と manifest を取る
  let html = null;
  let manifest = null;
  let manifestSource = null;
  try {
    if (htmlPath) {
      if (!existsSync(htmlPath)) throw new Error(`${htmlPath} が無い`);
      html = readFileSync(htmlPath, 'utf8');
    } else {
      html = await fetchText(url);
    }
  } catch (e) {
    results.push({
      probe: 'HTML の取得',
      verdict: 'inconclusive',
      evidence: { url: url ?? htmlPath, error: e.message },
      detail: 'ページを取得できませんでした',
      howToFix: 'URL/パスが正しいか、サイトが公開されているか確認してください',
      limitation: LIMITATION,
    });
    return results;
  }

  // 1b. ★manifest が HTML に宣言され、配信されていること（無い/404/JSON でない＝赤）
  const manifestHref = extractManifestHref(html);
  const MANIFEST_FIX =
    '<link rel="manifest" href="/manifest.webmanifest"> を HTML に入れ、そのパスが 200 で JSON を返すようにする';
  const MANIFEST_WHY =
    'manifest が無い/読めないと、ホーム画面に追加しても名前・アイコン・起動画面の色を制御できません';
  try {
    if (manifestPath) {
      if (!existsSync(manifestPath)) throw new Error(`${manifestPath} が無い`);
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifestSource = manifestPath;
    } else if (url && manifestHref != null) {
      const abs = new URL(manifestHref, url).toString();
      const res = await fetch(abs, { redirect: 'follow' });
      manifestSource = abs;
      if (!res.ok) {
        results.push({
          probe: 'manifest が配信されている',
          verdict: 'fail',
          evidence: { href: manifestHref, status: res.status },
          detail: `manifest が HTTP ${res.status} です。${MANIFEST_WHY}`,
          howToFix: MANIFEST_FIX,
          limitation: LIMITATION,
        });
      } else {
        try {
          manifest = JSON.parse(await res.text());
          results.push({
            probe: 'manifest が配信されている',
            verdict: 'pass',
            evidence: { href: manifestHref, status: res.status },
            limitation: LIMITATION,
          });
        } catch {
          results.push({
            probe: 'manifest が配信されている',
            verdict: 'fail',
            evidence: { href: manifestHref, status: res.status },
            detail: `manifest が 200 でも JSON として読めません。${MANIFEST_WHY}`,
            howToFix: MANIFEST_FIX,
            limitation: LIMITATION,
          });
        }
      }
    }
    if (manifestHref == null) {
      results.push({
        probe: 'manifest が配信されている',
        verdict: 'fail',
        evidence: { 宣言: null },
        detail: `HTML に <link rel="manifest"> がありません。${MANIFEST_WHY}`,
        howToFix: MANIFEST_FIX,
        limitation: LIMITATION,
      });
    }
  } catch (e) {
    results.push({
      probe: 'manifest の取得',
      verdict: 'inconclusive',
      evidence: { error: e.message },
      detail: 'manifest を取得/解析できませんでした',
      howToFix: '--manifest でパスを渡すか、manifest が配信されているか確認',
      limitation: LIMITATION,
    });
  }

  // 2. ★background_color があり、--expect-bg（アプリ本体の地色）と一致すること
  //    （Android の OS 起動画面の地色になる。無い/違うと本体・ベールとの間で色が飛ぶ）
  if (manifest) {
    const bg = judgeManifestBackground(manifest, expectBg);
    if (bg.ok === null) {
      results.push({
        probe: 'manifest の background_color が本体の地色と一致',
        verdict: 'inconclusive',
        evidence: { source: manifestSource, background_color: bg.value, display: manifest.display ?? null },
        detail: '--expect-bg が渡されていないため、本体の地色と比べられませんでした',
        howToFix: "--expect-bg にアプリ本体の地色を渡す（例: --expect-bg '#RRGGBB'）",
        limitation: LIMITATION,
      });
    } else {
      results.push({
        probe: `manifest の background_color が本体の地色 ${bg.expected} と一致`,
        verdict: bg.ok ? 'pass' : 'fail',
        evidence: {
          source: manifestSource,
          background_color: bg.value,
          期待: bg.expected,
          display: manifest.display ?? null,
        },
        detail: bg.ok
          ? ''
          : bg.value === null
            ? `background_color が無いため、Android(WebAPK) の起動画面が白になり、本体・ベール(${bg.expected})との間で色が飛びます`
            : `background_color=${bg.value} が本体の地色 ${bg.expected} と違うため、起動画面と本体・ベールの間で色が飛びます`,
        howToFix: `manifest に "background_color": "${bg.expected}" を入れる（theme_color はステータスバー色なので別）`,
        limitation: LIMITATION,
      });
    }
  }

  // 2b. ★theme_color と <meta name="theme-color"> が同じ値
  if (manifest) {
    const metas = extractThemeColors(html);
    const th = judgeThemeColor(manifest, metas);
    results.push({
      probe: 'manifest の theme_color と meta theme-color が一致',
      verdict: th.ok ? 'pass' : 'fail',
      evidence: { manifest: th.manifestValue, meta: th.metaValues },
      detail: th.ok
        ? ''
        : th.reason === 'meta-missing'
          ? '<meta name="theme-color"> が HTML にありません。ブラウザ枠の色が manifest と別になります'
          : th.reason === 'manifest-missing'
            ? 'manifest に theme_color がありません。meta theme-color と値をそろえられません'
            : `meta theme-color(${th.metaValues.join(', ')}) が manifest の theme_color(${th.manifestValue}) と違います`,
      howToFix: 'manifest の theme_color と <meta name="theme-color" content="..."> を同じ値にする',
      limitation: LIMITATION,
    });

    // 2c. ★アイコン: 192 と 512 の PNG があり、--url 指定時は配信されている
    const ic = judgeIcons(manifest);
    if (!ic.ok) {
      results.push({
        probe: 'manifest.icons に 192 と 512 の PNG がある',
        verdict: 'fail',
        evidence: { 192: ic.found[192], 512: ic.found[512] },
        detail: 'manifest.icons に 192x192 と 512x512 の PNG が両方そろっていません（ホーム画面・起動画面のアイコンが作れません）',
        howToFix: 'manifest.icons に sizes "192x192" と "512x512" の PNG（type image/png）を入れる',
        limitation: LIMITATION,
      });
    } else if (url && manifestSource && /^https?:/i.test(manifestSource)) {
      for (const want of [192, 512]) {
        const src = ic.found[want];
        try {
          const r = await fetchStatus(new URL(src, manifestSource).toString());
          const ok = r.status === 200 && r.type === 'image/png';
          results.push({
            probe: `アイコン ${want}x${want} が配信されている`,
            verdict: ok ? 'pass' : 'fail',
            evidence: { src, status: r.status, contentType: r.type },
            detail: ok ? '' : `アイコン ${src} が HTTP ${r.status} / ${r.type || 'content-type なし'} です（200 かつ image/png が必要）`,
            howToFix: 'アイコン PNG を配置し、manifest の src が 200 / image/png で返るようにする',
            limitation: LIMITATION,
          });
        } catch (e) {
          results.push({
            probe: `アイコン ${want}x${want} が配信されている`,
            verdict: 'inconclusive',
            evidence: { src, error: e.message },
            detail: 'アイコンを取得できず測れませんでした',
            howToFix: 'ネットワークと URL を確認して再実行',
            limitation: LIMITATION,
          });
        }
      }
    } else {
      results.push({
        probe: 'manifest.icons に 192 と 512 の PNG がある',
        verdict: 'pass',
        evidence: { 192: ic.found[192], 512: ic.found[512], 配信確認: 'ローカルのため宣言のみ' },
        limitation: LIMITATION,
      });
    }
  }

  // 3. startupImage が宣言されているか
  const images = extractStartupImages(html);
  results.push({
    probe: 'apple-touch-startup-image の宣言',
    verdict: images.length > 0 ? 'pass' : 'fail',
    evidence: { 宣言数: images.length },
    detail: images.length > 0 ? '' : 'apple-touch-startup-image が1つも宣言されていません',
    howToFix:
      'Next.js なら app/layout.tsx の metadata.appleWebApp.startupImage に解像度ごとの画像を並べる',
    limitation: LIMITATION,
  });

  if (images.length === 0) return results;

  // 3b. ★起動画像の href にクエリ（?）が無いこと（固定名＋クエリは CDN に旧版が残る。内容ハッシュ名にする）
  const queried = findQueryHrefs(images);
  results.push({
    probe: '起動画像の href にクエリ（?）が無い',
    verdict: queried.length === 0 ? 'pass' : 'fail',
    evidence: { 検査数: images.length, クエリ付き: queried.length, 例: queried.slice(0, 2) },
    detail:
      queried.length === 0
        ? ''
        : `起動画像 ${queried.length}/${images.length} 本の href に「?」があります（例: ${queried[0]}）。固定名＋クエリだと CDN に旧版が残る罠があります`,
    howToFix: '起動画像のファイル名を内容ハッシュ入りにし、href から ?v= 等を外す（参照: surechigai docs/symptoms.md SG-02）',
    limitation: LIMITATION,
  });

  // 4-5. 画像が実在し、地色が正しく、★単色でないこと
  const target = images[0];
  const sharp = await loadSharp();
  let buf = null;
  try {
    if (url) {
      buf = await fetchBuffer(new URL(target.href, url).toString());
    } else {
      const p = target.href.startsWith('/')
        ? join(dirname(resolve(htmlPath)), target.href.replace(/^\//, ''))
        : resolve(dirname(resolve(htmlPath)), target.href);
      if (!existsSync(p)) throw new Error(`${p} が無い`);
      buf = readFileSync(p);
    }
  } catch (e) {
    results.push({
      probe: '起動画像が実在して開ける',
      verdict: 'fail',
      evidence: { href: target.href, error: e.message },
      detail: '宣言されている起動画像を取得できません（宣言だけあって実体が無い）',
      howToFix: '画像を配置し、href のパスが本番で 200 を返すことを確認',
      limitation: LIMITATION,
    });
    return results;
  }

  results.push({
    probe: '起動画像が実在して開ける',
    verdict: 'pass',
    evidence: { href: target.href, bytes: buf.length },
    limitation: LIMITATION,
  });

  if (!sharp) {
    results.push({
      probe: '起動画像の地色と絵柄',
      verdict: 'inconclusive',
      evidence: { reason: 'sharp が入っていないため画素を測れません' },
      detail: '画像の中身（地色・単色かどうか）を測れませんでした',
      howToFix: 'npm i -D sharp してから再実行してください',
      limitation: LIMITATION,
    });
    return results;
  }

  try {
    const px = await analyzeSplashPixels(sharp, buf);
    const { W, H, hex } = px;
    const solid = looksSolidByRatio(px.counted.ratio);

    if (expectBg) {
      const ok = hex === normalizeHex(expectBg);
      results.push({
        probe: '起動画像の地色',
        verdict: ok ? 'pass' : 'fail',
        evidence: { 実測: hex, 期待: normalizeHex(expectBg), サイズ: `${W}x${H}` },
        detail: ok ? '' : `地色 ${hex} が期待 ${normalizeHex(expectBg)} と違います`,
        howToFix: '起動画像を生成し直して地色を揃えてください',
        limitation: LIMITATION,
      });
    }

    const { region, counted } = px;
    results.push({
      probe: '起動画像にロゴが描かれている（単色でない）',
      verdict: solid ? 'fail' : 'pass',
      evidence: {
        地色: hex,
        四隅: px.corners,
        中央1点: px.center,
        中央矩形: `left=${region.left} top=${region.top} ${region.width}x${region.height}（${Math.round(LOGO_REGION.fraction * 100)}%）`,
        数えた画素: `${px.sampled}=${counted.total}px`,
        非地色画素の割合: pct(counted.ratio),
        判定しきい値: `${pct(LOGO_REGION.minRatio)} 以上で合格（各チャンネル差 >${LOGO_REGION.channelDiff}）`,
        サイズ: `${W}x${H}`,
        単色: solid,
      },
      detail: solid
        ? `★中央 ${Math.round(LOGO_REGION.fraction * 100)}% の矩形で地色と違う画素が ${pct(counted.ratio)}（しきい値 ${pct(LOGO_REGION.minRatio)} 未満）＝ロゴ/マスコットが描かれていない疑い（色は正しくても「ただの単色塗り」になっています）`
        : '',
      howToFix: 'ロゴ入りの起動画像を生成し直してください（地色だけの画像になっていないか、ロゴが中央 60% の矩形に入っているか確認）',
      limitation: LIMITATION,
    });
  } catch (e) {
    results.push({
      probe: '起動画像の地色と絵柄',
      verdict: 'inconclusive',
      evidence: { error: e.message },
      detail: '画像を解析できませんでした',
      howToFix: '画像が壊れていないか確認してください',
      limitation: LIMITATION,
    });
  }

  return results;
}

// ─── selftest ────────────────────────────────────────────────────────
//
// ★実ファイル・ネットワークを触らず、純関数に文字列/配列を食わせる＝毒が確実に届く。
//   画像の判定だけは sharp でメモリ上に PNG を作り、main と同じ analyzeSplashPixels を通す。
async function selftest() {
  // ── 画像ケース（sharp が無い環境では「測れない」として赤にする。黙って緑にしない） ──
  const sharp = await loadSharp();
  const PNG_W = 300;
  const PNG_H = 500;
  const BG = '#FFFFFF';
  const INK = '#1E63C7';
  const rect = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: INK } }).png().toBuffer();
  const canvas = (shapes = []) =>
    sharp({ create: { width: PNG_W, height: PNG_H, channels: 3, background: BG } })
      .composite(shapes)
      .png()
      .toBuffer();
  /** @type {Record<string, Awaited<ReturnType<typeof analyzeSplashPixels>>|null>} */
  const px = { solid: null, wordmark: null, centered: null, speck: null };
  if (sharp) {
    // (a) 地色だけの単色
    px.solid = await analyzeSplashPixels(sharp, await canvas());
    // (b) ワードマークを模す: 中央(150,250)は地色のまま、中央矩形(60..240, 100..400)の左右に離れた図形
    px.wordmark = await analyzeSplashPixels(
      sharp,
      await canvas([
        { input: await rect(50, 20), left: 70, top: 240 },
        { input: await rect(50, 20), left: 180, top: 240 },
      ])
    );
    // (c) 従来どおり中央に図形
    px.centered = await analyzeSplashPixels(sharp, await canvas([{ input: await rect(100, 100), left: 100, top: 200 }]));
    // (d) 中央矩形内に数画素のノイズだけ（5x5=25px / 54000px = 0.046%）
    px.speck = await analyzeSplashPixels(sharp, await canvas([{ input: await rect(5, 5), left: 100, top: 150 }]));
  }
  const isBase = (p) => p.r === 255 && p.g === 255 && p.b === 255;

  const HTML_WITH = `
<html><head>
<link rel="apple-touch-startup-image" href="/splash/a.png" media="(device-width: 390px)">
<link rel="apple-touch-startup-image" href="/splash/b.png">
</head></html>`;
  const HTML_WITHOUT = '<html><head><link rel="apple-touch-icon" href="/icon.png"></head></html>';

  const cases = [
    {
      name: '★background_color が無いと赤（Android の起動画面が白になり、本体と色が飛ぶ）',
      poison: () => {},
      restore: () => {},
      isRed: () => judgeManifestBackground({ theme_color: '#00427B' }, '#E2EDF7').ok === false,
    },
    {
      name: '★background_color が違う色だと赤',
      poison: () => {},
      restore: () => {},
      isRed: () => judgeManifestBackground({ background_color: '#FFFFFF' }, '#E2EDF7').ok === false,
    },
    {
      name: 'background_color が期待色と一致すれば緑（大文字小文字・# の有無・3桁表記は無視）',
      poison: () => {},
      restore: () => {},
      isRed: () =>
        judgeManifestBackground({ background_color: '#E2EDF7' }, '#E2EDF7').ok === true
        && judgeManifestBackground({ background_color: '#e2edf7' }, 'E2EDF7').ok === true
        && judgeManifestBackground({ background_color: '#fff' }, '#FFFFFF').ok === true,
    },
    {
      name: '★background_color が空文字・数値でも緑にしない',
      poison: () => {},
      restore: () => {},
      isRed: () =>
        judgeManifestBackground({ background_color: '' }, '#E2EDF7').ok === false
        && judgeManifestBackground({ background_color: 123 }, '#E2EDF7').ok === false,
    },
    {
      name: '★--expect-bg が無いと「測れなかった(null)」。緑にも赤にもしない',
      poison: () => {},
      restore: () => {},
      isRed: () =>
        judgeManifestBackground({ background_color: '#E2EDF7' }).ok === null
        && judgeManifestBackground({}, '').ok === null,
    },
    {
      name: 'startupImage を宣言している HTML から href を拾える',
      poison: () => {},
      restore: () => {},
      isRed: () => extractStartupImages(HTML_WITH).length === 2,
    },
    {
      name: '★宣言が無い HTML を「あった」と読まない',
      poison: () => {},
      restore: () => {},
      isRed: () => extractStartupImages(HTML_WITHOUT).length === 0,
    },
    {
      name: '★単色画像（ロゴ無しの青一色）を検出する',
      poison: () => {},
      restore: () => {},
      isRed: () =>
        looksSolidColor([
          { r: 0, g: 66, b: 123 },
          { r: 0, g: 66, b: 123 },
          { r: 0, g: 66, b: 123 },
          { r: 0, g: 66, b: 123 },
        ]) === true,
    },
    {
      name: '★ロゴがある画像を「単色」と誤判定しない',
      poison: () => {},
      restore: () => {},
      isRed: () =>
        looksSolidColor([
          { r: 0, g: 66, b: 123 },
          { r: 0, g: 66, b: 123 },
          { r: 0, g: 66, b: 123 },
          { r: 240, g: 160, b: 60 },
        ]) === false,
    },
    {
      name: '★サンプルが空なら「単色」と答える（測れていないのを緑にしない）',
      poison: () => {},
      restore: () => {},
      isRed: () => looksSolidColor([]) === true,
    },
    // ── 中央矩形の領域サンプリング（純関数） ──
    {
      name: '中央矩形は画像中央の 60%×60%（750x1334 → 450x800、left=150 top=267）',
      poison: () => {},
      restore: () => {},
      isRed: () => {
        const r = centerRegion(750, 1334);
        return r.left === 150 && r.top === 267 && r.width === 450 && r.height === 800;
      },
    },
    {
      name: '★非地色画素を数える: 地色との差が 16 以下は数えない・17 以上は数える・RGBA の stride も正しい',
      poison: () => {},
      restore: () => {},
      isRed: () => {
        const base = { r: 255, g: 255, b: 255 };
        const rgb = Uint8Array.from([255, 255, 255, 239, 255, 255, 238, 255, 255, 30, 99, 199]);
        const a = countNonBasePixels(rgb, 3, base);
        const rgba = Uint8Array.from([255, 255, 255, 255, 30, 99, 199, 255]);
        const b = countNonBasePixels(rgba, 4, base);
        return a.total === 4 && a.nonBase === 2 && a.ratio === 0.5 && b.total === 2 && b.nonBase === 1;
      },
    },
    {
      name: '★割合が 0.5% 未満なら単色、以上なら単色でない。数でなければ単色（測れていないを緑にしない）',
      poison: () => {},
      restore: () => {},
      isRed: () =>
        looksSolidByRatio(0.0049) === true
        && looksSolidByRatio(0.005) === false
        && looksSolidByRatio(0.054) === false
        && looksSolidByRatio(NaN) === true
        && looksSolidByRatio(undefined) === true,
    },
    // ── 中央矩形の領域サンプリング（sharp で作った PNG を main と同じ経路で測る） ──
    {
      name: '★(a) 地色だけの PNG は単色＝赤（非地色画素 0%）',
      poison: () => {},
      restore: () => {},
      isRed: () => Boolean(px.solid) && px.solid.counted.nonBase === 0 && looksSolidByRatio(px.solid.counted.ratio) === true,
    },
    {
      name: '★(b) ワードマーク型（中央1点は地色だが、中央矩形に離れた図形がある）PNG を単色と誤判定しない',
      poison: () => {},
      restore: () => {},
      isRed: () => {
        const p = px.wordmark;
        if (!p) return false;
        // 旧判定（四隅＋中央1点）だとこの画像は「単色」になる＝誤検知の再現
        const oldVerdictWasSolid = looksSolidColor([...p.corners, p.center]) === true;
        return isBase(p.center) && oldVerdictWasSolid && p.counted.ratio > 0.03 && looksSolidByRatio(p.counted.ratio) === false;
      },
    },
    {
      name: '(c) 中央に図形がある PNG は従来どおり単色でない＝緑',
      poison: () => {},
      restore: () => {},
      isRed: () => Boolean(px.centered) && !isBase(px.centered.center) && looksSolidByRatio(px.centered.counted.ratio) === false,
    },
    {
      name: '★(d) 中央矩形に数画素のノイズしか無い PNG は「ロゴあり」と見なさない＝赤',
      poison: () => {},
      restore: () => {},
      isRed: () => Boolean(px.speck) && px.speck.counted.nonBase > 0 && looksSolidByRatio(px.speck.counted.ratio) === true,
    },
    {
      name: '8桁 ARGB を 6桁に正規化できる',
      poison: () => {},
      restore: () => {},
      isRed: () => normalizeHex('#00427BFF') === '#00427B',
    },
    // ── manifest の宣言 ──
    {
      name: '★<link rel="manifest"> が無い HTML は null（宣言なし＝赤）',
      poison: () => {},
      restore: () => {},
      isRed: () => extractManifestHref('<html><head><link rel="icon" href="/i.png"></head></html>') === null,
    },
    {
      name: 'manifest の href を属性の順序・引用符に依らず拾える',
      poison: () => {},
      restore: () => {},
      isRed: () =>
        extractManifestHref('<link rel="manifest" href="/m.json">') === '/m.json'
        && extractManifestHref("<link href='/n.webmanifest' rel='manifest'>") === '/n.webmanifest'
        && extractManifestHref('<link rel="manifest" crossorigin="use-credentials" href="/c.json" />') === '/c.json',
    },
    // ── theme-color ──
    {
      name: '★meta theme-color が無いと赤',
      poison: () => {},
      restore: () => {},
      isRed: () => judgeThemeColor({ theme_color: '#E2EDF7' }, []).ok === false,
    },
    {
      name: '★manifest に theme_color が無いと赤',
      poison: () => {},
      restore: () => {},
      isRed: () => judgeThemeColor({}, ['#E2EDF7']).ok === false,
    },
    {
      name: '★meta と manifest の theme-color が違うと赤',
      poison: () => {},
      restore: () => {},
      isRed: () => judgeThemeColor({ theme_color: '#E2EDF7' }, ['#00427B']).ok === false,
    },
    {
      name: '★meta が2つあり片方だけ違っても赤',
      poison: () => {},
      restore: () => {},
      isRed: () => judgeThemeColor({ theme_color: '#E2EDF7' }, ['#E2EDF7', '#0D1117']).ok === false,
    },
    {
      name: 'theme-color が同値なら緑（大文字小文字・# の有無・3桁を無視、複数 meta も全部一致なら緑）',
      poison: () => {},
      restore: () => {},
      isRed: () =>
        judgeThemeColor({ theme_color: '#E2EDF7' }, ['#e2edf7']).ok === true
        && judgeThemeColor({ theme_color: '#fff' }, ['FFFFFF', '#ffffff']).ok === true,
    },
    {
      name: 'HTML から meta theme-color を media 付き複数宣言ごと拾える',
      poison: () => {},
      restore: () => {},
      isRed: () => {
        const h = '<meta name="theme-color" content="#111111" media="(prefers-color-scheme: dark)"><meta content="#EEEEEE" name="theme-color"><meta name="viewport" content="width=device-width">';
        const got = extractThemeColors(h);
        return got.length === 2 && got[0] === '#111111' && got[1] === '#EEEEEE';
      },
    },
    // ── 起動画像の href のクエリ ──
    {
      name: '★起動画像の href に ?v= があると検出する（固定名＋クエリは CDN に旧版が残る）',
      poison: () => {},
      restore: () => {},
      isRed: () =>
        findQueryHrefs([{ href: '/splash/a.png?v=2' }, { href: '/splash/b.png' }]).length === 1,
    },
    {
      name: 'クエリの無い（内容ハッシュ名の）href は検出しない',
      poison: () => {},
      restore: () => {},
      isRed: () => findQueryHrefs([{ href: '/splash/a.3fa9c1.png' }, { href: '/splash/b.9b2e44.png' }]).length === 0,
    },
    // ── アイコン ──
    {
      name: '★512 の PNG が無いと赤',
      poison: () => {},
      restore: () => {},
      isRed: () =>
        judgeIcons({ icons: [{ src: '/i192.png', sizes: '192x192', type: 'image/png' }] }).ok === false,
    },
    {
      name: '★192 の PNG が無いと赤',
      poison: () => {},
      restore: () => {},
      isRed: () =>
        judgeIcons({ icons: [{ src: '/i512.png', sizes: '512x512', type: 'image/png' }] }).ok === false,
    },
    {
      name: '★192/512 が PNG でない（SVG だけ）と赤',
      poison: () => {},
      restore: () => {},
      isRed: () =>
        judgeIcons({ icons: [{ src: '/i.svg', sizes: '192x192 512x512', type: 'image/svg+xml' }] }).ok === false
        && judgeIcons({}).ok === false,
    },
    {
      name: '192 と 512 の PNG がそろえば緑（sizes 複数指定・type 省略で拡張子 .png も可）',
      poison: () => {},
      restore: () => {},
      isRed: () =>
        judgeIcons({ icons: [{ src: '/a.png', sizes: '192x192', type: 'image/png' }, { src: '/b.png?v=3', sizes: '512x512' }] }).ok === true
        && judgeIcons({ icons: [{ src: '/c.png', sizes: '192x192 512x512', type: 'image/png' }] }).ok === true,
    },
  ];

  const { ok, fails } = runSelfTest(cases);
  if (ok) {
    console.log(`[check-pwa-splash] selftest OK (${cases.length}件すべて期待どおり)`);
    process.exit(EXIT.PASS);
  }
  console.error('[check-pwa-splash] ★selftest 失敗:');
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(EXIT.FAIL);
}

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) {
  await selftest();
} else {
  const results = await main(argv);
  console.log(formatProbeReport(results, { label: 'check-pwa-splash' }));
  // ★--verbose: 合格したときも「何をいくつ測ったか」を出す。
  //   共通土台の formatProbeReport は緑のとき件数しか出さない（それは土台の設計なので変えない）。
  //   ただし ★「根拠あり5件」だけでは、緑が本物か人間には確かめられない。
  //   実測値を見せる口をこちら側に用意しておく（掟: 計器は自分が何を測ったかを言える）。
  if (argv.includes('--verbose')) {
    console.log('\n── 実測値 ──');
    for (const r of results) {
      console.log(`  ${r.probe}: ${r.verdict}`);
      if (r.evidence) console.log(`    ${JSON.stringify(r.evidence)}`);
    }
  }
  process.exit(computeExitCode(results));
}
