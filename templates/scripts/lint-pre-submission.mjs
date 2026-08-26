#!/usr/bin/env node
// 移植元: partnership_program_website/scripts/lint-pre-submission.mjs
//   (リバースハック固有の Clerk / partner URL / client・server パスのハードコードを除去し、
//    app.config.json 駆動 + 環境変数オーバーライド + 「ファイルが無ければ skip」に一般化)。
//
// 審査前 lint — このキットで実証済みの Apple 却下ベクタを、ストア提出CIが
// Apple に送る前に検出する。`node scripts/lint-pre-submission.mjs` で手動実行、
// または CI(ios/android release の前段)で走らせる。
//
// 各チェックは独立。すべての失敗を集めて、blocking が1つでもあれば exit 1。
// warning(非 blocking)は表示するが exit は止めない。
//
// ガイドライン別の背景は _docs/apple-reject-knowledge-base.md を参照。
//
// 環境変数(アプリのレイアウトに合わせて上書き可能。未指定なら既定パスを探す):
//   APP_SIGNIN_GLOB        ログイン関連 source(既定: client/src/**, src/**)
//   APP_RELEASE_WORKFLOW   iOS release workflow(既定: .github/workflows/ios-appstore-release.yml)
//   APP_PLAY_WORKFLOW      Android release workflow(既定: .github/workflows/android-play-release.yml)
//   APP_PLATFORM_SCAN_DIRS 2.3.10 platform 参照を grep するディレクトリ(カンマ区切り、既定: store-assets,release-notes)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ANSI_RED = '\x1b[31m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_DIM = '\x1b[2m';
const ANSI_RESET = '\x1b[0m';

const failures = [];
const warnings = [];

function fail(name, guideline, message) {
  failures.push({ name, guideline, message });
}
function warn(name, guideline, message) {
  warnings.push({ name, guideline, message });
}
function ok(name, detail) {
  console.log(`${ANSI_GREEN}✓${ANSI_RESET} ${name}${detail ? `  ${ANSI_DIM}${detail}${ANSI_RESET}` : ''}`);
}
function skip(name, why) {
  console.log(`${ANSI_DIM}- ${name} (skip: ${why})${ANSI_RESET}`);
}

function readFile(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}
function readJson(rel) {
  const c = readFile(rel);
  return c ? JSON.parse(c) : null;
}
function* walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkDir(full);
    else yield full;
  }
}

const appConfig = readJson('app.config.json');
const pkg = readJson('package.json');

/**
 * capacitor の appId を取り出す。
 *
 * ★`.json` 決め打ちで読むと、capacitor.config.ts を使うプロジェクトでは cap が常に null になり、
 *   **CHECK 2 が skip 表示すら出さずに丸ごと消滅する**（kimitolink-linktree で実際に発生・
 *   2026-08-05 発見。CHECK 9 は `.ts` フォールバック済みで CHECK 2 だけ取り残されていた）。
 *   ゲートは「見ていないこと」が見えなくなるのが最も危険なので、両形式を読む。
 */
