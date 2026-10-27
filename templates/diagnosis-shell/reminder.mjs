// 次に確認する日と、端末の中だけで行う知らせ・カレンダー登録。
// なぜ要るか: 結果を見た人が、いつもう一度見るかをその場で決められるようにする。
// サーバーへの送信も、サーバー発のプッシュもしない。測れない外部の許可は、カレンダーファイルに落とす。

export const RECHECK_INTERVAL_DAYS = 30;

/**
 * @param {string|Date} from
 * @param {number} [days]
 * @returns {string} YYYY-MM-DD
 */
export function nextCheckDate(from, days = RECHECK_INTERVAL_DAYS) {
  const start = from instanceof Date ? from : new Date(from);
  if (Number.isNaN(start.getTime())) throw new Error('invalid date');
  const utc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + days);
  return new Date(utc).toISOString().slice(0, 10);
}

/**
 * その面で使える本地の知らせ。サーバープッシュはどの面でも使わない。
 * @param {'app'|'extension'|'web'} _surface
 * @param {{capacitorLocalNotifications?: boolean, chromeAlarms?: boolean, notificationApi?: boolean}} caps
 */
export function planReminder(_surface, caps) {
  const local = [];
  if (caps && caps.capacitorLocalNotifications) local.push('capacitor-local-notification');
  if (caps && caps.chromeAlarms) local.push('chrome-alarm');
  if (caps && caps.notificationApi) local.push('notification-while-open');
  return {
    calendar: 'ics-download',
    local,
    serverPush: false,
    collectsData: false,
  };
}

/**
 * @param {{domain: string, nextCheckOn: string, locale: string}} input
 */
export function buildIcs(input) {
  const day = String(input.nextCheckOn).replace(/-/g, '');
  if (!/^\d{8}$/.test(day)) throw new Error('invalid next check date');
  const summary = input.locale === 'en'
    ? `Check ${input.domain} again`
    : `${input.domain} を再確認`;
  const uidHost = String(input.domain).replace(/[^a-z0-9.-]/gi, '') || 'local';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//diagnosis-shell//recheck//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${day}-${uidHost}@local`,
    `DTSTAMP:${day}T000000Z`,
    `DTSTART;VALUE=DATE:${day}`,
    `SUMMARY:${escapeIcs(summary)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

function escapeIcs(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

/** 端末内の再確認メモ。案内の識別子や連絡先は足さない。 */
export function rememberRecheck(list, item) {
  const next = Array.isArray(list) ? list.slice() : [];
  next.push({ domain: item.domain, nextCheckOn: item.nextCheckOn });
  return next;
}

/** @param {Array<{domain: string, nextCheckOn: string}>} list @param {string} today YYYY-MM-DD */
export function dueReminders(list, today) {
  const day = String(today).slice(0, 10);
  return (Array.isArray(list) ? list : []).filter((item) => item && typeof item.nextCheckOn === 'string' && item.nextCheckOn <= day);
}
