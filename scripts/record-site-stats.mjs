#!/usr/bin/env node
// 役割: トップページ(kimito-skill.link)に出す「実測の証拠」を集めて、専用ブランチ usage-data の stats.json へ保存する。
// なぜ要るか: このキットの売りは「自動化が本当に動いている」こと。文章の主張ではなく、いま計った数字で見せる。
//   公開アプリの一覧(showcase.json)は手で書く正本で、状態・名前が古くなる(2026-10-19: 改名した旧名・旧説明のまま)。
//   公開状態と最終更新は App Store の公開 API で、稼働は実際にアクセスして、毎回計り直す。
// 何を集めるか(どれも公開情報か、公開リポの数字。鍵・会話・売上は扱わない):
//   ・公開アプリ: App Store の最新版・最終更新日(iTunes 公開API)と、サイトの稼働(HTTP応答・ミリ秒)
//   ・今週の開発: 取り込まれた PR の数、検査(CI verify)の緑の割合、自動検査・警備(hook)の本数
//   ・今週の頭脳: 無料・ローカルの頭脳が完了した作業の数(dispatch の実行ログ。成功したものだけ数える)
// 使い方: node scripts/record-site-stats.mjs [--dry-run]。gh がログイン済みで、このリポへ書けること。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initBranch, writeFile } from './lib/data-branch.mjs';
import { readDispatchConfig, readRunLogs } from './lib/dispatch-runs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.USAGE_REPO || 'kimito-link/web-ios-android';
const DAY = 86400000;
const sinceMs = Date.now() - 7 * DAY;
const sinceDate = new Date(sinceMs).toISOString().slice(0, 10);

const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 }));
const safe = async (fn, fallback = null) => { try { return await fn(); } catch { return fallback; } };

// ---- 公開アプリ ---------------------------------------------------------------------------------
async function appsStatus() {
  const showcase = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/assets/data/showcase.json'), 'utf8'));
  const rows = await Promise.all((showcase.apps || []).filter((a) => a.status === 'live').map(async (a) => {
    const id = /id(\d+)/.exec(a.iosUrl || '')?.[1];
    const store = id ? await safe(async () => {
      const r = await fetch(`https://itunes.apple.com/lookup?id=${id}&country=jp`, { signal: AbortSignal.timeout(15000) });
      const x = (await r.json()).results?.[0];
      return x ? { version: x.version, updatedAt: x.currentVersionReleaseDate } : null;
    }) : null;
    const t0 = Date.now();
    const web = a.webUrl ? await safe(async () => {
      const r = await fetch(a.webUrl, { redirect: 'follow', signal: AbortSignal.timeout(12000) });
      return { ok: r.status < 400, status: r.status, ms: Date.now() - t0 };
    }, { ok: false, status: 0, ms: null }) : null;
    return { id: a.id, name: a.name, store, web };
  }));
  return rows;
}

// ---- 今週の開発(公開リポの数字) ---------------------------------------------------------------
async function devStats() {
  const merged = await safe(() => gh(['api', '-X', 'GET', 'search/issues', '-f', `q=repo:${REPO} is:pr is:merged merged:>=${sinceDate}`, '-f', 'per_page=1']).total_count);
  const runs = await safe(() => {
    const wf = gh(['api', `repos/${REPO}/actions/workflows`]).workflows.find((w) => /^verify/.test(w.name));
    if (!wf) return null;
    const r = gh(['api', '-X', 'GET', `repos/${REPO}/actions/workflows/${wf.id}/runs`, '-f', `created=>=${sinceDate}`, '-f', 'per_page=100']).workflow_runs.filter((x) => x.status === 'completed');
    const ok = r.filter((x) => x.conclusion === 'success').length;
    return { total: r.length, ok };
  });
  const count = (dir, re) => { try { return fs.readdirSync(path.join(ROOT, dir)).filter((f) => re.test(f)).length; } catch { return 0; } };
  return {
    mergedPrs: merged,
    ci: runs,
    checks: count('templates/diagnostics', /^check-.*\.mjs$/) + count('templates/scripts', /^(check|verify)-.*\.mjs$/),
    guards: count('.claude/hooks', /\.mjs$/) - count('.claude/hooks', /\.test\.mjs$/),
  };
}

// ---- 今週の頭脳(無料・ローカルが完了した作業) -------------------------------------------------
function brainWork() {
  const cfg = readDispatchConfig();
  const runs = readRunLogs({ failMarks: cfg.FAIL_MARKS, perBrain: 500, maxFiles: 2000, sinceMs });
  const FREE = new Set(['qwen', 'oc', 'cf', 'muse', 'nvidia', 'mistral', 'gemini', 'groq', 'local']);
  let done = 0, tried = 0;
  const byBrain = {};
  for (const [brain, list] of Object.entries(runs)) {
    const ok = list.filter((x) => x.ok).length;
    byBrain[brain] = { done: ok, tried: list.length };
    if (FREE.has(brain)) { done += ok; tried += list.length; }
  }
  return { freeDone: done, freeTried: tried, byBrain };
}

async function main() {
  const [apps, dev] = await Promise.all([appsStatus(), devStats()]);
  const stats = { updatedAt: new Date().toISOString(), sinceDate, apps, dev, brainWork: brainWork() };
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify(stats, null, 1));
    return;
  }
  initBranch();
  writeFile('stats.json', stats, `site stats ${stats.updatedAt}`);
  console.log(`保存した: 公開アプリ ${apps.length} 件 / 今週の PR ${dev.mergedPrs} 件 / 無料・ローカルが完了した作業 ${stats.brainWork.freeDone} 件`);
}

main().catch((e) => {
  console.error(`record-site-stats FATAL: ${String(e.message).split('\n')[0]}`);
  process.exit(1);
});
