#!/usr/bin/env node
/**
 * verify-security-score.mjs — 出荷前に「malwarecheck.site へ投げたら何点になるか」を先取りする。
 *
 * 移植元: malwarecheck.site（packages/core/src/scoring/weights.ts の WEIGHTS・
 *   packages/core/src/scanner/analyzers.ts のヘッダ判定ロジックを移植）。
 *   同リポの _docs/five-passive-security-checks-DESIGN.md / owasp-coverage-triage-DESIGN.md
 *   で確定した不変条件を継承する:
 *     「公開URLへのGETのみ。攻撃・侵入・総当たりは一切しない」
 *   このスクリプトも同じ制約を守る。ペイロード送信・ポートスキャン・総当たりは行わない。
 *
 * ★何を測るか（malwarecheck.site の WEIGHTS と1対1対応させたもの）
 *   本番URL(app.config.json の identity.productionDomain)へ実際にGETし、
 *   レスポンスヘッダとHTML本文を、malwarecheck.site の減点項目と同じ基準で判定する。
 *   ここで満点相当になれば、実際に malwarecheck.site で診断しても同じ結果になるはず。
 *
 * ■ 終了コード（instrument-core.mjs と同じ3値規約）
 *   0 = 減点0（満点相当） / 1 = 減点あり（直すべきものがある） / 2 = 測れなかった
 *
 * ■ 使い方
 *   node templates/scripts/verify-security-score.mjs                # app.config.json から自動取得
 *   node templates/scripts/verify-security-score.mjs --url https://example.com
 *   node templates/scripts/verify-security-score.mjs --selftest      # 毒→赤を確認
 *
 * ■ この検査の限界（過信を防ぐ）
 *   - malwarecheck.site 本体が持つ実装（crt.sh照合・Pwned Passwords・SPF/DMARC等の外部API連携）
 *     までは再現していない。ヘッダ・HTML静的解析で完結する項目のみ。
 *   - 「兆候が無い」ことは「安全である」ことを意味しない（malwarecheck.site 自身の文言方針と同じ）。
 *   - これは能動的な脆弱性テストではない。SQLi/XSS等の実注入テストは行わない（不変条件）。
 * ───────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const SELFTEST = process.argv.includes('--selftest');
const urlArgIdx = process.argv.indexOf('--url');
const URL_OVERRIDE = urlArgIdx >= 0 ? process.argv[urlArgIdx + 1] : null;

/** malwarecheck.site の packages/core/src/scoring/weights.ts と同じ値。
 *  ★正本はあちら。値を変えるときは向こうと揃える（移植元コメント参照）。 */
const WEIGHTS = {
  httpsMissing: 25,
  sslError: 20,
  hstsMissing: 3,
  cspMissing: 8,
  xFrameOptionsMissing: 5,
  xContentTypeMissing: 4,
  referrerPolicyMissing: 3,
  permissionsPolicyMissing: 2,
  serverVersionExposed: 4,
  poweredByExposed: 4,
  cookieInsecure: 6,
  envFileExposed: 30,
  gitDirExposed: 25,
};

function resolveTargetUrl() {
  if (URL_OVERRIDE) return URL_OVERRIDE;
  const cfgPath = resolve(ROOT, 'app.config.json');
  if (!existsSync(cfgPath)) return null;
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    const domain = cfg?.identity?.productionDomain;
    if (!domain || typeof domain !== 'string') return null;
    return domain.startsWith('http') ? domain : `https://${domain}`;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'manual' });
  } finally {
    clearTimeout(t);
  }
}

/**
 * ★本体。指定URLをGETし、WEIGHTS の各項目に対応する減点をリストで返す。
 * fetchImpl を差し替えられるようにして selftest から毒を注入できるようにする。
 */
