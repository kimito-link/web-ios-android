import { describe, expect, it } from 'vitest';
import { statementFor, verify } from './verify-pr.mjs';
import { computeVerdict } from './lib/pipeline-core.mjs';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const SHA = 'abc123abc123abc';

/** 偽の gh。routes は「パスの一部 → 返す値」。無ければ例外（取得失敗の再現）。 */
const fakeGh = (routes) => (args) => {
  const p = args.find((a) => a.startsWith('repos/')) || '';
  for (const [k, v] of Object.entries(routes)) if (p.includes(k)) {
    if (v instanceof Error) throw v;
    return v;
  }
  throw new Error('未定義の経路: ' + p);
};
const pr = (over = {}) => ({ number: 7, state: 'open', merged: false, head: { sha: SHA }, ...over });
const run = (conclusion, status = 'completed') => ({ name: 'ci', status, conclusion });

describe('verify（成功と報告してよいか）', () => {
  it('成功: exit 0・canReportDone true。「未マージ・人の確認が必要」と言い、「完了」とは言わない', () => {
    const r = verify('o/r', { pr: 7 }, fakeGh({ 'pulls/7': pr(), [`commits/${SHA}/check-runs`]: { check_runs: [run('success')] }, [`commits/${SHA}/status`]: { state: 'pending', total_count: 0 } }), NOW);
    expect(r.exit).toBe(0);
    expect(r.out.canReportDone).toBe(true);
    expect(r.out.statement).toContain('未マージ');
    expect(r.out.statement).toContain('人の確認が必要');
    expect(r.out.statement).not.toContain('完了');
  });
  it('【毒】失敗: exit 1・canReportDone false', () => {
    const r = verify('o/r', { pr: 7 }, fakeGh({ 'pulls/7': pr(), [`commits/${SHA}/check-runs`]: { check_runs: [run('success'), run('failure')] }, [`commits/${SHA}/status`]: { state: 'pending', total_count: 0 } }), NOW);
    expect(r.exit).toBe(1);
    expect(r.out.canReportDone).toBe(false);
  });
  it('【毒】実行中・チェック0件・スキップだけ は exit 2・canReportDone false（成功と言わない）', () => {
    for (const checks of [[run(null, 'in_progress')], [], [run('skipped')]]) {
      const r = verify('o/r', { pr: 7 }, fakeGh({ 'pulls/7': pr(), [`commits/${SHA}/check-runs`]: { check_runs: checks }, [`commits/${SHA}/status`]: { state: 'pending', total_count: 0 } }), NOW);
      expect(r.exit, JSON.stringify(checks)).toBe(2);
      expect(r.out.canReportDone).toBe(false);
      expect(r.out.statement).toContain('未確認');
    }
  });
  it('【毒】PR が見つからない・取得に失敗 は exit 2（例外にせず、未確認と言う）', () => {
    const none = verify('o/r', { issue: 3 }, fakeGh({ 'pulls?head=': [] }), NOW);
    expect(none.exit).toBe(2);
    expect(none.out.canReportDone).toBe(false);
    const boom = verify('o/r', { pr: 7 }, fakeGh({ 'pulls/7': new Error('rate limit ghp_' + 'q'.repeat(36)) }), NOW);
    expect(boom.exit).toBe(2);
    expect(boom.out.statement).toContain('未確認');
    expect(JSON.stringify(boom.out)).not.toContain('ghp_qqqq'); // 秘密を出さない
  });
  it('--issue から ai/issue-N の PR を探す', () => {
    const r = verify('o/r', { issue: 5 }, fakeGh({ 'pulls?head=': [{ number: 7 }], 'pulls/7': pr(), [`commits/${SHA}/check-runs`]: { check_runs: [run('success')] }, [`commits/${SHA}/status`]: { state: 'pending', total_count: 0 } }), NOW);
    expect(r.out.pr).toBe(7);
    expect(r.exit).toBe(0);
  });
});

describe('statementFor', () => {
  it('どの判定でも「完了しました」とは言わない（マージは人が決める）', () => {
    for (const checks of [[run('success')], [run('failure')], [], [run('skipped')], [run(null, 'queued')]]) {
      const v = computeVerdict({ merged: false }, checks, null);
      expect(statementFor(1, v)).not.toContain('完了しました');
    }
  });
  it('マージ済みなら、そう言う', () => {
    expect(statementFor(1, computeVerdict({ merged: true }, [run('success')], null))).toContain('マージ済み');
  });
});
