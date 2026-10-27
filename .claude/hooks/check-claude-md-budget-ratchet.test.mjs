// check-claude-md-budget-ratchet のテスト。純関数 applyEdit()/decideRatchet() を直接叩く。
// mk(n, marker, extra): n 行の核本文 + core:end マーカー + extra 行(核の外)。measureCore の coreLines は n+1。
import { describe, it, expect } from 'vitest';
import { applyEdit, decideRatchet } from './check-claude-md-budget-ratchet.mjs';

const mk = (n, marker = true, extra = 0) =>
  [
    ...Array.from({ length: n }, (_, i) => `行${i}`),
    ...(marker ? ['<!-- core:end -->'] : []),
    ...Array.from({ length: extra }, () => '外'),
  ].join('\n');

describe('decideRatchet', () => {
  it('予算内の編集は allow', () => {
    expect(decideRatchet(mk(100), mk(110), 450).decision).toBe('allow'); // 核 101→111 ≤450
  });

  it('増やして超過は deny(ラチェット)', () => {
    const r = decideRatchet(mk(460), mk(470), 450); // 核 461→471、どちらも >450
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(/増やせません|増加/);
  });

  it('超過しているが減らす方向は warn(通す)', () => {
    const r = decideRatchet(mk(470), mk(460), 450); // 核 471→461(実削除10行)、まだ >450
    expect(r.decision).toBe('warn');
  });

  it('超過から上限内まで実削除したら allow', () => {
    expect(decideRatchet(mk(460), mk(430), 450).decision).toBe('allow'); // 核 461→431 ≤450・実削除30行
  });

  it('core:end マーカーを消す編集は deny', () => {
    const r = decideRatchet(mk(100), mk(100, false), 450);
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(/マーカー/);
  });

  it('マーカーが2つになる編集は deny', () => {
    const r = decideRatchet(mk(100), `${mk(10)}\n${mk(10)}`, 450);
    expect(r.decision).toBe('deny');
  });

  it('マーカーを上へ動かして下へ退避しただけ(gaming)は deny', () => {
    // pre: 核461(>450)・全461。post: 核441(≤450に見える)・全461(消していない=20行を下へ退避しただけ)。
    const r = decideRatchet(mk(460, true, 0), mk(440, true, 20), 450);
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(/退避|消えて/);
  });

  it('マーカーが無いリポは対象外(allow)', () => {
    expect(decideRatchet(mk(100, false), mk(200, false), 450).decision).toBe('allow');
  });

  it('増やしても上限内なら allow', () => {
    expect(decideRatchet(mk(400), mk(448), 450).decision).toBe('allow'); // 核 401→449 ≤450
  });
});

describe('applyEdit', () => {
  it('Write は content をそのまま返す', () => {
    expect(applyEdit('old', 'Write', { content: 'new全文' })).toBe('new全文');
  });

  it('Edit は最初の1件を置換する', () => {
    expect(applyEdit('aXbXc', 'Edit', { old_string: 'X', new_string: 'Y' })).toBe('aYbXc');
  });

  it('Edit replace_all は全件置換する', () => {
    expect(applyEdit('aXbXc', 'Edit', { old_string: 'X', new_string: 'Y', replace_all: true })).toBe('aYbYc');
  });

  it('Edit で old_string が無ければ null(止めない)', () => {
    expect(applyEdit('abc', 'Edit', { old_string: 'Z', new_string: 'Y' })).toBeNull();
  });

  it('NotebookEdit 等は対象外(null)', () => {
    expect(applyEdit('abc', 'NotebookEdit', { new_source: 'x' })).toBeNull();
  });
});
