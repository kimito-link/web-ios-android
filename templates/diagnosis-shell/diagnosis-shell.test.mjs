// 診断結果シェルの回帰テスト。
// 何を守るか: アプリと拡張の描画に紹介・有料・LINEが出ないこと、点数が先に出ること、
// 共有リンクが共有者の LINE だけで取次店コードを含まないこと、再確認が端末内だけで終わること、文字と背景が 4.5:1 以上であること。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { COPY } from './copy.mjs';
import { findForbiddenWording } from './forbidden-wording.mjs';
import { previewDiagnose } from './preview-diagnose.mjs';
import { QUICK_VIEW_ORDER } from './quick-view.mjs';
import { dueReminders, buildIcs, nextCheckDate, planReminder, rememberRecheck } from './reminder.mjs';
import { renderShell } from './render.mjs';
import { buildShareLink, buildSharePayload, chooseShareChannel, normalizeSharerLine, shareLinkQueryKeys } from './share.mjs';
import { allowsPromoWording, blocksForSurface, resolveSurface } from './surface-policy.mjs';
import { COLOR_PAIRS, contrastRatio } from './tokens.mjs';
import { WEB_ONLY_COPY } from './web-only-copy.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const result = {
  domain: 'example.com',
  score: 88,
  status: 'good',
  checkedAt: '2026-10-27T00:00:00.000Z',
  summary: {
    ja: '大きな問題は見当たりません。',
    en: 'Nothing major turned up.',
  },
};

function draw(surface, extra = {}) {
  return renderShell({
    surface,
    locale: extra.locale || 'ja',
    result,
    origin: 'https://example.com',
    lineUrl: 'https://line.me/R/ti/p/@example',
    pricingPath: '/price/',
    webCopy: WEB_ONLY_COPY,
    ...extra,
  });
}

test('アプリの描画に紹介・有料・LINEの文言が無い', () => {
  const hits = findForbiddenWording(draw('app'));
  assert.deepEqual(hits, []);
});

test('拡張の描画に紹介・有料・LINEの文言が無い', () => {
  const html = draw('extension');
  assert.deepEqual(findForbiddenWording(html), []);
  assert.equal(html.includes('data-pricing'), false);
  assert.equal(html.includes('data-line'), false);
});

test('Web は有料と LINE を出し、紹介は出さない', () => {
  const hits = findForbiddenWording(draw('web'));
  assert.ok(hits.some((hit) => hit.id === 'paid'));
  assert.ok(hits.some((hit) => hit.id === 'line'));
  assert.equal(hits.some((hit) => hit.id === 'referral'), false);
});

test('禁止語の検出器は、文言を足した文字列を赤にする', () => {
  assert.equal(findForbiddenWording('紹介コードはこちら').some((hit) => hit.id === 'referral'), true);
  assert.equal(findForbiddenWording('取次店コードはこちら').some((hit) => hit.id === 'referral'), true);
  assert.equal(findForbiddenWording('料金を見る').some((hit) => hit.id === 'paid'), true);
  assert.equal(findForbiddenWording('LINE公式アカウント').some((hit) => hit.id === 'line'), true);
});

test('環境変数が app のとき、設定が web でも有料と LINE を隠す', () => {
  const html = draw('web', { env: { DISTRIBUTION_SURFACE: 'app' }, sharerLine: '@Example_01' });
  assert.deepEqual(findForbiddenWording(html), []);
  assert.match(html, /data-surface="app"/);
  assert.equal(html.includes('@Example_01'), false);
  assert.equal(html.includes('line='), false);
});

test('環境変数が extension のときも紹介・有料・LINEを出さない', () => {
  const html = draw('web', { env: { DISTRIBUTION_SURFACE: 'extension' }, sharerLine: '@Example_01' });
  assert.equal(allowsPromoWording('extension'), false);
  assert.deepEqual(findForbiddenWording(html), []);
  assert.match(html, /data-surface="extension"/);
  assert.equal(html.includes('@Example_01'), false);
});

