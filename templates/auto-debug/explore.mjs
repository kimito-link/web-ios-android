#!/usr/bin/env node
// 自動デバッグの「歩き回る係」。本番のページを開いて、種で決まる順にリンク・ボタンを押して回り、
// 異常（JS の例外・500番台・真っ白・固まる・404・コンソール error）を見つけたら、証拠と「同じ歩き方の手順(replay)」を残す。
// 見つけたものは、その場で同じ手順をもう一度たどって再現するかを確かめる（記事の「自動再現確認」）。
//
// 使い方:
//   node templates/auto-debug/explore.mjs --url https://example.com/ [--url ...] [--steps 25] [--seed 1] [--out auto-debug-out]
//   node templates/auto-debug/explore.mjs --registry          # templates/scripts/lib/app-links.json の全 web を回る
//   node templates/auto-debug/explore.mjs --replay <file.json> # 残した手順をたどる（直ったかの確認。0=出ない 1=再現した）
// 出力: <out>/findings.json（指紋ごと・再現の有無つき）と <out>/<指紋>.replay.json / .png
//
// ★本番を壊さない: 同じサイトへの POST/PUT/PATCH/DELETE は全部止める（読むだけで歩く）。文字は打たない。
//   押すと消える・お金・送る・出る文言（lib.mjs DENY_WORDS）の要素は押さない。外のサイトへは出ない。
// ★判定しないこと: ログインが要る画面の中・見た目の崩れ・文言の誤り。決まり: docs/ai-rules/17_AUTO_DEBUG.md

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupFindings, isSafeTarget, pickTarget, rng, signatureOf } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const NAV_TIMEOUT = 20000;
const IDLE_WAIT = 1500; // 押したあと少し待つ（記事: 押した瞬間の記録が落ちることがあるので一定時間待つ。画面を描き終わるのも待つ）

function args(argv) {
  const o = { url: [], steps: 25, seed: Number(process.env.AUTO_DEBUG_SEED) || Math.floor(Date.now() / 86400000), out: 'auto-debug-out' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') o.url.push(argv[++i]);
    else if (a === '--steps') o.steps = Number(argv[++i]);
    else if (a === '--seed') o.seed = Number(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--replay') o.replay = argv[++i];
    else if (a === '--registry') o.registry = true;
  }
  return o;
}

function registryUrls() {
  const reg = JSON.parse(readFileSync(resolve(here, '../scripts/lib/app-links.json'), 'utf8'));
  return reg.services.filter((s) => s.autoDebug !== false).flatMap((s) => s.web ?? []);
}

async function listTargets(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const out = [];
    document.querySelectorAll('a[href]').forEach((a) => {
      if (vis(a)) out.push({ kind: 'link', href: a.href, text: (a.innerText || '').trim().slice(0, 60), label: a.getAttribute('aria-label') || '' });
    });
    const btns = [...document.querySelectorAll('button:not([type=submit]):not([disabled]), [role=button], summary')].filter(
      (b) => vis(b) && !b.closest('form'),
    );
    btns.forEach((b, i) => out.push({ kind: 'button', index: i, text: (b.innerText || '').trim().slice(0, 60), label: b.getAttribute('aria-label') || '' }));
    return out;
  });
}

