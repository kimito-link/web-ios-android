// ドメイン入力の直後に出す、点数優先の結果。
// なぜ要るか: いちばん知りたい点数とひとことの要約を、詳しい説明より前に置く。
// 状態は言葉と印で示す。色だけにはしない。

import { COPY, normalizeLocale } from './copy.mjs';

export const QUICK_VIEW_ORDER = Object.freeze([
  'score',
  'status',
  'summary',
  'recheck',
  'share',
  'details',
]);

/**
 * @param {object} result
 * @param {string} locale
 */
export function buildQuickView(result, locale) {
  const loc = normalizeLocale(locale);
  const status = COPY.status[result.status] ? result.status : 'pending';
  return {
    order: QUICK_VIEW_ORDER,
    domain: result.domain,
    score: result.score,
    status,
    statusLabel: COPY.status[status][loc],
    statusIcon: COPY.status[status].icon,
    summary: result.summary[loc],
  };
}

/**
 * 確認中でも点数の位置を先に開ける。結果が届いたら同じ並びに数字を入れる。
 * @param {string} domain
 * @param {string} locale
 */
export function pendingQuickView(domain, locale) {
  return buildQuickView({
    domain,
    score: null,
    status: 'pending',
    summary: {
      ja: COPY.status.pending.ja,
      en: COPY.status.pending.en,
    },
  }, locale);
}
