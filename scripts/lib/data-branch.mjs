// 役割: 専用ブランチ(usage-data)のファイルを gh api で読み書きする小さな部品。
// なぜ要るか: 使用量(usage.json)と頭脳の状況(brains.json)の2つの記録スクリプトが、同じ保存先・同じ手順を使うため。
//   データはサイト本体とは別の親なしブランチに置く。ページを作り直して再デプロイしなくても更新でき、main を汚さない。
//   リポは公開なので、置くのは割合・残量・状態だけ(鍵・会話内容は置かない)。
// 使い方: readFile(name) → {sha, json}|null / writeFile(name, obj, message) / initBranch()。gh がログイン済みで、このリポへ書けること。
import { execFileSync } from 'node:child_process';

const REPO = process.env.USAGE_REPO || 'kimito-link/web-ios-android';
export const BRANCH = 'usage-data';

const gh = (args, input) =>
  execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });

export function readFile(name) {
  try {
    const r = JSON.parse(gh(['api', `repos/${REPO}/contents/${name}?ref=${BRANCH}`]));
    return { sha: r.sha, json: JSON.parse(Buffer.from(r.content, 'base64').toString('utf8')) };
  } catch (e) {
    if (/404|Not Found/.test(String(e.stderr || e.message))) return null;
    throw e;
  }
}

// 親を持たないブランチ(orphan)を API だけで作る。main の中身を引きずらない。
export function initBranch() {
  try {
    gh(['api', `repos/${REPO}/git/ref/heads/${BRANCH}`]);
    return false;
  } catch { /* 無ければ作る */ }
  const blob = JSON.parse(gh(['api', '-X', 'POST', `repos/${REPO}/git/blobs`, '-f', 'content={}', '-f', 'encoding=utf-8']));
  const tree = JSON.parse(gh(['api', '-X', 'POST', `repos/${REPO}/git/trees`, '--input', '-'], JSON.stringify({ tree: [{ path: 'usage.json', mode: '100644', type: 'blob', sha: blob.sha }] })));
  const commit = JSON.parse(gh(['api', '-X', 'POST', `repos/${REPO}/git/commits`, '--input', '-'], JSON.stringify({ message: 'init usage-data', tree: tree.sha, parents: [] })));
  gh(['api', '-X', 'POST', `repos/${REPO}/git/refs`, '-f', `ref=refs/heads/${BRANCH}`, '-f', `sha=${commit.sha}`]);
  return true;
}

export function writeFile(name, obj, message) {
  const existing = readFile(name);
  const args = ['api', '-X', 'PUT', `repos/${REPO}/contents/${name}`, '-f', `message=${message}`, '-f', `branch=${BRANCH}`, '-f', `content=${Buffer.from(JSON.stringify(obj)).toString('base64')}`];
  if (existing?.sha) args.push('-f', `sha=${existing.sha}`);
  gh(args);
}
