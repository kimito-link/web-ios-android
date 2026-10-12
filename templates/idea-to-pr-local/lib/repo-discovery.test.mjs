import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 1テストが git を何度も起動するので、PC が混んでいると既定の5秒を超える（遅さであって失敗ではない）
vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
import { discoverRepos, parseGitHubRemote } from './repo-discovery.mjs';

describe('parseGitHubRemote', () => {
  it('https・ssh・.git 付き・末尾スラッシュ・認証情報つき URL から owner/name を取る', () => {
    expect(parseGitHubRemote('https://github.com/kimito-link/web-ios-android.git')).toBe('kimito-link/web-ios-android');
    expect(parseGitHubRemote('https://github.com/kimito-link/malwarecheck.site')).toBe('kimito-link/malwarecheck.site');
    expect(parseGitHubRemote('git@github.com:kimito-link/ai-hub.git')).toBe('kimito-link/ai-hub');
    expect(parseGitHubRemote('https://x-access-token@github.com/o/r/\n')).toBe('o/r');
  });
  it('【毒】GitHub 以外・壊れた入力は null', () => {
    expect(parseGitHubRemote('https://gitlab.com/o/r.git')).toBeNull();
    expect(parseGitHubRemote('https://github.com.evil.example/o/r')).toBeNull();
    expect(parseGitHubRemote('')).toBeNull();
    expect(parseGitHubRemote(null)).toBeNull();
  });
});

describe('discoverRepos（配下の全リポを自動で見つける）', () => {
  /** @type {string} */
  let root;
  const git = (cwd, ...a) => {
    const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  };
  const mkRepo = (name, remote) => {
    const d = path.join(root, name);
    fs.mkdirSync(d, { recursive: true });
    git(d, 'init', '-b', 'main');
    if (remote) git(d, 'remote', 'add', 'origin', remote);
    return d;
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'disc-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('許可 owner の GitHub リポだけを、owner/name をキーにして見つける', () => {
    mkRepo('a.site', 'https://github.com/kimito-link/a.site.git');
    mkRepo('b', 'git@github.com:kimito-link/b.git');
    fs.mkdirSync(path.join(root, 'not-a-repo'));
    const r = discoverRepos(root, { allowedOwners: ['kimito-link'] });
    expect(Object.keys(r.repos).sort()).toEqual(['kimito-link/a.site', 'kimito-link/b']);
    expect(r.repos['kimito-link/a.site'].path).toBe(path.join(root, 'a.site'));
  });
  it('【毒】他人の owner・GitHub 以外・origin 無し・除外指定は対象にしない（理由を返す）', () => {
    mkRepo('theirs', 'https://github.com/someone-else/theirs.git');
    mkRepo('gitlab', 'https://gitlab.com/kimito-link/gitlab.git');
    mkRepo('local-only', '');
    mkRepo('excluded', 'https://github.com/kimito-link/excluded.git');
    mkRepo('ok', 'https://github.com/kimito-link/ok.git');
    const r = discoverRepos(root, { allowedOwners: ['kimito-link'], exclude: ['kimito-link/excluded'] });
    expect(Object.keys(r.repos)).toEqual(['kimito-link/ok']);
    expect(r.skipped.map((s) => path.basename(s.dir)).sort()).toEqual(['excluded', 'gitlab', 'local-only', 'theirs']);
  });
  it('同じリポが複数のフォルダにあれば、本体（.git がフォルダ）を選ぶ。owner の大文字小文字は区別しない', () => {
    const main = mkRepo('zzz-main', 'https://github.com/Kimito-Link/dup.git');
    const copy = path.join(root, 'aaa-copy');
    fs.mkdirSync(copy);
    fs.writeFileSync(path.join(copy, '.git'), `gitdir: ${path.join(main, '.git')}\n`);
    const r = discoverRepos(root, { allowedOwners: ['kimito-link'] });
    expect(r.repos['Kimito-Link/dup'].path).toBe(main);
  });
  it('存在しないフォルダ・隠しフォルダでも throw しない', () => {
    expect(discoverRepos(path.join(root, 'nope'), { allowedOwners: ['x'] }).repos).toEqual({});
    mkRepo('.hidden', 'https://github.com/kimito-link/hidden.git');
    expect(discoverRepos(root, { allowedOwners: ['kimito-link'] }).repos).toEqual({});
  });
});
