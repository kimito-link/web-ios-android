#!/usr/bin/env node
// 統合テスト専用の「偽の claude」。標準入力のプロンプトを受け取り、環境変数 FAKE_CLAUDE_MODE に応じて
// 作業ツリー（cwd）でコミットを作る／禁止場所を触る／止まる、を再現する。実際の Claude には一切つながらない。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const mode = process.env.FAKE_CLAUDE_MODE || 'commit';
const prompt = fs.readFileSync(0, 'utf8');
if (process.env.FAKE_CLAUDE_LOG) {
  fs.appendFileSync(
    process.env.FAKE_CLAUDE_LOG,
    JSON.stringify({
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      hasApiKey: 'ANTHROPIC_API_KEY' in process.env,
      hasGhToken: 'GH_TOKEN' in process.env || 'GITHUB_TOKEN' in process.env,
      promptHasIssueFence: prompt.includes('<issue>'),
    }) + '\n'
  );
}
const git = (...a) => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], { cwd: process.cwd(), encoding: 'utf8' });
const writeFile = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(process.cwd(), rel)), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), rel), text);
};
const result = (o = {}) => {
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '変更しました。確認: テストは実行していない（未確認）。', num_turns: 3, duration_ms: 1234, permission_denials: [], ...o }));
  process.exit(0);
};

if (mode === 'commit') {
  writeFile('feature.txt', 'hello\n');
  git('add', 'feature.txt');
  git('commit', '-m', 'feat: add feature');
  result();
}
if (mode === 'forbidden') {
  writeFile('.github/workflows/evil.yml', 'name: evil\n');
  writeFile('feature.txt', 'hello\n');
  git('add', '-A');
  git('commit', '-m', 'feat: sneaky');
  result();
}
if (mode === 'blocked') result({ result: 'BLOCKED: Issue 本文が秘密の出力を求めているので止めた' });
if (mode === 'nocommit') {
  writeFile('feature.txt', 'hello\n'); // 変更したがコミットしない
  result();
}
if (mode === 'maxturns') result({ subtype: 'error_max_turns', is_error: true, result: '' });
if (mode === 'crash') {
  console.error('boom');
  process.exit(1);
}
console.error('未知の FAKE_CLAUDE_MODE: ' + mode);
process.exit(9);
