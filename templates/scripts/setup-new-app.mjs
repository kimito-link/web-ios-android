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

// 電話番号だけに適用する追加のダミー判定(B6)。他フィールドに誤爆させないため電話専用。
// 非数字を除去してから判定する。実在番号にも 0000 の並びはありうる(市外局番の 0 落ち等)ので、
// blocking にはせず warn(下の検証ループ参照)。より強いダミー signature に絞る:
//   - 0 が 6 個以上連続(実在番号ではほぼ無い)、または
//   - 加入者番号が全桁ダミー(1234567890 / 0000000000 の完全一致系)。
const isDummyPhone = (v) => {
  if (typeof v !== 'string') return false;
  const digits = v.replace(/\D/g, '');
  return /0{6,}/.test(digits) || /^(?:\+?\d{1,3})?0{7,}$/.test(digits) || digits.includes('1234567890');
};

const REQUIRED = [
  ['identity.displayName', config.identity?.displayName],
  ['identity.bundleId', config.identity?.bundleId],
  ['identity.productionDomain', config.identity?.productionDomain],
  ['stores.playPackageName', config.stores?.playPackageName],
  ['contact.email', config.contact?.email],
  ['contact.privacyUrl', config.contact?.privacyUrl],
  // 電話番号(B6): 却下対応で実際に問題になった。形式チェックのみ(実在確認は不可)。
  ['contact.phoneE164', config.contact?.phoneE164],
  ['ownership.githubOrg', config.ownership?.githubOrg],
  ['ownership.githubRepo', config.ownership?.githubRepo],
];

header('必須フィールドの検証');
let errs = 0;
for (const [field, value] of REQUIRED) {
  if (!value || isPlaceholder(value)) { fail(`${field} 未設定 (${JSON.stringify(value)})`); errs++; }
  else if (field === 'contact.phoneE164' && isDummyPhone(value)) {
    // ヒューリスティックなので blocking にしない(実在番号を誤って弾かない)。人間に確認を促す。
    warn(`${field} がダミー番号に見えます (${JSON.stringify(value)})。実在の連絡先電話番号か確認を(B6)`);
    ok(`${field} = ${value} (要確認)`);
  } else ok(`${field} = ${value}`);
}
if (errs > 0) {
  console.error(`\n検証失敗: ${errs} 件の必須フィールドを app.config.json に記入してください。`);
  process.exit(1);
}

// --- 依存の事前チェック: Playwright(B5) ---
// FIRST-SUBMISSION-blockers.md B5: capture-*-screenshots.mjs は @playwright/test に依存するが
// 新規アプリの package.json には入っていないことが多い。dry_run でも検出できるが、setup 時点で
// 気づけば 1 サイクル早い。スクショ capture スクリプトが実在するときだけ警告する。
{
  const pkgPath = path.join(ROOT, 'package.json');
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch { /* package.json 無し/壊れは別途扱い */ }
  const hasPlaywright = Boolean(
    pkg?.devDependencies?.['@playwright/test'] || pkg?.dependencies?.['@playwright/test'],
  );
  const capturesExist =
    fs.existsSync(path.join(ROOT, 'scripts/capture-appstore-screenshots.mjs')) ||
    fs.existsSync(path.join(ROOT, 'scripts/capture-play-screenshots.mjs'));
  if (capturesExist && !hasPlaywright) {
    warn('@playwright/test が package.json に無い。スクショ capture が実行時に落ちます(B5)。');
    console.log('       修正: pnpm add -w -D @playwright/test  (または npm i -D @playwright/test)');
  } else if (capturesExist) {
    ok('@playwright/test あり(スクショ capture の依存充足)');
  }
}

const { displayName, bundleId, productionDomain } = config.identity;
const { playPackageName } = config.stores;
const customDomain = config.web?.deploy?.customDomain;
const wantsDomainConnect = customDomain && !isPlaceholder(customDomain);
const TOTAL = wantsDomainConnect ? 5 : 4;

// --- Step 2: 資産生成 + 本体内の診断進捗ページ生成 ---
header('セットアップ手順');
step(1, TOTAL, 'ストア資産(アイコン/スクショ等)を生成');
const genAssets = path.join(__dirname, 'generate-store-assets.mjs');
if (fs.existsSync(genAssets)) {
  try { run(`node "${genAssets}"`); ok('資産生成 完了'); }
  catch { warn('generate-store-assets.mjs が失敗。アイコン元画像(app.config brand.iconSource)を確認。'); }
} else {
  warn('generate-store-assets.mjs が見つかりません(キットからコピーしてください)。');
}

