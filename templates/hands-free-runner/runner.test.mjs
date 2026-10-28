// runner.test.mjs — runner.mjs の試験。済んだ段を飛ばす／失敗で止まり状態に残る／秘密が状態に残らない／クリップボード待ち。
//   使い方: node runner.test.mjs  （一時フォルダだけを使う。クリップボードは代役を渡す）
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDir, runSteps, waitForClipboard } from './runner.mjs';

const quiet = () => {};
const dir = mkdtempSync(join(tmpdir(), 'ai-runs-'));
const SECRET = 'sk_live_SUPERSECRET1234567890';
let calls = { a: 0, b: 0 };
let failB = true;
const steps = [
  { id: 'a', title: 'A', run: async () => { calls.a++; return { length: SECRET.length }; } },
  { id: 'b', title: 'B', run: async (ctx) => { calls.b++; ctx.waitingHuman('押してください', 'https://example.com/x'); if (failB) throw new Error('まだ'); } },
];

let r = await runSteps({ name: 't', steps, dir, print: quiet });
assert.deepEqual(r, { status: 'failed', failedStep: 'b' });
let st = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
assert.equal(st.status, 'failed');
assert.equal(st.step, 'b');
assert.equal(st.error, 'まだ');
assert.equal(st.waiting.url, 'https://example.com/x', '何を待っていたかが状態に残る');

failB = false;
r = await runSteps({ name: 't', steps, dir, print: quiet });
assert.equal(r.status, 'done');
assert.equal(calls.a, 1, '済んだ段は2回目に飛ばす');
assert.equal(calls.b, 2);
st = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
assert.equal(st.status, 'done');
const files = readFileSync(join(dir, 'state.json'), 'utf8') + readFileSync(join(dir, 'log.txt'), 'utf8');
assert.ok(!files.includes(SECRET), '秘密の値は状態にもログにも書かない');

assert.throws(() => runDir('Bad Name'), /英小文字/);

// クリップボード: 始めの中身は無視し、新しく来た合う値だけを返す
let seq = [SECRET, SECRET, 'hello', 'sk_live_NEWVALUE0000000000'];
let v = await waitForClipboard(/^sk_live_/, { read: () => seq.length > 1 ? seq.shift() : seq[0], intervalMs: 1 });
assert.equal(v, 'sk_live_NEWVALUE0000000000');
// acceptExisting: 先にコピー済みでもすぐ受け取る
v = await waitForClipboard(/^sk_live_/, { read: () => SECRET, intervalMs: 1, acceptExisting: true });
assert.equal(v, SECRET);
await assert.rejects(waitForClipboard(/^x$/, { read: () => 'y', intervalMs: 1, timeoutMs: 5 }), /待ち時間/);

console.log('runner.test.mjs: OK');