function readCapacitorAppId() {
  const capJson = readJson('capacitor.config.json');
  if (capJson) return { appId: capJson.appId ?? null, source: 'capacitor.config.json' };

  const capTs = readFile('capacitor.config.ts');
  if (capTs != null) {
    // ★コメントを除いてから、**トップレベル**の appId だけを拾う。
    //   素朴に `match(/appId:.../)` すると最初の1件しか見ないため、
    //   「旧IDをコメントで残す」「plugins の中に appId を持つプラグインがある」という
    //   ごく普通の編集で**誤った値を拾う**（実測で3パターン確認）。
    //   誤検出は fail なら気付けるが、逆に誤一致で緑になると出荷ゲートが素通りする。
    const noComment = capTs
      .replace(/\/\*[\s\S]*?\*\//g, '')        // ブロックコメント
      .replace(/(^|[^:])\/\/.*$/gm, '$1');     // 行コメント（URL の // を壊さない）
    // `appId: 'com.example.app'` / "..." / バッククォート を許容。
    // 行頭インデント2以下＝トップレベル定義に限定（ネストしたプラグイン設定を拾わない）。
    const m = noComment.match(/^\s{0,2}appId:\s*['"`]([^'"`]+)['"`]/m);
    return { appId: m ? m[1] : null, source: 'capacitor.config.ts' };
  }
  return null;
}

const cap = readCapacitorAppId();

// ----------------------------------------------------------------------------
// CHECK 1 — version が semver X.Y.Z(meta)
// ----------------------------------------------------------------------------
const marketingVersion = appConfig?.stores?.marketingVersion || pkg?.version;
if (!marketingVersion) {
  warn('version-present', 'meta', 'app.config.json stores.marketingVersion も package.json version も無い');
} else if (!/^\d+\.\d+\.\d+$/.test(String(marketingVersion))) {
  fail('version-semver', 'meta', `version "${marketingVersion}" が semver X.Y.Z でない`);
} else {
  ok('version-semver', `version = ${marketingVersion}`);
}

// ----------------------------------------------------------------------------
// CHECK 2 — Bundle ID 整合(capacitor.config.json appId == app.config bundleId)
// ----------------------------------------------------------------------------
const bundleId = appConfig?.identity?.bundleId;
// どの分岐に落ちても必ず ok/fail/skip のいずれかを出す（沈黙させない）。
if (!cap) {
  skip('bundle-id-consistency', 'capacitor.config.json / .ts のどちらも読めない');
} else if (!cap.appId) {
  skip('bundle-id-consistency', `${cap.source} から appId を読み取れない`);
} else if (!bundleId || String(bundleId).startsWith('<')) {
  skip('bundle-id-consistency', 'app.config identity.bundleId が未設定（プレースホルダのまま）');
} else if (cap.appId !== bundleId) {
  fail('bundle-id-consistency', 'meta', `${cap.source} appId="${cap.appId}" != app.config bundleId="${bundleId}"`);
} else {
  ok('bundle-id-consistency', cap.appId);
}

// ----------------------------------------------------------------------------
// CHECK 3 — 2.3.10 他プラットフォーム参照(Apple に送るメタデータに混入させない)
// ----------------------------------------------------------------------------
const banned = ['Android', 'Google Play', 'Play Store', 'Galaxy Store', 'Amazon Appstore', 'Material Design'];
const scanDirs = (process.env.APP_PLATFORM_SCAN_DIRS || 'store-assets/appstore,release-notes')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
let scannedAny = false;
let platformHit = false;
for (const dir of scanDirs) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  scannedAny = true;
  for (const f of walkDir(abs)) {
    if (!/\.(txt|md|json)$/i.test(f)) continue;
    // ★README / CONTRIBUTING は Apple に送信されない「書き方ガイド」であり、
    //   その性質上「`Android` や `Google Play` という語を入れないこと」という
    //   **禁止事項の説明として禁止語が出てくる**。これを 2.3.10 違反として
    //   fail にすると、ガイドを書けば書くほど落ちる不条理になる（実測で誤検知を確認）。
    //   実際に送信されるのは同ディレクトリの本文ファイル（CURRENT-*.txt 等）の方。
    if (/(^|[\\/])(README|CONTRIBUTING)\.md$/i.test(f)) continue;
    const c = fs.readFileSync(f, 'utf8');
    const hits = banned.filter((w) => c.toLowerCase().includes(w.toLowerCase()));
    if (hits.length > 0) {
      platformHit = true;
      fail('platform-references', '2.3.10', `${path.relative(ROOT, f)}: ${hits.join(', ')}`);
    }
  }
}
if (!scannedAny) {
  skip('platform-references', `スキャン対象ディレクトリが無い (${scanDirs.join(', ')})`);
} else if (!platformHit) {
  ok('platform-references', `iOS メタデータに Android/Play 等の混入なし`);
}

// ----------------------------------------------------------------------------
// CHECK 4 — App Review 用 URL(app.config.json contact.*)
// ----------------------------------------------------------------------------
if (appConfig) {
  const urls = [
    ['supportUrl', appConfig.contact?.supportUrl],
    ['privacyUrl', appConfig.contact?.privacyUrl],
    ['marketingUrl', appConfig.contact?.marketingUrl],
  ];
  // dataDeletionUrl は「アカウント作成があるアプリ」のみ必須。businessModel から推定できないので warn。
  const dataDeletion = appConfig.contact?.dataDeletionUrl;
  const missing = urls.filter(([, v]) => !v || String(v).startsWith('<') || !/^https:\/\//.test(String(v)));
  if (missing.length > 0) {
    fail('app-config-review-urls', 'privacy/5.1.1(v)', `contact URL が未設定 or 非https: ${missing.map(([k]) => k).join(', ')}`);
  } else {
    ok('app-config-review-urls', 'support / privacy / marketing URL あり');
  }
  if (!dataDeletion || String(dataDeletion).startsWith('<')) {
    warn('account-deletion-url', '5.1.1(v)', 'contact.dataDeletionUrl 未設定。アカウント作成があるアプリは削除導線が必須(iOS16+)');
  } else if (/^https:\/\//.test(String(dataDeletion))) {
    ok('account-deletion-url', 'dataDeletionUrl あり');
  }
} else {
  skip('app-config-review-urls', 'app.config.json が無い');
}

// ----------------------------------------------------------------------------
// CHECK 5 — 2.3.3 スクショ capture は「ログイン後」を撮る(ログイン認証アプリのみ)
// v1.0.7: capture が未認証 /sign-in を撮り 2.3.3 却下。fail-closed を固定する。
// ログイン不要アプリは IOS_REVIEW_DEMO_* を使わないので skip 扱い。
// ----------------------------------------------------------------------------
const captureScript = readFile('scripts/capture-appstore-screenshots.mjs');
if (!captureScript) {
  warn('screenshot-capture-script', '2.3.3', 'scripts/capture-appstore-screenshots.mjs が無い(committed スクショ運用なら可)');
} else {
  // 認証方式は2通り: Clerk等の直接ログイン(IOS_REVIEW_DEMO_USERNAME/_PASSWORD)、
  // またはCI直接ログインがbot検知で弾かれるアプリ向けの storageState 再利用
  // (IOS_REVIEW_STORAGE_STATE_JSON_BASE64。名前はIOS_だがAndroid captureとも共用可)。
  const usesDemo = captureScript.includes('IOS_REVIEW_DEMO_USERNAME') && captureScript.includes('IOS_REVIEW_DEMO_PASSWORD');
  const usesStorageState = captureScript.includes('IOS_REVIEW_STORAGE_STATE_JSON_BASE64');
  const usesAuth = usesDemo || usesStorageState;
  const failsClosed = /process\.exit\(1\)/.test(captureScript);
  if (!usesAuth) {
    // ログイン不要アプリ(public 画面のみで価値が伝わる)では正当。warn に留める。
    warn(
      'screenshot-capture-auth',
      '2.3.3',
      'capture が IOS_REVIEW_DEMO_USERNAME/_PASSWORD も IOS_REVIEW_STORAGE_STATE_JSON_BASE64 も ' +
        '読まない。ログイン認証アプリならログイン後画面を撮らないと v1.0.7 と同じ 2.3.3 却下になる。' +
        'ログイン不要アプリなら無視可。',
    );
  } else if (!failsClosed) {
    fail('screenshot-capture-failclosed', '2.3.3', 'creds 欠落時に process.exit(1) しない。silent fallback は 2.3.3 を再発させる');
  } else {
    ok('screenshot-capture-auth', 'capture はログインして fail-closed');
  }
}

// ----------------------------------------------------------------------------
// CHECK 6 — 2.3.3 スクショ upload は delete-then-reupload(slot 内の stale を残さない)
// v1.0.8: filename 一致で skip した結果、slot1 に旧ログイン画面が残り再却下。
// ----------------------------------------------------------------------------
const ssUpload = readFile('scripts/lib/asc-screenshot-upload.mjs');
if (!ssUpload) {
  skip('screenshot-upload-delete-then-reupload', 'scripts/lib/asc-screenshot-upload.mjs が無い');
} else {
  const callsDelete = /deleteAllScreenshots\s*\(/.test(ssUpload);
  const hasDeleteApi = /['"]DELETE['"]/.test(ssUpload) && /appScreenshots\//.test(ssUpload);
  const hasFilenameSkip = /already uploaded; skipping/.test(ssUpload);
  if (!callsDelete || !hasDeleteApi) {
    fail(
      'screenshot-upload-delete-then-reupload',
      '2.3.3',
      `asc-screenshot-upload.mjs は再upload前に deleteAllScreenshots + DELETE /v1/appScreenshots/{id} を ` +
        `呼ぶこと(callsDelete=${callsDelete} hasDeleteApi=${hasDeleteApi})。ASC slot は versionString を跨いで persist する。`,
    );
  } else if (hasFilenameSkip) {
    warn('screenshot-upload-stale-skip', '2.3.3', '"already uploaded; skipping" の legacy dedup 文字列が残っている。到達不能か確認');
    ok('screenshot-upload-delete-then-reupload', 'delete-then-reupload あり(warn: legacy 文字列残存)');
  } else {
    ok('screenshot-upload-delete-then-reupload', 'delete-then-reupload あり');
  }
}

// ----------------------------------------------------------------------------
// CHECK 7 — release workflow の path filter が提出スクリプトを全て含む
// v1.0.8 retry#1: capture script が on.push.paths に無く、修正 push が silent no-op。
// ----------------------------------------------------------------------------
function checkWorkflowPaths(rel, requiredScripts, label) {
  const wf = readFile(rel);
  if (!wf) {
    skip(`${label}-workflow-paths`, `${rel} が無い`);
    return;
  }
  const m = wf.match(/\n {4}paths:\n([\s\S]*?)(?=\n[a-z][a-zA-Z_-]*:)/);
  const block = m ? m[1] : '';
  if (!block) {
    // path filter 無し = 全 push でトリガ(または別 on トリガ)。warn に留める。
    warn(`${label}-workflow-paths`, 'process', `${rel} に on.push.paths が無い。提出スクリプト修正が再ビルドをトリガするか確認`);
    return;
  }
  // workflow が実際に実行している script のみ必須化(invoke していないものは false flag しない)。
  const required = requiredScripts.filter((s) => wf.includes(`scripts/${s}`));
  const missing = required.filter((s) => !block.includes(`scripts/${s}`));
  if (missing.length > 0) {
    fail(`${label}-workflow-paths`, 'process', `${rel} の on.push.paths に提出スクリプトが欠落: ${missing.join(', ')}(修正 push が再トリガしない)`);
  } else if (required.length > 0) {
    ok(`${label}-workflow-paths`, `${required.length} scripts が path filter に存在`);
  } else {
    skip(`${label}-workflow-paths`, 'workflow が該当スクリプトを invoke していない');
  }
}
checkWorkflowPaths(
  process.env.APP_RELEASE_WORKFLOW || '.github/workflows/ios-appstore-release.yml',
  ['appstore-submit.mjs', 'capture-appstore-screenshots.mjs', 'frame-appstore-screenshots.mjs', 'lib/asc-api.mjs', 'lib/asc-screenshot-upload.mjs'],
  'ios',
);
checkWorkflowPaths(
  process.env.APP_PLAY_WORKFLOW || '.github/workflows/android-play-release.yml',
  ['play-publish.mjs', 'play-fill-listing.mjs', 'play-fill-data-safety.mjs', 'capture-play-screenshots.mjs', 'lib/play-api.mjs'],
  'android',
);

// ----------------------------------------------------------------------------
// CHECK 8 — Play スクショ capture も fail-closed(CHECK 5 の Play 版)
// ----------------------------------------------------------------------------
const playCapture = readFile('scripts/capture-play-screenshots.mjs');
if (!playCapture) {
  skip('play-capture-auth', 'scripts/capture-play-screenshots.mjs が無い');
} else {
  const usesDemo = playCapture.includes('IOS_REVIEW_DEMO_USERNAME') && playCapture.includes('IOS_REVIEW_DEMO_PASSWORD');
  const usesStorageState = playCapture.includes('IOS_REVIEW_STORAGE_STATE_JSON_BASE64');
  const usesAuth = usesDemo || usesStorageState;
  const failsClosed = /process\.exit\(1\)/.test(playCapture);
  if (!usesAuth) {
    warn(
      'play-capture-auth',
      '2.3.3',
      'Play capture が demo creds も IOS_REVIEW_STORAGE_STATE_JSON_BASE64 も読まない。' +
        'ログイン認証アプリならログイン後を撮ること。',
    );
  } else if (!failsClosed) {
    fail('play-capture-failclosed', '2.3.3', 'Play capture も creds 欠落時 exit 1 すること');
  } else {
    ok('play-capture-auth', 'Play capture はログインして fail-closed');
  }
}

// ----------------------------------------------------------------------------
// CHECK 9 — Capacitor WebView 黒画面/ATS の静的チェック
//   _docs/CAPACITOR-GOLDEN-RULES.md をコード化。server.url が cleartext(http)だと
//   ATS にブロックされ黒画面になる。NSAllowsArbitraryLoads の乱用も審査で指摘される。
//   このキットの真実の源は capacitor.config.ts(原則2)。.ts をテキスト走査し、
//   無ければ .json に fallback。{{...}} プレースホルダ(未コピーのテンプレ)は skip。
// ----------------------------------------------------------------------------
{
  const capTs = readFile('capacitor.config.ts');
  const capJson = capTs != null ? null : readJson('capacitor.config.json');
  const capSource = capTs != null ? capTs : (readFile('capacitor.config.json') || null);
  const sourceName = capTs != null ? 'capacitor.config.ts' : 'capacitor.config.json';
  // server.url は「server ブロック内の url」に限定する。プラグイン等の別の url: を誤読すると
  // false fail/false ok になる(レビュー指摘 HIGH)。
  //   - .json: JSON.parse して server.url を直読み(最も確実)。
  //   - .ts  : `server: { ... }` ブロックを切り出してから、その中の url: だけ拾う。
  let serverUrl = null;
  if (capJson) {
    serverUrl = capJson.server?.url ?? null;
  } else if (capSource) {
    const serverBlock = capSource.match(/\bserver\s*:\s*\{([\s\S]*?)\}/);
    const scope = serverBlock ? serverBlock[1] : '';
    const urlMatch = scope.match(/\burl\s*:\s*['"]([^'"]+)['"]/);
    serverUrl = urlMatch ? urlMatch[1] : null;
  }
  const isPlaceholderUrl = serverUrl ? /\{\{|<\.\.\.>|example\.com/.test(serverUrl) : false;
  // cleartext:true は server ブロック内に限定して判定(別ブロックの同名キー誤読を避ける)。
  const serverScope = capJson
    ? JSON.stringify(capJson.server || {})
    : (capSource?.match(/\bserver\s*:\s*\{([\s\S]*?)\}/)?.[1] || '');

  if (!capSource) {
    skip('capacitor-server-cleartext', 'capacitor.config.(ts|json) が無い(server.url 連動型でなければ可)');
  } else if (!serverUrl) {
    // バンドル型(server.url 無し)は正当。原則1では連動型が標準だが、ここでは fail にしない。
    skip('capacitor-server-cleartext', `${sourceName} に server.url が無い(バンドル型なら可)`);
  } else if (isPlaceholderUrl) {
    skip('capacitor-server-cleartext', `${sourceName} の server.url が未コピーのプレースホルダ`);
  } else if (/^http:\/\//i.test(serverUrl)) {
    fail('capacitor-server-cleartext', 'ATS', `${sourceName} server.url が http:// (cleartext)。ATS にブロックされ黒画面の原因になる: ${serverUrl}`);
  } else if (!/^https:\/\//i.test(serverUrl)) {
    warn('capacitor-server-scheme', 'ATS', `${sourceName} server.url が https:// でない: ${serverUrl}`);
  } else {
    // cleartext:true が明示されていれば http 読込を許してしまうので警告(server ブロック内のみ)。
    // .ts の `cleartext: true` と .json の `"cleartext":true` 両対応。
    if (/["']?cleartext["']?\s*:\s*true\b/.test(serverScope)) {
      warn('capacitor-cleartext-flag', 'ATS', `${sourceName} server に cleartext: true。https 運用では不要。意図しない http 読込を許す`);
    }
    ok('capacitor-server-cleartext', `server.url = ${serverUrl} (https)`);
  }

  // Info.plist の NSAllowsArbitraryLoads=true は ATS を全面無効化する。審査指摘リスク。
  const infoPlist = readFile('ios/App/App/Info.plist');
  if (infoPlist == null) {
    skip('ats-arbitrary-loads', 'ios/App/App/Info.plist が無い(CI で cap copy 後に生成)');
    // <true/>(短縮形, Xcode/plutil の既定)と <true></true>(手書き長形式)の両方を拾う。
  } else if (/<key>\s*NSAllowsArbitraryLoads\s*<\/key>\s*<true\s*\/?>(<\/true>)?/.test(infoPlist)) {
    warn('ats-arbitrary-loads', 'ATS', 'Info.plist NSAllowsArbitraryLoads=true。ATS 全面無効化は審査で指摘されうる。必要な例外ドメインだけ許可に絞る');
  } else {
    ok('ats-arbitrary-loads', 'NSAllowsArbitraryLoads の乱用なし');
  }
}

// ----------------------------------------------------------------------------
// CHECK 10〜13 — ASC の Read-Only 検証(contentRightsDeclaration / App プライバシー公開 /
//   配信地域 / reviewer デモ値の stale)。creds + bundleId があるときだけ有効化。
//   _docs/FIRST-SUBMISSION-blockers.md B7/B8 を「症状が出てから直す」から
//   「submit 前に API で読み取って止める」ゲートに昇格する。
//   API 呼び出しはこの区画のみ。ローカルで creds が無ければ skip し高速フィードバックを壊さない。
// ----------------------------------------------------------------------------
{
  const { hasAscCreds, runAscReadonlyChecks } = await import('./lib/asc-readonly-checks.mjs');
  const ascBundleId = appConfig?.identity?.bundleId;
  if (!ascBundleId || String(ascBundleId).startsWith('<')) {
    skip('asc-readonly-manual-items', 'app.config identity.bundleId が未設定');
  } else if (!hasAscCreds()) {
    skip('asc-readonly-manual-items', 'APPSTORE_CONNECT_* creds が無い(ローカル実行)');
  } else {
    const results = await runAscReadonlyChecks(ascBundleId);
    for (const { name, guideline, result } of results) {
      if (result.status === 'fail') fail(name, guideline, result.detail);
      else if (result.status === 'warn') warn(name, guideline, result.detail);
      else ok(name, result.detail);
    }
  }
}

// ----------------------------------------------------------------------------
// CHECK 14 — 直近 bump で SW キャッシュ版数の更新がスキップされていないか
//   release-bump.mjs が release-history/<version>.json に立てる sw_cache_bump_skipped を拾う。
//   bump 時の warn は埋もれやすいので、提出前 lint で2段目のセーフティネットにする。
// ----------------------------------------------------------------------------
if (marketingVersion && /^\d+\.\d+\.\d+$/.test(String(marketingVersion))) {
  const history = readJson(`release-history/${marketingVersion}.json`);
  if (!history) {
    skip('sw-cache-bump', `release-history/${marketingVersion}.json が無い(release-bump 未実行 or 別運用)`);
  } else if (history.sw_cache_bump_skipped === true) {
    warn('sw-cache-bump', 'process', `直近 bump(${marketingVersion})で SW キャッシュ版数の更新がスキップされた。古い Service Worker が残る恐れ。sw.js の CACHE_NAME パターンか SW_CACHE_PREFIX を確認`);
  } else {
    ok('sw-cache-bump', `release-history/${marketingVersion}.json: SW キャッシュ bump スキップなし`);
  }
} else {
  skip('sw-cache-bump', 'marketingVersion が semver でないため履歴照合をスキップ');
}

// ----------------------------------------------------------------------------
// CHECK 15 — iOS プライバシーマニフェスト(PrivacyInfo.xcprivacy)
//   _docs/pre-submission-compliance-checklist.md (A) 表「iOS プライバシーマニフェスト宣言」のコード化。
//   裏取り済みの実態(2026-07-04, ionic-team/capacitor main):
//     - `cap add ios` のアプリテンプレ(ios-pods-template / ios-spm-template)は
//       app-level PrivacyInfo.xcprivacy を生成しない。
//     - SDK 側(Capacitor.framework / CapacitorCordova)はマニフェストを同梱
//       (commit #7321, 2024-03-11 → Capacitor 6.0.0 以降に同梱)。
//   よって「ファイルが無ければ fail」は CI 生成プロジェクトで必ず false-fail する。
//   検査は次の3点に落とす:
//     1. @capacitor/ios < 6 → SDK 自体がマニフェスト無し = ITMS-91053 リスク → fail
//     2. ios/ をコミットしていて app-level マニフェストを置いた場合、
//        pbxproj から参照されていなければバンドルされない(置いた意図が実装されていない) → fail
//     3. ios/ コミット + マニフェスト無しは、自前 native code が Required Reason API を
//        使う場合のみ必要 → warn(Xcode の Privacy Report で確認を促す)
//   ⚠ バージョン閾値・必須SDKリストは更新されうる。一次ソース:
//     https://developer.apple.com/support/third-party-SDK-requirements/
// ----------------------------------------------------------------------------
{
  const capIosVer =
    pkg?.dependencies?.['@capacitor/ios'] || pkg?.devDependencies?.['@capacitor/ios'] || null;
  const iosAppDir = path.join(ROOT, 'ios', 'App');
  const hasIosDir = fs.existsSync(iosAppDir);
  const majorMatch = capIosVer ? String(capIosVer).match(/\d+/) : null;
  const capIosMajor = majorMatch ? Number(majorMatch[0]) : null;

  if (!capIosVer && !hasIosDir) {
    skip('privacy-manifest', '@capacitor/ios 依存も ios/App も無い(iOS 配布しないなら可)');
  } else if (capIosVer && capIosMajor == null) {
    warn('privacy-manifest', '必須SDK要件(2024-05)', `@capacitor/ios のバージョン "${capIosVer}" を解釈できない。6 以上(SDK 同梱マニフェストあり)か確認すること`);
  } else if (capIosMajor != null && capIosMajor < 6) {
    fail(
      'privacy-manifest',
      '必須SDK要件(2024-05)',
      `@capacitor/ios ${capIosVer} (<6) は PrivacyInfo.xcprivacy を同梱しない。ITMS-91053 / 提出却下リスク。` +
        'Capacitor 6+ へ更新するか、app-level の PrivacyInfo.xcprivacy を ios/App/App に追加して pbxproj に登録すること',
    );
  } else if (hasIosDir) {
    const manifest = readFile('ios/App/App/PrivacyInfo.xcprivacy');
    const pbx = readFile('ios/App/App.xcodeproj/project.pbxproj');
    if (manifest == null) {
      warn(
        'privacy-manifest',
        '必須SDK要件(2024-05)',
        'ios/ をコミットしているが app-level PrivacyInfo.xcprivacy が無い。薄殻(自前 native code 無し)なら ' +
          'SDK 同梱マニフェストで足りるが、自前コードが Required Reason API(UserDefaults 等)を使うなら必須。' +
          'Xcode の Privacy Report(Product > Archive > Generate Privacy Report)で最終バンドルを確認すること',
      );
    } else if (!/NSPrivacyAccessedAPITypes|NSPrivacyCollectedDataTypes|NSPrivacyTracking/.test(manifest)) {
      warn('privacy-manifest', '必須SDK要件(2024-05)', 'PrivacyInfo.xcprivacy はあるが宣言キーが1つも無い(空マニフェスト)。宣言内容を確認すること');
    } else if (pbx != null && !pbx.includes('PrivacyInfo.xcprivacy')) {
      fail(
        'privacy-manifest',
        '必須SDK要件(2024-05)',
        'ios/App/App/PrivacyInfo.xcprivacy はあるが project.pbxproj から参照されていない = ビルドにバンドルされない。' +
          'Xcode でターゲット App の Copy Bundle Resources に追加すること',
      );
    } else {
      ok('privacy-manifest', 'app-level PrivacyInfo.xcprivacy あり(バンドル参照 OK)');
    }
  } else {
    // ios/ は CI の `npx cap add ios` で生成される運用(ios-appstore-release.yml)。
    // Capacitor >=6 なら SDK 側マニフェストが同梱され、テンプレが app-level を生成しないのは正常。
    ok('privacy-manifest', `@capacitor/ios ${capIosVer} (>=6): SDK 同梱マニフェストあり。ios/ は CI 生成(app-level 非生成が正常)`);
  }
}

// ----------------------------------------------------------------------------
// CHECK 16 — UIWebView 残存(2.5.1 / ITMS-90809 hard reject)
//   _docs/pre-submission-compliance-checklist.md (A) 表のコード化。薄殻での当てはまり度は
//   「中(古いプラグイン由来の混入)」。ios/ をコミットしている場合のみ検査可能
//   (CI 生成運用では Apple 側の ITMS-90809 が最終ゲート)。
//   自前ソース(ios/App/App)でのヒットは fail、Pods 等プラグイン領域はコメント誤検知が
//   ありうるため warn(要調査)に留める。
// ----------------------------------------------------------------------------
{
  const iosRoot = path.join(ROOT, 'ios');
  if (!fs.existsSync(iosRoot)) {
    skip('uiwebview-scan', 'ios/ が無い(CI 生成運用。最終ゲートは Apple の ITMS-90809)');
  } else {
    const textExt = /\.(swift|m|h|mm|pbxproj|storyboard|xib|plist|podspec)$/i;
    const ownHits = [];
    const vendorHits = [];
    const ownPrefix = path.join(iosRoot, 'App', 'App') + path.sep;
    for (const f of walkDir(iosRoot)) {
      const base = path.basename(f);
      if (!textExt.test(f) && base !== 'Podfile' && base !== 'Podfile.lock') continue;
      const c = fs.readFileSync(f, 'utf8');
      if (!c.includes('UIWebView')) continue;
      (f.startsWith(ownPrefix) ? ownHits : vendorHits).push(path.relative(ROOT, f));
    }
    if (ownHits.length > 0) {
      fail('uiwebview-scan', '2.5.1', `自前 iOS ソースに UIWebView 参照(削除済み API・ITMS-90809 で hard reject): ${ownHits.slice(0, 5).join(', ')}`);
    } else if (vendorHits.length > 0) {
      warn('uiwebview-scan', '2.5.1', `プラグイン/Pods 領域に UIWebView 文字列(コメントの可能性あり、要調査): ${vendorHits.slice(0, 5).join(', ')}`);
    } else {
      ok('uiwebview-scan', 'ios/ に UIWebView 参照なし');
    }
  }
}

// ----------------------------------------------------------------------------
// CHECK 17 — Android Data Safety の配線(申告パイプラインが繋がっているか)
//   Data Safety 自体は play-generate-data-safety-csv.mjs(CSV 生成・orphan key 0 で fail-closed)
//   + play-fill-data-safety.mjs(API 送信)で実装済み。ここでは「release workflow が
//   送信スクリプトを実行しているか」の配線を検査する。CHECK 7 は path filter の整合しか
//   見ておらず、workflow が invoke 自体をやめても素通りするのが穴だった。
// ----------------------------------------------------------------------------
{
  const playWfRel = process.env.APP_PLAY_WORKFLOW || '.github/workflows/android-play-release.yml';
  const playWf = readFile(playWfRel);
  if (playWf == null) {
    skip('data-safety-wiring', `${playWfRel} が無い(Android 配布しないなら可)`);
  } else if (!playWf.includes('play-fill-data-safety.mjs')) {
    fail(
      'data-safety-wiring',
      'Play Data Safety',
      `${playWfRel} が play-fill-data-safety.mjs を実行していない。Data Safety 未申告(または stale)のまま公開されると Play ポリシー違反。` +
        'templates/workflows/android-play-release.yml の該当 step を復元すること',
    );
  } else if (!fs.existsSync(path.join(ROOT, 'scripts', 'play-fill-data-safety.mjs'))) {
    fail('data-safety-wiring', 'Play Data Safety', 'workflow は play-fill-data-safety.mjs を参照するが scripts/ に実体が無い');
  } else {
    const hasGenerator = fs.existsSync(path.join(ROOT, 'scripts', 'play-generate-data-safety-csv.mjs'));
    const hasTemplate = fs.existsSync(path.join(ROOT, 'scripts', 'lib', 'play-data-safety-template.json'));
    if (hasGenerator && !hasTemplate) {
      warn('data-safety-wiring', 'Play Data Safety', 'play-generate-data-safety-csv.mjs はあるが scripts/lib/play-data-safety-template.json が無い(生成スクリプトが実行時に必ず落ちる)。キットの templates/scripts/lib/ からコピーすること');
    } else {
      ok('data-safety-wiring', 'workflow → play-fill-data-safety.mjs の配線あり');
    }
  }
}

// ----------------------------------------------------------------------------
// CHECK 18 — 3.1.1 アプリ外購入への導線がネイティブで素通しになっていないか
//
// 【なぜ要るか】2026-08-17 追加
//   malwarecheck.site が 2026-08-01 に Guideline 3.1.1 で**実際に却下**された。
//   しかし CHECK 1〜17 に課金導線の検査は1つも無く、**lint が緑のまま素通り**した。
//   さらに却下対応後も「LINE 相談 CTA 10箇所」「監視サブスク CTA 2箇所」が
//   残っていたことが後日の実測で判明している（名前で探すと漏れる）。
//
// 【何を見るか】
//   server.url 型の Capacitor アプリは Web をそのまま WKWebView に出すため、
//   Web の課金導線がアプリ内にも出る。これを防ぐには
//   「ネイティブ判定（window.Capacitor）で描画を止める」実装が要る。
//   ここでは **外部購入 URL を持つのに、その判定がコードのどこにも無い** 状態を検出する。
//
// 【fail でなく warn にした理由】
//   「どの導線が課金でどれがサポート窓口か」は機械判定できない。
//   （例: 問い合わせ用 LINE は隠すべきでない。隠すと 1.5 側で不利になる）
//   誤検知で提出を止めると、この lint 自体が信用されなくなる。
//   ★ただし「外部購入 URL があるのに判定が1つも無い」は構造的に危険なので fail にする。
// ----------------------------------------------------------------------------
{
  // ★配置はリポジトリごとに違う（ルート直下 / apps/mobile/ 等）。
  //   ルートだけ見ると malwarecheck.site(apps/mobile/) が skip され、
  //   **実際に 3.1.1 で却下されたリポジトリで鳴らない**という本末転倒になる（実測で発見）。
  //   android/.../assets/ 配下はビルド生成物なので探索対象から外す。
  const CAP_CFG_CANDIDATES = [
    'capacitor.config.ts',
    'capacitor.config.js',
    'capacitor.config.json',
    'apps/mobile/capacitor.config.ts',
    'apps/mobile/capacitor.config.js',
    'apps/mobile/capacitor.config.json',
    'mobile/capacitor.config.ts',
    'mobile/capacitor.config.json',
  ];
  let capCfg = null;
  for (const rel of CAP_CFG_CANDIDATES) {
    capCfg = readFile(rel);
    if (capCfg != null) break;
  }

  if (capCfg == null) {
    skip('external-purchase-cta', 'capacitor.config が無い(ネイティブ配布しないなら可)');
    // ★キーが引用符付きの JSON 形式（"server": { "url": ... }）にも当てること。
    //   引用符を許さない正規表現だと capacitor.config.json のアプリが丸ごと
    //   skip され、検査したい対象が検査されない（partnership で実測して発見）。
  } else if (!/["']?server["']?\s*:\s*\{[\s\S]*?["']?url["']?\s*:/.test(capCfg)) {
    // ローカルバンドル型は Web と作り分けられるため、この検査の前提が違う
    skip('external-purchase-cta', 'server.url 型ではない(ローカルバンドル型)');
  } else {
    // ソース配下から「外部購入っぽい URL」と「ネイティブ判定」を数える。
    const SRC_DIRS = ['src', 'app', 'client/src', 'apps/web', 'components', 'lib'];
    const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '.html']);
    /**
     * 外部購入導線とみなすパターン（決済・申込）。
     * ★URL 直書きとは限らない。tRPC/RPC 経由で Checkout を起動する実装
     *   （`trpc.monitor.createCheckout` 等）は URL パターンに掛からず**検出ゼロ**になる。
     *   partnership_program_website で実測して発見（今日いちばん危なかった
     *   /monitor がまさにこの形だった）。「決済を開始する呼び出し」も含める。
     */
    const PURCHASE_URL =
      /(buy\.stripe\.com|checkout\.stripe\.com|\/checkout|payment[-_]?link|paymentLinks\.create|createCheckout|redirectToCheckout|stripe\.checkout)/i;
    /** ネイティブ判定の実装（呼び名は各リポで違うので広めに取る） */
    const NATIVE_GUARD = /window\.Capacitor|isNativePlatform|isNativeApp|isCapacitorNative/;

    const hits = [];
    let guardCount = 0;

    const walk = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (
            e.name === 'node_modules' ||
            e.name === '.next' ||
            e.name === 'dist' ||
            e.name === 'build' ||
            e.name === '.vercel' ||
            e.name === '.claude'
          )
            continue;
          walk(full);
        } else if (exts.has(path.extname(e.name))) {
          let body;
          try {
            body = fs.readFileSync(full, 'utf8');
          } catch {
            continue;
          }
          if (NATIVE_GUARD.test(body)) guardCount += 1;
          if (PURCHASE_URL.test(body)) {
            hits.push(path.relative(ROOT, full).split(path.sep).join('/'));
          }
        }
      }
    };
    for (const d of SRC_DIRS) {
      const abs = path.join(ROOT, d);
      if (fs.existsSync(abs)) walk(abs);
    }

    if (hits.length === 0) {
      ok('external-purchase-cta', '外部購入 URL をソース内に検出せず');
    } else if (guardCount === 0) {
      fail(
        'external-purchase-cta',
        '3.1.1',
        `外部購入 URL を ${hits.length} ファイルで検出したが、ネイティブ判定(window.Capacitor 等)が` +
          `**コード全体に1つも無い**。server.url 型は Web の課金導線がそのままアプリ内に出るため、` +
          `このまま提出すると 3.1.1 で却下される可能性が高い。該当: ${hits.slice(0, 5).join(', ')}` +
          `${hits.length > 5 ? ` ほか${hits.length - 5}件` : ''}`,
      );
    } else {
      warn(
        'external-purchase-cta',
        '3.1.1',
        `外部購入 URL が ${hits.length} ファイルにあり、ネイティブ判定は ${guardCount} ファイルに存在する。` +
          `**判定漏れが無いかは機械では判定できない**ので、提出前に実機相当で目視すること` +
          `（window.Capacitor.isNativePlatform=()=>true を注入して残存を数えるのが確実）。` +
          `★「LINE」等の名前で探すと漏れる。基準は「アプリ外購入への導線」。` +
          `該当: ${hits.slice(0, 5).join(', ')}${hits.length > 5 ? ` ほか${hits.length - 5}件` : ''}`,
      );
    }
  }
}

