#!/usr/bin/env node
// 移植元: partnership_program_website/scripts/capture-play-screenshots.mjs
//   (固有 URL / 文言 / Clerk セレクタを除去し app.config.json + 環境変数 + screenshot-plan.json 駆動に一般化)。
//
// デプロイ済みサイトから Google Play スクショを Playwright で撮る。iOS 版
// (capture-appstore-screenshots.mjs)と同じ「価値5枚 + キャプション帯 + オンボ抑止」を
// Android FHD(1080×1920)で撮る。作り分けない方針で iOS とロジック統一。
//
// Google Play "Misleading metadata"(実使用を反映)と Apple 2.3.3 と同じ観点で、
// ログイン認証アプリはログイン後画面を撮る。creds 欠落時は fail-closed(exit 1)。
//
// 出力: <OUT_DIR>/01..NN-*.png(play-fill-listing.mjs がディレクトリ内全 png をファイル名順で upload)。
//
// 撮影計画は iOS と同じ screenshot-plan.json を共有(SCREENSHOT_PLAN または store-assets/screenshot-plan.json)。
//
// 環境変数:
//   SCREENSHOT_URL                       撮影対象(既定: app.config.json identity.productionDomain)
//   PLAY_SCREENSHOTS_OUT_DIR             出力(既定: store-assets/play/screenshots)
//   SCREENSHOT_PLAN                      撮影計画 JSON のパス
//   IOS_REVIEW_DEMO_USERNAME/_PASSWORD   ログイン認証アプリのデモ資格(iOS と同じ secret を流用)
//   SCREENSHOT_ALLOW_NO_AUTH=1           ローカルで public のみ撮る時
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfg, productionUrl } from './lib/app-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const URL = productionUrl();
const OUT_DIR = process.env.PLAY_SCREENSHOTS_OUT_DIR || path.join(ROOT, 'store-assets', 'play', 'screenshots');
const DEMO_USER = process.env.IOS_REVIEW_DEMO_USERNAME;
const DEMO_PASS = process.env.IOS_REVIEW_DEMO_PASSWORD;
const BRAND_PRIMARY = cfg('brand.primaryColor', '#4facfe');
const BRAND_ACCENT = cfg('brand.accentColor', '#dd6500');

const DEFAULT_PLAN = {
  dashboardUrlRegex: '/dashboard',
  signInPath: '/sign-in',
  publicPages: [{ slot: '01', path: '/', label: 'home', title: '', subtitle: '', scrollToSelector: null }],
  authTabs: [],
};
function loadPlan() {
  const candidates = [process.env.SCREENSHOT_PLAN, path.join(ROOT, 'store-assets', 'screenshot-plan.json')].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        console.log(`[play-capture] using plan: ${path.relative(ROOT, p)}`);
        return { ...DEFAULT_PLAN, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
      }
    } catch (e) {
      console.warn(`[play-capture] failed to parse plan ${p}: ${e.message}`);
    }
  }
  console.log('[play-capture] no screenshot-plan.json — capturing home page only');
  return DEFAULT_PLAN;
}
const PLAN = loadPlan();
const hasAuthPlan = PLAN.authTabs && PLAN.authTabs.length > 0;

if (hasAuthPlan && (!DEMO_USER || !DEMO_PASS) && process.env.SCREENSHOT_ALLOW_NO_AUTH !== '1') {
  console.error(
    '[capture-play-screenshots] この撮影計画はログイン後タブを含むため IOS_REVIEW_DEMO_USERNAME と ' +
      'IOS_REVIEW_DEMO_PASSWORD が必須(iOS capture と同じ secret。_docs/apple-reject-knowledge-base.md 参照)。' +
      'ローカルで public のみ撮るなら SCREENSHOT_ALLOW_NO_AUTH=1 を渡す。',
  );
  process.exit(1);
}

const ONBOARDING_KEY = process.env.SCREENSHOT_ONBOARDING_KEY || cfg('identity.shortName', 'app') + '_onboarding_completed';
const VIEWPORT = { width: 1080, height: 1920 }; // Android FHD 縦

