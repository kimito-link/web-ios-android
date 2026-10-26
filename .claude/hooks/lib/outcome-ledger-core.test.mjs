// outcome-ledger-core のテスト。純関数 validateRecord / dedupKey / appendIfNew / parseLedger / makeRecord を直接叩く。
import { describe, it, expect } from 'vitest';
import {
  SCHEMA_VERSION,
  HOOKS,
  DECISIONS,
  validateRecord,
  dedupKey,
  appendIfNew,
  parseLedger,
  makeRecord,
} from './outcome-ledger-core.mjs';

/** 検査を通る1行を作る(上書きで崩せる)。 */
const ok = (over = {}) => ({
  schema: SCHEMA_VERSION,
  hook: 'require-claude-md-read',
  decision: 'deny',
  sessionId: 'session_01ABC',
  toolUseId: 'toolu_01XYZ',
  reasonCategory: 'unread',
  at: '2026-10-21T02:30:00Z',
  ...over,
});

describe('validateRecord', () => {
  it('正しい1行は合格', () => {
    expect(validateRecord(ok()).ok).toBe(true);
  });
  it('オブジェクトでない入力は not-an-object', () => {
    expect(validateRecord(null).violations[0].rule).toBe('not-an-object');
    expect(validateRecord([]).violations[0].rule).toBe('not-an-object');
  });
  it('未知のキーを弾く', () => {
    const r = validateRecord(ok({ extra: 1 }));
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.rule === 'unknown-key')).toBe(true);
  });
  it('schema が違えば弾く', () => {
    expect(validateRecord(ok({ schema: 2 })).ok).toBe(false);
  });
  it('対象外の hook を弾く(ブロッキング3本＋ratchet のみ)', () => {
    expect(validateRecord(ok({ hook: 'warn-long-running-session' })).ok).toBe(false);
    for (const h of HOOKS) expect(validateRecord(ok({ hook: h })).ok).toBe(true);
  });
  it('decision は deny/allow/ask のみ', () => {
    for (const d of DECISIONS) expect(validateRecord(ok({ decision: d })).ok).toBe(true);
    expect(validateRecord(ok({ decision: 'block' })).ok).toBe(false);
  });
  it('sessionId / toolUseId の不正な文字種を弾く', () => {
    expect(validateRecord(ok({ sessionId: 'has space' })).ok).toBe(false);
    expect(validateRecord(ok({ toolUseId: 'bad/slash' })).ok).toBe(false);
    expect(validateRecord(ok({ sessionId: '' })).ok).toBe(false);
  });
  it('reasonCategory は小文字・数字・ハイフンの短い語だけ(自由文・秘密を構造的に排除)', () => {
    expect(validateRecord(ok({ reasonCategory: 'over-budget-increase' })).ok).toBe(true);
    expect(validateRecord(ok({ reasonCategory: 'Has Space' })).ok).toBe(false);
    expect(validateRecord(ok({ reasonCategory: 'sk-secretlike' })).ok).toBe(true); // 形式は通るが…
    expect(validateRecord(ok({ reasonCategory: 'contains_underscore' })).ok).toBe(false);
    expect(validateRecord(ok({ reasonCategory: 'a'.repeat(49) })).ok).toBe(false); // 長すぎ
  });
  it('at は ISO8601', () => {
    expect(validateRecord(ok({ at: 'yesterday' })).ok).toBe(false);
  });
});

describe('dedupKey', () => {
  it('(sessionId, toolUseId, hook) で決まる', () => {
    expect(dedupKey(ok())).toBe('session_01ABC\u0000toolu_01XYZ\u0000require-claude-md-read');
  });
  it('決定時刻や理由が違っても同じツール呼び出しなら同じ鍵', () => {
    expect(dedupKey(ok({ at: '2026-10-21T09:00:00Z', reasonCategory: 'stale' }))).toBe(dedupKey(ok()));
  });
  it('hook が違えば別の鍵(1呼び出しで複数 hook が deny しうる)', () => {
    expect(dedupKey(ok({ hook: 'guard-external-actions' }))).not.toBe(dedupKey(ok()));
  });
});

describe('appendIfNew(冪等)', () => {
  it('空の台帳には追記できる', () => {
    expect(appendIfNew([], ok())).toMatchObject({ added: true, reason: 'ok' });
  });
  it('同じ鍵の行が既にあれば追記しない(duplicate)', () => {
    const existing = [ok()];
    expect(appendIfNew(existing, ok({ at: '2026-10-21T10:00:00Z' }))).toMatchObject({ added: false, reason: 'duplicate' });
  });
  it('同じセッション・同じ呼び出しでも別 hook は追記できる', () => {
    const existing = [ok()];
    expect(appendIfNew(existing, ok({ hook: 'guard-external-actions' })).added).toBe(true);
  });
  it('別のツール呼び出し(toolUseId 違い)は追記できる', () => {
    const existing = [ok()];
    expect(appendIfNew(existing, ok({ toolUseId: 'toolu_02NEW' })).added).toBe(true);
  });
  it('不正な行は invalid で追記しない', () => {
    expect(appendIfNew([], ok({ schema: 99 }))).toMatchObject({ added: false, reason: 'invalid' });
  });
  it('既存に壊れた行が混じっていても落ちず、正しい重複だけ検出する', () => {
    const existing = [{ garbage: true }, ok()];
    expect(appendIfNew(existing, ok()).reason).toBe('duplicate');
    expect(appendIfNew(existing, ok({ toolUseId: 'toolu_other' })).added).toBe(true);
  });
});

describe('parseLedger', () => {
  it('空・空白は空配列', () => {
    expect(parseLedger('')).toEqual([]);
    expect(parseLedger('   \n  ')).toEqual([]);
  });
  it('壊れた行・配列行は飛ばし、オブジェクト行だけ返す', () => {
    const text = [JSON.stringify(ok()), 'not json', JSON.stringify([1, 2]), JSON.stringify(ok({ toolUseId: 'toolu_2' }))].join('\n');
    const rows = parseLedger(text);
    expect(rows.length).toBe(2);
  });
});

describe('makeRecord', () => {
  it('必要な項目から検査済みの1行を組み立てる(decision 既定は deny)', () => {
    const r = makeRecord({ hook: 'check-claude-md-budget-ratchet', sessionId: 'session_1', toolUseId: 'toolu_1', reasonCategory: 'gaming' });
    expect(r.ok).toBe(true);
    expect(r.record).toMatchObject({ schema: 1, decision: 'deny', hook: 'check-claude-md-budget-ratchet' });
  });
  it('at を渡さなければ現在時刻(ISO)を埋め、検査を通る', () => {
    const r = makeRecord({ hook: 'require-claude-md-read', sessionId: 'session_1', toolUseId: 'toolu_1', reasonCategory: 'unread' });
    expect(r.ok).toBe(true);
    expect(validateRecord(r.record).ok).toBe(true);
  });
  it('不正な入力は record=null・ok=false', () => {
    const r = makeRecord({ hook: 'nope', sessionId: 'session_1', toolUseId: 'toolu_1', reasonCategory: 'x' });
    expect(r.ok).toBe(false);
    expect(r.record).toBe(null);
  });
});