// ----------------------------------------------------------------------------
// CHECK 19 — インストール済みCapacitorプラグイン vs Info.plistのusage-description欠落
//   2026-08-25追加（計器の水平思考調査で確定）。
//
// 【なぜ要るか】
//   カメラ・位置情報・連絡先等にアクセスするCapacitorプラグインを追加したのに、
//   対応する NSCameraUsageDescription 等の usage-description キーを Info.plist に
//   書き忘れると、Apple審査で即却下される（Guideline 5.1.1）。CHECK 1〜18には
//   この突き合わせが1つも無く、プラグイン追加時に人力でInfo.plistを思い出す
//   運用に頼っていた。
//
// 【対応表の考え方】
//   公式 @capacitor/* プラグインのうち、iOS側でOS権限ダイアログを要するものだけを
//   対象にする（例: @capacitor/preferences は権限不要なので対象外）。
//   対応表は Capacitor公式ドキュメント(capacitorjs.com/docs/apis)のiOS設定セクションが
//   一次ソース。新しいプラグインが追加されたら PLUGIN_PERMISSIONS に足すだけで済む形にする。
// ----------------------------------------------------------------------------
{
  /** @type {Record<string, {keys: string[], label: string}>} */
  const PLUGIN_PERMISSIONS = {
    '@capacitor/camera': { keys: ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription'], label: 'カメラ/フォトライブラリ' },
    '@capacitor/geolocation': { keys: ['NSLocationWhenInUseUsageDescription'], label: '位置情報' },
    '@capacitor/contacts': { keys: ['NSContactsUsageDescription'], label: '連絡先' },
    '@capacitor/microphone': { keys: ['NSMicrophoneUsageDescription'], label: 'マイク' },
    '@capacitor/local-notifications': { keys: [], label: 'ローカル通知（usage-description不要、UNUserNotificationCenterで許可を取る）' },
    '@capacitor/push-notifications': { keys: [], label: 'プッシュ通知（usage-description不要）' },
    '@capacitor-community/bluetooth-le': { keys: ['NSBluetoothAlwaysUsageDescription'], label: 'Bluetooth' },
    '@capacitor-community/speech-recognition': { keys: ['NSSpeechRecognitionUsageDescription', 'NSMicrophoneUsageDescription'], label: '音声認識' },
    '@capacitor/filesystem': { keys: [], label: 'ファイルシステム（usage-description不要、サンドボックス内アクセスのため）' },
    '@capacitor/motion': { keys: ['NSMotionUsageDescription'], label: 'モーションセンサー' },
  };

  const infoPlist19 = readFile('ios/App/App/Info.plist');
  const capDeps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const installed = Object.keys(capDeps).filter((k) => k in PLUGIN_PERMISSIONS);

  if (installed.length === 0) {
    skip('plugin-usage-description', 'usage-description が要るCapacitorプラグインの依存が無い');
  } else if (infoPlist19 == null) {
    skip('plugin-usage-description', 'ios/App/App/Info.plist が無い(CI で cap copy 後に生成。生成後に再実行すること)');
  } else {
    const missing = [];
    for (const dep of installed) {
      const { keys, label } = PLUGIN_PERMISSIONS[dep];
      for (const key of keys) {
        const hasKey = new RegExp(`<key>\\s*${key}\\s*</key>`).test(infoPlist19);
        if (!hasKey) missing.push(`${dep}(${label}) → ${key}`);
      }
    }
    if (missing.length > 0) {
      fail(
        'plugin-usage-description',
        '5.1.1',
        `インストール済みプラグインが要求するusage-descriptionキーがInfo.plistに無い: ${missing.join(', ')}。` +
          'このまま提出すると審査で権限ダイアログの文言不備として却下されうる。' +
          'ios/App/App/Info.plist に該当キーと説明文字列を追加すること',
      );
    } else {
      ok('plugin-usage-description', `${installed.length}件のプラグイン依存を確認、usage-description欠落なし`);
    }
  }
}

// ----------------------------------------------------------------------------
// CHECK 20 — インストール済みCapacitorプラグイン vs Play Data SafetyのCSV記載漏れ
//   2026-08-25追加（計器の水平思考調査で確定）。
//
// 【なぜ要るか】
//   play-fill-data-safety.mjs は store-assets/play/data-safety.csv の内容を
//   そのままAPIへ送るだけで、その内容がアプリの実際の権限（＝インストール済み
//   Capacitorプラグイン）と一致しているかは一切見ていなかった。カメラ等の
//   プラグインを追加したのにCSVを更新し忘れると、Data Safety宣言が実態と
//   ズレたまま公開され、Playポリシー違反（不正確な宣言）のリスクになる。
//
// 【対応表の考え方とlimitation】
//   プラグイン→PSL(Play Safety Labels)データ種別の対応は「このプラグインを
//   使うなら通常この種別を収集する可能性が高い」という★保守的な最小対応のみ。
//   実際に収集するかどうか（ローカル処理のみで送信しない等）はコードを読まないと
//   分からないため、★ここでは「プラグインがあるのにCSVに関連PSLコードが
//   1つも無い」ケースだけをwarn（fail にはしない＝機械では判定しきれないため）。
// ----------------------------------------------------------------------------
{
  /** @type {Record<string, {pslCodes: string[], label: string}>} */
  const PLUGIN_TO_PSL = {
    '@capacitor/camera': { pslCodes: ['PSL_PHOTOS', 'PSL_VIDEOS'], label: 'カメラ/フォトライブラリ' },
    '@capacitor/geolocation': { pslCodes: ['PSL_APPROX_LOCATION', 'PSL_PRECISE_LOCATION'], label: '位置情報' },
    '@capacitor/contacts': { pslCodes: ['PSL_CONTACTS'], label: '連絡先' },
    '@capacitor/microphone': { pslCodes: ['PSL_AUDIO'], label: 'マイク' },
  };

  const csvPath20 = process.env.PLAY_DATA_SAFETY_CSV_PATH
    || path.join(ROOT, 'store-assets', 'play', 'data-safety.csv');
  const csv20 = readFile(path.relative(ROOT, csvPath20).split(path.sep).join('/'));
  const capDeps20 = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const installed20 = Object.keys(capDeps20).filter((k) => k in PLUGIN_TO_PSL);

  if (installed20.length === 0) {
    skip('data-safety-plugin-match', 'Data Safety対応が要るCapacitorプラグインの依存が無い');
  } else if (csv20 == null) {
    skip('data-safety-plugin-match', `${path.relative(ROOT, csvPath20)} が無い(CHECK 17の配線検査を先に見ること)`);
  } else {
    const missingDeclarations = [];
    for (const dep of installed20) {
      const { pslCodes, label } = PLUGIN_TO_PSL[dep];
      const anyDeclared = pslCodes.some((code) => csv20.includes(code));
      if (!anyDeclared) missingDeclarations.push(`${dep}(${label})`);
    }
    if (missingDeclarations.length > 0) {
      warn(
        'data-safety-plugin-match',
        'Play Data Safety',
        `インストール済みプラグインに対応するData Safety宣言がCSVに見当たらない: ${missingDeclarations.join(', ')}。` +
          '実際にデータを収集・送信しているなら宣言漏れの可能性がある。Play Console > Data Safety で該当種別を確認すること。' +
          '★このチェックは「宣言0件」だけを検出し、宣言内容(収集目的等)の正しさは判定しない',
      );
    } else {
      ok('data-safety-plugin-match', `${installed20.length}件のプラグインに対応するData Safety宣言をCSV内に確認`);
    }
  }
}

// ----------------------------------------------------------------------------
// CHECK 21 — 生成済みストア画像の実寸がストア要件どおりか
//   2026-08-25追加（計器の水平思考調査で確定）。
//
// 【なぜ要るか】
//   generate-store-assets.mjs / capture-appstore-screenshots.mjs / capture-play-screenshots.mjs
//   はサイズをハードコードして生成するが、生成後の実ファイルがその寸法どおりに
//   出力されたかを検証する仕組みがCHECK 1〜20に無かった。テンプレ改修や
//   フォント差し替え等でSVG→PNG変換のサイズが崩れても、提出直前まで気付けない。
//
// 【対象外にした理由】
//   Apple/Googleの「現在の必須サイズ一覧」を自動追従する仕組みはここでは作らない
//   （公式ページのスクレイピングは壊れやすく車輪の再発明になる）。あくまで
//   「このキットが生成すると謳っているサイズどおりに実際出力されたか」の
//   ドリフト検知に限定する。ストア側の要件変更自体はcapture-*.mjsのコメントを
//   人力で見直す運用のまま。
// ----------------------------------------------------------------------------
{
  const REQUIRED_SIZES = [
    { rel: 'og-image.png', width: 1200, height: 630, label: 'Open Graph image' },
    { rel: 'store-assets/play/feature-graphic.png', width: 1024, height: 500, label: 'Play feature graphic' },
  ];

  let sharpMod;
  try {
    sharpMod = await import('sharp');
  } catch {
    skip('store-asset-dimensions', 'sharp が未インストール(devDependenciesに追加すること)');
  }

  if (sharpMod) {
    const sharp = sharpMod.default;
    const present = REQUIRED_SIZES.filter((s) => fs.existsSync(path.join(ROOT, s.rel)));
    if (present.length === 0) {
      skip('store-asset-dimensions', 'og-image.png / feature-graphic.png のいずれも未生成(generate-store-assets.mjs 未実行なら可)');
    } else {
      const mismatches = [];
      for (const s of present) {
        try {
          const meta = await sharp(path.join(ROOT, s.rel)).metadata();
          if (meta.width !== s.width || meta.height !== s.height) {
            mismatches.push(`${s.rel}(${s.label}): 期待 ${s.width}x${s.height} / 実際 ${meta.width}x${meta.height}`);
          }
        } catch (e) {
          mismatches.push(`${s.rel}(${s.label}): 読み取り失敗(${e && e.message})`);
        }
      }
      if (mismatches.length > 0) {
        fail(
          'store-asset-dimensions',
          'Store asset requirements',
          `生成済み画像の実寸がテンプレの想定サイズと不一致: ${mismatches.join(' / ')}。` +
            'generate-store-assets.mjs のSVGテンプレか変換処理を確認し、再生成すること',
        );
      } else {
        ok('store-asset-dimensions', `${present.length}件の生成済み画像の実寸を確認、想定どおり`);
      }
    }
  }
}

// ----------------------------------------------------------------------------
// Output
// ----------------------------------------------------------------------------
console.log('');
if (warnings.length > 0) {
  console.log(`${ANSI_YELLOW}--- Warnings (${warnings.length}) ---${ANSI_RESET}`);
  for (const w of warnings) console.log(`${ANSI_YELLOW}!${ANSI_RESET} ${w.name} [${w.guideline}]: ${w.message}`);
  console.log('');
}
if (failures.length > 0) {
  console.log(`${ANSI_RED}--- Failures (${failures.length}) ---${ANSI_RESET}`);
  for (const f of failures) console.log(`${ANSI_RED}✗${ANSI_RESET} ${f.name} [${f.guideline}]: ${f.message}`);
  console.log('');
  console.log(`${ANSI_RED}Pre-submission lint failed.${ANSI_RESET}`);
  console.log('修正レシピは _docs/apple-reject-knowledge-base.md を参照。');
  process.exit(1);
}
console.log(`${ANSI_GREEN}All pre-submission lint checks passed.${ANSI_RESET}`);
console.log('ストア提出に進んで安全。');
