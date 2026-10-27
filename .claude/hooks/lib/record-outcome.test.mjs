// record-outcome の100年設計ハードニングのテスト:
// (1) readLedgerTailText が巨大ファイルでも末尾だけを完全な行で返す(定数コスト)、
// (2) recordOutcome が末尾の重複を正しく冪等判定する(全文を読まなくても dedup が効く)。
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readLedgerTailText, recordOutcome, DEDUP_TAIL_BYTES } from './record-outcome.mjs';

function rec(over = {}) {
  return {
    schema: 1,
    hook: 'require-claude-md-read',
    decision: 'deny',
    sessionId: 'sess-X',
    toolUseId: 'toolu_Y',
    reasonCategory: 'unread',
    at: '2026-10-21T04:00:00Z',
    ...over,
  };
}

describe('readLedgerTailText — 末尾だけを完全な行で読む', () => {
  it('小さいファイルは全文を返す', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rot-a-'));
    try {
      const p = join(dir, 'l.jsonl');
      const lines = [rec({ toolUseId: 't1' }), rec({ toolUseId: 't2' })].map((e) => JSON.stringify(e));
      writeFileSync(p, lines.join('\n') + '\n', 'utf8');
      const text = readLedgerTailText(p);
      expect(text.includes('t1')).toBe(true);
      expect(text.includes('t2')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('maxBytes を超えるファイルは末尾だけ・先頭の欠け行は捨て、残りは全て完全なJSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rot-b-'));
    try {
      const p = join(dir, 'l.jsonl');
      const many = Array.from({ length: 2000 }, (_, i) => JSON.stringify(rec({ toolUseId: 'toolu_' + i })));
      writeFileSync(p, many.join('\n') + '\n', 'utf8');
      const text = readLedgerTailText(p, 2000); // わざと小さい窓
      // 返ったテキストのバイト長は窓以下
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(2000);
      // 非空行はすべて完全な JSON(= 先頭の欠け行が混ざっていない)
      const rows = text.split('\n').filter((l) => l.trim());
      for (const r of rows) expect(() => JSON.parse(r)).not.toThrow();
      // 末尾の最新行(最後の toolUseId)は必ず含まれる
      expect(text.includes('toolu_1999')).toBe(true);
      // 全文(2000件)は読んでいない=定数コスト化できている
      expect(rows.length).toBeLessThan(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('既定の窓は 64KiB', () => {
    expect(DEDUP_TAIL_BYTES).toBe(64 * 1024);
  });
});

describe('recordOutcome — 末尾に重複があれば二重記録しない(E2E)', () => {
  function makeRepoWithLedger(entries) {
    const dir = mkdtempSync(join(tmpdir(), 'rec-e2e-'));
    mkdirSync(join(dir, '.git'), { recursive: true });
    mkdirSync(join(dir, '.loop'), { recursive: true });
    const p = join(dir, '.loop', 'hook-outcomes.jsonl');
    writeFileSync(p, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''), 'utf8');
    return { dir, p };
  }
  const lineCount = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).length;

  it('末尾付近の同一(session,toolUseId,hook)は duplicate で追記しない', () => {
    // 1990件のノイズ + 末尾に dup を1件(窓=64KiBには十分収まる近さ)
    const noise = Array.from({ length: 300 }, (_, i) => rec({ toolUseId: 'noise_' + i }));
    const dup = rec({ sessionId: 'sess-DUP', toolUseId: 'toolu_DUP' });
    const { dir, p } = makeRepoWithLedger([...noise, dup]);
    try {
      const before = lineCount(p);
      const r = recordOutcome(
        { session_id: 'sess-DUP', tool_use_id: 'toolu_DUP', cwd: dir },
        { hook: 'require-claude-md-read', reasonCategory: 'unread' }
      );
      expect(r.recorded).toBe(false);
      expect(r.reason).toBe('duplicate');
      expect(lineCount(p)).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('新しい tool_use_id は追記する(+1)', () => {
    const { dir, p } = makeRepoWithLedger([rec({ toolUseId: 'toolu_old' })]);
    try {
      const before = lineCount(p);
      const r = recordOutcome(
        { session_id: 'sess-NEW', tool_use_id: 'toolu_new', cwd: dir },
        { hook: 'guard-external-actions', reasonCategory: 'no-coord' }
      );
      expect(r.recorded).toBe(true);
      expect(lineCount(p)).toBe(before + 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