test('環境変数が web のときは、設定が app でも今までの案内と共有者の LINE を出す', () => {
  const html = draw('app', { env: { DISTRIBUTION_SURFACE: 'web' }, sharerLine: '@Example_01' });
  const hits = findForbiddenWording(html);
  assert.equal(allowsPromoWording('web'), true);
  assert.ok(hits.some((hit) => hit.id === 'paid'));
  assert.ok(hits.some((hit) => hit.id === 'line'));
  assert.equal(hits.some((hit) => hit.id === 'referral'), false);
  assert.match(html, /line=%40Example_01/);
  assert.match(html, /data-sharer-line/);
});

test('未知の面はアプリとして扱い、有料と LINE を隠す', () => {
  assert.equal(resolveSurface({ distribution: { surface: 'store' } }), 'app');
  assert.equal(resolveSurface({ distribution: { surface: 'web' } }, { DISTRIBUTION_SURFACE: 'kiosk' }), 'web');
  assert.deepEqual(findForbiddenWording(draw('store', { sharerLine: '@Example_01' })), []);
});

test('取次店コードの欄はどの面にも無く、共有リンクは共有者の LINE だけ', () => {
  for (const surface of ['app', 'extension', 'web']) {
    assert.equal(Object.hasOwn(blocksForSurface(surface), 'referral'), false);
    const html = draw(surface, { sharerLine: '@Example_01' });
    assert.equal(html.includes('取次店'), false, surface);
    assert.equal(html.includes('pending-xserver'), false, surface);
    assert.equal(html.includes('referralPlaceholder'), false, surface);
    assert.equal(findForbiddenWording(html).some((hit) => hit.id === 'referral'), false, surface);
    if (surface === 'web') {
      assert.match(html, /data-sharer-line>共有者のLINE @Example_01/);
      assert.match(html, /line=%40Example_01/);
    } else {
      assert.equal(html.includes('@Example_01'), false, surface);
      assert.equal(html.includes('data-sharer-line'), false, surface);
      assert.equal(html.includes('line='), false, surface);
      assert.deepEqual(findForbiddenWording(html), []);
    }
  }
  const untouched = draw('web');
  assert.equal(untouched.includes('data-sharer-line'), false);
  assert.equal(untouched.includes('line='), false);
  const english = draw('web', { locale: 'en', sharerLine: '@Example_01' });
  assert.match(english, /data-sharer-line>Sharer LINE @Example_01/);
  const englishApp = draw('app', { locale: 'en', sharerLine: '@Example_01', env: { DISTRIBUTION_SURFACE: 'app' } });
  assert.deepEqual(findForbiddenWording(englishApp), []);
  assert.equal(englishApp.includes('Sharer LINE'), false);
});

test('点数、状態の言葉、ひとこと、詳しい説明の順', () => {
  const html = draw('app');
  const scoreAt = html.indexOf('data-score');
  const statusAt = html.indexOf('data-status-label');
  const summaryAt = html.indexOf('data-summary');
  const detailsAt = html.indexOf('data-details');
  assert.ok(scoreAt >= 0 && scoreAt < statusAt && statusAt < summaryAt && summaryAt < detailsAt);
  assert.deepEqual(QUICK_VIEW_ORDER[0], 'score');
  assert.match(html, /data-score-value>88</);
  assert.match(html, /大きな問題は見当たりません。/);
});

test('状態は色だけでなく言葉と印で示す', () => {
  for (const status of ['good', 'warn', 'bad']) {
    const html = draw('app', { result: { ...result, status } });
    assert.match(html, new RegExp(`data-status-label>${COPY.status[status].ja}`));
    assert.match(html, new RegExp(`aria-hidden="true">${COPY.status[status].icon}`));
  }
});

test('英語でも点数とひとことが先に出る', () => {
  const html = draw('app', { locale: 'en' });
  assert.match(html, /Nothing major turned up\./);
  assert.match(html, /data-status-label>Good/);
  assert.ok(html.indexOf('data-score') < html.indexOf('data-summary'));
  for (const key of ['check', 'share', 'addCalendar', 'remindDevice', 'recheckLabel']) {
    assert.equal(typeof COPY[key].ja, 'string');
    assert.equal(typeof COPY[key].en, 'string');
    assert.notEqual(COPY[key].ja, COPY[key].en);
  }
});

