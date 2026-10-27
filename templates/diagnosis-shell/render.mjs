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
  const share = input.result.score == null ? null : buildSharePayload({
    origin: input.origin || 'https://example.com',
    domain: input.result.domain,
    score: input.result.score,
    summary: view.summary,
    locale,
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
  const webCopy = input.webCopy || {};
  if (blocks.pricing && input.pricingPath && webCopy.pricing && webCopy.pricing[locale]) {
    parts.push(`<p class="web-only" data-pricing><a href="${escapeHtml(input.pricingPath)}">${escapeHtml(webCopy.pricing[locale])}</a></p>`);
  }
  if (blocks.line && input.lineUrl && webCopy.line && webCopy.line[locale]) {
    parts.push(`<p class="web-only" data-line><a href="${escapeHtml(input.lineUrl)}">${escapeHtml(webCopy.line[locale])}</a></p>`);
  }
  return parts.join('');
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
