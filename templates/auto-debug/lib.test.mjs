// 自動デバッグの判定部品の自己検査（毒を入れたら赤くなるか）。npm run auto-debug:selftest
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupFindings, isSafeTarget, pickTarget, planActions, priorityOf, readMark, rng, signatureOf, writeMark } from './lib.mjs';
import { issueBody, readReplay } from './report.mjs';

const f = (o = {}) => ({ type: 'js-exception', url: 'https://a.example/item/123', message: 'x is undefined at 42', ...o });
const DAY = 86400000;

test('同じ画面・同じ種類なら、毎回変わる数字が違っても同じ指紋', () => {
  assert.equal(signatureOf(f()), signatureOf(f({ url: 'https://a.example/item/999?q=1', message: 'x is undefined at 77' })));
  assert.notEqual(signatureOf(f()), signatureOf(f({ type: 'console-error' })));
  // 呼び出し履歴だけ違う同じ例外は1件にまとめる
  const e = (stack) => f({ type: 'console-error', message: `Error: Unable to find tRPC Context.\n    at ${stack}` });
  assert.equal(signatureOf(e('q (https://a.example/x.js:102:9206)')), signatureOf(e('Object.useQuery (https://a.example/y.js:5:1)')));
  assert.notEqual(signatureOf(f()), signatureOf(f({ url: 'https://a.example/cart/1' })));
});

test('同じ回の重複は数としてまとめ、重複数で優先度が上がる', () => {
  const g = groupFindings([f(), f(), f({ type: 'server-5xx' })]);
  assert.equal(g.length, 2);
  assert.equal(g.find((x) => x.type === 'js-exception').count, 2);
  assert.equal(priorityOf(1), 'P3');
  assert.equal(priorityOf(3), 'P2');
  assert.equal(priorityOf(10), 'P1');
});

test('台帳の印は本文に埋めて読み戻せる', () => {
  const b = writeMark('本文', { sig: 'abc', count: 2 });
  assert.deepEqual(readMark(b), { sig: 'abc', count: 2 });
  assert.deepEqual(readMark(writeMark(b, { sig: 'abc', count: 5 })), { sig: 'abc', count: 5 });
});

test('新規は起票・開いていれば回数を足す・閉じたのに再発なら開け直す', () => {
  const now = Date.parse('2026-11-28T00:00:00Z');
  const [a, b, c] = groupFindings([f(), f({ type: 'server-5xx' }), f({ type: 'blank-screen' })]);
  const issues = [
    { number: 1, state: 'OPEN', body: writeMark('', { sig: b.signature, count: 2, lastSeen: '2026-11-27T00:00:00Z' }) },
    { number: 2, state: 'CLOSED', body: writeMark('', { sig: c.signature, count: 1, lastSeen: '2026-11-01T00:00:00Z' }) },
  ];
  const acts = planActions({ issues, found: [a, b, c], now });
  assert.deepEqual(acts.map((x) => x.op).sort(), ['bump', 'create', 'reopen']);
  assert.equal(acts.find((x) => x.op === 'bump').priority, 'P2');
});

test('14日出なければ自動で閉じ、閉じた Issue を手順でたどって出なければ確認済み（1回だけ）', () => {
  const now = Date.parse('2026-11-28T00:00:00Z');
  const issues = [
    { number: 3, state: 'OPEN', body: writeMark('', { sig: 'old', count: 1, lastSeen: new Date(now - 15 * DAY).toISOString() }) },
    { number: 4, state: 'OPEN', body: writeMark('', { sig: 'new', count: 1, lastSeen: new Date(now - 2 * DAY).toISOString() }) },
    { number: 5, state: 'CLOSED', body: writeMark('', { sig: 'fixed', count: 1 }) },
    { number: 6, state: 'CLOSED', body: writeMark('', { sig: 'done', count: 1, verified: 'x' }) },
  ];
  const replayed = new Map([['fixed', false], ['done', false]]);
  const acts = planActions({ issues, found: [], replayed, now });
  assert.deepEqual(acts.map((x) => `${x.op}#${x.number}`).sort(), ['close#3', 'verified#5']);
});

test('本番で押してはいけないものと外のサイトは押さない', () => {
  const o = 'https://a.example';
  assert.equal(isSafeTarget({ kind: 'link', href: 'https://a.example/about', text: '会社概要' }, o), true);
  assert.equal(isSafeTarget({ kind: 'link', href: 'https://b.example/', text: '外' }, o), false);
  assert.equal(isSafeTarget({ kind: 'button', text: 'アカウントを削除' }, o), false);
  assert.equal(isSafeTarget({ kind: 'button', text: '購入する' }, o), false);
  assert.equal(isSafeTarget({ kind: 'link', href: 'https://a.example/logout', text: '' }, o), false);
});

test('同じ種なら同じ歩き方（＝そのまま再現手順になる）', () => {
  const t = [1, 2, 3, 4, 5].map((i) => ({ kind: 'link', href: `https://a.example/${i}` }));
  const walk = (seed) => {
    const r = rng(seed);
    return Array.from({ length: 6 }, () => pickTarget(t, new Set(), r).href);
  };
  assert.deepEqual(walk(7), walk(7));
  assert.notDeepEqual(walk(7), walk(8));
});

test('起票本文に残した再現手順と印を読み戻せる', () => {
  const g = { ...groupFindings([f()])[0], startUrl: 'https://a.example/', seed: 3, step: 2, reproduced: true };
  g.replay = { startUrl: g.startUrl, seed: 3, signature: g.signature, steps: [{ kind: 'link', href: 'https://a.example/x' }] };
  const body = issueBody(g, { sig: g.signature, count: 1 });
  assert.deepEqual(readReplay(body), g.replay);
  assert.equal(readMark(body).sig, g.signature);
});
