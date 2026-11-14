#!/usr/bin/env node
/**
 * check-features-alive.mjs — ★「今動いている機能の一覧」（features.json）が、修正の後も全部そろっているかを見る（配布用）。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ なぜ要るか（2026-11-14 りんく「これがおこらないようにして」「サイト全体で」）
 *
 *   AI にバグを直させると、関係ない機能（ログイン・検索・設定など）が消えることがある。
 *   直した本人（AI）は「直した所」しか確かめないので、消えた機能は誰も見ていない。
 *   ⟹ 「このサービスで動いていなければ困る機能」を先に一覧（features.json）にしておき、
 *     修正のたびに**一覧の全部**を機械で確かめる。一覧はリポに残るので、次の AI も同じものを確かめる。
 *
 * ■ features.json の形（リポの直下）
 *   {
 *     "features": [
 *       {
 *         "name": "ログイン",
 *         "anchors": [ { "file": "src/components/Header.tsx", "contains": "data-testid=\"login\"" } ],
 *         "smoke":   [ { "path": "/login", "contains": "ログイン" } ]
 *       }
 *     ]
 *   }
 *   anchors … ファイルがあり、その文字列を含むこと（コードの中に機能の入口が残っているか）。
 *   smoke   … --smoke <URL> を付けたときだけ、そのページが 200 で返り、その文字列を含むこと（本番・プレビューで動いているか）。
 *
 * ■ ★この検査が判定しないこと
 *   ・一覧に**書いていない**機能は見ない。新しい機能を作ったら一覧に足すところまでが作業。
 *   ・押したときに正しく動くかは見ない（入口があるか・ページが開くかまで）。中身はテスト・E2E の仕事。
 *
 * ■ 使い方
 *   node check-features-alive.mjs [対象ディレクトリ]
 *   node check-features-alive.mjs . --smoke https://example.com
 *   node check-features-alive.mjs --selftest
 *
 * ■ 終了コード
 *   0 = 全部そろっている / 1 = 消えた機能がある / 2 = ★測れなかった（一覧が無い・読めない。緑ではない）
 * ───────────────────────────────────────────────────────────────────────────
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });

/**
 * features.json の中身を確かめる（純粋な判定）。
 * @param {any} registry features.json を読んだもの
 * @param {(file:string) => string|null} readFile 無ければ null
 * @returns {{exit:number, missing:string[], checked:number, reason?:string}}
 */
export function checkAnchors(registry, readFile) {
  const features = registry && Array.isArray(registry.features) ? registry.features : null;
  if (!features || features.length === 0) {
    return { exit: EXIT.INCONCLUSIVE, missing: [], checked: 0, reason: 'features.json に features が1件も無い' };
  }
  const missing = [];
  let checked = 0;
  for (const f of features) {
    const anchors = Array.isArray(f.anchors) ? f.anchors : [];
    if (anchors.length === 0) { missing.push(`${f.name}: 目印(anchors)が1つも書かれていない`); continue; }
    for (const a of anchors) {
      checked++;
      const body = readFile(String(a.file || ''));
      if (body === null) missing.push(`${f.name}: ファイルが無い（${a.file}）`);
      else if (a.contains && !body.includes(a.contains)) missing.push(`${f.name}: 「${a.contains}」が ${a.file} から消えた`);
    }
  }
  return { exit: missing.length ? EXIT.FAIL : EXIT.PASS, missing, checked };
}

/**
 * 本番・プレビューで各ページが開けるか。
 * @param {any} registry
 * @param {string} baseUrl
 * @param {(url:string) => Promise<{status:number, text:string}>} fetcher
 */
export async function checkSmoke(registry, baseUrl, fetcher) {
  const missing = [];
  let checked = 0;
  for (const f of registry.features || []) {
    for (const s of Array.isArray(f.smoke) ? f.smoke : []) {
      checked++;
      const url = new URL(String(s.path || '/'), baseUrl).href;
      try {
        const r = await fetcher(url);
        if (r.status < 200 || r.status >= 300) missing.push(`${f.name}: ${url} が ${r.status}`);
        else if (s.contains && !r.text.includes(s.contains)) missing.push(`${f.name}: ${url} に「${s.contains}」が無い`);
      } catch (e) {
        missing.push(`${f.name}: ${url} に繋がらない（${e.message}）`);
      }
    }
  }
  return { exit: checked === 0 ? EXIT.INCONCLUSIVE : missing.length ? EXIT.FAIL : EXIT.PASS, missing, checked };
}

// ── selftest（★毒→赤） ──────────────────────────────────────────────────

