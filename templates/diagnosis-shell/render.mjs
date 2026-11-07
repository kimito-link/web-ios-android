// 診断結果シェルの HTML。点数、状態の言葉、ひとこと、再確認、共有の順。
// なぜ要るか: ブラウザでもテストでも同じ並びを使い、アプリビルドに人へ勧める案内文が出ないことを描画結果で確かめる。
// 案内の目印は画面に出さない。案内文そのものは呼び出し側が webCopy として渡したときだけ、Web の面で使う。

import { COPY, normalizeLocale, text } from './copy.mjs';
import { blocksForSurface, resolveSurface } from './surface-policy.mjs';
import { buildQuickView } from './quick-view.mjs';
import { nextCheckDate } from './reminder.mjs';
import { buildSharePayload } from './share.mjs';

/**
 * @param {object} input
 * @param {string} input.surface
 * @param {string} [input.locale]
 * @param {object} [input.env]
 * @param {object|null} [input.result]
 * @param {string} [input.origin]
 * @param {string} [input.lineUrl]
 * @param {string} [input.sharerLine]
 * @param {string} [input.pricingPath]
 * @param {string} [input.now]
 */
export function renderShell(input) {
  const surface = resolveSurface(
    { distribution: { surface: input.surface } },
    input.env,
  );
  const locale = normalizeLocale(input.locale);
  const blocks = blocksForSurface(surface);
  const resultHtml = input.result
    ? renderResult({ ...input, surface, locale, blocks })
    : '';
  return [
    `<section class="diagnosis-shell" data-diagnosis-shell data-surface="${escapeHtml(surface)}" lang="${locale}">`,
    renderLanguageButton(locale),
    '<form class="domain-form" data-domain-form>',
    `<label for="diagnosis-domain">${escapeHtml(text(locale, 'domainLabel'))}</label>`,
    `<input id="diagnosis-domain" name="domain" type="text" inputmode="url" autocomplete="url" spellcheck="false" required placeholder="${escapeHtml(text(locale, 'domainHint'))}">`,
    `<button type="submit">${escapeHtml(text(locale, 'check'))}</button>`,
    '</form>',
    `<div class="result" data-result ${input.result ? '' : 'hidden'}>`,
    resultHtml,
    '</div>',
    '</section>',
  ].join('');
}

/**
 * @param {object} input
 */
export function renderResult(input) {
  const surface = input.surface || resolveSurface({ distribution: { surface: input.surface } }, input.env);
  const locale = normalizeLocale(input.locale);
  const blocks = input.blocks || blocksForSurface(surface);
  const view = buildQuickView(input.result, locale);
  const checkedAt = input.result.checkedAt || input.now || '2026-10-27T00:00:00.000Z';
  const nextOn = nextCheckDate(checkedAt);
  const webCopy = input.webCopy || {};
  const allowLine = blocks.line === true;
  const share = input.result.score == null ? null : buildSharePayload({
    origin: input.origin || 'https://example.com',
    domain: input.result.domain,
    score: input.result.score,
    summary: view.summary,
    locale,
    allowLine,
    line: input.sharerLine,
    lineLabel: allowLine && webCopy.sharerLine ? webCopy.sharerLine[locale] : '',
  });
  const parts = [
    '<div class="quick" data-quick-view>',
    `<p class="score" data-score><span class="score-number" data-score-value>${view.score == null ? escapeHtml(COPY.pendingScore[locale]) : escapeHtml(view.score)}</span> <span class="score-caption" data-score-caption>${escapeHtml(text(locale, 'scoreCaption'))}</span></p>`,
    `<p class="status status-${escapeHtml(view.status)}" data-status><span class="status-icon" aria-hidden="true">${escapeHtml(view.statusIcon)}</span> <span data-status-label>${escapeHtml(view.statusLabel)}</span></p>`,
    `<p class="summary" data-summary><span class="summary-label">${escapeHtml(text(locale, 'summaryHeading'))}</span> ${escapeHtml(view.summary)}</p>`,
    '</div>',
    '<div class="recheck" data-recheck>',
    `<p><span class="recheck-label">${escapeHtml(text(locale, 'recheckLabel'))}</span> <time data-next-check datetime="${escapeHtml(nextOn)}">${escapeHtml(nextOn)}</time></p>`,
    `<div class="actions">`,
    `<button type="button" data-action="calendar">${escapeHtml(text(locale, 'addCalendar'))}</button>`,
    `<button type="button" data-action="remind">${escapeHtml(text(locale, 'remindDevice'))}</button>`,
    `<button type="button" data-action="share">${escapeHtml(text(locale, 'share'))}</button>`,
    '</div>',
    '<p class="share-status" data-share-status role="status"></p>',
    '</div>',
  ];
  if (share) parts.push(`<p class="share-link" data-share-url hidden>${escapeHtml(share.url)}</p>`);
  parts.push(
    '<details class="details" data-details>',
    `<summary>${escapeHtml(text(locale, 'detailsSummary'))}</summary>`,
    `<p data-stays-local>${escapeHtml(text(locale, 'staysLocal'))}</p>`,
    `<p data-checked-domain>${escapeHtml(view.domain)}</p>`,
    '</details>',
  );
  if (webSurface(blocks)) {
    parts.push(renderReason(webCopy, locale));
  }
  if (blocks.pricing && input.pricingPath && webCopy.pricing && webCopy.pricing[locale]) {
    const lead = webCopy.pricingLead && webCopy.pricingLead[locale];
    if (lead) parts.push(`<p class="web-only" data-pricing-lead>${escapeHtml(lead)}</p>`);
    parts.push(`<p class="web-only" data-pricing><a href="${escapeHtml(input.pricingPath)}">${escapeHtml(webCopy.pricing[locale])}</a></p>`);
  }
  if (blocks.line && input.lineUrl && webCopy.line && webCopy.line[locale]) {
    const lead = webCopy.lineLead && webCopy.lineLead[locale];
    if (lead) parts.push(`<p class="web-only" data-line-lead>${escapeHtml(lead)}</p>`);
    parts.push(`<p class="web-only" data-line><a href="${escapeHtml(input.lineUrl)}">${escapeHtml(webCopy.line[locale])}</a></p>`);
  }
  if (webSurface(blocks)) {
    parts.push(renderOffers(input.offers, webCopy, locale));
  }
  if (share && share.line) {
    const label = webCopy.sharerLine && webCopy.sharerLine[locale];
    const shown = label ? `${label} ${share.line}` : share.line;
    parts.push(`<p class="web-only" data-sharer-line>${escapeHtml(shown)}</p>`);
  }
  return parts.join('');
}

