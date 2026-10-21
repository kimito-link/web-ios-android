// ai-box.js の純関数 composeCopyText のテスト（_preamble が指示文の先頭へ入るか）。
// ai-box.js は CommonJS(ブラウザ classic script)。Node で読み込むと document が無いので
// 配線はされず、composeCopyText だけが module.exports 経由で取れる(ai-box.js 末尾の guard)。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import aiBox from './ai-box.js';

const { composeCopyText } = aiBox;

describe('composeCopyText — _preamble の先頭注入', () => {
  it('preamble があれば本文の前に置く', () => {
    const out = composeCopyText('PRE', 'BODY');
    expect(out.startsWith('PRE')).toBe(true);
    expect(out).toBe('PRE\n\nBODY');
  });
  it('preamble 無し/空/空白のみは本文だけ', () => {
    expect(composeCopyText('', 'BODY')).toBe('BODY');
    expect(composeCopyText(null, 'BODY')).toBe('BODY');
    expect(composeCopyText(undefined, 'BODY')).toBe('BODY');
    expect(composeCopyText('   ', 'BODY')).toBe('BODY');
  });
  it('preamble の前後空白は落とす', () => {
    expect(composeCopyText('  PRE  ', 'BODY')).toBe('PRE\n\nBODY');
  });
  it('本文が空/未定義でも落ちない', () => {
    expect(composeCopyText('PRE', '')).toBe('PRE\n\n');
    expect(composeCopyText('PRE', null)).toBe('PRE\n\n');
  });
});

describe('実データ結合: ai-instructions.json の _preamble が各指示文の先頭に来る', () => {
  const data = JSON.parse(readFileSync(new URL('../assets/data/ai-instructions.json', import.meta.url), 'utf8'));

  it('_preamble が存在し、XYEval の趣旨(見立ては誤りうる・先に確かめる)を含む', () => {
    expect(typeof data._preamble).toBe('string');
    expect(data._preamble.length).toBeGreaterThan(10);
    expect(data._preamble).toMatch(/誤って|可能性|確かめ/);
  });

  it('全 ai-box エントリで、合成後の先頭が _preamble になる', () => {
    const entries = Object.keys(data).filter((k) => k[0] !== '_' && data[k] && typeof data[k].text === 'string');
    expect(entries.length).toBeGreaterThan(0);
    for (const k of entries) {
      const out = composeCopyText(data._preamble, data[k].text);
      expect(out.startsWith(data._preamble.trim())).toBe(true);
      // 本文も必ず含まれる(preamble で本文を潰していない)
      expect(out.includes(data[k].text)).toBe(true);
    }
  });
});