async function press(page, t) {
  if (t.kind === 'link') {
    // 人と同じく画面のリンクを押す（画面の中で行き先を切り替える作りのリンクを、直接開いて 404 と誤報しないため）
    const a = (
      await page.evaluateHandle((href) => {
        const el = [...document.querySelectorAll('a[href]')].find((x) => x.href === href && x.getBoundingClientRect().width > 0);
        if (el) el.removeAttribute('target'); // 新しいタブではなく同じタブで開く
        return el ?? null;
      }, t.href)
    ).asElement();
    if (a) {
      const nav = page.waitForNavigation({ timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' }).catch(() => null);
      await a.click({ timeout: 5000 });
      await Promise.race([nav, page.waitForTimeout(3000)]);
      return;
    }
    await page.goto(t.href, { timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' });
    return;
  }
  const handle = await page.evaluateHandle((i) => {
    const btns = [...document.querySelectorAll('button:not([type=submit]):not([disabled]), [role=button], summary')].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !b.closest('form');
    });
    return btns[i] ?? null;
  }, t.index);
  const el = handle.asElement();
  if (!el) throw new Error('button-gone');
  await el.click({ timeout: 5000 });
}

/** 1つの入口から歩く。replay を渡すとその手順どおりに歩く。 */
export async function walk(browser, { startUrl, seed, steps, replay }) {
  // 自分のサイト＝入口の住所と、転送された先の住所（例: yukkuri-exosome.link → exosome.kimito.link）
  let origin = new URL(startUrl).origin;
  const own = new Set([origin]);
  const isOwn = (url) => {
    try {
      return own.has(new URL(url).origin);
    } catch {
      return false;
    }
  };
  const ctx = await browser.newContext({ userAgent: 'kimito-auto-debug/1 (+https://github.com/kimito-link/web-ios-android)' });
  const page = await ctx.newPage();
  const findings = [];
  const trail = [];
  const blocked = [];
  const add = (type, message, url = page.url()) => {
    if (!isOwn(url)) return; // 外のサイト（ログイン先の X など）の異常は数えない
    findings.push({ type, message, url, step: trail.length, startUrl, seed });
  };

  await ctx.route('**/*', (route) => {
    const req = route.request();
    // 書き込みは本番に届けず、空の成功を返す（止めた事による偽の異常を出さない）
    if (isOwn(req.url()) && !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      blocked.push(`${req.method()} ${req.url()}`);
      return route.fulfill({ status: 204, body: '' });
    }
    return route.continue();
  });
  page.on('pageerror', (e) => add('js-exception', e.message));
  page.on('console', (m) => m.type() === 'error' && !/^Failed to load resource/.test(m.text()) && add('console-error', m.text())); // 読み込み失敗は response 側で数える
  page.on('response', (r) => {
    if (!isOwn(r.url())) return;
    if (r.status() >= 500) add('server-5xx', `${r.status()} ${r.request().method()}`, r.url());
    else if (r.status() === 404 && r.request().resourceType() === 'document') add('broken-link', '404', r.url());
  });
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? '';
    if (isOwn(r.url()) && !/ERR_ABORTED/i.test(why)) add('request-failed', why, r.url());
  });

  const isEmpty = () =>
    page.evaluate(() => (document.body?.innerText || '').trim().length === 0 && !document.querySelector('img,canvas,svg,video')).catch(() => false);
  const checkBlank = async () => {
    if (!(await isEmpty())) return;
    await page.waitForTimeout(3000); // 描くのが遅いだけの画面を真っ白と言わない
    if (await isEmpty()) add('blank-screen', 'empty body');
  };
  const go = async (fn, url) => {
    const t0 = Date.now();
    const at = url ?? page.url();
    try {
      await fn();
      await page.waitForTimeout(IDLE_WAIT);
      if (trail.length > 0 && !isOwn(page.url())) {
        // 押したら外のサイトへ出た → 入口へ戻る（外は歩かない）
        await page.goto(startUrl, { timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(IDLE_WAIT);
      }
      await checkBlank();
    } catch (e) {
      if (Date.now() - t0 >= NAV_TIMEOUT - 500) add('stuck', 'timeout', at); // ボタンが押せなかっただけ(5秒)は固まったと言わない
    }
  };

  await go(() => page.goto(startUrl, { timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' }), startUrl);
  try {
    const landed = new URL(page.url()).origin;
    if (landed.startsWith('http')) {
      own.add(landed);
      origin = landed;
    }
  } catch {
    /* 開けなかった（stuck として記録済み） */
  }
  const random = rng(seed);
  const visited = new Set([startUrl]);
  const plan = replay?.steps;
  const n = plan ? plan.length : steps;
  for (let i = 0; i < n; i++) {
    let t = plan ? plan[i] : null;
    if (!t) {
      const targets = (await listTargets(page).catch(() => [])).filter((x) => isSafeTarget(x, origin));
      t = pickTarget(targets, visited, random);
      if (!t) {
        await go(() => page.goto(startUrl, { timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' }), startUrl);
        continue;
      }
    }
    trail.push(t);
    if (t.kind === 'link') visited.add(t.href);
    await go(() => press(page, t), t.href);
  }
  const shot = findings.length ? await page.screenshot({ fullPage: false }).catch(() => null) : null;
  await ctx.close();
  return { findings: findings.map((f) => ({ ...f, signature: signatureOf(f) })), trail, shot, blocked };
}

/** playwright を読む（リポに入っていなければ、この機械に入っている物を探す）。 */
export async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    return createRequire(import.meta.url)('playwright').chromium;
  }
}

async function main() {
  const o = args(process.argv.slice(2));
  const chromium = await loadChromium();
  const browser = await chromium.launch();
  try {
    if (o.replay) {
      const rp = JSON.parse(readFileSync(o.replay, 'utf8'));
      const r = await walk(browser, { startUrl: rp.startUrl, seed: rp.seed, replay: rp });
      const hit = r.findings.some((f) => f.signature === rp.signature);
      console.log(hit ? `✗ 再現した: ${rp.signature}` : `✓ 出なかった: ${rp.signature}`);
      process.exit(hit ? 1 : 0);
    }
    const urls = o.registry ? registryUrls() : o.url;
    if (!urls.length) {
      console.error('--url か --registry を渡す');
      process.exit(2);
    }
    mkdirSync(o.out, { recursive: true });
    const all = [];
    const one = async (startUrl) => {
      const r = await walk(browser, { startUrl, seed: o.seed, steps: o.steps });
      const groups = groupFindings(r.findings);
      for (const g of groups) {
        // その場で同じ手順をもう一度たどる＝自動再現確認
        const steps = r.trail.slice(0, g.step);
        const again = await walk(browser, { startUrl, seed: o.seed, replay: { steps } });
        g.reproduced = again.findings.some((f) => f.signature === g.signature);
        g.replay = { startUrl, seed: o.seed, signature: g.signature, steps };
        writeFileSync(join(o.out, `${g.signature}.replay.json`), JSON.stringify(g.replay, null, 2));
        if (r.shot) writeFileSync(join(o.out, `${g.signature}.png`), r.shot);
        all.push(g);
      }
      console.log(`${groups.length ? '✗' : '✓'} ${startUrl} 歩いた数 ${r.trail.length} / 異常 ${groups.length} / 止めた書き込み ${r.blocked.length}`);
    };
    // 3サイトずつ同時に歩く（1サイトずつだと一覧が増えるほど夜の枠に収まらなくなる）
    const queue = [...urls];
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) await one(queue.shift()).catch((e) => console.error(`巡回できなかった: ${e.message}`));
    }));
    writeFileSync(join(o.out, 'findings.json'), JSON.stringify(all, null, 2));
    process.exit(all.length ? 1 : 0);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}