test('次の確認日を出し、カレンダーファイルは外部 URL を持たない', () => {
  assert.equal(nextCheckDate('2026-10-27T15:00:00.000Z'), '2026-11-26');
  const html = draw('app');
  assert.match(html, /datetime="2026-11-26"/);
  const ics = buildIcs({ domain: 'example.com', nextCheckOn: '2026-11-26', locale: 'ja' });
  assert.match(ics, /DTSTART;VALUE=DATE:20261126/);
  assert.equal(/https?:/i.test(ics), false);
  assert.deepEqual(findForbiddenWording(ics), []);
});

test('再確認は端末内のメモだけで、サーバープッシュも収集もしない', () => {
  const plan = planReminder('app', {
    capacitorLocalNotifications: true,
    chromeAlarms: false,
    notificationApi: true,
  });
  assert.equal(plan.serverPush, false);
  assert.equal(plan.collectsData, false);
  assert.equal(plan.calendar, 'ics-download');
  assert.deepEqual(plan.local, ['capacitor-local-notification', 'notification-while-open']);
  const stored = rememberRecheck([], { domain: 'example.com', nextCheckOn: '2026-11-26', referral: 'secret' });
  assert.deepEqual(stored, [{ domain: 'example.com', nextCheckOn: '2026-11-26' }]);
  assert.equal(dueReminders(stored, '2026-11-26').length, 1);
  assert.equal(dueReminders(stored, '2026-11-25').length, 0);
});

test('共有リンクは /check/ と共有者の LINE だけで、取次店コードを付けない', () => {
  const plain = buildShareLink({ origin: 'https://example.com', domain: 'https://www.example.com/path' });
  assert.equal(plain, 'https://example.com/check/?domain=example.com');
  assert.deepEqual(shareLinkQueryKeys(plain), ['domain']);
  const shared = buildShareLink({
    origin: 'https://example.com',
    domain: 'https://www.example.com/path',
    allowLine: true,
    line: '@Example_01',
  });
  assert.equal(shared, 'https://example.com/check/?domain=example.com&line=%40Example_01');
  assert.deepEqual(shareLinkQueryKeys(shared), ['domain', 'line']);
  assert.equal(normalizeSharerLine('12345678'), '');
  assert.equal(normalizeSharerLine('取次店123'), '');
  assert.equal(normalizeSharerLine('referral'), '');
  const refused = buildShareLink({
    origin: 'https://example.com',
    domain: 'example.com',
    allowLine: true,
    line: '12345678',
  });
  assert.deepEqual(shareLinkQueryKeys(refused), ['domain']);
  const hidden = buildSharePayload({
    origin: 'https://example.com',
    domain: 'example.com',
    score: 88,
    summary: 'ok',
    locale: 'ja',
    allowLine: false,
    line: '@Example_01',
    lineLabel: '共有者のLINE',
  });
  assert.equal(hidden.url, 'https://example.com/check/?domain=example.com');
  assert.equal(hidden.line, '');
  assert.equal(hidden.text.includes('@Example_01'), false);
  assert.equal(hidden.text.includes('LINE'), false);
  const shown = buildSharePayload({
    origin: 'https://example.com',
    domain: 'example.com',
    score: 88,
    summary: 'ok',
    locale: 'ja',
    allowLine: true,
    line: '@Example_01',
    lineLabel: '共有者のLINE',
  });
  assert.equal(shown.line, '@Example_01');
  assert.match(shown.text, /共有者のLINE @Example_01$/);
  assert.equal(new URL(shown.url).searchParams.get('ref'), null);
  assert.equal(new URL(shown.url).searchParams.get('agency'), null);
  assert.equal(chooseShareChannel('app', { webShare: true }), 'native-sheet');
  assert.equal(chooseShareChannel('app', { capacitorShare: true }), 'native-sheet');
  assert.equal(chooseShareChannel('web', { webShare: true }), 'web-share');
  assert.equal(chooseShareChannel('web', {}), 'copy-link');
  assert.equal(chooseShareChannel('extension', {}), 'copy-link');
  assert.throws(() => buildShareLink({ origin: 'http://example.com', domain: 'example.com' }));
  assert.throws(() => buildShareLink({ origin: 'https://www.example.com', domain: 'example.com' }));
});

