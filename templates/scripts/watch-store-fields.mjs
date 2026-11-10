#!/usr/bin/env node
// 役割: 各ストアの「入力欄の一覧」が増えた・変わったことに、人が言う前に気づく。
//   公式の API 定義（App Store Connect の OpenAPI・Google Play の discovery）と仕様ページ（Apple・Play・Chrome ウェブストア）を取りに行き、
//   lib/store-fields.json の watch.*.known と比べる。違いがあれば終了コード 1 で一覧を出す（週1の workflow が Issue にする）。
// なぜ要るか: 2026-11-09、ASC に「iPhone Duo 用のスクリーンショット」「ヘッダと検索結果」の案内が出ていたのに、
//   キットの対応表には iPhone Duo が無かった（ASC API 4.6 にもまだ無い。仕様ページにだけある）。
//   りんくの指示「今後入力項目が増えたら言わなくても入れてほしい」。⟹ 人の目より先に機械が差分を拾う。
// 使い方:
//   node templates/scripts/watch-store-fields.mjs            # 比べる（差分があれば exit 1）
//   node templates/scripts/watch-store-fields.mjs --update   # 確認したあと、今の一覧を known に書き戻す
//   node templates/scripts/watch-store-fields.mjs --selftest # ネットを使わない自己検査
//   --json <path> で結果を JSON に書く（workflow が Issue 本文に使う）
// 終了コード: 0 = 変化なし / 1 = 変化あり / 2 = 取れなかった源がある（変化なしとは言えない）
// ★増えた欄を見つけたら: store-fields.json の stores に欄を足す → 素材の置き場と作り方を決める → --update。
//   ルール本文: docs/ai-rules/10_STORE_FIELDS.md

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { diffKnown, extractAscOpenApi, extractPageLabels, extractPlayDiscovery } from './lib/store-fields.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INVENTORY = path.join(HERE, 'lib', 'store-fields.json');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

// zip の中の最初の .json を取り出す（依存なし。deflate と無圧縮だけ扱う）。
export function firstJsonFromZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip の終端が見つからない');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip の目次が壊れている');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.json$/i.test(name) || name.startsWith('__MACOSX')) continue;
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + csize);
    const raw = method === 8 ? zlib.inflateRawSync(data) : method === 0 ? data : null;
    if (!raw) throw new Error(`zip の圧縮方式 ${method} は扱えない`);
    return JSON.parse(raw.toString('utf8'));
  }
  throw new Error('zip に .json が無い');
}

