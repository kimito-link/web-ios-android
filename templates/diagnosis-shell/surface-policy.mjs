// 診断結果シェルの「どの面のビルドか」と、その面で出してよい塊。
// なぜ要るか: アプリと拡張は本人の日常使いなので、人に勧める案内文を出さない。
// Web は人に提案する面なので、その案内文を出せる。
// 共有リンクに足してよい識別子は、許可したときの line だけ。案内コードの欄は持たない。
// 測れないとき: surface が app / extension / web のどれでもなければ店頭向けに app とみなし、案内文を隠す。
// 環境変数 DISTRIBUTION_SURFACE が app または extension のときは、設定が web でも案内文を出さない。
// 環境変数がそれらの名前でないときは、設定の surface を今まで通り使う。

export const SURFACES = Object.freeze(['app', 'extension', 'web']);

/**
 * ビルド対象の面を決める。環境変数 DISTRIBUTION_SURFACE が app.config の surface より先。
 * @param {object|null|undefined} config
 * @param {Record<string, string>|null|undefined} env
 * @returns {'app'|'extension'|'web'}
 */
export function resolveSurface(config, env) {
  const fromEnv = readSurface(env && env.DISTRIBUTION_SURFACE);
  if (fromEnv) return fromEnv;
  const fromConfig = readSurface(config && config.distribution && config.distribution.surface);
  if (fromConfig) return fromConfig;
  return 'app';
}

/**
 * 紹介・有料・LINE の文言を、この面の描画に載せてよいか。
 * app と extension は載せない。Web だけ載せる。
 * @param {'app'|'extension'|'web'} surface
 */
export function allowsPromoWording(surface) {
  return surface === 'web';
}

/**
 * @param {'app'|'extension'|'web'} surface
 */
export function blocksForSurface(surface) {
  const web = allowsPromoWording(surface);
  return {
    quickView: true,
    recheck: true,
    share: true,
    pricing: web,
    line: web,
  };
}

function readSurface(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim().toLowerCase();
  return SURFACES.includes(name) ? name : '';
}
