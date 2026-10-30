// 結果の共有。許可したときだけ、共有者の入口を line クエリに載せる。
// なぜ要るか: アプリは共有シート、Web は Web Share API、無ければリンクのコピー、で同じ結果を渡す。
// ref や agency などの案内クエリは付けない。許可は allowLine で、app と extension の描画は false。

import { normalizeLocale } from './copy.mjs';

const BANNED_QUERY = new Set([
  'ref', 'referral', 'referrer', 'affiliate', 'af', 'agency', 'xserver', 'agencycode',
]);

/**
 * @param {string} raw
 * @returns {string} 空文字は不正。数字だけ、または案内の識別子に見える値は捨てる。
 */
export function normalizeSharerLine(raw) {
  const source = String(raw || '').trim();
  if (!source || /取次|紹介|affiliate|referral|代理店/i.test(source)) return '';
  let value = source.startsWith('@') ? source.slice(1) : source;
  if (!/^[A-Za-z0-9._-]{2,20}$/.test(value)) return '';
  if (/^\d+$/.test(value)) return '';
  if (/^(?:ref|referral|referrer|affiliate|af|agency|xserver|agencycode)$/i.test(value)) return '';
  return `@${value}`;
}

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
 * @param {{origin: string, domain: string, line?: string, allowLine?: boolean}} input
 */
export function buildShareLink(input) {
  const host = new URL(input.origin);
  if (host.protocol !== 'https:') throw new Error('https required');
  if (host.hostname.startsWith('www.')) throw new Error('www not allowed');
  const domain = normalizeDomain(input.domain);
  if (!domain) throw new Error('domain required');
  const url = new URL('/check/', `${host.protocol}//${host.host}`);
  url.searchParams.set('domain', domain);
  if (input.allowLine === true) {
    const line = normalizeSharerLine(input.line);
    if (line) url.searchParams.set('line', line);
  }
  for (const key of [...url.searchParams.keys()]) {
    if (BANNED_QUERY.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  return url.toString();
}

/**
 * @param {{origin: string, domain: string, score: number|string, summary: string, locale: string, line?: string, allowLine?: boolean, lineLabel?: string}} input
 */
export function buildSharePayload(input) {
  const locale = normalizeLocale(input.locale);
  const allowLine = input.allowLine === true;
  const line = allowLine ? normalizeSharerLine(input.line) : '';
  const url = buildShareLink({
    origin: input.origin,
    domain: input.domain,
    allowLine,
    line,
  });
  const domain = normalizeDomain(input.domain);
  let text = locale === 'en'
    ? `${domain}: ${input.score}. ${input.summary}`
    : `${domain}：${input.score}点。${input.summary}`;
  if (line) {
    const label = typeof input.lineLabel === 'string' ? input.lineLabel.trim() : '';
    text = label ? `${text} ${label} ${line}` : `${text} ${line}`;
  }
  return { title: domain, text, url, line };
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
