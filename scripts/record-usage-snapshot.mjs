#!/usr/bin/env node
// 役割: Claude の使用量(get_usage の出力)を、専用ブランチ usage-data の usage.json へ畳み込んで保存する。
// なぜ要るか: kimito-skill.link/hub/usage/ のダッシュボードは、このファイルを読んで「どれだけ減っているか・いつ回復するか」を描く。
//   ページを作り直して再デプロイしなくても、データだけを更新できるようにするため、データはサイトとは別の場所(専用ブランチ)に置く。
//   main を汚さない・履歴はコミットとして残る。リポは公開なので、載せるのは使用量の割合と回復時刻だけ(鍵・会話内容は載せない)。
// 使い方:
//   get_usage の出力JSONを標準入力に渡す:  node scripts/record-usage-snapshot.mjs < usage.json
//   初回(専用ブランチが無いとき):           node scripts/record-usage-snapshot.mjs --init
//   書き込まずに結果だけ見る:               node scripts/record-usage-snapshot.mjs --dry-run < usage.json
// 前提: gh がログイン済み(このリポへ書ける)。判定の中身は site/hub/usage/usage-history.mjs(純関数・テスト付き)。
import { execFileSync } from 'node:child_process';
import { mergeSnapshot, normalizeUsage } from '../site/hub/usage/usage-history.mjs';

const REPO = process.env.USAGE_REPO || 'kimito-link/web-ios-android';
const BRANCH = 'usage-data';
const FILE = 'usage.json';

const gh = (args, input) =>
  execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });

function readExisting() {
  try {
    const r = JSON.parse(gh(['api', `repos/${REPO}/contents/${FILE}?ref=${BRANCH}`]));
    return { sha: r.sha, json: JSON.parse(Buffer.from(r.content, 'base64').toString('utf8')) };
  } catch (e) {
    if (/404|Not Found/.test(String(e.stderr || e.message))) return null;
    throw e;
  }
}

// 親を持たないブランチ(orphan)を API だけで作る。main の中身を引きずらない。
function initBranch() {
  try {
    gh(['api', `repos/${REPO}/git/ref/heads/${BRANCH}`]);
    console.log(`${BRANCH} は既にある`);
    return;
  } catch { /* 無ければ作る */ }
  const blob = JSON.parse(gh(['api', '-X', 'POST', `repos/${REPO}/git/blobs`, '-f', 'content={}', '-f', 'encoding=utf-8']));
  const tree = JSON.parse(gh(['api', '-X', 'POST', `repos/${REPO}/git/trees`, '--input', '-'], JSON.stringify({ tree: [{ path: FILE, mode: '100644', type: 'blob', sha: blob.sha }] })));
  const commit = JSON.parse(gh(['api', '-X', 'POST', `repos/${REPO}/git/commits`, '--input', '-'], JSON.stringify({ message: 'init usage-data', tree: tree.sha, parents: [] })));
  gh(['api', '-X', 'POST', `repos/${REPO}/git/refs`, '-f', `ref=refs/heads/${BRANCH}`, '-f', `sha=${commit.sha}`]);
  console.log(`${BRANCH} を作った(${commit.sha.slice(0, 7)})`);
}

async function main() {
  if (process.argv.includes('--init')) return initBranch();
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const snap = normalizeUsage(raw);
  if (!snap) throw new Error('使用量を読めない状態(plan.status が ok ではない)。保存しない');
  const existing = readExisting();
  const merged = mergeSnapshot(existing?.json && existing.json.history ? existing.json : null, snap, Date.now());
  const body = JSON.stringify(merged);
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ points: merged.history.length, current: merged.current.windows, updatedAt: merged.updatedAt }));
    return;
  }
  if (!existing) initBranch();
  const sha = readExisting()?.sha;
  const args = ['api', '-X', 'PUT', `repos/${REPO}/contents/${FILE}`, '-f', `message=usage snapshot ${merged.updatedAt}`, '-f', `branch=${BRANCH}`, '-f', `content=${Buffer.from(body).toString('base64')}`];
  if (sha) args.push('-f', `sha=${sha}`);
  gh(args);
  console.log(`保存した: 履歴 ${merged.history.length} 点 / 更新 ${merged.updatedAt}`);
}

main().catch((e) => {
  console.error(`record-usage-snapshot FATAL: ${String(e.message).split('\n')[0]}`);
  process.exit(1);
});
