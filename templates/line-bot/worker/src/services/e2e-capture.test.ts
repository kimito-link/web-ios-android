// LINEシミュレーション部品の試験。導入先で `npx vitest run src/services/e2e-capture.test.ts`。
import { describe, expect, test, vi } from 'vitest';
import { captureLineClient, e2eFileFetch, isE2eUser, isNeverSendAddress } from './e2e-capture.js';

const E2E = 'U' + 'e2e0'.repeat(8);

function fakeDb(files: Record<string, string> = {}) {
  const inserted: unknown[][] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        run: async () => { inserted.push([sql, ...args]); return {}; },
        first: async () => (args[0] as string) in files ? { content_type: null, body_base64: files[args[0] as string] } : null,
      }),
    }),
  } as unknown as D1Database;
  return { db, inserted };
}

describe('isE2eUser', () => {
  test('完全一致だけ true', () => {
    expect(isE2eUser(E2E, E2E)).toBe(true);
    expect(isE2eUser('U' + '1'.repeat(32), E2E)).toBe(false);
  });
  test('設定が無い・形が違うなら誰にも効かない', () => {
    expect(isE2eUser(E2E, undefined)).toBe(false);
    expect(isE2eUser('', '')).toBe(false);
    expect(isE2eUser('x', 'x')).toBe(false);
  });
});

describe('captureLineClient', () => {
  test('送信は記録だけで、本物は呼ばれない', async () => {
    const real = { replyMessage: vi.fn(), pushTextMessage: vi.fn(), other: () => 'real' };
    const { db, inserted } = fakeDb();
    const c = captureLineClient(real as never, db) as unknown as typeof real;
    await c.replyMessage('tok', [{ type: 'text', text: 'こんにちは' }]);
    await c.pushTextMessage(E2E, 'お知らせ');
    expect(real.replyMessage).not.toHaveBeenCalled();
    expect(real.pushTextMessage).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(2);
    expect(JSON.stringify(inserted[0])).toContain('こんにちは');
    expect(c.other()).toBe('real');
  });
  test('プロフィールは偽の値', async () => {
    const { db } = fakeDb();
    const c = captureLineClient({} as never, db);
    expect((await c.getProfile(E2E)).displayName).toBe('E2Eテスト');
  });
});

describe('e2eFileFetch', () => {
  test('e2e-file: の取り出しだけ D1 の中身を返す', async () => {
    const real = vi.fn(async () => new Response('real'));
    const f = e2eFileFetch(fakeDb({ price: btoa('A,B') }).db, real as never);
    expect(await (await f('https://api-data.line.me/v2/bot/message/e2e-file%3Aprice/content')).text()).toBe('A,B');
    expect(real).not.toHaveBeenCalled();
  });
  test('変換状態の問い合わせは「できた」', async () => {
    const f = e2eFileFetch(fakeDb().db, vi.fn() as never);
    const r = await f('https://api-data.line.me/v2/bot/message/e2e-file%3Avoice/content/transcoding');
    expect((await r.json()).status).toBe('succeeded');
  });
  test('置いていない名前は404、ふつうの取り出しは本物へ', async () => {
    const real = vi.fn(async () => new Response('real'));
    const f = e2eFileFetch(fakeDb().db, real as never);
    expect((await f('https://api-data.line.me/v2/bot/message/e2e-file%3Anone/content')).status).toBe(404);
    expect(await (await f('https://api-data.line.me/v2/bot/message/123/content')).text()).toBe('real');
  });
});

test('.invalid 宛てには送らない', () => {
  expect(isNeverSendAddress('a@example.invalid')).toBe(true);
  expect(isNeverSendAddress('a@example.com')).toBe(false);
});