function webSurface(blocks) {
  return blocks.pricing === true || blocks.line === true;
}

function renderReason(webCopy, locale) {
  const reason = webCopy.reason;
  if (!reason) return '';
  const keys = ['relevance', 'benefit', 'acting', 'waiting'];
  const paragraphs = [];
  for (const key of keys) {
    const text = reason[key] && reason[key][locale];
    if (!text) return '';
    paragraphs.push(`<p data-reason-${key}>${escapeHtml(text)}</p>`);
  }
  return `<div class="reason web-only" data-reason>${paragraphs.join('')}</div>`;
}

function renderOffers(offers, webCopy, locale) {
  if (!Array.isArray(offers) || offers.length === 0) return '';
  const cards = [];
  for (const offer of offers) {
    const card = renderOffer(offer, locale);
    if (card) cards.push(card);
  }
  if (cards.length === 0) return '';
  const heading = webCopy.offersHeading && webCopy.offersHeading[locale];
  const note = webCopy.offersNote && webCopy.offersNote[locale];
  return [
    '<section class="offers web-only" data-complementary>',
    heading ? `<h2>${escapeHtml(heading)}</h2>` : '',
    note ? `<p data-offers-note>${escapeHtml(note)}</p>` : '',
    cards.join(''),
    '</section>',
  ].join('');
}

function renderOffer(offer, locale) {
  if (!offer || typeof offer !== 'object') return '';
  const href = safeOfferHref(offer.href);
  const name = localized(offer.name, locale);
  const joint = localized(offer.jointBenefit, locale);
  const price = localized(offer.priceText, locale);
  const ask = localized(offer.askLabel, locale);
  const decline = localized(offer.decline, locale);
  if (!href || !name || !joint || !price || !ask || !decline) return '';
  const id = typeof offer.id === 'string' ? offer.id : '';
  return [
    `<article class="offer" data-offer="${escapeHtml(id)}">`,
    `<h3>${escapeHtml(name)}</h3>`,
    `<p data-joint>${escapeHtml(joint)}</p>`,
    `<p data-offer-price>${escapeHtml(price)}</p>`,
    `<p class="web-only"><a href="${escapeHtml(href)}">${escapeHtml(ask)}</a></p>`,
    `<p data-decline>${escapeHtml(decline)}</p>`,
    '</article>',
  ].join('');
}

function localized(value, locale) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && typeof value[locale] === 'string' && value[locale].trim()) {
    return value[locale].trim();
  }
  return '';
}

function safeOfferHref(value) {
  const href = typeof value === 'string' ? value.trim() : '';
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:') return '';
    if (url.hostname.startsWith('www.')) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function renderLanguageButton(locale) {
  const next = locale === 'en' ? 'ja' : 'en';
  return `<button type="button" class="language" data-action="language" data-next-locale="${next}">${escapeHtml(text(locale, 'language'))}</button>`;
}

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}