const HIDE_SOCIAL_CSS = `
  .cl-socialButtons,
  .cl-socialButtonsBlockButton,
  .cl-socialButtonsIconButton,
  [data-clerk-component^="SignIn-Social"],
  [data-localization-key^="socialButtonsBlockButton__"],
  [data-provider],
  button[aria-label*="Google" i],
  button[aria-label*="Apple" i] {
    display: none !important;
  }
  html, body { overflow-x: hidden !important; max-width: 100vw !important; }
`;

// Android FHD は横 1080px と広いのでフォントは大きめ。
async function withCaption(page, { title, subtitle }, shoot) {
  if (!title) {
    await shoot();
    return;
  }
  await page.evaluate(
    ({ title, subtitle, primary, accent }) => {
      const id = '__aso_caption__';
      document.getElementById(id)?.remove();
      const el = document.createElement('div');
      el.id = id;
      el.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'width:100%',
        'box-sizing:border-box', 'z-index:2147483647',
        'padding:80px 56px 64px', 'pointer-events:none',
        'min-height:520px',
        'background:#0A0A0F',
        'border-bottom:1px solid rgba(255,255,255,0.08)',
        'font-family:-apple-system,BlinkMacSystemFont,"Noto Sans JP",sans-serif',
        'text-align:center',
      ].join(';');
      const h = document.createElement('div');
      h.textContent = title;
      h.style.cssText = [
        'color:#ffffff', 'font-weight:800', 'font-size:46px', 'line-height:1.3',
        'letter-spacing:0.005em', 'text-shadow:0 2px 12px rgba(0,0,0,0.5)',
        'white-space:normal', 'overflow-wrap:anywhere', 'word-break:normal',
        'max-width:100%', 'margin:0 auto',
      ].join(';');
      el.appendChild(h);
      if (subtitle) {
        const p = document.createElement('div');
        p.textContent = subtitle;
        p.style.cssText = [
          'color:rgba(244,246,251,0.92)', 'font-weight:500', 'font-size:24px',
          'line-height:1.5', 'margin-top:16px',
          'white-space:normal', 'overflow-wrap:anywhere', 'max-width:100%',
        ].join(';');
        el.appendChild(p);
      }
      const bar = document.createElement('div');
      bar.style.cssText = [
        'width:80px', 'height:6px', 'border-radius:3px', 'margin:24px auto 0',
        `background:linear-gradient(90deg,${primary},${accent})`,
      ].join(';');
      el.appendChild(bar);
      (document.body || document.documentElement).appendChild(el);
    },
    { title, subtitle, primary: BRAND_PRIMARY, accent: BRAND_ACCENT },
  );
  await page.waitForTimeout(250);
  await shoot();
  await page.evaluate(() => document.getElementById('__aso_caption__')?.remove());
}

fs.mkdirSync(OUT_DIR, { recursive: true });

