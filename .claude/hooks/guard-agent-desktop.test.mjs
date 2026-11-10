// guard-agent-desktop のテスト。純関数 decide() を直接叩く。
import { describe, it, expect } from 'vitest';
import { decide } from './guard-agent-desktop.mjs';

const bash = (command) => decide('Bash', { command });

describe('decide', () => {
  it('裏で動く既定の操作は通す', () => {
    expect(bash('agent-desktop snapshot --app notepad -i')).toBeNull();
    expect(bash("agent-desktop click '@s8f3k2p9:e8'")).toBeNull();
    expect(bash('npx agent-desktop set-value @s1:e2 hello')).toBeNull();
  });

  it('--force は拒否', () => {
    expect(bash('agent-desktop press alt+f4 --force')).toMatch(/--force/);
    expect(bash('agent-desktop.exe press win+l --force')).toMatch(/止めました/);
    expect(bash("& 'C:\\Users\\info\\bin\\agent-desktop.exe' press alt+tab --force")).toMatch(/--force/);
    expect(bash('agent-desktop version; agent-desktop press alt+f4 --force')).toMatch(/--force/);
  });

  it('--headed は本人の OK の印が無ければ拒否、あれば通す', () => {
    expect(bash('agent-desktop --headed type @s1:e2 hi')).toMatch(/本人の OK/);
    expect(bash('AGENT_DESKTOP_HEADED_OK_BY_USER="りんく 11/1 メモ帳だけOK" agent-desktop --headed type @s1:e2 hi')).toBeNull();
  });

  it('clipboard-get は拒否、clipboard-set は通す', () => {
    expect(bash('agent-desktop clipboard-get')).toMatch(/クリップボード/);
    expect(bash('agent-desktop clipboard-set hello')).toBeNull();
  });

  it('版なし・latest の導入は拒否、版を固定した導入は通す', () => {
    expect(bash('npm install -g agent-desktop')).toMatch(/版なし/);
    expect(bash('npm i -g agent-desktop@latest')).toMatch(/版なし/);
    expect(bash('npm install -g agent-desktop@1.0.2 --allow-scripts')).toBeNull();
    expect(bash('npm install agent-desktop@1.0.2 --ignore-scripts && npm audit signatures')).toBeNull();
  });

  it('別コマンドの --force や、agent-desktop を含むだけの文字は拒否しない', () => {
    expect(bash('agent-desktop version && git push --force-with-lease')).toBeNull();
    expect(bash('cat docs/ai-workflows/AGENT-DESKTOP-HOWTO.md')).toBeNull();
    expect(bash('grep -n "agent-desktop --force" notes.md')).toBeNull();
  });

  it('Bash 以外は対象外', () => {
    expect(decide('Write', { command: 'agent-desktop --force' })).toBeNull();
  });
});
