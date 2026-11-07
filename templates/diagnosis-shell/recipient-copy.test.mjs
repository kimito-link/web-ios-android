// Web の案内文が、相手の得から始まり、店頭ビルドへ漏れず、実在の組み合わせだけを出すことを見る。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderShell } from './render.mjs';
import { contrastRatio } from './tokens.mjs';
import { WEB_ONLY_COPY } from './web-only-copy.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LP = readFileSync(`${ROOT}site/lp/index.html`, 'utf8');
const BANNED = /必ず|絶対|確実|保証|今だけ|期間限定|先着|割引|今すぐ|財布|ポテト|コーラ/;

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) strings(item, out);
  }
  return out;
}

function sliceBetween(html, start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return html.slice(from, to);
}

test('案内文に、根拠の無い強さや食べ物のたとえを入れない', () => {
  for (const line of strings(WEB_ONLY_COPY)) {
    assert.equal(BANNED.test(line), false, line);
  }
  assert.equal(WEB_ONLY_COPY.reason.relevance.ja.includes('LINE'), false);
  assert.match(WEB_ONLY_COPY.lineLead.ja, /任意|使わなくても/);
  assert.match(WEB_ONLY_COPY.line.ja, /任意/);
});

test('英語でも結果が先で、LINE は手段の文にだけ出る', () => {
  const html = renderShell({
    surface: 'web',
    locale: 'en',
    result: {
      domain: 'example.com',
      score: 88,
      status: 'good',
      checkedAt: '2026-10-27T00:00:00.000Z',
      summary: { ja: '大きな問題は見当たりません。', en: 'Nothing major turned up.' },
    },
    origin: 'https://example.com',
    lineUrl: 'https://line.me/R/ti/p/@example',
    pricingPath: '/price/',
    webCopy: WEB_ONLY_COPY,
  });
  assert.ok(html.indexOf('data-score') < html.indexOf('data-reason-relevance'));
  assert.ok(html.indexOf('data-reason-waiting') < html.indexOf('data-line'));
  assert.match(html, /Ask about this result on LINE \(optional\)/);
  assert.match(html, /does not send the result/);
  const reason = html.slice(html.indexOf('data-reason'), html.indexOf('data-line-lead'));
  assert.equal(reason.includes('LINE'), false);
});

test('LP は既存の料金のまま、補完と見送りと軽い道だけを足す', () => {
  const together = sliceBetween(LP, 'id="together"', 'こんなWebサービスに向いています');
  assert.match(together, /data-complementary="continuity"/);
  assert.match(together, /data-complementary="iap"/);
  assert.match(together, /構築を頼むと証明書とストア規約の更新が残るので、継続運用を足すと、その更新を同じ運用の中で任せられます。/);
  assert.match(together, /ウェブでいま受けている支払いを、ストアのアプリからも受け取れるようにします。/);
  assert.match(together, /¥30,000 \/ 月/);
  assert.match(together, /\+¥100,000/);
  assert.match(together, /data-decline/);
  assert.match(together, /このページは合計を自動では出しません/);
  assert.equal(/<input/i.test(together), false);
  assert.equal(/checked=/i.test(together), false);
  assert.equal(BANNED.test(together), false);
  assert.equal(together.includes('LINE'), false);
  assert.equal(LP.includes('60秒'), false);
  assert.match(LP, /data-lighter-path="web-wrap"/);
  assert.match(LP, /data-lighter-alternative/);
  assert.match(LP, /運営: 株式会社ベストトラスト/);
  assert.match(LP, /text-decoration: underline/);
  assert.match(LP, /"price": "0"/);
  assert.match(LP, /"price": "30000"/);
  assert.match(LP, /"price": "300000"/);
  const scripts = LP.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  assert.ok(scripts.length >= 2);
  for (const block of scripts) {
    const json = block.replace(/^<script type="application\/ld\+json">/, '').replace(/<\/script>$/, '');
    JSON.parse(json);
  }
  assert.ok(contrastRatio('#12203f', '#ffffff') >= 4.5);
});

test('見本の診断ページは、別商品の料金を持たない', () => {
  const page = readFileSync(fileURLToPath(new URL('./check-page.html', import.meta.url)), 'utf8');
  assert.equal(page.includes('data-complementary'), false);
  assert.equal(page.includes('¥30,000'), false);
  assert.equal(page.includes('offers:'), false);
});
