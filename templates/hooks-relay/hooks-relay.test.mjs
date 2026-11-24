// hooks-relay のテスト。一時ディレクトリを HOME・~/.claude に見立てる（本物の ~/.claude には触らない）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isValidHookName, candidateRoots, findHook } from './web-ios-android-relay.mjs';
import { projectHookEntries, applyHooks, install, repoSkillNames, REPO_ROOT } from './install.mjs';

const RELAY = fileURLToPath(new URL('./web-ios-android-relay.mjs', import.meta.url));

let tmp;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hooks-relay-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** 偽の web-ios-android checkout を作る。hook は stdin をそのまま書き、引数の終了コードで終わる。 */
function fakeCheckout(dir, name = 'web-ios-android') {
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }));
  writeFileSync(
    join(dir, '.claude', 'hooks', 'echo-hook.mjs'),
    "import { readFileSync } from 'node:fs';\nconst s = readFileSync(0, 'utf8');\nprocess.stdout.write('OUT:' + s);\nprocess.stderr.write('ERR:' + process.argv.slice(2).join(','));\nprocess.exit(Number(JSON.parse(s).code ?? 0));\n",
  );
  return dir;
}

function runRelay(args, { input = '', env = {}, cwd = tmp } = {}) {
  return spawnSync(process.execPath, [RELAY, ...args], {
    input,
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: join(tmp, 'home'), USERPROFILE: join(tmp, 'home'), WEB_IOS_ANDROID_DIR: '', CLAUDE_PROJECT_DIR: '', ...env },
  });
}

describe('relay: 引数', () => {
  it('ファイル名だけを受け付ける', () => {
    expect(isValidHookName('guard-external-actions.mjs')).toBe(true);
    expect(isValidHookName('../evil.mjs')).toBe(false);
    expect(isValidHookName('a/b.mjs')).toBe(false);
    expect(isValidHookName('a\\b.mjs')).toBe(false);
    expect(isValidHookName('x..mjs')).toBe(false);
    expect(isValidHookName('/abs.mjs')).toBe(false);
    expect(isValidHookName('noext')).toBe(false);
    expect(isValidHookName(undefined)).toBe(false);
  });
  it('不正な引数では何も起動せず exit 0（fail-open）', () => {
    const r = runRelay(['../echo-hook.mjs'], { input: '{"code":2}' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/不正/);
  });
});

describe('relay: checkout を探す', () => {
  it('環境変数 → cwd の祖先と兄弟 → 記録 → 決まった置き場所 → ~/.claude/web-ios-android の順', () => {
    // 期待値も relay と同じく resolve()/join() で組み立てる（Windows では '/x/wia' が 'C:\x\wia' になるため）。
    const c = candidateRoots({ env: { WEB_IOS_ANDROID_DIR: '/x/wia' }, cwds: ['/g/line-bot'], home: '/h', relayDir: null });
    expect(c[0]).toBe(resolve('/x/wia'));
    const lineBot = c.indexOf(resolve('/g/line-bot'));
    expect(lineBot).toBeGreaterThan(0);
    expect(c.indexOf(join(resolve('/g'), 'web-ios-android'))).toBeGreaterThan(lineBot);
    expect(c.at(-1)).toBe(join('/h', '.claude', 'web-ios-android'));
  });
  it('兄弟リポの形（github/line-bot から github/web-ios-android）で見つかる', () => {
    fakeCheckout(join(tmp, 'github', 'web-ios-android'));
    mkdirSync(join(tmp, 'github', 'line-bot'), { recursive: true });
    const f = findHook('echo-hook.mjs', { env: {}, cwds: [join(tmp, 'github', 'line-bot')], home: join(tmp, 'home') });
    expect(f?.root).toBe(join(tmp, 'github', 'web-ios-android'));
  });
  it('package.json の name が違うフォルダは checkout と見なさない', () => {
    fakeCheckout(join(tmp, 'other'), 'line-bot');
    expect(findHook('echo-hook.mjs', { env: {}, cwds: [join(tmp, 'other')], home: join(tmp, 'home') })).toBeNull();
  });
  it('~/.claude/web-ios-android（浅い clone）で見つかる', () => {
    fakeCheckout(join(tmp, 'home', '.claude', 'web-ios-android'));
    const f = findHook('echo-hook.mjs', { env: {}, cwds: [join(tmp, 'elsewhere')], home: join(tmp, 'home') });
    expect(f?.root).toBe(join(tmp, 'home', '.claude', 'web-ios-android'));
  });
});

describe('relay: 起動', () => {
  it('stdin・stdout・stderr・終了コードをそのまま通す（stdin の cwd から兄弟を探す）', () => {
    fakeCheckout(join(tmp, 'github', 'web-ios-android'));
    const input = JSON.stringify({ cwd: join(tmp, 'github', 'line-bot'), code: 2 });
    const r = runRelay(['echo-hook.mjs', 'a1'], { input });
    expect(r.stdout).toBe('OUT:' + input);
    expect(r.stderr).toBe('ERR:a1');
    expect(r.status).toBe(2);
  });
  it('WEB_IOS_ANDROID_DIR で場所を指定できる', () => {
    const root = fakeCheckout(join(tmp, 'anywhere', 'wia'));
    const r = runRelay(['echo-hook.mjs'], { input: '{"code":0}', env: { WEB_IOS_ANDROID_DIR: root } });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('OUT:{"code":0}');
  });
  it('checkout も hook も無ければ素通し（exit 0）', () => {
    const r = runRelay(['echo-hook.mjs'], { input: '{"code":2}' });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/見つからない/);
  });
});