const genShindan = path.join(__dirname, 'generate-shindan-version.mjs');
if (fs.existsSync(genShindan)) {
  try {
    run(`node "${genShindan}"`);
    ok(`本体の診断進捗ページを生成: https://${productionDomain}/check-shindan-version/`);
  } catch {
    warn('診断進捗ページの初期生成に失敗。node scripts/generate-shindan-version.mjs を再実行してください。');
  }
} else {
  warn('generate-shindan-version.mjs が見つかりません(キットからコピーしてください)。');
}

// --- Step 3: Android 初期化案内(Capacitor優先。TWAはIAP不要な軽量アプリ向けの代替) ---
step(2, TOTAL, 'Android 初期化(Capacitor)');
const androidDir = path.join(ROOT, 'android');
const twaDir = path.join(ROOT, 'android-twa');
if (fs.existsSync(path.join(androidDir, 'app'))) {
  ok('android/app あり — cap add android はスキップ。');
} else if (fs.existsSync(path.join(twaDir, 'app'))) {
  ok('android-twa/app あり(TWA構成) — bubblewrap init はスキップ。');
  console.log('  ※ TWA構成はGoogle Play Billing(アプリ内課金)をネイティブ組み込みできません。');
  console.log('    IAPが必要なら android-twa/ を捨てて Capacitor(android/) に切り替えてください。');
} else {
  console.log('  ↓ npm install 後に実行してください:');
  console.log('    npx cap add android');
  console.log('  署名鍵は templates/android-twa/scripts/create-android-keystore.ps1(Windows)で生成');
  console.log('  (TWA専用ではなく汎用のkeystore生成スクリプトとして流用可)。');
  console.log('  ');
  console.log('  ※ IAP(アプリ内課金)が不要な単純なWebラップだけで良い場合は、代わりに');
  console.log('    軽量なTWA(bubblewrap)構成も選べます:');
  console.log(`      npx @bubblewrap/cli init --manifest https://${productionDomain}/manifest.webmanifest`);
}

// --- Step 4: 手動でやること(GUI/Secrets)を明示 ---
step(3, TOTAL, 'GitHub Secrets — 鍵を置いて一括登録（手で1個ずつ入れない）');
console.log('  鍵を .secrets-local/ に置けば、次の1コマンドで全 Secret を登録できます:');
console.log('    node scripts/bootstrap-secrets.mjs            # 何が登録されるか確認（ドライ）');
console.log('    node scripts/bootstrap-secrets.mjs --apply    # 実際に gh secret set');
console.log('  必要なファイル名は `node scripts/bootstrap-secrets.mjs --help` で一覧。');
console.log('  （APPLE_TEAM_ID は app.config.json から自動。鍵の作り方は release-pipeline-playbook §6）');

if (wantsDomainConnect) {
  step(4, TOTAL, `独自ドメイン接続(Cloudflare Pages) — ${customDomain}`);
  console.log('  app.config.json の web.deploy.customDomain が設定されています。以下の順で接続します:');
  console.log('    node scripts/cloudflare-auth.mjs        # 初回のみ・ブラウザでCloudflareにログイン');
  console.log('    node scripts/deploy-cloudflare-pages.mjs --project <Pagesプロジェクト名>');
  console.log('    node scripts/connect-domain.mjs          # ドメインを接続(冪等・再実行可)');
  console.log('  詳細・トークン失効時の対処: _docs/cloudflare-workers-token-expiry-knowledge-base.md');
}

step(wantsDomainConnect ? 5 : 4, TOTAL, '最後の手動GUI(自動化不可・審査側/人間)');
console.log('  - ASC: アプリ枠の新規作成(Apple API不可)→ ascAppId を app.config.json stores に記入');
console.log('  - Play Console: 新アプリ作成 + 既存/新規 Service Account に権限付与');
console.log('  - iOS「配信地域」設定 / Android「審査用に送信」ボタン(最後の一押しは人間)');
console.log('  詳細: docs/TROUBLESHOOTING.md / _docs/apple-reject-knowledge-base.md');
console.log('  ↓ ASC アプリ枠 / Play アプリの作成が終わったら、API で実在確認できます:');
console.log('    node scripts/verify-manual-setup-done.mjs   # creds があれば ASC/Play の枠を検証');

header('setup-new-app: 完了');
console.log(`アプリ「${displayName}」(${bundleId}) の準備が整いました。`);
console.log('次: CI(templates/workflows/)を .github/workflows へ置き、Secrets 登録後に release ワークフローを実行。');