async function fetchBuf(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'store-fields-watch (web-ios-android kit)', 'accept-language': 'en-US,en;q=0.9' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export function currentFor(source, buf) {
  if (source.kind === 'asc-openapi') return extractAscOpenApi(firstJsonFromZip(buf));
  if (source.kind === 'play-discovery') return extractPlayDiscovery(JSON.parse(buf.toString('utf8')));
  return { labels: extractPageLabels(buf.toString('utf8'), source) };
}

async function run() {
  const inv = JSON.parse(fs.readFileSync(INVENTORY, 'utf8'));
  const sources = [...inv.watch.api, ...inv.watch.pages];
  const results = [];
  let unreachable = 0;
  for (const src of sources) {
    try {
      const current = currentFor(src, await fetchBuf(src.url));
      const empty = Object.values(current).every((v) => !v.length);
      if (empty) throw new Error('一覧が空（ページの作りが変わった可能性。start/end を見直す）');
      const d = diffKnown(src.known, current);
      results.push({ id: src.id, label: src.label, url: src.url, ...d });
      if (flag('--update')) src.known = current;
    } catch (e) {
      unreachable++;
      results.push({ id: src.id, label: src.label, url: src.url, error: e.message });
    }
  }
  const changed = results.filter((r) => r.changed);
  for (const r of results) {
    if (r.error) console.log(`? ${r.label}: 取れなかった（${r.error}） ${r.url}`);
    else if (!r.changed) console.log(`✓ ${r.label}: 変化なし`);
    else {
      console.log(`! ${r.label}: 変化あり ${r.url}`);
      for (const [k, v] of Object.entries(r.added)) console.log(`    + ${k}: ${v.join(' / ')}`);
      for (const [k, v] of Object.entries(r.removed)) console.log(`    - ${k}: ${v.join(' / ')}`);
    }
  }
  if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
  if (flag('--update')) {
    inv.checkedAt = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(INVENTORY, JSON.stringify(inv, null, 2) + '\n');
    console.log(`known を書き戻した: ${path.relative(process.cwd(), INVENTORY)}（増えた欄を stores に足したか確かめてからコミットする）`);
    return 0;
  }
  if (changed.length) {
    console.log(`\nストアの入力欄に変化が ${changed.length} か所。store-fields.json の stores に欄を足し、素材を用意してから --update する（docs/ai-rules/10_STORE_FIELDS.md）`);
    return 1;
  }
  return unreachable ? 2 : 0;
}

function selftest() {
  const ok = [];
  const bad = [];
  const expect = (name, cond) => (cond ? ok : bad).push(name);
  // ページ: Apple の端末一覧は HTML コメントで区切られている。新しい端末（コメント）を足すと「増えた」に出る
  const page = (extra) => `<h1>Screenshot specifications</h1><h3>iPhone</h3><!-- iPhone 16 -->${extra}<th>Screenshot size</th>Developer Footer<h3>Footer</h3>`;
  const src = { start: 'Screenshot specifications</h1>', end: 'Developer Footer' };
  const before = { labels: extractPageLabels(page(''), src) };
  const after = { labels: extractPageLabels(page('<!-- iPhone Duo -->'), src) };
  expect('ページの欄を拾う', before.labels.includes('iPhone') && before.labels.includes('Screenshot size'));
  expect('範囲外（フッター）は拾わない', !before.labels.includes('Footer'));
  const d = diffKnown(before, after);
  expect('増えた端末を差分に出す', d.changed && d.added.labels?.includes('iPhone Duo'));
  expect('同じなら変化なし', !diffKnown(before, before).changed);
  // API: 新しい欄・新しい画像の種類
  const play = (extra) => ({ schemas: { Listing: { properties: { title: {}, ...extra } } }, resources: { edits: { resources: { images: { methods: { upload: { parameters: { imageType: { enum: ['icon'] } } } } } } } } });
  const pd = diffKnown(extractPlayDiscovery(play({})), extractPlayDiscovery(play({ promoBanner: {} })));
  expect('Play の掲載欄の追加を拾う', pd.added.Listing?.includes('promoBanner'));
  const asc = { components: { schemas: { ScreenshotDisplayType: { enum: ['APP_IPHONE_67'] }, AppProductPageHeaderImage: {}, AppProductPageHeaderImageResponse: {} } } };
  const ax = extractAscOpenApi(asc);
  expect('ASC のヘッダ系資源を拾う（付属型は除く）', ax.productPageSchemas.includes('AppProductPageHeaderImage') && !ax.productPageSchemas.includes('AppProductPageHeaderImageResponse'));
  // zip
  const json = Buffer.from('{"a":1}');
  const comp = zlib.deflateRawSync(json);
  const name = Buffer.from('x.json');
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(comp.length, 20); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
  const body = Buffer.concat([lh, name, comp]);
  const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 10); eo.writeUInt32LE(body.length, 16);
  expect('zip から json を出す', firstJsonFromZip(Buffer.concat([body, cd, name, eo])).a === 1);
  // 正本の表が読める・known が埋まっている
  const inv = JSON.parse(fs.readFileSync(INVENTORY, 'utf8'));
  const emptyKnown = [...inv.watch.api, ...inv.watch.pages].filter((s) => Object.values(s.known || {}).every((v) => !v.length)).map((s) => s.id);
  expect(`known が空の源が無い${emptyKnown.length ? `（空: ${emptyKnown.join(', ')}）` : ''}`, emptyKnown.length === 0);
  for (const n of ok) console.log(`✓ ${n}`);
  for (const n of bad) console.log(`✗ ${n}`);
  return bad.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (flag('--selftest')) process.exit(selftest());
  run().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
}
