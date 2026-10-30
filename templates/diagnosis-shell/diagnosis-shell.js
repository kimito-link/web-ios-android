// 診断結果シェルの画面側。ドメイン送信の直後に点数を出し、共有と再確認を端末内で行う。
// なぜ要るか: Web、アプリの WebView、拡張のポップアップが同じ動きをコピーして使えるようにする。
// サーバーへの送信、サーバー発のプッシュ、案内の入力欄は無い。

import { COPY, normalizeLocale, text } from './copy.mjs';
import { resolveSurface } from './surface-policy.mjs';
import { renderResult, renderShell } from './render.mjs';
import { buildIcs, dueReminders, planReminder, rememberRecheck } from './reminder.mjs';
import { buildSharePayload, chooseShareChannel, normalizeDomain } from './share.mjs';

const STORAGE_KEY = 'diagnosis-shell-recheck';

/**
 * @param {HTMLElement} root
 * @param {object} options
 */
export function mountDiagnosisShell(root, options) {
  const opts = options || {};
  const config = opts.config || {};
  const surface = resolveSurface({
    distribution: {
      surface: (root.dataset && root.dataset.surface) || (config.distribution && config.distribution.surface),
    },
  }, opts.env);
  let locale = normalizeLocale(opts.locale || root.lang || 'ja');
  let result = null;
  const origin = opts.origin || (globalThis.location && globalThis.location.origin) || 'https://example.com';
  const lineUrl = opts.lineUrl || (config.contact && config.contact.lineUrl) || '';

  const paint = (next) => {
    result = next;
    root.innerHTML = renderShell({
      surface,
      locale,
      result,
      origin,
      lineUrl,
      env: opts.env,
      now: opts.now,
      pricingPath: opts.pricingPath,
      webCopy: opts.webCopy,
      sharerLine: opts.sharerLine,
    });
    bind();
    announceDue();
  };

  const bind = () => {
    const form = root.querySelector('[data-domain-form]');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const domain = normalizeDomain(new FormData(form).get('domain'));
      if (!domain || typeof opts.diagnose !== 'function') return;
      const produced = opts.diagnose(domain);
      if (produced && typeof produced.then === 'function') {
        paint(pendingResult(domain));
        produced.then((value) => paint(value));
        return;
      }
      paint(produced);
    });
    root.querySelector('[data-action="language"]').addEventListener('click', () => {
      locale = locale === 'en' ? 'ja' : 'en';
      paint(result);
    });
    const calendar = root.querySelector('[data-action="calendar"]');
    if (calendar) calendar.addEventListener('click', () => downloadCalendar());
    const remind = root.querySelector('[data-action="remind"]');
    if (remind) remind.addEventListener('click', () => storeReminder());
    const share = root.querySelector('[data-action="share"]');
    if (share) share.addEventListener('click', () => shareResult());
  };

  const downloadCalendar = () => {
    if (!result || !result.domain) return;
    const nextOn = root.querySelector('[data-next-check]').getAttribute('datetime');
    const ics = buildIcs({ domain: result.domain, nextCheckOn: nextOn, locale });
    const blob = new Blob([ics], { type: 'text/calendar' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'recheck.ics';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const storeReminder = async () => {
    if (!result || !result.domain) return;
    const nextOn = root.querySelector('[data-next-check]').getAttribute('datetime');
    const list = rememberRecheck(readList(), { domain: result.domain, nextCheckOn: nextOn });
    writeList(list);
    const caps = detectCaps();
    const plan = planReminder(surface, caps);
    if (plan.local.includes('capacitor-local-notification')) {
      await scheduleCapacitor(result.domain, nextOn, locale);
    } else if (plan.local.includes('chrome-alarm')) {
      scheduleChromeAlarm(result.domain, nextOn);
    } else if (plan.local.includes('notification-while-open') && globalThis.Notification) {
      await Notification.requestPermission();
    }
    const status = root.querySelector('[data-share-status]');
    if (status) status.textContent = text(locale, 'remindSaved');
  };

  const shareResult = async () => {
    if (!result || result.score == null) return;
    const allowLine = surface === 'web';
    const lineCopy = opts.webCopy && opts.webCopy.sharerLine;
    const payload = buildSharePayload({
      origin,
      domain: result.domain,
      score: result.score,
      summary: result.summary[locale],
      locale,
      allowLine,
      line: opts.sharerLine,
      lineLabel: allowLine && lineCopy ? lineCopy[locale] : '',
    });
    const channel = chooseShareChannel(surface, {
      capacitorShare: Boolean(globalThis.Capacitor && globalThis.Capacitor.Plugins && globalThis.Capacitor.Plugins.Share),
      webShare: typeof navigator.share === 'function',
    });
    const status = root.querySelector('[data-share-status]');
    const sheet = { title: payload.title, text: payload.text, url: payload.url };
    if (channel === 'native-sheet' && globalThis.Capacitor && globalThis.Capacitor.Plugins && globalThis.Capacitor.Plugins.Share) {
      await globalThis.Capacitor.Plugins.Share.share(sheet);
      return;
    }
    if (channel === 'native-sheet' || channel === 'web-share') {
      await navigator.share(sheet);
      return;
    }
    await navigator.clipboard.writeText(payload.url);
    if (status) status.textContent = text(locale, 'copied');
  };

  const announceDue = () => {
    const due = dueReminders(readList(), todayStamp());
    if (due.length === 0) return;
    const note = document.createElement('p');
    note.className = 'due';
    note.setAttribute('role', 'status');
    note.dataset.due = 'true';
    note.textContent = `${text(locale, 'dueNow')}: ${due[0].domain}`;
    root.prepend(note);
  };

  paint(null);
  return { surface };
}

function pendingResult(domain) {
  return {
    domain,
    score: null,
    status: 'pending',
    summary: { ja: COPY.status.pending.ja, en: COPY.status.pending.en },
    checkedAt: new Date().toISOString(),
  };
}

function detectCaps() {
  const plugins = globalThis.Capacitor && globalThis.Capacitor.Plugins;
  return {
    capacitorLocalNotifications: Boolean(plugins && plugins.LocalNotifications && plugins.LocalNotifications.schedule),
    chromeAlarms: Boolean(globalThis.chrome && globalThis.chrome.alarms && globalThis.chrome.notifications),
    notificationApi: typeof globalThis.Notification === 'function',
  };
}

async function scheduleCapacitor(domain, nextOn, locale) {
  const local = globalThis.Capacitor.Plugins.LocalNotifications;
  const at = new Date(`${nextOn}T09:00:00`);
  await local.schedule({
    notifications: [{
      id: Math.abs(hashCode(`${domain}:${nextOn}`)) % 2147483647,
      title: text(locale, 'dueNow'),
      body: domain,
      schedule: { at },
    }],
  });
}

function scheduleChromeAlarm(domain, nextOn) {
  const when = new Date(`${nextOn}T09:00:00`).getTime();
  globalThis.chrome.alarms.create(`recheck:${domain}:${nextOn}`, { when });
}

function readList() {
  try {
    const raw = globalThis.localStorage && localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeList(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 端末が保存を拒否しても、カレンダー登録は別ボタンで残る。
  }
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function hashCode(value) {
  let hash = 0;
  for (const ch of value) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0;
  return hash;
}

export { renderResult };
