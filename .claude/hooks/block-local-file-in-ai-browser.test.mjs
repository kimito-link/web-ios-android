// block-local-file-in-ai-browser のテスト。純関数 decide()/findLocalFileUrl() を直接叩く。
import { describe, it, expect } from 'vitest';
import { decide, findLocalFileUrl } from './block-local-file-in-ai-browser.mjs';

describe('decide', () => {
  it('内蔵ブラウザで file:// を開くのは拒否', () => {
    expect(decide('mcp__Claude_Browser__navigate', { url: 'file:///C:/work/report.html' })).toMatch(/止めました/);
  });

  it('クラウドから端末へ繋いだ内蔵ブラウザも拒否', () => {
    expect(decide('mcp__remote-devices__Claude_Browser__navigate', { url: 'FILE:///Users/a/x.html' })).toMatch(/EMBRACE/);
  });

  it('引数名が違っても入れ子でも見つける', () => {
    expect(decide('mcp__Claude_Browser__preview_start', { opts: { target: ' file:///tmp/a.html' } })).not.toBeNull();
  });

  it('localhost と https は通す', () => {
    expect(decide('mcp__Claude_Browser__navigate', { url: 'http://localhost:3000/' })).toBeNull();
    expect(decide('mcp__Claude_Browser__navigate', { url: 'https://kimito-skill.link/' })).toBeNull();
  });

  it('内蔵ブラウザ以外のツールは対象外', () => {
    expect(decide('mcp__claude-in-chrome__navigate', { url: 'file:///tmp/a.html' })).toBeNull();
    expect(decide('Bash', { command: 'file:///tmp/a.html' })).toBeNull();
  });

  it('文中に file: を含むだけの文字列は拒否しない', () => {
    expect(findLocalFileUrl({ text: 'see file:///x for details' })).toBeNull();
  });
});
