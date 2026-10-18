import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocalizationAttrs as r } from './asc-localization-attrs.mjs';

const prev = { attributes: { description: '旧説明', keywords: '旧,キー', promotionalText: '旧PT', marketingUrl: 'm0', supportUrl: 's0' } };
const urls = { marketingUrl: 'm1', supportUrl: 's1' };

test('ファイルがあれば前の版・今の版より優先する', () => {
  const a = r({ copy: prev, ja: prev, files: { description: '新説明', keywords: '新,キー', promotionalText: '新PT' }, urls, includeWhatsNew: false });
  assert.equal(a.description, '新説明');
  assert.equal(a.keywords, '新,キー');
  assert.equal(a.promotionalText, '新PT');
});

test('ファイルが無い項目だけ前の版を引き継ぐ', () => {
  const a = r({ copy: prev, ja: null, files: { keywords: '新,キー' }, urls, includeWhatsNew: false });
  assert.equal(a.description, '旧説明');
  assert.equal(a.keywords, '新,キー');
  assert.equal(a.marketingUrl, 'm0');
});

test('何も無ければ URL は既定値・promotionalText は undefined', () => {
  const a = r({ copy: null, ja: null, urls, includeWhatsNew: false });
  assert.equal(a.marketingUrl, 'm1');
  assert.equal(a.promotionalText, undefined);
});

test('whatsNew は更新版のみ', () => {
  assert.equal('whatsNew' in r({ urls, whatsNew: 'x', includeWhatsNew: false }), false);
  assert.equal(r({ urls, whatsNew: 'x', includeWhatsNew: true }).whatsNew, 'x');
});
