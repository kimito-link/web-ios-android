/**
 * scripts/chrome/build-zip-node.mjs
 *
 * Chrome 拡張 ZIP 作成（Node だけ・外部依存なし・PowerShell 不使用）。
 * build-zip.ps1 の Node 等価。Windows + Git Bash 環境では PowerShell プロファイルの
 * パースエラーや日本語パス文字化けに巻き込まれて「空 zip」が生成される事故があるため、
 * 申請パイプラインはこちらを正とする（罠⑤、docs/CHROME-WEBSTORE.md 参照）。
 *
 * 仕様（build-zip.ps1 と同一）:
 *   - manifest.json のあるディレクトリを拡張ルートとして自動検出
 *   - ルート直下から不要物（node_modules/.git/dist/store-assets/test 等・.env*・*.zip）を除外して全部入れる
 *   - manifest.json が zip の最上位に来る（= ルート直下の中身をそのまま zip ルートへ）
 *   - 出力: dist/<name>-v<version>.zip（name は manifest.name を slug 化）
 *
 * ★ MV3 注意: 外部CDNを実行時に読むと「リモートコード」違反で却下。ライブラリは vendor/ に
 *   同梱し、それごと zip に入れること。vendor/ が拡張ルートにあるのに zip へ入らなければ WARN を出す。
 *
 * 使い方（拡張ルート / scripts/chrome のどこからでも可）:
 *   node scripts/chrome/build-zip-node.mjs
 *   node scripts/chrome/build-zip-node.mjs --out dist
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 拡張ルート（manifest.json のある場所）を上方向に探索
function findRoot(start) {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
const ROOT = findRoot(HERE) || findRoot(process.cwd());
if (!ROOT) {
  console.error('ERROR: manifest.json が見つかりません。拡張のルートで実行してください。');
  process.exit(1);
}

const outArgIdx = process.argv.indexOf('--out');
const OUT_DIR = outArgIdx >= 0 ? process.argv[outArgIdx + 1] : 'dist';

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
const version = manifest.version;
const name = (String(manifest.name || '').replace(/[^\w\-]/g, '').replace(/^_+/, '')) || 'extension';

// 除外（build-zip.ps1 と同一思想）
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', '.github', 'dist', 'store-assets', OUT_DIR,
  '.vscode', '.idea', 'test', 'tests',
]);
const isExcludedTop = (n) =>
  EXCLUDE_DIRS.has(n) || n.startsWith('.env') || n.endsWith('.zip') || n.startsWith('temp-zip-');

// ルート直下から同梱対象を決め、その中身を再帰収集（zip 内パスは ROOT からの相対）
function collect() {
  const out = [];
  for (const top of fs.readdirSync(ROOT)) {
    if (isExcludedTop(top)) continue;
    const full = path.join(ROOT, top);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, top, out);
    else out.push({ full, rel: top });
  }
  return out;
}
function walk(dir, base, out) {
  for (const n of fs.readdirSync(dir)) {
    const full = path.join(dir, n);
    const rel = `${base}/${n}`;
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, rel, out);
    else out.push({ full, rel });
  }
}

const files = collect();
if (files.length === 0) {
  console.error('ERROR: 同梱対象がありません。拡張ルートを確認してください:', ROOT);
  process.exit(1);
}

// MV3: vendor/ がルートにあるのに zip へ入らなければ警告
if (fs.existsSync(path.join(ROOT, 'vendor')) && !files.some((f) => f.rel.startsWith('vendor/'))) {
  console.warn('WARN: vendor/ が同梱されていません。MV3 リモートコード違反で却下の恐れ。');
}

// --- minimal zip writer (DEFLATE, store フォールバック) ---
const enc = (s) => Buffer.from(s, 'utf8');
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n >>> 0); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

const localParts = [];
const centralParts = [];
let offset = 0;
for (const f of files) {
  const data = fs.readFileSync(f.full);
  const nameBuf = enc(f.rel);
  const crc = crc32(data) >>> 0;
  let method = 8;
  let comp = zlib.deflateRawSync(data, { level: 9 });
  if (comp.length >= data.length) { method = 0; comp = data; }

  const lfh = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0x21),
    u32(crc), u32(comp.length), u32(data.length), u16(nameBuf.length), u16(0),
  ]);
  localParts.push(lfh, nameBuf, comp);

  const cdh = Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0x21),
    u32(crc), u32(comp.length), u32(data.length),
    u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset),
  ]);
  centralParts.push(cdh, nameBuf);
  offset += lfh.length + nameBuf.length + comp.length;
}
const central = Buffer.concat(centralParts);
const eocd = Buffer.concat([
  u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
  u32(central.length), u32(offset), u16(0),
]);
const zipBuf = Buffer.concat([...localParts, central, eocd]);

const outDirAbs = path.join(ROOT, OUT_DIR);
if (!fs.existsSync(outDirAbs)) fs.mkdirSync(outDirAbs, { recursive: true });
const dst = path.join(outDirAbs, `${name}-v${version}.zip`);
if (fs.existsSync(dst)) fs.unlinkSync(dst);
fs.writeFileSync(dst, zipBuf);

const mb = (zipBuf.length / 1048576).toFixed(2);
console.log(`完了: ${path.relative(ROOT, dst).replace(/\\/g, '/')} (${mb} MB, ${files.length} files)`);
console.log('次: node scripts/chrome/publish-cws-node.mjs でアップロード+審査提出');