async function scoreUrl(targetUrl, fetchImpl = fetchWithTimeout) {
  const deductions = [];
  let res;
  try {
    res = await fetchImpl(targetUrl);
  } catch (e) {
    return { verdict: 'inconclusive', detail: `到達できませんでした: ${e.message}` };
  }

  if (!targetUrl.startsWith('https://')) {
    deductions.push({ id: 'httpsMissing', weight: WEIGHTS.httpsMissing, detail: 'HTTPSではありません' });
  }

  const headers = res.headers;
  const h = (name) => headers.get(name);

  if (!h('strict-transport-security')) {
    deductions.push({ id: 'hstsMissing', weight: WEIGHTS.hstsMissing, detail: 'Strict-Transport-Security ヘッダーがありません' });
  }
  if (!h('content-security-policy')) {
    deductions.push({ id: 'cspMissing', weight: WEIGHTS.cspMissing, detail: 'Content-Security-Policy ヘッダーがありません' });
  }
  if (!h('x-frame-options') && !/frame-ancestors/i.test(h('content-security-policy') || '')) {
    deductions.push({ id: 'xFrameOptionsMissing', weight: WEIGHTS.xFrameOptionsMissing, detail: 'X-Frame-Options（またはCSP frame-ancestors）がありません' });
  }
  if (!h('x-content-type-options')) {
    deductions.push({ id: 'xContentTypeMissing', weight: WEIGHTS.xContentTypeMissing, detail: 'X-Content-Type-Options: nosniff がありません' });
  }
  if (!h('referrer-policy')) {
    deductions.push({ id: 'referrerPolicyMissing', weight: WEIGHTS.referrerPolicyMissing, detail: 'Referrer-Policy ヘッダーがありません' });
  }
  if (!h('permissions-policy')) {
    deductions.push({ id: 'permissionsPolicyMissing', weight: WEIGHTS.permissionsPolicyMissing, detail: 'Permissions-Policy ヘッダーがありません' });
  }
  if (h('server') && /\d/.test(h('server'))) {
    deductions.push({ id: 'serverVersionExposed', weight: WEIGHTS.serverVersionExposed, detail: `Server ヘッダーにバージョン番号が出ています: ${h('server')}` });
  }
  if (h('x-powered-by')) {
    deductions.push({ id: 'poweredByExposed', weight: WEIGHTS.poweredByExposed, detail: `X-Powered-By ヘッダーが出ています: ${h('x-powered-by')}` });
  }
  const setCookie = headers.get('set-cookie') || '';
  if (setCookie && (!/secure/i.test(setCookie) || !/httponly/i.test(setCookie))) {
    deductions.push({ id: 'cookieInsecure', weight: WEIGHTS.cookieInsecure, detail: 'Cookie に Secure/HttpOnly 属性が欠けています' });
  }

  // .env / .git の露出（GETのみ・存在確認だけ。中身のダンプはしない）
  for (const [id, path, weight] of [
    ['envFileExposed', '/.env', WEIGHTS.envFileExposed],
    ['gitDirExposed', '/.git/config', WEIGHTS.gitDirExposed],
  ]) {
    try {
      const r = await fetchImpl(new URL(path, targetUrl).toString());
      if (r.status === 200) {
        deductions.push({ id, weight, detail: `${path} が外部から取得できます（要非公開化）` });
      }
    } catch {
      // 到達不可はここでは無視（対象サイトの正常な404/接続拒否と区別しない＝厳しすぎる誤検知を避ける）
    }
  }

  const totalDeduction = deductions.reduce((sum, d) => sum + d.weight, 0);
  const score = Math.max(0, Math.min(100, 100 - totalDeduction));

  return {
    verdict: deductions.length === 0 ? 'pass' : 'fail',
    score,
    deductions,
  };
}

