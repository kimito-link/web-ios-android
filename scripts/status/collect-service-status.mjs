#!/usr/bin/env node
/**
 * collect-service-status.mjs
 *
 * 「LINEハーネスの複数アカウント生死監視」と同じ発想を、GitHub Actions・Vercel・
 * Cloudflare・Stripe・App Store Connect・Google Play・X・YouTubeへ適用する。
 *
 * ★型（line-bot/docs/wiki/18-Multi-Account-and-BAN.mdより一般化）:
 *   「軽量な確認エンドポイントを叩く」→「レスポンスを normal/warning/danger の
 *   3段階に写像する」→「スナップショットJSONへ書く」。DB常駐・cronは作らない
 *   （売上ダッシュボードと同じくローカル手動実行＋スナップショット方式）。
 *
 * ★Stripe/App Store Connect/Google Play/X/YouTubeは新規API呼び出しをしない。
 *   既存の収集関数(collect-revenue-snapshot.mjs・social-followers.mjs)の
 *   戻り値(ok/error)をそのままnormal/dangerへ写像するだけ(車輪の再発明をしない)。
 *   新規に叩くのはGitHub Actions・Vercel・Cloudflareの3つだけ。
 *
 * 3値exit(instrument-core.mjs規約): 0=全サービスnormal / 1=いずれかdanger / 2=測れない。
 *
 * Usage:
 *   node scripts/status/collect-service-status.mjs           # 通常収集
 *   node scripts/status/collect-service-status.mjs --check   # 認証確認のみ(GitHub/Cloudflareのみ実行)
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, computeExitCode, formatProbeReport } from '../lib/instrument-core.mjs';
import { findRepoRoot } from '../lib/repo-root.mjs';
import { loadProductMap } from '../revenue/lib/product-map.mjs';
import { collectStripeRevenue } from '../revenue/lib/stripe-revenue.mjs';
import { fetchXFollowers, fetchYouTubeSubscribers } from '../revenue/lib/social-followers.mjs';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = resolve(HERE, '..', '..');
const GITHUB_ROOT = resolve(KIT_ROOT, '..');

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');

const SNAPSHOT_PATH = join(KIT_ROOT, '.service-status-snapshot.json');

function nowIso() {
  return new Date().toISOString();
}

/**
 * GitHub Actions: 対象リポジトリの直近workflow実行のconclusionを見る。
 * 失敗(failure/timed_out/cancelled)が1件でもあればdanger、全successならnormal。
 */
async function checkGithubActions(owner, repo) {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['api', `repos/${owner}/${repo}/actions/runs?per_page=5`, '--jq', '.workflow_runs'],
      { maxBuffer: 20 * 1024 * 1024, windowsHide: true }
    );
    const runs = JSON.parse(stdout);
    if (!Array.isArray(runs)) return { status: 'unmeasured', detail: 'workflow_runsが配列ではありません' };
    if (runs.length === 0) return { status: 'normal', detail: '実行履歴なし' };
    const failed = runs.filter((r) => ['failure', 'timed_out', 'cancelled'].includes(r.conclusion));
    if (failed.length > 0) {
      return { status: 'danger', detail: `直近${runs.length}件中${failed.length}件失敗（最新: ${failed[0].name}）` };
    }
    return { status: 'normal', detail: `直近${runs.length}件すべて成功` };
  } catch (e) {
    return { status: 'unmeasured', detail: String(e?.stderr || e?.message || e) };
  }
}

/** Vercel: 直近デプロイのstateを見る。READY以外(ERROR等)があればdanger。 */
async function checkVercel(token, projectName) {
  const apiToken = token || process.env.VERCEL_TOKEN;
  if (!apiToken) return { status: 'unmeasured', detail: 'VERCEL_TOKEN 未設定' };
  try {
    const url = new URL('https://api.vercel.com/v6/deployments');
    url.searchParams.set('projectId', projectName);
    url.searchParams.set('limit', '3');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiToken}` } });
    const text = await res.text();
    if (!res.ok) return { status: 'unmeasured', detail: `${res.status}: ${text.slice(0, 200)}` };
    const j = JSON.parse(text);
    const deployments = j.deployments || [];
    if (deployments.length === 0) return { status: 'normal', detail: 'デプロイ履歴なし' };
    const latest = deployments[0];
    if (latest.state === 'ERROR') return { status: 'danger', detail: `最新デプロイがERROR（${latest.url}）` };
    if (latest.state !== 'READY') return { status: 'warning', detail: `最新デプロイが${latest.state}` };
    return { status: 'normal', detail: '最新デプロイREADY' };
  } catch (e) {
    return { status: 'unmeasured', detail: String(e?.message || e) };
  }
}

/** Cloudflare: ゾーンのstatusを見る。activeでなければwarning。 */
async function checkCloudflareZone(token, zoneName) {
  const apiToken = token || process.env.CLOUDFLARE_API_TOKEN;
  if (!apiToken) return { status: 'unmeasured', detail: 'CLOUDFLARE_API_TOKEN 未設定' };
  try {
    const url = new URL('https://api.cloudflare.com/client/v4/zones');
    url.searchParams.set('name', zoneName);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiToken}` } });
    const text = await res.text();
    if (!res.ok) return { status: 'unmeasured', detail: `${res.status}: ${text.slice(0, 200)}` };
    const j = JSON.parse(text);
    if (!j.success) return { status: 'unmeasured', detail: JSON.stringify(j.errors).slice(0, 200) };
    const zone = (j.result || [])[0];
    if (!zone) return { status: 'unmeasured', detail: `ゾーンが見つかりません: ${zoneName}` };
    if (zone.status !== 'active') return { status: 'warning', detail: `ゾーンstatus=${zone.status}` };
    return { status: 'normal', detail: 'active' };
  } catch (e) {
    return { status: 'unmeasured', detail: String(e?.message || e) };
  }
}

