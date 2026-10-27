// 診断結果シェルの「どの面のビルドか」と、その面で出してよい塊。
// なぜ要るか: アプリと拡張は本人の日常使いなので、人に勧める案内文を出さない。
// Web は人に提案する面なので、その案内文を出せる。案内の識別子の画面はどの面でもまだ出さない。
// 測れないとき: surface が app / extension / web のどれでもなければ店頭向けに app とみなし、案内文を隠す。

export const SURFACES = Object.freeze(['app', 'extension', 'web']);

/**
 * 案内の識別子の目印。画面も入力欄もまだ無い。
 * 外部の番号と、共有者の入口が決まるまで enabled は false のまま。
 * @typedef {object} ReferralPlaceholder
 * @property {false} enabled
 * @property {'pending-xserver'} status
 */

/** @type {ReferralPlaceholder} */
export const REFERRAL_PLACEHOLDER = Object.freeze({
  enabled: false,
  status: 'pending-xserver',
});

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
 * 設定に紹介の値が書いてあっても、画面用の値は作らない。
 * @returns {ReferralPlaceholder}
 */
export function readReferralPlaceholder() {
  return REFERRAL_PLACEHOLDER;
}

/**
 * @param {'app'|'extension'|'web'} surface
 */
export function blocksForSurface(surface) {
  const web = surface === 'web';
  return {
    quickView: true,
    recheck: true,
    share: true,
    pricing: web,
    line: web,
    referral: false,
  };
}

function readSurface(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim().toLowerCase();
  return SURFACES.includes(name) ? name : '';
}
