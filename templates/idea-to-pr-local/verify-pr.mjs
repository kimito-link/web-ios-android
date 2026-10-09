#!/usr/bin/env node
// @ts-check
/**
 * verify-pr.mjs — 「この PR は成功と報告してよいか」を、GitHub の事実だけから機械的に答える。
 *
 * ■ 誰が使うか
 *   Grok など、結果を人に報告する側。報告の前に必ずこれ（または worker が Issue に書いた「機械確認」コメント）を見て、
 *   `statement` の文をそのまま使う。推測で「完了しました」と言わない。
 *
 * ■ 使い方（gh が認証済みであること。読み取りだけで、何も書き換えない）
 *   node verify-pr.mjs owner/repo --pr 12
 *   node verify-pr.mjs owner/repo --issue 7        # ワーカーが作った ai/issue-7 の PR を探す
 *
 * ■ 終了コード（3値。「測れなかった」を成功にしない）
 *   0 = チェックが全て成功と確かめられた（成功が1件以上・失敗なし・実行中なし）
 *   1 = チェックに失敗がある
 *   2 = 成功とは言えない（実行中／チェック0件／スキップだけ／PR が見つからない／取得に失敗）
 *
 * ■ ★判定しないこと
 *   PR の内容が正しいか。「チェックが通った」は「正しい」ではない。マージするかは人が決める。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeVerdict, redact } from './lib/pipeline-core.mjs';
import { fetchPrFacts, findPrNumberForIssue } from './lib/pr-facts.mjs';

/**
 * 人にそのまま言ってよい文を作る。「完了」とは言わない（マージは人が決める）。
 * @param {number} prNumber
 * @param {ReturnType<typeof computeVerdict>} v
 */
export function statementFor(prNumber, v) {
  const c = v.counts;
  const merged = v.merged ? 'マージ済み' : '未マージ（人のレビュー待ち）';
  switch (v.verdict) {
    case 'success':
      return `PR #${prNumber} のチェックは全て成功しました（成功 ${c.success}件・スキップ ${c.skipped}件）。${merged}。内容が正しいかは人の確認が必要です。`;
    case 'failure':
      return `PR #${prNumber} のチェックに失敗があります（失敗 ${c.failure}件）。${v.reasons.join('／')}。${merged}。`;
    case 'pending':
      return `PR #${prNumber} のチェックはまだ実行中です。結果は未確認です。`;
    case 'no_checks':
      return `PR #${prNumber} にはチェックが1件もありません。成功とは確認できていません（未確認）。`;
    case 'no_effective_checks':
      return `PR #${prNumber} のチェックは全てスキップされています。成功とは確認できていません（未確認）。`;
    default:
      return `PR #${prNumber} の状態を取得できませんでした（未確認）。`;
  }
}

/** @param {string[]} args */
function realGhJson(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} が失敗: ${redact(r.stderr || (r.error && r.error.message) || '').slice(0, 200)}`);
  return JSON.parse(r.stdout || 'null');
}

/**
 * @param {string} repo
 * @param {{pr?:number, issue?:number}} target
 * @param {(args:string[])=>any} ghJson
 * @param {number} nowMs
 */
export function verify(repo, target, ghJson, nowMs) {
  try {
    const prNumber = target.pr ?? (target.issue !== undefined ? findPrNumberForIssue(ghJson, repo, target.issue) : null);
    if (prNumber === null || prNumber === undefined) {
      return { exit: 2, out: { repo, verdict: 'unknown', canReportDone: false, statement: 'PR が見つかりません（未確認）。', checkedAt: new Date(nowMs).toISOString() } };
    }
    const f = fetchPrFacts(ghJson, repo, prNumber);
    const v = computeVerdict(f.pr ? { state: f.pr.state, merged: f.pr.merged === true, headSha: f.headSha || undefined } : null, f.checkRuns, f.status);
    const exit = v.verdict === 'success' ? 0 : v.verdict === 'failure' ? 1 : 2;
    return {
      exit,
      out: {
        repo,
        pr: prNumber,
        issue: target.issue,
        state: f.pr && f.pr.state,
        merged: v.merged,
        headSha: f.headSha,
        verdict: v.verdict,
        counts: v.counts,
        reasons: v.reasons,
        canReportDone: v.verdict === 'success',
        statement: statementFor(prNumber, v),
        checkedAt: new Date(nowMs).toISOString(),
      },
    };
  } catch (e) {
    return { exit: 2, out: { repo, verdict: 'unknown', canReportDone: false, statement: `取得に失敗しました（未確認）: ${redact(e instanceof Error ? e.message : String(e)).slice(0, 200)}`, checkedAt: new Date(nowMs).toISOString() } };
  }
}

function main() {
  const [repo, ...rest] = process.argv.slice(2);
  const val = (flag) => {
    const i = rest.indexOf(flag);
    return i >= 0 ? Number(rest[i + 1]) : undefined;
  };
  const pr = val('--pr');
  const issue = val('--issue');
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || (pr === undefined && issue === undefined) || [pr, issue].some((x) => x !== undefined && !Number.isInteger(x))) {
    console.error('使い方: node verify-pr.mjs owner/repo (--pr N | --issue N)');
    process.exit(2);
  }
  const r = verify(repo, { pr, issue }, realGhJson, Date.now());
  console.log(JSON.stringify(r.out, null, 2));
  process.exit(r.exit);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main();
