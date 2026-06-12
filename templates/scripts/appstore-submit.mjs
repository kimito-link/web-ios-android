#!/usr/bin/env node
// 移植元: partnership_program_website/scripts/appstore-submit.mjs
//        (Exosome/scripts/appstore-submit.mjs と構造は同等)
//
// App Store Connect にビルドを審査提出する。iOS リリース・スクリプト本体。
// app.config.json を SSOT とする: bundleId / 連絡先 / privacy URL / 会社名 /
// reviewer notes はハードコードせず app.config.json と env から組み立てる。
//
// ※ 移植時の脱ハードコード点(partnership 版から):
//   - default BUNDLE_ID は app.config.json identity.bundleId(env APP_BUNDLE_ID 優先)
//   - DEFAULT_COPYRIGHT は app.config.json ownership.organization から生成
//   - reviewer notes は app.config.json の businessModel.summaryEn / IAP フラグから
//     汎用テンプレを組み立て(env IOS_REVIEW_NOTES で全文上書き可)
//   - subtitle / support / privacy / marketing / dataDeletion URL は app.config.json
//
// Reads:
//   env APPSTORE_CONNECT_KEY_ID
//   env APPSTORE_CONNECT_ISSUER_ID
//   env APPSTORE_CONNECT_API_KEY_P8_PATH (path to .p8) OR _BASE64
//   env APP_BUNDLE_ID (省略時は app.config.json identity.bundleId)
//   env IOS_BUILD_NUMBER (CFBundleVersion; 未指定なら最新の VALID build)
//   ./package.json -> version (marketing)
//   ./release-notes/CURRENT-ja.txt (whatsNew)
//
// Steps:
//   1. Find app by bundleId
//   2. Wait for the build to finish processing (max 30 min)
//   3. Find or create AppStoreVersion=<marketing>, copy metadata from latest READY_FOR_SALE
//   4. PATCH ja localization with whatsNew
//   5. Link build
//   6. Copy review detail from latest READY_FOR_SALE if missing
//   7. Create reviewSubmission, add item, PATCH submitted=true
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAscClient, findApp, listVersions, getLocalizations, getReviewDetail, findBuildByVersion, listRecentBuilds, sleep } from './lib/asc-api.mjs';
import { loadAppConfig, productionUrl, isPlaceholder } from './lib/app-config.mjs';
import { uploadIPhoneScreenshots } from './lib/asc-screenshot-upload.mjs';
import { ensureFreePricing } from './lib/asc-pricing.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const APP_CONFIG = loadAppConfig();
const PRODUCTION_URL = productionUrl();

const BUNDLE_ID = process.env.APP_BUNDLE_ID || APP_CONFIG.identity?.bundleId;
if (isPlaceholder(BUNDLE_ID)) {
  throw new Error(
    'APP_BUNDLE_ID も app.config.json の identity.bundleId も未設定です。' +
      'どちらかに iOS の Bundle ID を設定してください。',
  );
}
const PLATFORM = 'IOS';
const POLL_INTERVAL_MS = 30_000;
const POLL_MAX_MIN = 30;

function readMarketingVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  return String(pkg.version).trim();
}

// Apple Guideline 2.3.10: メタデータに他社プラットフォーム名が入ると審査で弾かれる。
// アップロード前に文字列スキャンで弾き、時間とランナー秒を節約する。
const BANNED_IN_IOS_WHATS_NEW = [
  'Android',
  'Google Play',
  'Play Store',
  'Play Console',
  'Galaxy Store',
  'Amazon Appstore',
];

function assertNoBannedPlatformReferences(text) {
  const hits = BANNED_IN_IOS_WHATS_NEW.filter((w) =>
    text.toLowerCase().includes(w.toLowerCase()),
  );
  if (hits.length > 0) {
    throw new Error(
      `release-notes/CURRENT-ja.txt contains references to other platforms (${hits.join(', ')}). ` +
        `App Store rejects this under Guideline 2.3.10. ` +
        `Rephrase the notes to be platform-neutral and try again.`,
    );
  }
}

function readWhatsNew() {
  const p = path.join(REPO, 'release-notes', 'CURRENT-ja.txt');
  if (!fs.existsSync(p)) {
    throw new Error(`Missing release-notes/CURRENT-ja.txt at ${p}`);
  }
  const text = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trim();
  assertNoBannedPlatformReferences(text);
  return text;
}

function resolvePrivateKey() {
  const direct = process.env.APPSTORE_CONNECT_API_KEY_P8;
  if (direct && direct.includes('BEGIN PRIVATE KEY')) return direct;
  const filePath = process.env.APPSTORE_CONNECT_API_KEY_P8_PATH;
  if (filePath && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8');
  }
  const b64 = process.env.APPSTORE_CONNECT_API_KEY_P8_BASE64;
  if (b64) {
    return Buffer.from(b64.trim(), 'base64').toString('utf8');
  }
  throw new Error('Provide APPSTORE_CONNECT_API_KEY_P8_PATH, _BASE64, or _P8 env');
}