describe('install: 配線', () => {
  const project = {
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-external-actions.mjs"', timeout: 10 }] },
        { matcher: 'Edit', hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/require-claude-md-read.mjs"', timeout: 10 }] },
      ],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/warn-long-running-session.mjs"' }] }],
    },
  };
  it('プロジェクトの配線から hook 名を取り出す', () => {
    expect(projectHookEntries(project).map((e) => e.hookName)).toEqual([
      'guard-external-actions.mjs',
      'require-claude-md-read.mjs',
      'warn-long-running-session.mjs',
    ]);
  });
  it('既存の設定は残し、2回目は増えない。直接コピーで既にある hook は足さない', () => {
    const user = {
      autoMode: { allow: ['$defaults'] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "/root/.claude/hooks/guard-external-actions.mjs"' }] }] },
    };
    const entries = projectHookEntries(project);
    const once = applyHooks(user, entries, '/r/web-ios-android-relay.mjs');
    expect(once.skipped.map((e) => e.hookName)).toEqual(['guard-external-actions.mjs']);
    expect(once.added.map((e) => e.hookName)).toEqual(['require-claude-md-read.mjs', 'warn-long-running-session.mjs']);
    expect(once.settings.autoMode).toEqual(user.autoMode);
    expect(once.settings.hooks.PreToolUse[0].hooks).toHaveLength(1);
    const twice = applyHooks(once.settings, entries, '/r/web-ios-android-relay.mjs');
    expect(twice.added).toEqual([]);
    expect(twice.settings).toEqual(once.settings);
  });
  it('一時 HOME に入れる: relay を置き、バックアップを取り、--dry-run は何も書かない', () => {
    const claudeDir = join(tmp, 'home', '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ theme: 'dark' }));
    const quiet = () => {};

    const dry = install({ claudeDir, dryRun: true, log: quiet });
    expect(dry.wrote).toBe(false);
    expect(existsSync(join(claudeDir, 'hooks'))).toBe(false);
    expect(JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'))).toEqual({ theme: 'dark' });

    const r1 = install({ claudeDir, log: quiet });
    expect(r1.added.length).toBeGreaterThan(0);
    expect(existsSync(join(claudeDir, 'hooks', 'web-ios-android-relay.mjs'))).toBe(true);
    expect(existsSync(join(claudeDir, 'settings.json.bak-hooks-relay'))).toBe(true);
    const after1 = readFileSync(join(claudeDir, 'settings.json'), 'utf8');
    expect(JSON.parse(after1).theme).toBe('dark');
    expect(after1).toMatch(/web-ios-android-relay\.mjs\\" guard-external-actions\.mjs/);
    expect(JSON.parse(readFileSync(join(claudeDir, 'hooks', 'web-ios-android-relay.json'), 'utf8')).root).toBe(REPO_ROOT);

    const r2 = install({ claudeDir, log: quiet });
    expect(r2.added).toEqual([]);
    expect(readFileSync(join(claudeDir, 'settings.json'), 'utf8')).toBe(after1);
  });
  it('先頭に BOM が付いた settings.json（PowerShell で書いたもの）も読めて、設定を残したまま足す', () => {
    const claudeDir = join(tmp, 'bomhome', '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), '\uFEFF' + JSON.stringify({ theme: 'dark' }));
    const r = install({ claudeDir, log: () => {} });
    expect(r.added.length).toBeGreaterThan(0);
    const after = readFileSync(join(claudeDir, 'settings.json'), 'utf8');
    expect(JSON.parse(after).theme).toBe('dark');
    expect(after).toMatch(/warn-large-tool-output\.mjs/);
  });

  it('リポの .claude/skills/ を ~/.claude/skills/ へ写す（その PC だけの個人スキルには触らない・--dry-run は写さない）', () => {
    const claudeDir = join(tmp, 'home', '.claude');
    mkdirSync(join(claudeDir, 'skills', 'my-own'), { recursive: true });
    writeFileSync(join(claudeDir, 'skills', 'my-own', 'SKILL.md'), 'mine');
    const names = repoSkillNames(REPO_ROOT);
    expect(names).toContain('frontend-design');
    expect(names).toContain('anything-frontend-art-direction');

    const dry = install({ claudeDir, dryRun: true, log: () => {} });
    expect(dry.skills).toEqual(names);
    expect(existsSync(join(claudeDir, 'skills', 'frontend-design'))).toBe(false);

    install({ claudeDir, log: () => {} });
    for (const n of names) {
      expect(readFileSync(join(claudeDir, 'skills', n, 'SKILL.md'), 'utf8')).toBe(readFileSync(join(REPO_ROOT, '.claude', 'skills', n, 'SKILL.md'), 'utf8'));
    }
    expect(existsSync(join(claudeDir, 'skills', 'anything-frontend-art-direction', 'references', 'visual-direction.md'))).toBe(true);
    expect(readFileSync(join(claudeDir, 'skills', 'my-own', 'SKILL.md'), 'utf8')).toBe('mine');
  });
  it('入れた relay が、このリポの本物の hook を起動できる（記録した checkout の場所を使う）', () => {
    const claudeDir = join(tmp, 'home', '.claude');
    install({ claudeDir, log: () => {} });
    const r = spawnSync(process.execPath, [join(claudeDir, 'hooks', 'web-ios-android-relay.mjs'), 'guard-agent-desktop.mjs'], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: join(tmp, 'elsewhere') }),
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, HOME: join(tmp, 'home'), USERPROFILE: join(tmp, 'home'), WEB_IOS_ANDROID_DIR: '', CLAUDE_PROJECT_DIR: '' },
    });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/見つからない/);
  });
});
