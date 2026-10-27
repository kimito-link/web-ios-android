// 診断結果シェルの表示文。日本語と英語を同じキーで持つ。
// なぜ要るか: 結果を一目で読む文と、再確認・共有のボタン文を1か所に置く。
// 人に勧めるための案内文は、このファイルには置かない。

/** @typedef {'ja'|'en'} Locale */

export const COPY = Object.freeze({
  title: { ja: 'ドメインの結果', en: 'Domain result' },
  domainLabel: { ja: 'ドメイン', en: 'Domain' },
  domainHint: { ja: '例: example.com', en: 'Example: example.com' },
  check: { ja: '結果を見る', en: 'Show result' },
  scoreCaption: { ja: '点', en: 'score' },
  summaryHeading: { ja: 'ひとこと', en: 'In short' },
  language: { ja: 'English', en: '日本語' },
  recheckLabel: { ja: '次の確認日', en: 'Next check' },
  addCalendar: { ja: 'カレンダーに入れる', en: 'Add to calendar' },
  remindDevice: { ja: 'この端末で知らせる', en: 'Remind me on this device' },
  remindSaved: { ja: 'この端末に覚えました', en: 'Saved on this device' },
  share: { ja: '結果を共有', en: 'Share result' },
  copied: { ja: 'リンクをコピーしました', en: 'Link copied' },
  detailsSummary: { ja: 'くわしく見る', en: 'More detail' },
  staysLocal: {
    ja: 'この結果は端末の中だけにあり、サーバーへは送っていません。',
    en: 'This result stays on this device and is not sent to a server.',
  },
  dueNow: { ja: '再確認の日です', en: 'Time to check again' },
  pendingScore: { ja: '…', en: '…' },
  status: {
    good: { ja: '良好', en: 'Good', icon: '✓' },
    warn: { ja: '注意', en: 'Needs a look', icon: '▲' },
    bad: { ja: '要対応', en: 'Action needed', icon: '■' },
    pending: { ja: '確認中', en: 'Checking', icon: '…' },
  },
});

/**
 * @param {Locale} locale
 * @param {keyof typeof COPY} key
 */
export function text(locale, key) {
  const row = COPY[key];
  const loc = locale === 'en' ? 'en' : 'ja';
  return row[loc];
}

/**
 * @param {string} locale
 * @returns {Locale}
 */
export function normalizeLocale(locale) {
  return locale === 'en' ? 'en' : 'ja';
}
