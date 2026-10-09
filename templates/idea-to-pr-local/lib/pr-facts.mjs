// @ts-check
/**
 * pr-facts.mjs — PR とそのチェック結果を GitHub から取ってくる部分（worker.mjs と verify-pr.mjs が共有）。
 *
 * ■ なぜ別ファイルか
 *   「Issue 番号から PR を探し、チェック結果を集める」を worker と verify-pr の両方に書くと、
 *   片方だけ直して判定が食い違う（片方は成功・片方は未確認、のように）。取得はここに1つだけ置き、
 *   判定は pipeline-core.mjs の computeVerdict に1つだけ置く。
 *
 * ghJson は「gh の引数配列を受け取り、JSON を返す（失敗したら例外）」関数。実物の gh でも偽物でも差し替えられる。
 */
import { branchNameFor } from './pipeline-core.mjs';

/**
 * Issue 番号から、ワーカーが作ったブランチ（ai/issue-N）の PR 番号を探す。無ければ null。
 * @param {(args:string[])=>any} ghJson
 * @param {string} repo owner/name
 * @param {number} issueNumber
 * @returns {number|null}
 */
export function findPrNumberForIssue(ghJson, repo, issueNumber) {
  const branch = branchNameFor(issueNumber);
  const owner = repo.split('/')[0];
  const prs = ghJson(['api', `repos/${repo}/pulls?head=${encodeURIComponent(owner + ':' + branch)}&state=all&per_page=5`]);
  return Array.isArray(prs) && prs.length > 0 && Number.isInteger(prs[0].number) ? prs[0].number : null;
}

/**
 * PR とチェック結果の「事実」を取る。
 * @param {(args:string[])=>any} ghJson
 * @param {string} repo
 * @param {number} prNumber
 * @returns {{pr:any, headSha:string|null, checkRuns:any[], status:any}}
 */
export function fetchPrFacts(ghJson, repo, prNumber) {
  const pr = ghJson(['api', `repos/${repo}/pulls/${prNumber}`]);
  const headSha = pr && pr.head && typeof pr.head.sha === 'string' ? pr.head.sha : null;
  if (!headSha) return { pr, headSha: null, checkRuns: [], status: null };
  const runs = ghJson(['api', `repos/${repo}/commits/${headSha}/check-runs?per_page=100`]);
  const status = ghJson(['api', `repos/${repo}/commits/${headSha}/status`]);
  return { pr, headSha, checkRuns: runs && Array.isArray(runs.check_runs) ? runs.check_runs : [], status };
}
