#!/usr/bin/env node
/**
 * collect-revenue-snapshot.mjs
 *
 * Stripe・App Store Connect・Google Play・(任意)X/YouTubeへ問い合わせ、
 * .revenue-snapshot.json / .social-snapshot.json を書く。
 *
 * 設計: _docs/DESIGN-revenue-bottleneck-dashboard-2026-09-08.md
 *
 * ★このスクリプトは秘密を扱うローカル専用実行。公開リポには何も書かない
 * (成果物はすべて.gitignore対象)。描画側(generate-revenue-dashboard.mjs)は
 * このスクリプトが書いたJSONだけを読む(収集と描画の分離、設計B-2)。
 *
 * 3値exit(instrument-core.mjs規約): 0=全ソースOK / 1=いずれか失敗 / 2=測れない。
 * 失敗ソースがあってもスナップショットは書く(他ソースを道連れにしない)。
 *
 * Usage:
 *   node scripts/revenue/collect-revenue-snapshot.mjs           # 通常収集
 *   node scripts/revenue/collect-revenue-snapshot.mjs --check   # 認証・権限チェックのみ
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, computeExitCode, formatProbeReport } from '../lib/instrument-core.mjs';
import { findRepoRoot } from '../lib/repo-root.mjs';
import { loadProductMap } from './lib/product-map.mjs';
import { collectStripeRevenue } from './lib/stripe-revenue.mjs';
import { collectAscSales } from './lib/asc-sales.mjs';
import { collectPlayInstalls } from './lib/play-installs.mjs';
import { fetchXFollowers, fetchYouTubeSubscribers } from './lib/social-followers.mjs';
import { loadServiceAccount } from '../../templates/scripts/lib/play-api.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = resolve(HERE, '..', '..');
const GITHUB_ROOT = resolve(KIT_ROOT, '..');

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');

const WINDOW_DAYS = 30;
const SNAPSHOT_PATH = join(KIT_ROOT, '.revenue-snapshot.json');
const SOCIAL_SNAPSHOT_PATH = join(KIT_ROOT, '.social-snapshot.json');
const CACHE_DIR = join(KIT_ROOT, '.revenue-cache');

function nowIso() {
  return new Date().toISOString();
}
function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

async function checkStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return { probe: 'Stripe 認証', verdict: 'inconclusive', detail: 'STRIPE_SECRET_KEY が未設定です', howToFix: '読み取り専用の制限付きキーを新規発行し環境変数に設定してください（本番Secret keyを流用しない）' };
  }
  const result = await collectStripeRevenue(key, { days: 1 });
  if (!result.ok) {
    return { probe: 'Stripe 認証', verdict: 'fail', detail: result.error, howToFix: 'キーの権限（Checkout Sessions/Invoices/Subscriptions/Products/Balance の読み取り）を確認してください' };
  }
  return { probe: 'Stripe 認証', verdict: 'pass', evidence: { unassignedProducts: result.unassignedStripe.length } };
}

async function checkAsc() {
  const keyId = process.env.APPSTORE_CONNECT_KEY_ID;
  const issuerId = process.env.APPSTORE_CONNECT_ISSUER_ID;
  const p8 = process.env.APPSTORE_CONNECT_API_KEY_P8_BASE64;
  const vendorNumber = process.env.APPSTORE_CONNECT_VENDOR_NUMBER;
  if (!keyId || !issuerId || !p8 || !vendorNumber) {
    return { probe: 'Apple salesReports 認証', verdict: 'inconclusive', detail: 'APPSTORE_CONNECT_KEY_ID/_ISSUER_ID/_API_KEY_P8_BASE64/_VENDOR_NUMBER のいずれかが未設定です', howToFix: 'ASC > Payments and Financial Reports の Vendor Number を控え、Sales/Admin/Financeロールの鍵を用意してください' };
  }
  const privateKey = Buffer.from(p8, 'base64').toString('utf8');
  const cacheDir = join(CACHE_DIR, 'asc-check');
  const result = await collectAscSales(
    { keyId, issuerId, privateKey, vendorNumber },
    { days: 1, cacheDir }
  );
  if (!result.ok) {
    return { probe: 'Apple salesReports 認証', verdict: 'fail', detail: result.error, howToFix: result.howToFix || '鍵のロールを確認してください' };
  }
  return { probe: 'Apple salesReports 認証', verdict: 'pass', evidence: { appsFound: result.byAppId.size } };
}

async function checkPlay(products) {
  const bucket = process.env.GOOGLE_PLAY_REPORTS_BUCKET;
  if (!bucket) {
    return { probe: 'Google Play installs 認証', verdict: 'inconclusive', detail: 'GOOGLE_PLAY_REPORTS_BUCKET が未設定です', howToFix: 'Play Console > レポートをダウンロード > 統計 > 「Cloud Storage URI をコピー」の pubsite_prod_rev_… を設定してください' };
  }
  let sa;
  try {
    sa = loadServiceAccount();
  } catch (e) {
    return { probe: 'Google Play installs 認証', verdict: 'inconclusive', detail: String(e.message), howToFix: 'GOOGLE_PLAY_SA_JSON_PATH 等を設定してください（既存のPlay公開スクリプトと共有）' };
  }
  const withPlay = products.find((p) => p.playPackageName);
  if (!withPlay) {
    return { probe: 'Google Play installs 認証', verdict: 'inconclusive', detail: 'playPackageName を持つプロダクトが見つかりません' };
  }
  const result = await collectPlayInstalls(sa, bucket, withPlay.playPackageName, { days: 1 });
  if (!result.ok) {
    return { probe: 'Google Play installs 認証', verdict: 'fail', detail: result.error, howToFix: result.howToFix };
  }
  return { probe: 'Google Play installs 認証', verdict: 'pass', evidence: { sampleProduct: withPlay.id, installsToday: result.installs } };
}

async function runCheck() {
  const products = loadProductMap(GITHUB_ROOT);
  const results = [
    { probe: 'プロダクト結合(repositories.json × app.config.json)', verdict: products.length > 0 ? 'pass' : 'inconclusive', evidence: products.length > 0 ? { products: products.length } : null, detail: products.length === 0 ? '登録済みプロダクトが見つかりません' : '' },
    await checkStripe(),
    await checkAsc(),
    await checkPlay(products),
  ];
  console.log(formatProbeReport(results, { label: 'revenue:check' }));
  process.exit(computeExitCode(results));
}

async function collectAll() {
  const products = loadProductMap(GITHUB_ROOT);
  mkdirSync(CACHE_DIR, { recursive: true });

  const to = new Date();
  const from = new Date(to.getTime() - WINDOW_DAYS * 86400_000);
  const window = { days: WINDOW_DAYS, from: dateStr(from), to: dateStr(to) };

  const sources = { stripe: { ok: false }, asc: { ok: false }, play: { ok: false } };

  // --- Stripe ---
  let stripeResult = { ok: false, error: 'STRIPE_SECRET_KEY 未設定' };
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey) {
    stripeResult = await collectStripeRevenue(stripeKey, { days: WINDOW_DAYS });
    const prevResult = await collectStripeRevenue(stripeKey, { days: WINDOW_DAYS * 2 });
    stripeResult.prevByProduct = prevResult.ok ? prevResult.byProduct : new Map();
  }
  sources.stripe = stripeResult.ok ? { ok: true } : { ok: false, error: stripeResult.error, howToFix: '読み取り専用の制限付きキーを発行し STRIPE_SECRET_KEY に設定してください' };

  // --- Apple ---
  let ascResult = { ok: false, error: '認証情報未設定' };
  const keyId = process.env.APPSTORE_CONNECT_KEY_ID;
  const issuerId = process.env.APPSTORE_CONNECT_ISSUER_ID;
  const p8 = process.env.APPSTORE_CONNECT_API_KEY_P8_BASE64;
  const vendorNumber = process.env.APPSTORE_CONNECT_VENDOR_NUMBER;
  if (keyId && issuerId && p8 && vendorNumber) {
    const privateKey = Buffer.from(p8, 'base64').toString('utf8');
    ascResult = await collectAscSales(
      { keyId, issuerId, privateKey, vendorNumber, version: process.env.APPSTORE_CONNECT_SALES_REPORT_VERSION },
      { days: WINDOW_DAYS, cacheDir: join(CACHE_DIR, 'asc') }
    );
    const prevAsc = await collectAscSales(
      { keyId, issuerId, privateKey, vendorNumber, version: process.env.APPSTORE_CONNECT_SALES_REPORT_VERSION },
      { days: WINDOW_DAYS * 2, cacheDir: join(CACHE_DIR, 'asc') }
    );
    ascResult.prevByAppId = prevAsc.ok ? prevAsc.byAppId : new Map();
  }
  sources.asc = ascResult.ok
    ? { ok: true }
    : { ok: false, error: ascResult.error, howToFix: ascResult.howToFix || 'APPSTORE_CONNECT_KEY_ID/_ISSUER_ID/_API_KEY_P8_BASE64/_VENDOR_NUMBER を設定してください' };

  // --- Google Play (プロダクトごとに個別取得。1つ失敗しても他は続行) ---
  const bucket = process.env.GOOGLE_PLAY_REPORTS_BUCKET;
  const playByPackage = new Map();
  let playOverallOk = false;
  let playError = 'GOOGLE_PLAY_REPORTS_BUCKET 未設定';
  let playHowToFix;
  let playLagDays = null;
  if (bucket) {
    let sa;
    try {
      sa = loadServiceAccount();
    } catch (e) {
      playError = String(e.message);
    }
    if (sa) {
      const withPlay = products.filter((p) => p.playPackageName);
      for (const p of withPlay) {
        const r = await collectPlayInstalls(sa, bucket, p.playPackageName, { days: WINDOW_DAYS });
        const rPrev = await collectPlayInstalls(sa, bucket, p.playPackageName, { days: WINDOW_DAYS * 2 });
        if (r.ok) {
          playOverallOk = true;
          if (r.lagDays !== null) playLagDays = playLagDays === null ? r.lagDays : Math.max(playLagDays, r.lagDays);
          playByPackage.set(p.playPackageName, {
            installs: r.installs,
            installsPrev: rPrev.ok ? Math.max(0, rPrev.installs - r.installs) : null,
          });
        } else {
          playError = r.error;
          playHowToFix = r.howToFix;
        }
      }
    }
  }
  sources.play = playOverallOk
    ? { ok: true, lagDays: playLagDays }
    : { ok: false, error: playError, howToFix: playHowToFix || 'GOOGLE_PLAY_REPORTS_BUCKET と Play Console 側のSA権限を確認してください' };

  // --- 結合 ---
  const productOut = products.map((p) => {
    const stripeEntry = stripeResult.ok ? stripeResult.byProduct.get(p.id) : null;
    const stripePrevEntry = stripeResult.ok ? stripeResult.prevByProduct.get(p.id) : null;
    const ascEntry = ascResult.ok && p.ascAppId ? ascResult.byAppId.get(p.ascAppId) : null;
    const ascPrevEntry = ascResult.ok && p.ascAppId ? ascResult.prevByAppId.get(p.ascAppId) : null;
    const playEntry = p.playPackageName ? playByPackage.get(p.playPackageName) : null;

    const gross30d = stripeEntry?.gross ?? 0;
    const grossPrev30d = stripePrevEntry ? Math.max(0, (stripePrevEntry.gross ?? 0) - gross30d) : null;
    const units30d = ascEntry?.units ?? null;
    const unitsPrev30d = ascPrevEntry ? Math.max(0, (ascPrevEntry.units ?? 0) - (units30d ?? 0)) : null;
    const installs30d = playEntry?.installs ?? null;

    // ボトルネック判定(設計B-7)
    let bottleneck = null;
    const hasStoreData = units30d !== null || installs30d !== null;
    const dlTotal = (units30d ?? 0) + (installs30d ?? 0);
    const paidSomething = gross30d > 0 || (ascEntry?.proceeds ?? 0) > 0;
    if (!sources.stripe.ok || (!sources.asc.ok && !sources.play.ok)) {
      bottleneck = { stage: 'unmeasured', reason: '計測不能な項目があります（下の理由を参照）' };
    } else if (!paidSomething && dlTotal > 0) {
      bottleneck = { stage: 'monetize', reason: `DL ${dlTotal}/${WINDOW_DAYS}日 に対し課金 0` };
    } else if (hasStoreData && dlTotal < 10 && (p.ascAppId || p.playPackageName)) {
      bottleneck = { stage: 'acquire', reason: `DL ${dlTotal}/${WINDOW_DAYS}日 と少ない（掲載済みだが集客が弱い）` };
    } else if (grossPrev30d !== null && grossPrev30d > 0 && gross30d < grossPrev30d * 0.7) {
      bottleneck = { stage: 'decline', reason: `売上が前期比 ${Math.round((1 - gross30d / grossPrev30d) * 100)}% 減` };
    } else {
      bottleneck = { stage: 'ok', reason: '' };
    }

    return {
      id: p.id,
      name: p.name,
      brand: p.brand,
      url: p.url,
      store: {
        asc: p.ascAppId ? { appId: p.ascAppId, units30d, unitsPrev30d, proceeds30d: ascEntry?.proceeds ?? null } : null,
        play: p.playPackageName ? { package: p.playPackageName, installs30d, installsPrev30d: playEntry?.installsPrev ?? null } : null,
      },
      stripe: {
        currency: stripeEntry?.currency ?? null,
        gross30d,
        grossPrev30d,
        paidCount30d: stripeEntry?.paidCount ?? 0,
        activeSubs: stripeEntry?.activeSubs ?? 0,
        mrr: stripeEntry?.mrr ?? 0,
      },
      bottleneck,
    };
  });

  const unassignedStripe = stripeResult.ok ? stripeResult.unassignedStripe : [];
  const reconcileSumOfProducts = productOut.reduce((sum, p) => sum + p.stripe.gross30d, 0);
  const stripeNet30d = stripeResult.ok ? stripeResult.reconcile.stripeNet : 0;
  const refunds30d = stripeResult.ok ? stripeResult.reconcile.refunds : 0;
  const fees30d = stripeResult.ok ? stripeResult.reconcile.fees : 0;
  const expectedNet = reconcileSumOfProducts - refunds30d - fees30d;
  const reconcileOk = stripeResult.ok
    ? (stripeNet30d === 0 ? true : Math.abs(expectedNet - stripeNet30d) / Math.max(1, Math.abs(stripeNet30d)) <= 0.01)
    : null;

  const snapshot = {
    generatedAt: nowIso(),
    window,
    sources,
    products: productOut,
    unassignedStripe,
    reconcile: {
      stripeNet30d,
      sumOfProducts: reconcileSumOfProducts,
      refunds30d,
      fees30d,
      ok: reconcileOk,
    },
  };

  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf8');

  // --- SNS(任意機能。失敗しても収集全体を止めない) ---
  const socialProducts = [];
  for (const p of products) {
    const x = await fetchXFollowers(p.id);
    const yt = await fetchYouTubeSubscribers(p.id);
    if (x === null && yt === null) continue;
    socialProducts.push({ id: p.id, name: p.name, x, youtube: yt });
  }
  if (socialProducts.length > 0) {
    writeFileSync(SOCIAL_SNAPSHOT_PATH, JSON.stringify({ generatedAt: nowIso(), products: socialProducts }, null, 2), 'utf8');
  }

  const results = [
    { probe: 'Stripe 売上収集', verdict: sources.stripe.ok ? 'pass' : 'fail', detail: sources.stripe.error, howToFix: sources.stripe.howToFix, evidence: sources.stripe.ok ? { products: productOut.length } : null },
    { probe: 'Apple DL数収集', verdict: sources.asc.ok ? 'pass' : 'fail', detail: sources.asc.error, howToFix: sources.asc.howToFix, evidence: sources.asc.ok ? { window: WINDOW_DAYS } : null },
    { probe: 'Google Play installs収集', verdict: sources.play.ok ? 'pass' : 'fail', detail: sources.play.error, howToFix: sources.play.howToFix, evidence: sources.play.ok ? { lagDays: sources.play.lagDays } : null },
  ];
  console.log(formatProbeReport(results, { label: 'revenue:collect' }));
  console.log(`\n書き込み: ${SNAPSHOT_PATH}`);
  if (reconcileOk === false) {
    console.log(`🔴 突合ズレ検出: sumOfProducts=${reconcileSumOfProducts} vs stripeNet=${stripeNet30d}（1%超のズレ）`);
  }
  process.exit(computeExitCode(results));
}

async function main() {
  if (!findRepoRoot(KIT_ROOT) || !existsSync(join(GITHUB_ROOT, 'best-trust'))) {
    console.error('best-trust リポジトリが見つかりません（github/直下で実行してください）');
    process.exit(EXIT.INCONCLUSIVE);
  }
  if (checkOnly) {
    await runCheck();
  } else {
    await collectAll();
  }
}

main().catch((e) => {
  console.error(`予期しないエラー: ${e?.stack || e}`);
  process.exit(EXIT.INCONCLUSIVE);
});
