#!/usr/bin/env node
/**
 * setup-new-app.mjs — 新規アプリ立ち上げウィザード（web-ios-android キット汎用版）
 *
 * 出典(金型): Exosome/scripts/setup-new-app.mjs を、キットの実体(node資産)に合わせて汎用化。
 *   - Python(icon-gen/*.py)依存を除き、キット同梱の generate-store-assets.mjs を呼ぶ
 *   - 実アプリ固有値は一切持たない。すべて app.config.json(SSOT)から読む
 *
 * これは「コピー先の成果物リポ」で実行する想定:
 *   1. このキットの templates/ を成果物リポにコピー(scripts/ workflows/ capacitor/ android-twa/)
 *   2. app.config.json を埋める(<...> プレースホルダを実値に)
 *   3. node scripts/setup-new-app.mjs  ← これ
 *
 * やること: app.config.json 検証 → 資産生成(あれば) → TWA 初期化案内 →
 *           GitHub Secrets 一覧 → Play/ASC の手動GUIタスク を表示。
 * 「提出までを自動化、最後のGUI操作と合否は人間/審査側」(キットの実態)に正直な誘導。
 *
 * Usage: node scripts/setup-new-app.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadAppConfig, getProjectRoot } from './lib/app-config.mjs';

const ROOT = getProjectRoot();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes('--dry-run');

function header(t) { const b = '='.repeat(60); console.log(`\n${b}\n  ${t}\n${b}`); }
function step(n, total, m) { console.log(`\n[${n}/${total}] ${m}`); }
function ok(m) { console.log(`  OK   ${m}`); }
function warn(m) { console.log(`  WARN ${m}`); }
function fail(m) { console.error(`  FAIL ${m}`); }
function run(cmd, opts = {}) {
  if (DRY) { console.log(`  (dry-run) ${cmd}`); return; }
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });
}

// --- Step 1: config 読み込み + 検証 ---
header('setup-new-app: app.config.json を読み込み');
let config;
try { config = loadAppConfig(); } catch (e) { fail(e.message); process.exit(1); }

const PLACEHOLDER = [/^YOUR_/i, /^PLACEHOLDER/i, /^TODO/i, /^CHANGE_ME/i, /^example\./i, /^com\.example/i, /^</];
const isPlaceholder = (v) => typeof v === 'string' && PLACEHOLDER.some((re) => re.test(v));

const REQUIRED = [
  ['identity.displayName', config.identity?.displayName],
  ['identity.bundleId', config.identity?.bundleId],
  ['identity.productionDomain', config.identity?.productionDomain],
  ['stores.playPackageName', config.stores?.playPackageName],
  ['contact.email', config.contact?.email],
  ['contact.privacyUrl', config.contact?.privacyUrl],
  ['ownership.githubOrg', config.ownership?.githubOrg],
  ['ownership.githubRepo', config.ownership?.githubRepo],
];

header('必須フィールドの検証');
let errs = 0;
for (const [field, value] of REQUIRED) {
  if (!value || isPlaceholder(value)) { fail(`${field} 未設定 (${JSON.stringify(value)})`); errs++; }
  else ok(`${field} = ${value}`);
}
if (errs > 0) {
  console.error(`\n検証失敗: ${errs} 件の必須フィールドを app.config.json に記入してください。`);
  process.exit(1);
}

const { displayName, bundleId, productionDomain } = config.identity;
const { playPackageName } = config.stores;
const TOTAL = 4;

// --- Step 2: 資産生成(キット同梱の node スクリプトを使う。Python不要) ---
header('セットアップ手順');
step(1, TOTAL, 'ストア資産(アイコン/スクショ等)を生成');
const genAssets = path.join(__dirname, 'generate-store-assets.mjs');
if (fs.existsSync(genAssets)) {
  try { run(`node "${genAssets}"`); ok('資産生成 完了'); }
  catch { warn('generate-store-assets.mjs が失敗。アイコン元画像(app.config brand.iconSource)を確認。'); }
} else {
  warn('generate-store-assets.mjs が見つかりません(キットからコピーしてください)。');
}

// --- Step 3: Android TWA 初期化案内 ---
step(2, TOTAL, 'Android TWA 初期化(bubblewrap)');
const twaDir = path.join(ROOT, 'android-twa');
if (fs.existsSync(path.join(twaDir, 'app'))) {
  ok('android-twa/app あり — bubblewrap init はスキップ。');
} else {
  console.log(`  domain    : https://${productionDomain}`);
  console.log(`  packageId : ${playPackageName}`);
  console.log('  ↓ 対話式です。プロンプトに答えてから再実行してください:');
  console.log(`    npx @bubblewrap/cli init --manifest https://${productionDomain}/manifest.webmanifest`);
  console.log('  署名鍵は templates/android-twa/scripts/create-android-keystore.ps1(Windows)で生成。');
}

// --- Step 4: 手動でやること(GUI/Secrets)を明示 ---
step(3, TOTAL, 'GitHub Secrets(リポ Settings > Secrets > Actions に登録)');
[
  'APPLE_TEAM_ID', 'APPSTORE_CONNECT_KEY_ID', 'APPSTORE_CONNECT_ISSUER_ID',
  'APPSTORE_CONNECT_API_KEY_P8_BASE64', 'IOS_DIST_CERT_CER_BASE64',
  'IOS_DIST_PRIVATE_KEY_PEM_BASE64', 'IOS_DIST_CERT_PASSWORD', 'IOS_APPSTORE_PROFILE_BASE64',
  'ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PROPERTIES', 'GOOGLE_PLAY_SA_JSON_BASE64',
].forEach((s) => console.log(`  - ${s}`));

step(4, TOTAL, '最後の手動GUI(自動化不可・審査側/人間)');
console.log('  - ASC: アプリ枠の新規作成(Apple API不可)→ ascAppId を app.config.json stores に記入');
console.log('  - Play Console: 新アプリ作成 + 既存/新規 Service Account に権限付与');
console.log('  - iOS「配信地域」設定 / Android「審査用に送信」ボタン(最後の一押しは人間)');
console.log('  詳細: docs/TROUBLESHOOTING.md / _docs/apple-reject-knowledge-base.md');

header('setup-new-app: 完了');
console.log(`アプリ「${displayName}」(${bundleId}) の準備が整いました。`);
console.log('次: CI(templates/workflows/)を .github/workflows へ置き、Secrets 登録後に release ワークフローを実行。');
