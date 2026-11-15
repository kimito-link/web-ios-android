import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyRules } from './install.mjs';

const rules = JSON.parse(readFileSync(new URL('./rules.json', import.meta.url), 'utf8'));

describe('auto-mode install', () => {
  it('空の設定には $defaults を先頭に残して足す', () => {
    const s = applyRules({}, rules);
    expect(s.autoMode.allow[0]).toBe('$defaults');
    expect(s.autoMode.environment[0]).toBe('$defaults');
    expect(s.autoMode.allow.length).toBe(1 + rules.allow.length);
  });
  it('何度入れても増えない（古い文は入れ替える）', () => {
    const once = applyRules({ hooks: { a: 1 } }, rules);
    const old = structuredClone(once);
    old.autoMode.allow.push(rules.marker + ' old text');
    const twice = applyRules(old, rules);
    expect(twice.autoMode.allow).toEqual(once.autoMode.allow);
    expect(twice.hooks).toEqual({ a: 1 });
  });
  it('本人が既に書いた文と soft_deny には触らない', () => {
    const s = applyRules({ autoMode: { allow: ['$defaults', 'mine'], soft_deny: ['x'] } }, rules);
    expect(s.autoMode.allow.slice(0, 2)).toEqual(['$defaults', 'mine']);
    expect(s.autoMode.soft_deny).toEqual(['x']);
  });
  it('お金・削除・戻せない操作は許可しない旨を必ず含む', () => {
    expect(rules.allow.join(' ')).toMatch(/costs money/);
    expect(rules.allow.join(' ')).toMatch(/failing or still-running checks/);
  });
});
