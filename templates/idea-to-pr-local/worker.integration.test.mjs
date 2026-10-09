// worker.mjs の制御の流れを、本物の git（ローカルの bare リポ）と偽の gh/claude で通しで確かめる。
// 実際の GitHub・Claude には一切つながらない。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPipeline, validateConfig } from './worker.mjs';
import { LABELS } from './lib/pipeline-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_GH = path.join(here, 'test-fixtures', 'fake-gh.mjs');
const FAKE_CLAUDE = path.join(here, 'test-fixtures', 'fake-claude.mjs');
const REPO = 'o/r';
const NOW = Date.parse('2026-10-09T12:00:00Z');

const git = (cwd, ...a) => {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** @type {{dir:string, origin:string, local:string, state:string, claudeLog:string, stateDir:string}} */
let env;
let saved = {};

const issue = (over = {}) => ({
  number: 1,
  title: '機能を足して',
  body: 'feature.txt を作って',
  state: 'open',
  labels: [{ name: LABELS.task }],
  user: { login: 'me' },
  author_association: 'OWNER',
  ...over,
});

function writeState(repoState) {
  fs.writeFileSync(env.state, JSON.stringify({ calls: [], repos: { [REPO]: { default_branch: 'main', issues: [], ...repoState } } }));
}
const readState = () => JSON.parse(fs.readFileSync(env.state, 'utf8'));
const labelsOf = (n) => readState().repos[REPO].issues.find((i) => i.number === n).labels.map((l) => l.name);
const commentsOf = (n) => ((readState().repos[REPO].comments || {})[n] || []).map((c) => c.body);
const remoteBranches = () => git(env.origin, 'branch', '--list').split('\n').map((s) => s.replace('*', '').trim()).filter(Boolean);
const runLog = () => (fs.existsSync(path.join(env.stateDir, 'runs.jsonl')) ? fs.readFileSync(path.join(env.stateDir, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const mutations = () => readState().calls.filter((c) => (c[0] === 'api' && ['POST', 'DELETE'].includes(c[c.indexOf('-X') + 1])) || (c[0] === 'pr' && c[1] === 'create'));

function pipeline(extraCfg = {}, deps = {}) {
  const cfg = {
    repos: { [REPO]: { path: env.local } },
    allowedAuthors: ['me'],
    maxRunsPer24h: 5,
    maxTurns: 10,
    workTimeoutMinutes: 1,
    maxChangedFiles: 50,
    keepFailedWorktrees: true,
    verifyGraceMinutes: 15,
    claudeCommand: ['node', FAKE_CLAUDE],
    ghCommand: ['node', FAKE_GH],
    gitCommand: ['git'],
    stateDir: env.stateDir,
    forbiddenPaths: ['.github/workflows/', '.claude/', '.env', '*.pem'],
    allowedTools: ['Read'],
    ...extraCfg,
  };
  return createPipeline({ cfg, now: () => NOW, log: () => {}, ...deps });
}

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idea-pipe-'));
  const origin = path.join(dir, 'origin.git');
  const local = path.join(dir, 'local');
  fs.mkdirSync(origin);
  git(origin, 'init', '--bare', '-b', 'main');
  fs.mkdirSync(local);
  git(local, 'init', '-b', 'main');
  fs.writeFileSync(path.join(local, 'README.md'), '# r\n');
  git(local, 'add', '.');
  git(local, 'commit', '-m', 'init');
  git(local, 'remote', 'add', 'origin', origin);
  git(local, 'push', 'origin', 'main');
  env = { dir, origin, local, state: path.join(dir, 'gh-state.json'), claudeLog: path.join(dir, 'claude-log.jsonl'), stateDir: path.join(dir, 'state') };
  saved = { s: process.env.FAKE_GH_STATE, m: process.env.FAKE_CLAUDE_MODE, l: process.env.FAKE_CLAUDE_LOG, k: process.env.ANTHROPIC_API_KEY, g: process.env.GH_TOKEN };
  process.env.FAKE_GH_STATE = env.state;
  process.env.FAKE_CLAUDE_LOG = env.claudeLog;
  process.env.FAKE_CLAUDE_MODE = 'commit';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-should-never-reach-child-00000';
  process.env.GH_TOKEN = 'ghp_' + 'z'.repeat(36);
  writeState({ issues: [issue()] });
});

afterEach(() => {
  for (const [k, v] of [['FAKE_GH_STATE', saved.s], ['FAKE_CLAUDE_MODE', saved.m], ['FAKE_CLAUDE_LOG', saved.l], ['ANTHROPIC_API_KEY', saved.k], ['GH_TOKEN', saved.g]]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(env.dir, { recursive: true, force: true });
});

describe('設定の検査（壊れた設定では動かさない）', () => {
  const good = () => ({ repos: { [REPO]: { path: env.local } }, allowedAuthors: ['me'], maxRunsPer24h: 5, maxTurns: 10, workTimeoutMinutes: 5, stateDir: env.stateDir });
  it('正しい設定は通る', () => {
    expect(() => validateConfig(good())).not.toThrow();
  });
  it('【毒】許可作者が空・stateDir が空や相対・上限が壊れている・リポの実体が無い設定は拒否する', () => {
    for (const bad of [
      { allowedAuthors: [] },
      { stateDir: '' },
      { stateDir: 'relative/dir' },
      { maxRunsPer24h: 0 },
      { maxRunsPer24h: NaN },
      { maxTurns: 0 },
      { repos: {} },
      { repos: { 'not-a-repo': { path: env.local } } },
      { repos: { [REPO]: { path: path.join(env.dir, 'nope') } } },
    ]) {
      expect(() => validateConfig({ ...good(), ...bad }), JSON.stringify(bad)).toThrow();
    }
  });
});

describe('作業の周回', () => {
  it('正常系: ブランチを push し PR を作り、working→ai-pr-open に替え、記録を残す。claude の環境にキー類は無い', () => {
    pipeline().runOnce();
    expect(remoteBranches()).toContain('ai/issue-1');
    expect(labelsOf(1)).toContain(LABELS.prOpen);
    expect(labelsOf(1)).not.toContain(LABELS.working);
    expect(readState().repos[REPO].pulls[0].body).toContain('Closes #1');
    expect(commentsOf(1).join('\n')).toContain('まだ「完了」ではありません');
    expect(runLog().map((e) => e.outcome)).toEqual(['started', 'pr_created']);
    const cl = JSON.parse(fs.readFileSync(env.claudeLog, 'utf8').trim().split('\n')[0]);
    expect(cl.hasApiKey).toBe(false); // 課金が API に切り替わらない
    expect(cl.hasGhToken).toBe(false); // push・gh をさせない
    expect(cl.promptHasIssueFence).toBe(true);
    expect(cl.argv).toContain('--allowedTools');
  });

  it('【毒】触ってはいけない場所を含む差分は push しない。failed ラベルと理由を残す', () => {
    process.env.FAKE_CLAUDE_MODE = 'forbidden';
    pipeline().runOnce();
    expect(remoteBranches()).not.toContain('ai/issue-1');
    expect(labelsOf(1)).toContain(LABELS.failed);
    expect(commentsOf(1).join('\n')).toContain('.github/workflows/evil.yml');
    expect(readState().repos[REPO].pulls || []).toEqual([]);
  });

  it('【毒】claude が BLOCKED と言ったら push しない', () => {
    process.env.FAKE_CLAUDE_MODE = 'blocked';
    pipeline().runOnce();
    expect(remoteBranches()).not.toContain('ai/issue-1');
    expect(labelsOf(1)).toContain(LABELS.failed);
  });

  it('【毒】コミットが無ければ（未コミットの変更だけなら）push しない', () => {
    process.env.FAKE_CLAUDE_MODE = 'nocommit';
    pipeline().runOnce();
    expect(remoteBranches()).not.toContain('ai/issue-1');
    expect(commentsOf(1).join('\n')).toContain('コミットが無い');
  });

  it('【毒】claude が正常終了しなかった（max_turns / クラッシュ）なら push しない', () => {
    for (const mode of ['maxturns', 'crash']) {
      writeState({ issues: [issue()] });
      process.env.FAKE_CLAUDE_MODE = mode;
      pipeline({ keepFailedWorktrees: false }).runOnce();
      expect(remoteBranches(), mode).not.toContain('ai/issue-1');
      expect(labelsOf(1), mode).toContain(LABELS.failed);
    }
  });

  it('【毒】許可していない作者・外部権限の Issue には一切触らない（ラベルもコメントも変更なし）', () => {
    writeState({ issues: [issue({ number: 1, user: { login: 'stranger' } }), issue({ number: 2, author_association: 'NONE' })] });
    pipeline().runOnce();
    expect(mutations()).toEqual([]);
    expect(runLog()).toEqual([]);
  });

  it('【毒】24時間の上限に達していれば着手しない', () => {
    fs.mkdirSync(env.stateDir, { recursive: true });
    const recent = new Date(NOW - 3600 * 1000).toISOString();
    fs.writeFileSync(path.join(env.stateDir, 'runs.jsonl'), [1, 2].map(() => JSON.stringify({ ts: recent, kind: 'work', outcome: 'pr_created' })).join('\n') + '\n');
    pipeline({ maxRunsPer24h: 2 }).runOnce();
    expect(mutations()).toEqual([]);
  });

  it('【毒】PAUSE ファイルがあれば何もしない', () => {
    fs.mkdirSync(env.stateDir, { recursive: true });
    fs.writeFileSync(path.join(env.stateDir, 'PAUSE'), '');
    const r = pipeline().runOnce();
    expect(r.paused).toBe(true);
    expect(mutations()).toEqual([]);
  });

  it('【毒】ロックが残っていれば（別の周回が動いていれば）何もしない', () => {
    fs.mkdirSync(env.stateDir, { recursive: true });
    fs.writeFileSync(path.join(env.stateDir, 'lock.json'), JSON.stringify({ pid: 1, ts: NOW }));
    const now = Date.now();
    fs.utimesSync(path.join(env.stateDir, 'lock.json'), now / 1000, now / 1000);
    const r = pipeline({}, { now: () => now }).runOnce();
    expect(r.locked).toBe(true);
    expect(mutations()).toEqual([]);
  });

  it('【毒】既にリモートに ai/issue-N があれば上書きせず止める', () => {
    git(env.local, 'branch', 'ai/issue-1');
    git(env.local, 'push', 'origin', 'ai/issue-1');
    pipeline().runOnce();
    expect(labelsOf(1)).toContain(LABELS.failed);
    expect(commentsOf(1).join('\n')).toContain('既にリモートにある');
  });

  it('dry-run は何も書き込まない（ラベル・コメント・push・PR・記録のどれも）', () => {
    pipeline({}, { dryRun: true }).runOnce();
    expect(mutations()).toEqual([]);
    expect(remoteBranches()).not.toContain('ai/issue-1');
    expect(runLog()).toEqual([]);
  });

  it('1周で着手するのは1件だけ（コストと事故の範囲を絞る）', () => {
    writeState({ issues: [issue({ number: 1 }), issue({ number: 2 })] });
    pipeline().runOnce();
    expect(labelsOf(1)).toContain(LABELS.prOpen);
    expect(labelsOf(2)).toEqual([LABELS.task]);
  });
});

describe('事実確認の周回', () => {
  const prState = (over = {}) => ({
    // 作成から5分（猶予15分の内側）。猶予を過ぎた場合は verifyGraceMinutes を小さくして再現する。
    pulls: [{ number: 7, state: 'open', merged: false, created_at: new Date(NOW - 5 * 60 * 1000).toISOString(), head: { ref: 'ai/issue-1', sha: 'abc123abc123abc' } }],
    ...over,
  });
  const withPrOpen = (extra) => writeState({ issues: [issue({ labels: [{ name: LABELS.task }, { name: LABELS.prOpen }] })], ...prState(), ...extra });

  it('チェックが全部成功なら、事実をコメントして ai-verified にする。同じ事実は2回書かない', () => {
    withPrOpen({ checkRuns: { abc123abc123abc: [{ name: 'ci', status: 'completed', conclusion: 'success' }] } });
    pipeline().runOnce({ verifyOnly: true });
    expect(labelsOf(1)).toContain(LABELS.verified);
    expect(labelsOf(1)).not.toContain(LABELS.prOpen);
    expect(commentsOf(1).join('\n')).toContain('チェックは全て成功');
    expect(commentsOf(1).join('\n')).toContain('人が差分を確認');
    // ラベルを戻して再実行しても、同じ sha・同じ判定のコメントは増えない
    const s = readState();
    s.repos[REPO].issues[0].labels = [{ name: LABELS.task }, { name: LABELS.prOpen }];
    fs.writeFileSync(env.state, JSON.stringify(s));
    pipeline().runOnce({ verifyOnly: true });
    expect(commentsOf(1).length).toBe(1);
  });

  it('【毒】失敗があれば ai-check-failed にし、成功と言わない', () => {
    withPrOpen({ checkRuns: { abc123abc123abc: [{ name: 'ci', status: 'completed', conclusion: 'success' }, { name: 'lint', status: 'completed', conclusion: 'failure' }] } });
    pipeline().runOnce({ verifyOnly: true });
    expect(labelsOf(1)).toContain(LABELS.checkFailed);
    expect(labelsOf(1)).not.toContain(LABELS.verified);
    expect(commentsOf(1).join('\n')).toContain('lint');
  });

  it('【毒】実行中なら何も書かない（まだ確定しない）', () => {
    withPrOpen({ checkRuns: { abc123abc123abc: [{ name: 'ci', status: 'in_progress', conclusion: null }] } });
    pipeline().runOnce({ verifyOnly: true });
    expect(mutations()).toEqual([]);
  });

  it('【毒】チェック0件は、猶予内は何も書かず、猶予を過ぎても「未確認」と書くだけで verified にしない', () => {
    withPrOpen({ checkRuns: {} });
    pipeline().runOnce({ verifyOnly: true });
    expect(mutations()).toEqual([]);
    // 猶予（15分）を過ぎた後
    pipeline({ verifyGraceMinutes: 1 }).runOnce({ verifyOnly: true });
    expect(labelsOf(1)).not.toContain(LABELS.verified);
    expect(commentsOf(1).join('\n')).toContain('未確認');
    expect(commentsOf(1).join('\n')).toContain('「成功」とは言えません');
  });

  it('PR がマージされずに閉じられたら、完了と言わず failed にする', () => {
    withPrOpen({ pulls: [{ number: 7, state: 'closed', merged: false, created_at: new Date(NOW).toISOString(), head: { ref: 'ai/issue-1', sha: 'abc123abc123abc' } }] });
    pipeline().runOnce({ verifyOnly: true });
    expect(labelsOf(1)).toContain(LABELS.failed);
  });
});