test('結果の要約に記号が入っても HTML として実行されない', () => {
  const html = draw('app', {
    result: {
      ...result,
      summary: { ja: '<script>alert(1)</script>', en: '"quoted"' },
    },
  });
  assert.equal(html.includes('<script>alert'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('文字色と背景色は 4.5:1 以上で、CSS が同じ色を使う', () => {
  const css = readFileSync(`${HERE}diagnosis-shell.css`, 'utf8');
  assert.equal(/[^-\w]order\s*:/.test(css), false);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /flex-wrap:\s*wrap/);
  assert.match(css, /clamp\(/);
  for (const pair of COLOR_PAIRS) {
    assert.ok(contrastRatio(pair.fg, pair.bg) >= pair.min, pair.name);
    assert.match(css, new RegExp(`pair:${pair.name} fg`));
    assert.ok(css.includes(pair.fg), pair.fg);
    assert.ok(css.includes(pair.bg), pair.bg);
  }
});

test('見本診断は同じドメインなら同じ点数で、外部送信の文を含む', () => {
  const first = previewDiagnose('example.com');
  const second = previewDiagnose('example.com');
  assert.equal(first.score, second.score);
  assert.match(first.summary.ja, /外部へは送っていません/);
  assert.match(first.summary.en, /not sent/);
});

test('シェルのブラウザ側は通信 API を呼ばない', () => {
  const sources = [
    'diagnosis-shell.js',
    'preview-diagnose.mjs',
    'reminder.mjs',
    'share.mjs',
    'render.mjs',
    'extension/alarm-listener.js',
    'extension/popup.html',
  ];
  for (const name of sources) {
    const source = readFileSync(`${HERE}${name}`, 'utf8');
    assert.equal(/\bfetch\s*\(/.test(source), false, name);
    assert.equal(/XMLHttpRequest|sendBeacon|pushManager|firebase|FCM/i.test(source), false, name);
  }
});

test('拡張の読み込み経路に、Web 向けの案内文ファイルが無い', () => {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(`${HERE}${file}`, 'utf8');
    const imports = source.matchAll(/from\s+['"](\.[^'"]+)['"]/g);
    for (const found of imports) {
      const next = new URL(found[1], `file://${HERE}${file}`).pathname.replace(HERE, '');
      walk(next.endsWith('.mjs') || next.endsWith('.js') ? next : `${next}.mjs`);
    }
  };
  walk('extension/popup.html');
  assert.equal(seen.has('web-only-copy.mjs'), false);
  for (const file of seen) {
    const source = readFileSync(`${HERE}${file}`, 'utf8');
    assert.equal(source.includes('料金を見る'), false, file);
    assert.equal(source.includes('Talk with us on LINE'), false, file);
    assert.equal(source.includes('line.me'), false, file);
  }
});

test('app.config の distribution は面だけで、取次店コードの欄を許さない', () => {
  const schema = JSON.parse(readFileSync(`${ROOT}app.config.schema.json`, 'utf8'));
  const config = JSON.parse(readFileSync(`${ROOT}app.config.json`, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema.properties.distribution);
  assert.equal(validate(config.distribution), true, JSON.stringify(validate.errors));
  assert.equal(Object.hasOwn(config.distribution, 'referralPlaceholder'), false);
  assert.equal(Object.hasOwn(schema.properties.distribution.properties, 'referralPlaceholder'), false);
  assert.equal(config.distribution.surface, 'web');
  assert.equal(validate({ surface: 'mars' }), false);
  assert.equal(validate({
    surface: 'web',
    referralPlaceholder: { enabled: false, status: 'pending-xserver' },
  }), false);
  assert.equal(validate({ surface: 'extension' }), true);
});
