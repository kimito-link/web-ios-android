import { expect, test } from 'vitest';
import { resolveLocalizationAttrs as r } from './asc-localization-attrs.mjs';

const prev = { attributes: { description: '旧説明', keywords: '旧,キー', promotionalText: '旧PT', marketingUrl: 'm0', supportUrl: 's0' } };
const urls = { marketingUrl: 'm1', supportUrl: 's1' };

test('ファイルがあれば前の版・今の版より優先する', () => {
  const a = r({ copy: prev, ja: prev, files: { description: '新説明', keywords: '新,キー', promotionalText: '新PT' }, urls, includeWhatsNew: false });
  expect(a.description).toBe('新説明');
  expect(a.keywords).toBe('新,キー');
  expect(a.promotionalText).toBe('新PT');
});

test('ファイルが無い項目だけ前の版を引き継ぐ', () => {
  const a = r({ copy: prev, ja: null, files: { keywords: '新,キー' }, urls, includeWhatsNew: false });
  expect(a.description).toBe('旧説明');
  expect(a.keywords).toBe('新,キー');
  expect(a.marketingUrl).toBe('m0');
});

test('何も無ければ URL は既定値・promotionalText は undefined', () => {
  const a = r({ copy: null, ja: null, urls, includeWhatsNew: false });
  expect(a.marketingUrl).toBe('m1');
  expect(a.promotionalText).toBe(undefined);
});

test('whatsNew は更新版のみ', () => {
  expect('whatsNew' in r({ urls, whatsNew: 'x', includeWhatsNew: false })).toBe(false);
  expect(r({ urls, whatsNew: 'x', includeWhatsNew: true }).whatsNew).toBe('x');
});
