/**
 * scripts/chrome/publish-cws-node.mjs
 *
 * Chrome Web Store API v1.1 で zip をアップロードし審査提出する（Node版・外部依存なし）。
 * publish-cws.ps1 の Node 等価。Node の https のみ使用。Windows + Git Bash で PowerShell 経由が
 * 固まる/文字化けする事故を避けるため、申請パイプラインはこちらを正とする（docs/CHROME-WEBSTORE.md 罠⑤）。
 *
 * 認証は .env.cws（拡張ルート優先、無ければ scripts/chrome のもの・gitignore必須）から読む:
 *   CWS_CLIENT_ID / CWS_CLIENT_SECRET / CWS_REFRESH_TOKEN / CWS_ITEM_ID
 * 取得手順は docs/CHROME-WEBSTORE.md（OAuthは「デスクトップアプリ」型）。
 *
 * 使い方:
 *   node scripts/chrome/publish-cws-node.mjs              # アップロード → 検証待ち → 審査提出
 *   node scripts/chrome/publish-cws-node.mjs --check      # ID/権限の検証だけ（読み取り専用・提出しない）
 *   node scripts/chrome/publish-cws-node.mjs --upload-only # アップロードのみ（下書き確認）
 *
 * zip は build-zip-node.mjs の出力 dist/<name>-v<version>.zip を探す。
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

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
process.chdir(ROOT);

const uploadOnly = process.argv.includes('--upload-only');
const checkOnly = process.argv.includes('--check');

// .env.cws 読み込み（拡張ルート優先、無ければ scripts/chrome）。値は表示しない。
let envPath = path.join(ROOT, '.env.cws');
if (!fs.existsSync(envPath) && fs.existsSync(path.join(HERE, '.env.cws'))) {
  envPath = path.join(HERE, '.env.cws');
}
if (!fs.existsSync(envPath)) {
  console.error('ERROR: .env.cws がありません。');
  console.error('  cp scripts/chrome/.env.cws.example .env.cws して値を埋めてください（手順は docs/CHROME-WEBSTORE.md）。');
  process.exit(1);
}
const cfg = {};
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  if (/^\s*#/.test(line)) continue;
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
  if (m) cfg[m[1]] = m[2];
}
for (const k of ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN', 'CWS_ITEM_ID']) {
  if (!cfg[k] || cfg[k].includes('xxxx') || cfg[k].includes('ここに')) {
    console.error('ERROR: .env.cws の', k, 'が未設定です。');
    process.exit(1);
  }
}

// zip 特定（manifest の name/version）。--check は zip 不要。
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8').replace(/^﻿/, ''));
const version = manifest.version;
const name = (String(manifest.name || '').replace(/[^\w\-]/g, '').replace(/^_+/, '')) || 'extension';
let zipPath = path.join('dist', `${name}-v${version}.zip`);
if (!checkOnly && !fs.existsSync(zipPath)) {
  // フォールバック: dist 内の同 version zip を拾う
  const distDir = path.join(ROOT, 'dist');
  if (fs.existsSync(distDir)) {
    const alt = fs.readdirSync(distDir).find((f) => f.endsWith(`-v${version}.zip`));
    if (alt) zipPath = path.join('dist', alt);
  }
}
if (!checkOnly && !fs.existsSync(zipPath)) {
  console.error('ERROR: zip がありません:', zipPath);
  console.error('  先に node scripts/chrome/build-zip-node.mjs で zip を作成してください。');
  process.exit(1);
}
if (!checkOnly) {
  const zipBytesPreview = fs.statSync(zipPath).size;
  console.log(`対象: ${zipPath} (v${version}, ${Math.round(zipBytesPreview / 1024)}KB)`);
}
console.log(`アイテムID: ${cfg.CWS_ITEM_ID}`);

const request = (opts, body) => new Promise((resolve, reject) => {
  const req = https.request(opts, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
  });
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});

// 1. refresh_token → access_token
console.log('[1/3] アクセストークン取得...');
const tokenBody = new URLSearchParams({
  client_id: cfg.CWS_CLIENT_ID,
  client_secret: cfg.CWS_CLIENT_SECRET,
  refresh_token: cfg.CWS_REFRESH_TOKEN,
  grant_type: 'refresh_token',
}).toString();
const tokenRes = await request({
  hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(tokenBody) },
}, tokenBody);
let tokenJson;
try { tokenJson = JSON.parse(tokenRes.body); } catch { tokenJson = {}; }
if (!tokenJson.access_token) {
  console.error('ERROR: アクセストークン取得失敗 (status=' + tokenRes.status + ')');
  console.error('  ' + tokenRes.body);
  process.exit(1);
}
const token = tokenJson.access_token;
console.log('  OK');

// --check: アイテムID と権限の検証だけ（読み取り専用）
if (checkOnly) {
  console.log('[check] GET items/' + cfg.CWS_ITEM_ID + ' で ID と権限を検証...');
  const checkRes = await request({
    hostname: 'www.googleapis.com',
    path: `/chromewebstore/v1.1/items/${cfg.CWS_ITEM_ID}?projection=DRAFT`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2' },
  });
  console.log('  status=' + checkRes.status);
  console.log('  body=' + checkRes.body);
  if (checkRes.status === 200) console.log('✅ ID 正しく権限あり。publish 可能なはず。');
  else if (checkRes.status === 404) console.log('❌ 404: このIDの拡張がこのアカウントから見えません（ID誤り or 別アカウント所有）。');
  else console.log('⚠️ 予期しない status。body を確認してください。');
  process.exit(0);
}

const zipBytes = fs.readFileSync(zipPath);

// 2. ZIP アップロード（PUT items/{id}）
console.log('[2/3] ZIP アップロード中...');
const uploadRes = await request({
  hostname: 'www.googleapis.com',
  path: `/upload/chromewebstore/v1.1/items/${cfg.CWS_ITEM_ID}`,
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${token}`,
    'x-goog-api-version': '2',
    'Content-Type': 'application/zip',
    'Content-Length': zipBytes.length,
  },
}, zipBytes);
let uploadJson;
try { uploadJson = JSON.parse(uploadRes.body); } catch { uploadJson = {}; }
if (uploadJson.uploadState === 'FAILURE') {
  console.error('ERROR: アップロード失敗');
  (uploadJson.itemError || []).forEach((e) => console.error('  -', e.error_detail));
  process.exit(1);
}
console.log('  アップロード OK (uploadState=' + uploadJson.uploadState + ', status=' + uploadRes.status + ')');
if (process.env.CWS_DEBUG) console.log('  [debug] uploadRes.body=' + uploadRes.body);

if (uploadOnly) {
  console.log('--upload-only 指定のため審査提出はしません。ダッシュボードで下書きを確認してください。');
  process.exit(0);
}

// アップロードは Google 側で非同期検証される（uploadState=IN_PROGRESS）。
// 完了前に publish すると「現在の公開版より低い」と誤判定され 400 になるため、
// uploadState=SUCCESS になるまでポーリングしてから提出する。
console.log('  アップロードの検証完了を待っています（最大3分）...');
const POLL_MAX = 36; // 5秒 × 36 = 180秒
let uploadDone = false;
for (let i = 0; i < POLL_MAX; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const pollRes = await request({
    hostname: 'www.googleapis.com',
    path: `/chromewebstore/v1.1/items/${cfg.CWS_ITEM_ID}?projection=DRAFT`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2' },
  });
  let pollJson;
  try { pollJson = JSON.parse(pollRes.body); } catch { pollJson = {}; }
  const state = pollJson.uploadState;
  if (process.env.CWS_DEBUG) console.log(`  [debug] poll ${i + 1}: uploadState=${state} crxVersion=${pollJson.crxVersion}`);
  if (state === 'SUCCESS') {
    console.log(`  検証完了 (uploadState=SUCCESS, crxVersion=${pollJson.crxVersion})`);
    uploadDone = true;
    break;
  }
  if (state === 'FAILURE') {
    console.error('ERROR: アップロード検証失敗');
    (pollJson.itemError || []).forEach((e) => console.error('  -', e.error_detail || JSON.stringify(e)));
    process.exit(1);
  }
  process.stdout.write(`  待機中... (${(i + 1) * 5}秒, state=${state})\r`);
}
if (!uploadDone) {
  console.error('\nERROR: 3分待っても検証が完了しませんでした。少し時間を置いて再実行するか、devconsole で状態を確認してください。');
  process.exit(1);
}

// 3. 審査提出（POST items/{id}/publish）。publishTarget=default を明示（全公開）。
console.log('[3/3] 審査提出中...');
const publishBody = JSON.stringify({ target: 'default' });
const publishRes = await request({
  hostname: 'www.googleapis.com',
  path: `/chromewebstore/v1.1/items/${cfg.CWS_ITEM_ID}/publish`,
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'x-goog-api-version': '2',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(publishBody),
  },
}, publishBody);
if (process.env.CWS_DEBUG) console.log('  [debug] publishRes.status=' + publishRes.status + ' body=' + publishRes.body);
let publishJson;
try { publishJson = JSON.parse(publishRes.body); } catch { publishJson = {}; }
if (publishRes.status >= 400) {
  console.error('ERROR: 審査提出失敗 (status=' + publishRes.status + ')');
  console.error('  ' + publishRes.body);
  const msg = publishRes.body || '';
  if (/version/i.test(msg)) {
    console.error('\n[対処] バージョン判定で弾かれました。アップロードの検証が完了しきっていない可能性があります。');
    console.error('       1〜2分おいてから、もう一度このコマンドを実行してください（zipは再アップロードされます）。');
  } else if (/item.*not.*ready|listing|metadata|screenshot|description|category|privacy/i.test(msg)) {
    console.error('\n[対処] 初回公開に必要な掲載情報が不足しています。devconsole で以下を埋めてから再実行してください:');
    console.error('       スクリーンショット(最低1枚) / 説明文 / アイコン / カテゴリ / 言語 / プライバシー設定(単一用途・権限根拠)。');
  }
  process.exit(1);
}
console.log('========================================');
console.log('審査提出 完了: status=' + (publishJson.status || []).join(', '));
if (publishJson.statusDetail) publishJson.statusDetail.forEach((d) => console.log(' ', d));
console.log('Google の審査結果はメール/ダッシュボードで確認 (数時間〜数日)。');
console.log('========================================');