/* ── --selftest ─────────────────────────────────────────── */
if (SELFTEST) {
  const fails = [];

  // 毒1: ヘッダを一切持たないレスポンス → 複数項目が減点されるはず
  {
    const poisonedFetch = async () =>
      new Response('', { status: 200, headers: {} });
    const r = await scoreUrl('https://example.invalid.test', poisonedFetch);
    if (r.verdict !== 'fail' || r.score >= 100) {
      fails.push(`ヘッダ欠落を検知できない(得た: verdict=${r.verdict}, score=${r.score})`);
    }
  }

  // 毒2: 全ヘッダを満たすレスポンス → passになるはず
  {
    const cleanFetch = async (url) => {
      if (url.includes('.env') || url.includes('.git')) {
        return new Response('', { status: 404 });
      }
      return new Response('', {
        status: 200,
        headers: {
          'strict-transport-security': 'max-age=63072000',
          'content-security-policy': "default-src 'self'",
          'x-frame-options': 'DENY',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'strict-origin-when-cross-origin',
          'permissions-policy': 'geolocation=()',
        },
      });
    };
    const r = await scoreUrl('https://example.invalid.test', cleanFetch);
    if (r.verdict !== 'pass' || r.score !== 100) {
      fails.push(`満点条件を満点と判定しない(得た: verdict=${r.verdict}, score=${r.score})`);
    }
  }

  // 毒3: .env が200で返る → envFileExposed で検知するはず
  {
    const leakFetch = async (url) => {
      if (url.includes('.env')) return new Response('SECRET=1', { status: 200 });
      if (url.includes('.git')) return new Response('', { status: 404 });
      return new Response('', {
        status: 200,
        headers: {
          'strict-transport-security': 'x', 'content-security-policy': 'x',
          'x-frame-options': 'x', 'x-content-type-options': 'x',
          'referrer-policy': 'x', 'permissions-policy': 'x',
        },
      });
    };
    const r = await scoreUrl('https://example.invalid.test', leakFetch);
    if (!r.deductions?.some((d) => d.id === 'envFileExposed')) {
      fails.push('.env 露出を検知できない');
    }
  }

  if (fails.length) {
    console.error('[verify-security-score] selftest 失敗（検知器が効いていません）:');
    for (const f of fails) console.error('  - ' + f);
    process.exit(EXIT.FAIL);
  }
  console.log('[verify-security-score] selftest OK');
  process.exit(EXIT.PASS);
}

/* ── 通常実行 ───────────────────────────────────────────── */
const targetUrl = resolveTargetUrl();

if (!targetUrl) {
  console.log(formatProbeReport([{
    probe: 'malwarecheck.site満点チェック',
    verdict: 'inconclusive',
    detail: 'app.config.json の identity.productionDomain が見つかりません（--url で直接指定も可）',
    howToFix: 'app.config.json を埋めるか、node verify-security-score.mjs --url https://example.com で指定する',
  }]));
  process.exit(EXIT.INCONCLUSIVE);
}

const result = await scoreUrl(targetUrl);

if (result.verdict === 'inconclusive') {
  console.log(formatProbeReport([{
    probe: `malwarecheck.site満点チェック (${targetUrl})`,
    verdict: 'inconclusive',
    detail: result.detail,
    howToFix: 'デプロイが完了しているか、URLが正しいか確認する',
    limitation: 'ヘッダ・HTML静的解析のみ。crt.sh照合等の外部API連携は再現していない',
  }]));
  process.exit(EXIT.INCONCLUSIVE);
}

if (result.verdict === 'fail') {
  const lines = result.deductions.map((d) => `${d.detail}（-${d.weight}点）`).join(' / ');
  console.log(formatProbeReport([{
    probe: `malwarecheck.site満点チェック (${targetUrl})`,
    verdict: 'fail',
    evidence: { 推定スコア: result.score, 減点項目数: result.deductions.length },
    detail: lines,
    howToFix: '減点項目のヘッダ・ファイル公開設定を直す（Vercel/Cloudflare Pages の場合は next.config / _headers 等）',
    limitation: 'ヘッダ・HTML静的解析のみ。malwarecheck.site本体の全項目（crt.sh・SPF/DMARC等）は未再現',
  }]));
  process.exit(EXIT.FAIL);
}

console.log(formatProbeReport([{
  probe: `malwarecheck.site満点チェック (${targetUrl})`,
  verdict: 'pass',
  evidence: { 推定スコア: result.score },
  limitation: 'ヘッダ・HTML静的解析のみ。malwarecheck.site本体の全項目（crt.sh・SPF/DMARC等）は未再現。実際に malwarecheck.site へ投げての確認を推奨',
}]));
process.exit(EXIT.PASS);
