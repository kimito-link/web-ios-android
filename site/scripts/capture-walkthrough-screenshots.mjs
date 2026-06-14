#!/usr/bin/env node
/**
 * 追体験ページ用キャプチャ生成（_sources/*.html → captures/{ios,chrome}/*.png）
 * 実証アプリ「君斗りんくのWEBサイト健康診断」の ASC / CWS 画面を UI 再現して撮影。
 * 後から本物のスクショに差し替える場合は同名 PNG を上書きするだけ。
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(__dirname, '..');
const SOURCES = path.join(SITE, 'assets', 'captures', '_sources');
const MAX_WIDTH = 1000;

const JOBS = [
  { platform: 'ios', file: '01-developer-cert.html', out: '01-developer-cert.png' },
  { platform: 'ios', file: '02-asc-api-keys.html', out: '02-asc-api-keys.png' },
  { platform: 'ios', file: '03-apps-new-app.html', out: '03-apps-new-app.png' },
  { platform: 'ios', file: '04-app-privacy.html', out: '04-app-privacy.png' },
  { platform: 'ios', file: '05-waiting-review.html', out: '05-waiting-review.png' },
  { platform: 'chrome', file: '01-cws-dashboard.html', out: '01-cws-dashboard.png' },
  { platform: 'chrome', file: '02-gcp-oauth-client.html', out: '02-gcp-oauth-client.png' },
  { platform: 'chrome', file: '03-gcp-consent-test-users.html', out: '03-gcp-consent-test-users.png' },
  { platform: 'chrome', file: '04-oauth-auth-code.html', out: '04-oauth-auth-code.png' },
  { platform: 'chrome', file: '05-publish-success.html', out: '05-publish-success.png' },
];

async function resizePng(filePath) {
  const img = sharp(filePath);
  const meta = await img.metadata();
  if (meta.width && meta.width > MAX_WIDTH) {
    await img.resize({ width: MAX_WIDTH }).png({ compressionLevel: 9 }).toFile(filePath + '.tmp');
    fs.renameSync(filePath + '.tmp', filePath);
  }
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const job of JOBS) {
    const htmlPath = path.join(SOURCES, job.platform, job.file);
    const outDir = path.join(SITE, 'assets', 'captures', job.platform);
    const outPath = path.join(outDir, job.out);
    fs.mkdirSync(outDir, { recursive: true });
    const url = 'file:///' + htmlPath.replace(/\\/g, '/');
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(300);
    const root = page.locator('#capture-root');
    await root.screenshot({ path: outPath });
    await resizePng(outPath);
    console.log('OK', path.relative(SITE, outPath), fs.statSync(outPath).size, 'bytes');
  }
  await ctx.close();
} finally {
  await browser.close();
}
console.log('Done.');
