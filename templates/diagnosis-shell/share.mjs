// 結果の共有。リンクに案内の識別子は付けない。
// なぜ要るか: アプリは共有シート、Web は Web Share API、無ければリンクのコピー、で同じ結果を渡す。
// 外部の番号は、回答があるまでクエリに載せない。載せない名前の一覧はこのファイルだけが持つ。

import { normalizeLocale } from './copy.mjs';

const BANNED_QUERY = new Set([
  'ref', 'referral', 'referrer', 'affiliate', 'af', 'agency', 'xserver', 'line', 'lineid',
]);

/**
 * @param {string} raw
 * @returns {string} 空文字は不正
 */
export function normalizeDomain(raw) {
  let value = String(raw || '').trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split('/')[0].split('?')[0].split('#')[0];
  value = value.replace(/:\d+$/, '').replace(/\.$/, '');
  if (value.startsWith('www.')) value = value.slice(4);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value)) {
    return '';
  }
  return value;
}

/**
 * @param {{origin: string, domain: string}} input
 */
export function buildShareLink(input) {
  const host = new URL(input.origin);
  if (host.protocol !== 'https:') throw new Error('https required');
  if (host.hostname.startsWith('www.')) throw new Error('www not allowed');
  const domain = normalizeDomain(input.domain);
  if (!domain) throw new Error('domain required');
  const url = new URL('/check/', `${host.protocol}//${host.host}`);
  url.searchParams.set('domain', domain);
  for (const key of [...url.searchParams.keys()]) {
    if (BANNED_QUERY.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  return url.toString();
}

/**
 * @param {{origin: string, domain: string, score: number|string, summary: string, locale: string}} input
 */
export function buildSharePayload(input) {
  const locale = normalizeLocale(input.locale);
  const url = buildShareLink({ origin: input.origin, domain: input.domain });
  const domain = normalizeDomain(input.domain);
  const text = locale === 'en'
    ? `${domain}: ${input.score}. ${input.summary}`
    : `${domain}：${input.score}点。${input.summary}`;
  return { title: domain, text, url };
}

/**
 * @param {'app'|'extension'|'web'} surface
 * @param {{capacitorShare?: boolean, webShare?: boolean}} caps
 * @returns {'native-sheet'|'web-share'|'copy-link'}
 */
export function chooseShareChannel(surface, caps) {
  const share = caps || {};
  if (surface === 'app' && (share.capacitorShare || share.webShare)) return 'native-sheet';
  if ((surface === 'web' || surface === 'extension') && share.webShare) return 'web-share';
  return 'copy-link';
}

/** @param {string} url */
export function shareLinkQueryKeys(url) {
  return [...new URL(url).searchParams.keys()];
}