async function pollBuildProcessing(api, appId, marketing, buildNumber) {
  const maxLoops = Math.ceil((POLL_MAX_MIN * 60_000) / POLL_INTERVAL_MS);
  for (let i = 0; i < maxLoops; i++) {
    const build = buildNumber
      ? await findBuildByVersion(api, appId, marketing, buildNumber)
      : (await listRecentBuilds(api, appId, 5))[0];
    if (build) {
      console.log(`  build attempt ${i + 1}/${maxLoops}: state=${build.processingState} marketing=${build.marketingVersion} bn=${build.buildNumber}`);
      if (build.processingState === 'VALID') return build;
      if (build.processingState === 'INVALID' || build.processingState === 'FAILED') {
        throw new Error(`Build ${build.id} processing FAILED on Apple side.`);
      }
    } else {
      console.log(`  build attempt ${i + 1}/${maxLoops}: no matching build yet`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Build did not reach VALID within timeout');
}

// Apple は末尾の .0 を正規化するので "1.0" と "1.0.0" は同じ論理バージョン。
function normalizeVersion(v) {
  if (!v) return '';
  return String(v).replace(/(\.0)+$/, '');
}

// Apple は submit-for-review 前に copyright を要求する。app.config.json の
// ownership.organization から生成。env IOS_COPYRIGHT で上書き可。
const ORG_NAME =
  (!isPlaceholder(APP_CONFIG.ownership?.organization) && APP_CONFIG.ownership.organization) ||
  (!isPlaceholder(APP_CONFIG.identity?.displayNameEn) && APP_CONFIG.identity.displayNameEn) ||
  'the developer';
const DEFAULT_COPYRIGHT = process.env.IOS_COPYRIGHT || `© ${new Date().getFullYear()} ${ORG_NAME}`;

// 既存バージョンの copyright が空なら埋める。冪等(設定済みなら何もしない)。
async function ensureVersionCopyright(api, version) {
  if (version.copyright && String(version.copyright).trim().length > 0) {
    return;
  }
  console.log(`  setting copyright on version ${version.id} -> "${DEFAULT_COPYRIGHT}"`);
  try {
    await api('PATCH', `/v1/appStoreVersions/${version.id}`, {
      data: {
        type: 'appStoreVersions',
        id: version.id,
        attributes: { copyright: DEFAULT_COPYRIGHT },
      },
    });
    version.copyright = DEFAULT_COPYRIGHT;
  } catch (e) {
    console.log(`  (copyright patch failed; continuing) ${e.message.slice(0, 200)}`);
  }
}

async function ensureVersion(api, appId, marketing) {
  const all = await listVersions(api, appId, 50);
  const targetNorm = normalizeVersion(marketing);

  const exactMatch = all.find((v) => v.platform === PLATFORM && v.versionString === marketing);
  if (exactMatch) {
    console.log(`  version ${marketing} already exists (id=${exactMatch.id} state=${exactMatch.appStoreState})`);
    await ensureVersionCopyright(api, exactMatch);
    return exactMatch;
  }

  // ASC web UI は app 作成時に初期バージョン("1.0" 等)を自動生成する。POST で二つ目を
  // 作ろうとすると 409 になるので、編集可能な既存バージョンを再利用する。
  const editableStates = new Set([
    'PREPARE_FOR_SUBMISSION',
    'DEVELOPER_REJECTED',
    'METADATA_REJECTED',
    'REJECTED',
    'INVALID_BINARY',
    'WAITING_FOR_REVIEW',
  ]);
  const reusable = all.find(
    (v) =>
      v.platform === PLATFORM &&
      editableStates.has(v.appStoreState) &&
      normalizeVersion(v.versionString) === targetNorm,
  );
  // リリースタイミング: env IOS_RELEASE_TYPE で切替。
  //   AFTER_APPROVAL (default) — 審査通過後に自動公開(最速)
  //   MANUAL                   — 「リリース待ち」で停止
  //   SCHEDULED                — earliestReleaseDate 指定時
  const RELEASE_TYPE = (process.env.IOS_RELEASE_TYPE || 'AFTER_APPROVAL').toUpperCase();

  if (reusable) {
    if (reusable.versionString !== marketing) {
      console.log(
        `  reusing existing version id=${reusable.id} state=${reusable.appStoreState}; ` +
          `patching versionString "${reusable.versionString}" -> "${marketing}" to match build`,
      );
      try {
        await api('PATCH', `/v1/appStoreVersions/${reusable.id}`, {
          data: {
            type: 'appStoreVersions',
            id: reusable.id,
            attributes: { versionString: marketing },
          },
        });
        reusable.versionString = marketing;
      } catch (e) {
        console.log(`  (versionString patch failed; continuing with existing ${reusable.versionString}) ${e.message.slice(0, 200)}`);
      }
    } else {
      console.log(`  reusing existing version id=${reusable.id} versionString=${reusable.versionString} state=${reusable.appStoreState}`);
    }
    try {
      await api('PATCH', `/v1/appStoreVersions/${reusable.id}`, {
        data: {
          type: 'appStoreVersions',
          id: reusable.id,
          attributes: { releaseType: RELEASE_TYPE },
        },
      });
      console.log(`  patched releaseType -> ${RELEASE_TYPE}`);
    } catch (e) {
      console.log(`  (releaseType patch skipped: ${e.message.slice(0, 120)})`);
    }
    await ensureVersionCopyright(api, reusable);
    return reusable;
  }

  const live = all.find((v) => v.platform === PLATFORM && v.appStoreState === 'READY_FOR_SALE');
  console.log(`  creating new appStoreVersion ${marketing} (copyright copied from ${live?.versionString || 'n/a'}, releaseType=${RELEASE_TYPE})`);
  try {
    const created = await api('POST', '/v1/appStoreVersions', {
      data: {
        type: 'appStoreVersions',
        attributes: {
          platform: PLATFORM,
          versionString: marketing,
          copyright: live?.copyright || DEFAULT_COPYRIGHT,
          releaseType: RELEASE_TYPE,
        },
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    });
    return {
      id: created.data.id,
      platform: PLATFORM,
      versionString: marketing,
      appStoreState: created.data.attributes.appStoreState,
      copyright: created.data.attributes.copyright,
    };
  } catch (e) {
    if (!e.message.includes('409')) throw e;
    console.log('\n  ----- 409 diagnostic -----');
    console.log(`  POST /v1/appStoreVersions returned 409. Dumping app state...`);
    try {
      const appInfos = await api('GET', `/v1/apps/${appId}/appInfos`);
      console.log(`  appInfos.data.length = ${appInfos.data?.length}`);
      for (const ai of appInfos.data || []) {
        console.log(`    appInfo id=${ai.id} state=${ai.attributes.appStoreState} platforms=${JSON.stringify(ai.attributes.platforms)} appStoreAgeRating=${ai.attributes.appStoreAgeRating}`);
      }
    } catch (sub) { console.log(`  (appInfos failed: ${sub.message.slice(0, 200)})`); }
    try {
      const versions = await api('GET', `/v1/apps/${appId}/appStoreVersions?limit=50`);
      console.log(`  appStoreVersions.data.length = ${versions.data?.length}`);
      for (const v of versions.data || []) {
        console.log(`    version id=${v.id} platform=${v.attributes.platform} versionString=${v.attributes.versionString} state=${v.attributes.appStoreState}`);
      }
    } catch (sub) { console.log(`  (versions failed: ${sub.message.slice(0, 200)})`); }
    try {
      const app = await api('GET', `/v1/apps/${appId}?fields[apps]=bundleId,name,sku,primaryLocale,contentRightsDeclaration`);
      console.log(`  app.attributes = ${JSON.stringify(app.data.attributes)}`);
    } catch (sub) { console.log(`  (app failed: ${sub.message.slice(0, 200)})`); }
    console.log('  ----- end diagnostic -----\n');
    throw e;
  }
}

// store-assets/appstore のフォールバック metadata を読む。
function readAppstoreMetaFile(name) {
  const p = path.join(REPO, 'store-assets', 'appstore', name);
  if (!fs.existsSync(p)) return undefined;
  const v = fs.readFileSync(p, 'utf8').trim();
  return v.length > 0 ? v : undefined;
}

// 非ローカライズ URL は app.config.json の contact から。空なら本番ドメインから合成。
const STORE_SUPPORT_URL =
  (!isPlaceholder(APP_CONFIG.contact?.supportUrl) && APP_CONFIG.contact.supportUrl) || PRODUCTION_URL;
const STORE_MARKETING_URL =
  (!isPlaceholder(APP_CONFIG.contact?.marketingUrl) && APP_CONFIG.contact.marketingUrl) || PRODUCTION_URL;
const STORE_PRIVACY_URL =
  (!isPlaceholder(APP_CONFIG.contact?.privacyUrl) && APP_CONFIG.contact.privacyUrl) ||
  `${PRODUCTION_URL}/privacy`;
const STORE_DATA_DELETION_URL =
  (!isPlaceholder(APP_CONFIG.contact?.dataDeletionUrl) && APP_CONFIG.contact.dataDeletionUrl) ||
  `${PRODUCTION_URL}/account/delete-request`;
const APP_INFO_LOCALE = process.env.ASC_APP_INFO_LOCALE || 'ja';

async function ensureLocalization(api, versionId, sourceLocId, whatsNew) {
  const locs = await getLocalizations(api, versionId);
  let ja = locs.find((l) => l.attributes.locale === 'ja');
  let copy = null;
  if (sourceLocId) {
    const sourceLocs = await getLocalizations(api, sourceLocId);
    copy = sourceLocs.find((l) => l.attributes.locale === 'ja');
  }
  // whatsNew は UPDATES 専用。初回リリースには無いので prior live が無ければ送らない。
  const includeWhatsNew = !!sourceLocId;
  const fallbackDescription = readAppstoreMetaFile('description-ja.txt');
  const fallbackKeywords = readAppstoreMetaFile('keywords-ja.txt');
  const fallbackPromotionalText = readAppstoreMetaFile('promotional-text-ja.txt');
  const attrs = {
    description:
      copy?.attributes?.description || ja?.attributes?.description || fallbackDescription,
    keywords: copy?.attributes?.keywords || ja?.attributes?.keywords || fallbackKeywords,
    marketingUrl:
      copy?.attributes?.marketingUrl || ja?.attributes?.marketingUrl || STORE_MARKETING_URL,
    supportUrl: copy?.attributes?.supportUrl || ja?.attributes?.supportUrl || STORE_SUPPORT_URL,
    promotionalText:
      copy?.attributes?.promotionalText ||
      ja?.attributes?.promotionalText ||
      fallbackPromotionalText ||
      undefined,
    ...(includeWhatsNew ? { whatsNew } : {}),
  };
  const patchWithRetry = async (id, body) => {
    try {
      return await api('PATCH', `/v1/appStoreVersionLocalizations/${id}`, body);
    } catch (e) {
      if (e.message.includes("'whatsNew' cannot be edited")) {
        console.log(`  whatsNew not editable; retrying without it`);
        const { whatsNew: _, ...rest } = body.data.attributes;
        return await api('PATCH', `/v1/appStoreVersionLocalizations/${id}`, {
          data: { ...body.data, attributes: rest },
        });
      }
      throw e;
    }
  };
  if (ja) {
    console.log(`  patch ja localization id=${ja.id}${includeWhatsNew ? '' : ' (skip whatsNew: initial release)'}`);
    await patchWithRetry(ja.id, {
      data: { type: 'appStoreVersionLocalizations', id: ja.id, attributes: attrs },
    });
  } else {
    console.log(`  create ja localization${includeWhatsNew ? '' : ' (skip whatsNew: initial release)'}`);
    const r = await api('POST', '/v1/appStoreVersionLocalizations', {
      data: {
        type: 'appStoreVersionLocalizations',
        attributes: { locale: 'ja', ...attrs },
        relationships: {
          appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
        },
      },
    });
    ja = r.data;
  }
  return ja;
}

async function ensureAppInfoLocalization(api, appId) {
  console.log('  sync App Info localization (name / subtitle / privacy URLs)');
  let appInfo = null;
  try {
    const appInfos = await api('GET', `/v1/apps/${appId}/appInfos?limit=10&fields[appInfos]=appStoreState`);
    appInfo =
      (appInfos.data || []).find((ai) => ai.attributes?.appStoreState === 'PREPARE_FOR_SUBMISSION') ||
      (appInfos.data || [])[0] ||
      null;
  } catch (e) {
    console.log(`  WARN: appInfos read failed; privacy URL may need ASC UI check: ${e.message.slice(0, 240)}`);
    return;
  }
  if (!appInfo) {
    console.log('  WARN: no appInfo found; skipping app-level metadata sync.');
    return;
  }

  // subtitle はファイル → env → app.config.json のビジネス概要(JA)から。
  const subtitle =
    readAppstoreMetaFile('subtitle-ja.txt') ||
    process.env.ASC_APP_SUBTITLE_JA ||
    (!isPlaceholder(APP_CONFIG.businessModel?.summaryJa) && APP_CONFIG.businessModel.summaryJa) ||
    APP_CONFIG.identity?.displayName ||
    undefined;
  const attrs = {
    locale: APP_INFO_LOCALE,
    name: APP_CONFIG.identity?.displayName,
    subtitle,
    privacyPolicyUrl: STORE_PRIVACY_URL,
    privacyChoicesUrl: STORE_DATA_DELETION_URL,
  };

  let loc = null;
  try {
    const locs = await api(
      'GET',
      `/v1/appInfos/${appInfo.id}/appInfoLocalizations?fields[appInfoLocalizations]=locale,name,subtitle,privacyPolicyUrl,privacyChoicesUrl,privacyPolicyText`,
    );
    loc = (locs.data || []).find((l) => l.attributes?.locale === APP_INFO_LOCALE) || null;
  } catch (e) {
    console.log(`  WARN: appInfoLocalizations read failed; continuing: ${e.message.slice(0, 240)}`);
    return;
  }

  try {
    if (loc) {
      await api('PATCH', `/v1/appInfoLocalizations/${loc.id}`, {
        data: { type: 'appInfoLocalizations', id: loc.id, attributes: attrs },
      });
      console.log(`  appInfoLocalization patched id=${loc.id} privacy=${STORE_PRIVACY_URL}`);
    } else {
      const r = await api('POST', '/v1/appInfoLocalizations', {
        data: {
          type: 'appInfoLocalizations',
          attributes: attrs,
          relationships: {
            appInfo: { data: { type: 'appInfos', id: appInfo.id } },
          },
        },
      });
      console.log(`  appInfoLocalization created id=${r.data?.id || '(unknown)'} privacy=${STORE_PRIVACY_URL}`);
    }
  } catch (e) {
    console.log(`  WARN: appInfoLocalization write failed; ASC UI may need manual confirmation: ${e.message.slice(0, 400)}`);
  }
}

async function linkBuild(api, versionId, buildId) {
  console.log(`  link build ${buildId}`);
  await api('PATCH', `/v1/appStoreVersions/${versionId}/relationships/build`, {
    data: { type: 'builds', id: buildId },
  });
}

// ---- Reviewer 連絡先 + notes ----
// username が指定されたら demoAccountRequired を自動 ON(ログイン必須アプリで未指定だと
// レビュアーがアクセスできず METADATA_REJECTED になりやすい)。
const _DEMO_USER = process.env.IOS_REVIEW_DEMO_USERNAME || null;
const _DEMO_PASS = process.env.IOS_REVIEW_DEMO_PASSWORD || null;
const _DEMO_REQUIRED =
  process.env.IOS_REVIEW_DEMO_REQUIRED === 'true' || (!!_DEMO_USER && !!_DEMO_PASS);

// reviewer notes の汎用テンプレ。app.config.json の businessModel / IAP フラグから
// 「お金の流れ」を Apple 2.1(b) 向けに記述する。アプリ固有の細かい文言は
// env IOS_REVIEW_NOTES で全文上書きすることを推奨(審査要件はアプリごとに違う)。
function buildDefaultReviewNotes() {
  const bm = APP_CONFIG.businessModel || {};
  const summary =
    (!isPlaceholder(bm.summaryEn) && bm.summaryEn) ||
    (!isPlaceholder(bm.summaryJa) && bm.summaryJa) ||
    `Native wrapper around ${PRODUCTION_URL}.`;
  const hasPaid = !!(bm.hasInAppPurchase || bm.hasSubscription || bm.hasPaidContent);
  const lines = [];
  lines.push(`App: ${summary}`);
  lines.push(`Native wrapper around ${PRODUCTION_URL}.`);
  lines.push('');
  if (!hasPaid) {
    // 3.1.3(f) 系: アプリ内課金が無い場合の標準説明。
    lines.push(
      'Business model (Guideline 2.1(b) / 3.1.3): this app has NO in-app purchases, ' +
        'no subscriptions, and no paid digital content. Every feature is available at no charge ' +
        'inside the app, and there are no calls to action to purchase anything outside the app. ' +
        'Per Guideline 3.1.3, in-app purchase is therefore not required.',
    );
  } else {
    lines.push(
      'Business model (Guideline 2.1(b) / 3.1.3): paid items are listed in App Review Information. ' +
        'See the in-app purchase / subscription configuration in App Store Connect.',
    );
  }
  lines.push('');
  if (_DEMO_USER) {
    lines.push('Sign in with the demo credentials provided in App Review Information.');
  } else {
    lines.push(
      'If a sign-in is required to evaluate the app, demo credentials are provided in App Review Information.',
    );
  }
  lines.push(
    `Account deletion (5.1.1(v)): users can request deletion at ${STORE_DATA_DELETION_URL}.`,
  );
  return lines.join('\n');
}

const REVIEW_CONTACT_DEFAULTS = {
  contactFirstName: process.env.IOS_REVIEW_CONTACT_FIRST_NAME || APP_CONFIG.contact?.firstName,
  contactLastName: process.env.IOS_REVIEW_CONTACT_LAST_NAME || APP_CONFIG.contact?.lastName,
  contactPhone: process.env.IOS_REVIEW_CONTACT_PHONE || APP_CONFIG.contact?.phoneE164,
  contactEmail: process.env.IOS_REVIEW_CONTACT_EMAIL || APP_CONFIG.contact?.email,
  demoAccountRequired: _DEMO_REQUIRED,
  demoAccountName: _DEMO_USER,
  demoAccountPassword: _DEMO_PASS,
  notes: process.env.IOS_REVIEW_NOTES || buildDefaultReviewNotes(),
};

async function ensureReviewDetail(api, versionId, sourceVersionId) {
  let target = await getReviewDetail(api, versionId);
  let source = null;
  if (sourceVersionId) source = await getReviewDetail(api, sourceVersionId);
  const pick = (key) =>
    target?.attributes?.[key] ??
    source?.attributes?.[key] ??
    REVIEW_CONTACT_DEFAULTS[key];
  const attrs = {
    contactFirstName: pick('contactFirstName'),
    contactLastName: pick('contactLastName'),
    contactPhone: pick('contactPhone'),
    contactEmail: pick('contactEmail'),
    // demoAccountName/Password は env-first(過去 partnership で stale 値が居座り
    // reviewer がログインできず reject された事故の対策)。
    demoAccountName: _DEMO_USER || pick('demoAccountName') || undefined,
    demoAccountPassword: _DEMO_PASS || pick('demoAccountPassword') || undefined,
    demoAccountRequired:
      typeof (target?.attributes?.demoAccountRequired ?? source?.attributes?.demoAccountRequired) ===
      'boolean'
        ? (target?.attributes?.demoAccountRequired ?? source?.attributes?.demoAccountRequired)
        : REVIEW_CONTACT_DEFAULTS.demoAccountRequired,
    // notes は常に「今のビルド」を push(前回 reject の古い narrative を持ち越さない)。
    notes: REVIEW_CONTACT_DEFAULTS.notes,
  };
  // Apple の review notes は 4000 文字上限。超えると 409 で submit 全体が落ちるので clamp。
  if (typeof attrs.notes === 'string' && attrs.notes.length > 4000) {
    console.warn(
      `  WARN: review notes ${attrs.notes.length} chars exceeds Apple's 4000 limit; truncating to fit.`,
    );
    attrs.notes = attrs.notes.slice(0, 3988) + '\n[truncated]';
  }
  if (target) {
    console.log(`  patch review detail id=${target.id}`);
    await api('PATCH', `/v1/appStoreReviewDetails/${target.id}`, {
      data: { type: 'appStoreReviewDetails', id: target.id, attributes: attrs },
    });
  } else {
    console.log(`  create review detail (defaults; ${sourceVersionId ? `copy from ${sourceVersionId}` : 'no prior version'})`);
    await api('POST', '/v1/appStoreReviewDetails', {
      data: {
        type: 'appStoreReviewDetails',
        attributes: attrs,
        relationships: {
          appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
        },
      },
    });
  }
}

async function cancelOpenReviewSubmissions(api, appId) {
  const r = await api(
    'GET',
    `/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=${PLATFORM}&filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,UNRESOLVED_ISSUES`,
  );
  for (const sub of r.data || []) {
    try {
      console.log(`  cancel reviewSubmission id=${sub.id} state=${sub.attributes.state}`);
      await api('PATCH', `/v1/reviewSubmissions/${sub.id}`, {
        data: { type: 'reviewSubmissions', id: sub.id, attributes: { canceled: true } },
      });
    } catch (e) {
      try {
        await api('PATCH', `/v1/reviewSubmissions/${sub.id}`, {
          data: {
            type: 'reviewSubmissions',
            id: sub.id,
            attributes: { cancellationRequested: true },
          },
        });
      } catch (e2) {
        console.log(`  (cancel reviewSubmission failed; ignoring) ${e2.message.slice(0, 200)}`);
      }
    }
  }
}

async function repurposeBlockingVersion(api, appId, version, marketing) {
  await cancelOpenReviewSubmissions(api, appId);
  if (version.versionString === marketing) {
    console.log(`  rejected version is already at ${marketing} — reusing in place.`);
    return { ...version };
  }
  console.log(`  PATCH appStoreVersion id=${version.id}: versionString ${version.versionString} -> ${marketing}`);
  try {
    await api('PATCH', `/v1/appStoreVersions/${version.id}`, {
      data: {
        type: 'appStoreVersions',
        id: version.id,
        attributes: { versionString: marketing },
      },
    });
    console.log(`  ✓ repurposed rejected slot as ${marketing}`);
  } catch (e) {
    throw new Error(
      `Could not rename rejected version ${version.versionString} -> ${marketing}: ${e.message}\n` +
        `Please resolve it manually in App Store Connect and re-run.`,
    );
  }
  return { ...version, versionString: marketing };
}

// final 状態の submission に紐づいた version は、新 submission への item POST が
// 409 ITEM_PART_OF_ANOTHER_SUBMISSION になる。古い item を delete してから retry。
const PRUNABLE_SUBMISSION_STATES = new Set([
  'COMPLETE',
  'CANCELED',
  'CANCELLING',
  'ACCEPTED',
  'REJECTED',
  'DEVELOPER_REJECTED',
]);

async function freeVersionFromStaleSubmission(api, versionId, otherRsId) {
  let otherState = '(unknown)';
  try {
    const other = await api('GET', `/v1/reviewSubmissions/${otherRsId}`);
    otherState = other.data?.attributes?.state || '(missing)';
  } catch (e) {
    console.log(`  (could not GET reviewSubmission ${otherRsId}: ${e.message.slice(0, 160)})`);
  }
  console.log(`  conflicting reviewSubmission ${otherRsId} state=${otherState}`);
  if (!PRUNABLE_SUBMISSION_STATES.has(otherState)) {
    throw new Error(
      `Version ${versionId} is still attached to reviewSubmission ${otherRsId} ` +
        `which is in state=${otherState} (not in a prunable state). ` +
        `Cancel or resolve that submission in App Store Connect and re-run.`,
    );
  }
  const items = await api('GET', `/v1/reviewSubmissions/${otherRsId}/items`);
  const target = (items.data || []).find(
    (it) => it.relationships?.appStoreVersion?.data?.id === versionId,
  );
  if (!target) {
    console.log(
      `  (no reviewSubmissionItem for version ${versionId} in ${otherRsId}; proceeding with retry anyway)`,
    );
    return;
  }
  console.log(`  DELETE reviewSubmissionItem ${target.id} (free version from ${otherRsId})`);
  await api('DELETE', `/v1/reviewSubmissionItems/${target.id}`);
}

async function submitForReview(api, appId, versionId) {
  console.log(`  fetch existing review submissions...`);
  const existing = await api(
    'GET',
    `/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=${PLATFORM}&filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES`,
  );
  let rsId;
  const inFlight = (existing.data || [])[0];
  if (inFlight) {
    rsId = inFlight.id;
    console.log(`  reuse reviewSubmission id=${rsId} state=${inFlight.attributes.state}`);
    if (['WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(inFlight.attributes.state)) {
      console.log(`  already submitted, nothing to do`);
      return;
    }
  } else {
    const created = await api('POST', '/v1/reviewSubmissions', {
      data: {
        type: 'reviewSubmissions',
        attributes: { platform: PLATFORM },
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    });
    rsId = created.data.id;
    console.log(`  created reviewSubmission id=${rsId} state=${created.data.attributes.state}`);
  }
  const items = await api('GET', `/v1/reviewSubmissions/${rsId}/items`);
  const hasVersion = (items.data || []).some(
    (it) => it.relationships?.appStoreVersion?.data?.id === versionId,
  );
  if (!hasVersion) {
    console.log(`  add reviewSubmissionItem (versionId=${versionId})`);
    const itemBody = {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id: rsId } },
          appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
        },
      },
    };
    try {
      await api('POST', '/v1/reviewSubmissionItems', itemBody);
    } catch (e) {
      const detail = String(e.message);
      const m = detail.match(/already added to another reviewSubmission with id ([0-9a-fA-F-]+)/);
      if (!m) throw e;
      const otherRsId = m[1];
      console.log(`  ITEM_PART_OF_ANOTHER_SUBMISSION → attempt to free version from ${otherRsId}`);
      await freeVersionFromStaleSubmission(api, versionId, otherRsId);
      console.log(`  retry POST reviewSubmissionItems`);
      await api('POST', '/v1/reviewSubmissionItems', itemBody);
    }
  }
  console.log(`  PATCH submitted=true`);
  await api('PATCH', `/v1/reviewSubmissions/${rsId}`, {
    data: { type: 'reviewSubmissions', id: rsId, attributes: { submitted: true } },
  });
  const final = await api('GET', `/v1/reviewSubmissions/${rsId}`);
  console.log(`  final state=${final.data.attributes.state} submittedDate=${final.data.attributes.submittedDate || ''}`);
}

(async () => {
  const keyId = process.env.APPSTORE_CONNECT_KEY_ID;
  const issuerId = process.env.APPSTORE_CONNECT_ISSUER_ID;
  if (!keyId || !issuerId) throw new Error('Set APPSTORE_CONNECT_KEY_ID and APPSTORE_CONNECT_ISSUER_ID');
  const privateKey = resolvePrivateKey();

  const marketing = readMarketingVersion();
  const buildNumber = process.env.IOS_BUILD_NUMBER ? String(process.env.IOS_BUILD_NUMBER).trim() : null;
  const whatsNew = readWhatsNew();

  console.log(`bundleId=${BUNDLE_ID} marketing=${marketing} build=${buildNumber || '(latest)'}`);
  console.log(`whatsNew (${whatsNew.length} chars):\n  ${whatsNew.slice(0, 120).replace(/\n/g, ' / ')}...`);

  const api = makeAscClient({ keyId, issuerId, privateKey });

  console.log('\n[1] Find app...');
  const app = await findApp(api, BUNDLE_ID);
  if (!app) throw new Error(`App not found for bundleId=${BUNDLE_ID}`);
  console.log(`  appId=${app.id} name="${app.attributes.name}"`);

  console.log('\n[1b] Sync App Info localization...');
  await ensureAppInfoLocalization(api, app.id);

  console.log('\n[2] Pre-check existing version state...');
  let versions = await listVersions(api, app.id, 50);
  const liveVersion = versions.find((v) => v.platform === PLATFORM && v.appStoreState === 'READY_FOR_SALE');
  const existingSameVersion = versions.find((v) => v.platform === PLATFORM && v.versionString === marketing);
  const SHIPPED_STATES = new Set([
    'READY_FOR_SALE',
    'PREORDER_READY_FOR_SALE',
    'REPLACED_WITH_NEW_VERSION',
  ]);
  if (existingSameVersion && SHIPPED_STATES.has(existingSameVersion.appStoreState)) {
    console.log(
      `  version ${marketing} is already ${existingSameVersion.appStoreState}.\n  Nothing to do.`,
    );
    console.log(`  -> Bump the version first for a new release.`);
    return;
  }

  // 状態を 3 分類で扱う(混ぜると審査中の本番版を誤って cancel して事故る)。
  const DEVELOPER_TURN_STATES = new Set([
    'REJECTED',
    'METADATA_REJECTED',
    'DEVELOPER_REJECTED',
    'INVALID_BINARY',
    'PREPARE_FOR_SUBMISSION',
  ]);
  const APPLE_TURN_STATES = new Set([
    'WAITING_FOR_REVIEW',
    'IN_REVIEW',
    'PENDING_DEVELOPER_RELEASE',
    'PENDING_APPLE_RELEASE',
    'PROCESSING_FOR_APP_STORE',
  ]);

  const SUPERSEDABLE_APPLE_STATES = new Set(['WAITING_FOR_REVIEW']);
  const ACTIVELY_IN_REVIEW_STATES = new Set([
    'IN_REVIEW',
    'PENDING_DEVELOPER_RELEASE',
    'PENDING_APPLE_RELEASE',
    'PROCESSING_FOR_APP_STORE',
  ]);

  // semver 比較(local package.json をダウングレードしても newer 版を cancel しない)。
  const cmpSemver = (a, b) => {
    const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d;
    }
    return 0;
  };

  const otherBlocking = versions.filter(
    (v) =>
      v.platform === PLATFORM &&
      v.versionString !== marketing &&
      (DEVELOPER_TURN_STATES.has(v.appStoreState) || APPLE_TURN_STATES.has(v.appStoreState)),
  );
  let didRepurpose = false;
  for (const other of otherBlocking) {
    if (ACTIVELY_IN_REVIEW_STATES.has(other.appStoreState)) {
      console.log(
        `  another version ${other.versionString} is currently ${other.appStoreState} (Apple actively in review / pending release).\n  ` +
          `Skipping iOS submission for now (CI exits clean; web / Android unaffected).\n  ` +
          `If you intend to supersede this version, cancel it manually in App Store Connect and re-run.`,
      );
      return;
    }
    if (SUPERSEDABLE_APPLE_STATES.has(other.appStoreState)) {
      if (cmpSemver(marketing, other.versionString) <= 0) {
        console.log(
          `  another version ${other.versionString} is ${other.appStoreState} but local package.json marketing ${marketing} is NOT higher (semver).\n  ` +
            `Refusing to supersede — bump package.json first.`,
        );
        return;
      }
      console.log(
        `  another version ${other.versionString} is ${other.appStoreState} (Apple's queue, not yet under review).\n  ` +
          `New build ${marketing} pushed → cancelling old submission + repurposing version row.`,
      );
      await repurposeBlockingVersion(api, app.id, other, marketing);
      didRepurpose = true;
      continue;
    }
    console.log(
      `  another version ${other.versionString} is ${other.appStoreState} (developer's turn).\n  ` +
        `Re-purposing as ${marketing}...`,
    );
    await repurposeBlockingVersion(api, app.id, other, marketing);
    didRepurpose = true;
  }

  if (existingSameVersion && DEVELOPER_TURN_STATES.has(existingSameVersion.appStoreState)) {
    console.log(
      `  version ${marketing} itself is ${existingSameVersion.appStoreState} (developer's turn).\n  ` +
        `Cancelling any open review submission...`,
    );
    await cancelOpenReviewSubmissions(api, app.id);
    didRepurpose = true;
  }
  if (existingSameVersion && APPLE_TURN_STATES.has(existingSameVersion.appStoreState)) {
    console.log(
      `  version ${marketing} is already ${existingSameVersion.appStoreState} (Apple's turn).\n  Nothing to do.`,
    );
    return;
  }

  let liveVersionAfter = liveVersion;
  if (didRepurpose) {
    versions = await listVersions(api, app.id, 50);
    liveVersionAfter = versions.find((v) => v.platform === PLATFORM && v.appStoreState === 'READY_FOR_SALE') || null;
  }

  console.log('\n[3] Wait for build to be VALID...');
  const build = await pollBuildProcessing(api, app.id, marketing, buildNumber);
  console.log(`  build OK: id=${build.id} ${build.marketingVersion} (${build.buildNumber})`);

  console.log('\n[4] Ensure version exists...');
  const version = await ensureVersion(api, app.id, marketing);
  console.log(`  versionId=${version.id} state=${version.appStoreState}`);

  console.log('\n[5] Set ja localization with whatsNew...');
  const jaLoc = await ensureLocalization(api, version.id, liveVersionAfter?.id || null, whatsNew);

  console.log('\n[5b] Upload iPhone screenshots (6.7" + 6.5")...');
  const screenshotsDir = process.env.IOS_SCREENSHOTS_DIR || path.join(REPO, 'ios-screenshots');
  try {
    const r = await uploadIPhoneScreenshots(api, jaLoc.id, screenshotsDir);
    console.log(`  screenshots: uploaded=${r.uploaded} deleted=${r.deleted ?? 0} skipped=${r.skipped}`);
  } catch (e) {
    console.log(`  WARN: screenshot upload failed (continuing): ${e.message.slice(0, 400)}`);
  }

  console.log('\n[6] Link build...');
  await linkBuild(api, version.id, build.id);

  console.log('\n[7] Ensure review detail...');
  await ensureReviewDetail(api, version.id, liveVersionAfter?.id || null);

  console.log('\n[7b] Ensure free-tier pricing...');
  try {
    await ensureFreePricing(api, app.id);
  } catch (e) {
    console.log(`  WARN: pricing setup failed (continuing): ${e.message.slice(0, 400)}`);
  }

  console.log('\n[8] Submit for review...');
  await submitForReview(api, app.id, version.id);

  console.log('\nDONE.');
})().catch((e) => {
  console.error(`\nFATAL: ${e.message}`);
  process.exit(1);
});
