import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from './inject-ai-budget-mode.mjs';

const NOW = Date.parse('2026-11-26T00:00:00.000Z');
const dir = mkdtempSync(join(tmpdir(), 'budget-hook-'));
const file = join(dir, 'usage.json');
const write = (weekly, fable) =>
  writeFileSync(
    file,
    JSON.stringify({
      updatedAt: '2026-11-25T22:00:00.000Z',
      current: { windows: { weekly: { percentUsed: weekly, resetsAt: '2026-11-29T06:59:59.744Z' }, fable: { percentUsed: fable, resetsAt: '2026-11-29T06:59:59.744Z' } } },
    }),
  );

describe('inject-ai-budget-mode', () => {
  beforeEach(() => {
    process.env.AI_BUDGET_USAGE_FILE = file;
  });
  it('段階が変わったときだけ出す(同じセッションで同じ段階は二度出さない)', async () => {
    const sid = `t-${Math.random()}`;
    write(75, 98);
    const first = await run({ session_id: sid }, NOW);
    expect(first).toContain('強い節約');
    expect(await run({ session_id: sid }, NOW)).toBe('');
    write(96, 98);
    expect(await run({ session_id: sid }, NOW)).toContain('ほぼ空');
  });
  it('読めない記録でも落ちない(stale として知らせる)', async () => {
    writeFileSync(file, 'broken');
    expect(await run({ session_id: `t-${Math.random()}` }, NOW)).toContain('record-claude-usage');
  });
});
