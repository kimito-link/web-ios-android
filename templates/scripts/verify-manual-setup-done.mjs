#!/usr/bin/env node
// 手動GUIタスク(自動化不可)の「完了」を API で実在確認する独立スクリプト。
//
// 背景: 新規アプリ立ち上げでは ASC のアプリ枠作成 / Play Console の新アプリ作成 という
// 手動GUIタスクがある(_docs/FIRST-SUBMISSION-blockers.md)。setup-new-app.mjs はこれを
// 「表示するだけ」だった。ここでは「終わったかどうかを機械的に確認できる」ようにする。
//
// 会議の「Shadow Store Simulation」案の縮小採用: フルシミュレーションはせず
// 「手動GUIが終わったら API で実在確認する」までに留める(実装コスト低・地雷マップと整合)。
//
// できること / できないこと:
//   - ASC アプリ枠: bundleId で findApp → 実在すれば OK。(JWT で読める)
//   - Play アプリ: packageName で edits を作れれば実在。作成した edit は削除して副作用ゼロ。
//   - Chrome の初回アイテム作成は API で存在確認する手段が無い → ここでは扱わない(手動)。
//
// creds/ID が無ければ各チェックを skip(fail-closed on findings, fail-open on availability)。
//
// Usage: node scripts/verify-manual-setup-done.mjs
//   exit 0 = 確認できた項目は全て OK(または skip)。exit 1 = 実在しない項目があった。
import { loadAppConfig, isPlaceholder } from './lib/app-config.mjs';
import { makeAscClient, findApp } from './lib/asc-api.mjs';
import { hasAscCreds, resolveAscPrivateKey } from './lib/asc-readonly-checks.mjs';
import { loadServiceAccount, makePlayClient } from './lib/play-api.mjs';

const cfg = loadAppConfig();
let failed = 0;
const ok = (m) => console.log(`  OK   ${m}`);
const bad = (m) => { console.error(`  FAIL ${m}`); failed++; };
const skip = (m) => console.log(`  -    ${m} (skip)`);

console.log('=== 手動セットアップの完了確認 ===');

// --- ASC アプリ枠 ---
const bundleId = process.env.APP_BUNDLE_ID || cfg.identity?.bundleId;
if (isPlaceholder(bundleId)) {
  skip('ASC app: identity.bundleId 未設定');
} else if (!hasAscCreds()) {
  skip('ASC app: APPSTORE_CONNECT_* creds が無い');
} else {
  try {
    const api = makeAscClient({
      keyId: (process.env.APPSTORE_CONNECT_KEY_ID || '').trim(),
      issuerId: (process.env.APPSTORE_CONNECT_ISSUER_ID || '').trim(),
      privateKey: resolveAscPrivateKey(),
    });
    const app = await findApp(api, bundleId);
    if (app) ok(`ASC app 実在: ${app.attributes?.name || app.id} (bundleId=${bundleId})`);
    else bad(`ASC app が見つからない (bundleId=${bundleId})。ASC でアプリ枠を作成し ascAppId を記入`);
  } catch (e) {
    bad(`ASC app 確認でエラー: ${e.message}`);
  }
}

// --- Play アプリ ---
const packageName = process.env.PLAY_PACKAGE_NAME || cfg.stores?.playPackageName;
const hasPlayCreds =
  process.env.GOOGLE_PLAY_SA_JSON ||
  process.env.GOOGLE_PLAY_SA_JSON_PATH ||
  process.env.GOOGLE_PLAY_SA_JSON_BASE64;
if (isPlaceholder(packageName)) {
  skip('Play app: stores.playPackageName 未設定');
} else if (!hasPlayCreds) {
  skip('Play app: GOOGLE_PLAY_SA_JSON* creds が無い');
} else {
  try {
    const sa = loadServiceAccount();
    const play = makePlayClient(sa, packageName);
    // edits を作れる = アプリが実在し SA に権限がある。作った edit は削除して副作用を残さない。
    const edit = await play('POST', '/edits');
    ok(`Play app 実在: ${packageName} (edit ${edit?.id} を作成・検証)`);
    if (edit?.id) {
      try { await play('DELETE', `/edits/${edit.id}`); }
      catch (e) { console.log(`  (edit ${edit.id} の削除に失敗・無害: ${e.message.slice(0, 120)})`); }
    }
  } catch (e) {
    // 404/403 は「アプリ未作成」or「SA 未権限」。どちらも手動GUIが未完。
    bad(`Play app が確認できない (${packageName}): ${e.message.slice(0, 200)}`);
  }
}

// --- Chrome(参考表示のみ) ---
console.log('  -    Chrome: 初回アイテム作成は API で存在確認不可(手動)。docs/CHROME-WEBSTORE.md 参照');

// --- Cloudflare Pages 独自ドメイン接続(設定している場合のみ) ---
const customDomain = cfg.web?.deploy?.customDomain;
const cfProjectName = cfg.web?.deploy?.projectName;
if (isPlaceholder(customDomain)) {
  skip('Cloudflareドメイン接続: web.deploy.customDomain 未設定(独自ドメインを使わないアプリ)');
} else if (!process.env.CLOUDFLARE_API_TOKEN) {
  skip('Cloudflareドメイン接続: CLOUDFLARE_API_TOKEN が無い(ローカルはwrangler loginで代替)');
} else if (isPlaceholder(cfProjectName)) {
  bad('Cloudflareドメイン接続: customDomain はあるが web.deploy.projectName が未設定');
} else {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/pages/projects/${encodeURIComponent(cfProjectName)}/domains/${encodeURIComponent(customDomain)}`,
      { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } },
    );
    const body = await res.json().catch(() => null);
    if (res.ok && body?.result?.status === 'active') {
      ok(`Cloudflareドメイン接続 実在・有効: ${customDomain}`);
    } else if (res.ok) {
      bad(`Cloudflareドメイン接続 未完了(状態: ${body?.result?.status || '不明'}): ${customDomain}。connect-domain.mjs を再実行`);
    } else {
      bad(`Cloudflareドメイン接続が見つからない (${customDomain})。connect-domain.mjs を実行してください`);
    }
  } catch (e) {
    bad(`Cloudflareドメイン接続の確認でエラー: ${e.message}`);
  }
}

console.log('');
if (failed > 0) {
  console.error(`確認失敗: ${failed} 件。手動GUIタスクが未完の可能性があります。`);
  process.exit(1);
}
console.log('確認できた項目はすべて OK(または skip)。');