/** Stripe: 既存の売上収集関数の成否をそのまま生死確認に転用する(新規API呼び出しなし)。 */
async function checkStripeHealth() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { status: 'unmeasured', detail: 'STRIPE_SECRET_KEY 未設定' };
  const result = await collectStripeRevenue(key, { days: 1 });
  if (!result.ok) return { status: 'danger', detail: result.error };
  return { status: 'normal', detail: 'API疎通OK' };
}

/** X/YouTube: 既存のフォロワー取得関数の成否を写像する(新規API呼び出しなし)。 */
async function checkSocialHealth(products) {
  const results = [];
  for (const p of products) {
    const x = await fetchXFollowers(p.id);
    const yt = await fetchYouTubeSubscribers(p.id);
    if (x && !x.ok) results.push({ id: `x:${p.id}`, status: 'danger', detail: x.error });
    if (yt && !yt.ok) results.push({ id: `youtube:${p.id}`, status: 'danger', detail: yt.error });
  }
  return results;
}

async function main() {
  if (!existsSync(join(GITHUB_ROOT, 'best-trust'))) {
    console.error('best-trust リポジトリが見つかりません（github/直下で実行してください）');
    process.exit(EXIT.INCONCLUSIVE);
  }

  const products = loadProductMap(GITHUB_ROOT);
  const services = {};

  // --- GitHub Actions: プロダクトごとのリポジトリ ---
  const githubStatuses = [];
  for (const p of products) {
    if (!p.localPath) continue;
    // localPath配下の.gitからowner/repoを推定する代わりに、gh CLIの-R引数用に
    // best-trust台帳のgithub.urlを使う方が正確だが、product-mapは持たないため
    // ここではlocalPathをそのままリポジトリ名とみなす（kimito-link organization前提）。
    const owner = 'kimito-link';
    const repo = p.localPath;
    const r = await checkGithubActions(owner, repo);
    githubStatuses.push({ id: p.id, repo, ...r });
    if (checkOnly) break; // --checkは疎通確認のみ、1件で十分
  }
  services.github = githubStatuses;

  // --- Vercel ---
  const vercelStatuses = [];
  if (!checkOnly) {
    for (const p of products) {
      const r = await checkVercel(null, p.id);
      if (r.status !== 'unmeasured') vercelStatuses.push({ id: p.id, ...r });
    }
  }
  services.vercel = vercelStatuses;

  // --- Cloudflare (ドメインがあるプロダクトのみ、簡易的にurlのホスト名を使う) ---
  const cloudflareStatuses = [];
  if (!checkOnly) {
    for (const p of products) {
      if (!p.url) continue;
      try {
        const host = new URL(p.url).hostname;
        const r = await checkCloudflareZone(null, host);
        if (r.status !== 'unmeasured') cloudflareStatuses.push({ id: p.id, host, ...r });
      } catch {
        // URLが不正なプロダクトはスキップ(fail-closedにせず単に対象外にする)
      }
    }
  }
  services.cloudflare = cloudflareStatuses;

  // --- Stripe ---
  services.stripe = await checkStripeHealth();

  // --- Social (X/YouTube) ---
  services.social = checkOnly ? [] : await checkSocialHealth(products);

  const snapshot = {
    generatedAt: nowIso(),
    services,
  };

  if (!checkOnly) {
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
  }

  // --- 判定結果を表示 ---
  const results = [];
  const githubDanger = githubStatuses.filter((s) => s.status === 'danger');
  results.push({
    probe: 'GitHub Actions',
    verdict: githubStatuses.length === 0 ? 'inconclusive' : (githubDanger.length > 0 ? 'fail' : 'pass'),
    detail: githubDanger.map((s) => `${s.repo}: ${s.detail}`).join(' / '),
    evidence: githubStatuses.length > 0 ? { checked: githubStatuses.length } : null,
  });
  if (!checkOnly) {
    const vercelDanger = vercelStatuses.filter((s) => s.status === 'danger');
    results.push({
      probe: 'Vercel デプロイ',
      verdict: vercelStatuses.length === 0 ? 'inconclusive' : (vercelDanger.length > 0 ? 'fail' : 'pass'),
      detail: vercelDanger.map((s) => `${s.id}: ${s.detail}`).join(' / '),
      evidence: vercelStatuses.length > 0 ? { checked: vercelStatuses.length } : null,
    });
    const cfWarning = cloudflareStatuses.filter((s) => s.status !== 'normal');
    results.push({
      probe: 'Cloudflare ゾーン',
      verdict: cloudflareStatuses.length === 0 ? 'inconclusive' : (cfWarning.length > 0 ? 'fail' : 'pass'),
      detail: cfWarning.map((s) => `${s.host}: ${s.detail}`).join(' / '),
      evidence: cloudflareStatuses.length > 0 ? { checked: cloudflareStatuses.length } : null,
    });
  }
  results.push({
    probe: 'Stripe API疎通',
    verdict: services.stripe.status === 'unmeasured' ? 'inconclusive' : (services.stripe.status === 'danger' ? 'fail' : 'pass'),
    detail: services.stripe.detail,
    evidence: services.stripe.status === 'normal' ? { ok: true } : null,
  });

  console.log(formatProbeReport(results, { label: checkOnly ? 'status:check' : 'status:collect' }));
  if (!checkOnly) console.log(`\n書き込み: ${SNAPSHOT_PATH}`);
  process.exit(computeExitCode(results));
}

main().catch((e) => {
  console.error(`予期しないエラー: ${e?.stack || e}`);
  process.exit(EXIT.INCONCLUSIVE);
});