async function runSelftest() {
  const files = { 'a.tsx': '<button data-testid="login">ログイン</button><a href="/search">検索</a>' };
  const read = (p) => (p in files ? files[p] : null);
  const reg = (anchors) => ({ features: [{ name: 'ログイン', anchors }] });
  const fake = (map) => async (url) => map[url] || { status: 404, text: '' };
  const cases = [
    { name: '目印が全部あれば緑', ok: async () => checkAnchors(reg([{ file: 'a.tsx', contains: 'data-testid="login"' }]), read).exit === EXIT.PASS },
    { name: '★目印の文字列が消えたら赤', ok: async () => checkAnchors(reg([{ file: 'a.tsx', contains: 'href="/settings"' }]), read).exit === EXIT.FAIL },
    { name: '★ファイルごと消えたら赤', ok: async () => checkAnchors(reg([{ file: 'gone.tsx' }]), read).exit === EXIT.FAIL },
    { name: '★目印が1つも無い機能は赤（何も確かめていないのに緑にしない）', ok: async () => checkAnchors(reg([]), read).exit === EXIT.FAIL },
    { name: '★一覧が空なら緑にしない（測れなかった）', ok: async () => checkAnchors({ features: [] }, read).exit === EXIT.INCONCLUSIVE },
    {
      name: '★本番でページが 404 なら赤 / 文字が無ければ赤 / 両方そろえば緑',
      ok: async () => {
        const r = { features: [{ name: '検索', anchors: [], smoke: [{ path: '/search', contains: '検索' }] }] };
        const a = await checkSmoke(r, 'https://x.test', fake({}));
        const b = await checkSmoke(r, 'https://x.test', fake({ 'https://x.test/search': { status: 200, text: 'ほか' } }));
        const c = await checkSmoke(r, 'https://x.test', fake({ 'https://x.test/search': { status: 200, text: '検索する' } }));
        return a.exit === EXIT.FAIL && b.exit === EXIT.FAIL && c.exit === EXIT.PASS;
      },
    },
  ];
  const failed = [];
  for (const c of cases) { try { if (!(await c.ok())) failed.push(c.name); } catch { failed.push(c.name); } }
  if (failed.length) {
    console.error('[check-features-alive] ★selftest 失敗（検知器が効いていません）:');
    for (const f of failed) console.error(`  - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log(`[check-features-alive] ✅ selftest 合格（${cases.length}件: 目印・ファイル・ページが消えたら赤 / 一覧が空なら緑にしない）`);
  process.exit(EXIT.PASS);
}

// ── 実行 ──────────────────────────────────────────────────────────────────

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) await runSelftest();
  const si = argv.indexOf('--smoke');
  const smokeUrl = si >= 0 ? argv[si + 1] : undefined;
  const root = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--smoke') || '.';
  const p = join(root, 'features.json');
  if (!existsSync(p)) {
    console.error('[check-features-alive] 🟡 測れませんでした: features.json が無い。');
    console.error('  ★このサービスで「動いていなければ困る機能」（ログイン・検索・設定など）を一覧にして置く。');
    console.error('  形と書き方: docs/ai-rules/11_NO_REGRESSION.md（web-ios-android）');
    process.exit(EXIT.INCONCLUSIVE);
  }
  let registry;
  try { registry = JSON.parse(readFileSync(p, 'utf8')); } catch (e) {
    console.error(`[check-features-alive] 🟡 測れませんでした: features.json が読めない（${e.message}）`);
    process.exit(EXIT.INCONCLUSIVE);
  }
  const read = (f) => { const fp = join(root, f); return f && existsSync(fp) ? readFileSync(fp, 'utf8') : null; };
  const a = checkAnchors(registry, read);
  let exit = a.exit;
  const missing = [...a.missing];
  let smokeChecked = 0;
  if (smokeUrl) {
    const s = await checkSmoke(registry, smokeUrl, async (url) => {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
      return { status: res.status, text: await res.text() };
    });
    smokeChecked = s.checked;
    missing.push(...s.missing);
    if (s.exit === EXIT.FAIL) exit = EXIT.FAIL;
  }
  const n = (registry.features || []).length;
  if (exit === EXIT.PASS) {
    console.log(`[check-features-alive] ✅ 機能 ${n} 件の目印 ${a.checked} 個がすべて残っています${smokeUrl ? `／本番 ${smokeChecked} ページも開けました` : ''}`);
  } else if (exit === EXIT.FAIL) {
    console.error(`[check-features-alive] ❌ 消えた・開けない機能があります（${missing.length} 件）:`);
    for (const m of missing) console.error(`  - ${m}`);
    console.error('  ★直す前の状態に戻すか、本当に消す機能なら features.json から外して PR 本文に「消してよい: 機能名（理由）」を書く。');
  } else {
    console.error(`[check-features-alive] 🟡 測れませんでした: ${a.reason}`);
  }
  process.exit(exit);
}