// 旧スクショ掃除(public/ダッシュボード混在を防ぐ。play-fill-listing は全 png upload)。
const cleared = [];
for (const f of fs.readdirSync(OUT_DIR)) {
  if (/\.(png|jpe?g)$/i.test(f)) {
    fs.unlinkSync(path.join(OUT_DIR, f));
    cleared.push(f);
  }
}
if (cleared.length > 0) console.log(`Cleared ${cleared.length} stale screenshot(s): ${cleared.join(', ')}`);

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
  });
  await ctx.addInitScript(
    ({ css, onboardingKey }) => {
      try {
        window.localStorage.setItem(onboardingKey, 'true');
      } catch {
        /* ignore */
      }
      const apply = () => {
        if (document.getElementById('__capture-social-hide__')) return;
        const s = document.createElement('style');
        s.id = '__capture-social-hide__';
        s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
      else apply();
    },
    { css: HIDE_SOCIAL_CSS, onboardingKey: ONBOARDING_KEY },
  );
  const page = await ctx.newPage();

  // --- ログイン不要ページ ---
  for (const { slot, path: pubPath, label, title, subtitle, scrollToSelector } of PLAN.publicPages) {
    try {
      console.log(`Loading ${URL}${pubPath} (${label}) ...`);
      await page.goto(`${URL}${pubPath}`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(2000);
      await page.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const h = document.body.scrollHeight;
        for (let y = 0; y < h; y += Math.round(window.innerHeight * 0.8)) {
          window.scrollTo(0, y);
          await sleep(180);
        }
        window.scrollTo(0, 0);
        await sleep(300);
      });
      await page.waitForTimeout(800);
      let scrolled = false;
      if (scrollToSelector) {
        try {
          await page.locator(scrollToSelector).first().scrollIntoViewIfNeeded({ timeout: 6000 });
          await page.evaluate(() => window.scrollBy(0, -140));
          scrolled = true;
        } catch {
          /* fall through */
        }
      }
      if (!scrolled && pubPath.includes('#')) {
        const anchor = pubPath.split('#')[1];
        await page.evaluate((a) => document.getElementById(a)?.scrollIntoView({ block: 'start' }), anchor).catch(() => {});
      }
      await page.waitForTimeout(900);
      const file = path.join(OUT_DIR, `${slot}-${String(label).replace(/[^a-z0-9]+/gi, '-')}.png`);
      await withCaption(page, { title, subtitle }, () => page.screenshot({ path: file, fullPage: false }));
      console.log(`Saved ${path.relative(ROOT, file)} (${fs.statSync(file).size} bytes) — ${label}`);
    } catch (e) {
      console.warn(`  WARN: failed ${slot} (${label}): ${e.message.slice(0, 200)} — continuing`);
    }
  }

  // --- ログイン後タブ ---
  if (hasAuthPlan && DEMO_USER && DEMO_PASS) {
    try {
      console.log(`Loading ${URL}${PLAN.signInPath} ...`);
      await page.goto(`${URL}${PLAN.signInPath}`, { waitUntil: 'networkidle', timeout: 60000 });
      const emailInput = page.getByLabel(/email|メール/i).first();
      await emailInput.waitFor({ state: 'visible', timeout: 30000 });
      await emailInput.fill(DEMO_USER);
      await emailInput.press('Enter');
      await page.waitForFunction(
        () => {
          const el = document.querySelector('input[name="password"], input#password-field, input[type="password"]');
          return !!(el && !el.disabled && el.offsetParent !== null);
        },
        null,
        { timeout: 30000 },
      );
      const passwordInput = page.locator('input[name="password"], input#password-field, input[type="password"]').first();
      await passwordInput.fill(DEMO_PASS);
      await passwordInput.press('Enter');
      await page.waitForURL(new RegExp(PLAN.dashboardUrlRegex), { timeout: 30000 });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      for (const tab of PLAN.authTabs) {
        try {
          const sel = tab.selector || `[role="tab"][id$="-trigger-${tab.value}"]`;
          const loc = page.locator(sel).first();
          await loc.waitFor({ state: 'visible', timeout: 8000 });
          await loc.click({ timeout: 5000 });
          await page.waitForTimeout(2500);
          const file = path.join(OUT_DIR, `${tab.slot}-${String(tab.label).replace(/[^a-z0-9]+/gi, '-')}.png`);
          await withCaption(page, { title: tab.title, subtitle: tab.subtitle }, () => page.screenshot({ path: file, fullPage: false }));
          console.log(`Saved ${path.relative(ROOT, file)} (${fs.statSync(file).size} bytes) — ${tab.label}`);
        } catch (e) {
          console.warn(`  WARN: failed ${tab.slot} (${tab.label}): ${e.message.slice(0, 200)} — continuing`);
        }
      }
    } catch (e) {
      console.warn(`  WARN: auth capture skipped: ${e.message.slice(0, 200)} — public shots already satisfy Play`);
    }
  } else if (hasAuthPlan) {
    console.log('  (no reviewer creds — skipping authenticated tabs)');
  }

  await ctx.close();
} finally {
  await browser.close();
}
console.log('\nAll Play screenshot captures complete.');
