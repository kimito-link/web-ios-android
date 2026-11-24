// warn-large-tool-output.mjs の回帰テスト。
// 何を守るか: 大きな出力だけ注意する／小さい出力・サブエージェントの報告は黙る／回数の上限／壊れた入力でも落ちない(fail-open)。
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { judge, outputSize, LIMIT, MAX_WARN } from './warn-large-tool-output.mjs';

const HOOK = fileURLToPath(new URL('./warn-large-tool-output.mjs', import.meta.url));
const big = 'x'.repeat(LIMIT + 1);

describe('judge', () => {
  it('大きな出力には注意を出す', () => {
    const msg = judge({ tool_name: 'Bash', tool_response: { stdout: big } });
    expect(msg).toMatch(/コードで絞ってから読む/);
    expect(msg).toMatch(/Bash/);
  });
  it('小さい出力は黙る', () => {
    expect(judge({ tool_name: 'Bash', tool_response: { stdout: 'ok' } })).toBeNull();
  });
  it('サブエージェントの報告は対象外', () => {
    expect(judge({ tool_name: 'Agent', tool_response: big })).toBeNull();
  });
  it('1セッション MAX_WARN 回まで', () => {
    expect(judge({ tool_name: 'Read', tool_response: big }, MAX_WARN)).toBeNull();
    expect(judge({ tool_name: 'Read', tool_response: big }, MAX_WARN - 1)).not.toBeNull();
  });
  it('壊れた入力でも落ちない', () => {
    expect(judge(null)).toBeNull();
    expect(outputSize(undefined)).toBe(0);
  });
});

describe('hook として起動', () => {
  it('大きな出力で additionalContext を返し、壊れた入力は exit 0 で黙る', () => {
    const sid = `test-${process.pid}-${Date.now()}`;
    const r = spawnSync('node', [HOOK], {
      input: JSON.stringify({ session_id: sid, tool_name: 'mcp__x__get', tool_response: big }),
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toMatch(/mcp__x__get/);
    const bad = spawnSync('node', [HOOK], { input: 'not json', encoding: 'utf8' });
    expect(bad.status).toBe(0);
    expect(bad.stdout).toBe('');
  });
});
