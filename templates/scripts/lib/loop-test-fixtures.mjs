/**
 * loop-test-fixtures.mjs — 自己改善ループのテストが共有する部品（テストではない。vitest の対象外）。
 *
 * 役割: 診断出力のサンプル・偽の提案書・偽の Ollama サーバー・子プロセスの起動を、複数のテストで1箇所に持つ。
 * なぜ別ファイルか: あるテストファイルを別のテストから import すると、そのファイルのテストまで二重に実行される（実際に起きた）。
 * 偽の Ollama は 127.0.0.1 の空きポートで、/api/chat に決まった本文をストリーム（NDJSON）で返し、受け取った本文を記録する。実モデルは使わない。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

/** run.mjs の実際の出力の形（検査名は実在のもの）。まとめの前後に、本文や診断メッセージが付く。 */
export const SAMPLE = `[diagnostics] 対象: C:\\repo

[check-foo] 何かの本文。ファイル名 secret-file.txt や yamada@example.com が出ることもある。

--- 診断結果まとめ ---
✓ check-tracked-imports: pass
✓ check-lockfile-sync: pass
✗ check-foo: fail
? check-bar-baz: unmeasured
- check-symptom-index: skip
✓ check-selftest-coverage(scripts): pass

[diagnostics] 1件のチェックで問題を検出。上記の対処を確認してください。
`;

/** 症状なし（全部 pass）の診断出力。 */
export const ALL_PASS = '--- 診断結果まとめ ---\n✓ check-a: pass\n✓ check-b: pass\n\n';

/** SAMPLE から作ったカードの metrics にある数字だけを使った、形式検査に通る提案書の本文。 */
export const ANSWER = `## 症状
検査 check-foo が失敗している。

## 観測
- 検査は 6 件、失敗は 1 件、測れていないのは 1 件。

## 原因仮説
- 【確証】失敗が 1 件ある。確度: 高。根拠: card:check-foo。反証: 再実行で失敗が消えれば誤り。
- 【推測】check-foo の前提が変わった。確度: 中。反証: 前提を戻しても失敗するなら誤り。

## 版の提案
- 変更: check-foo の失敗の原因を特定する
- 触るファイル候補: （ファイル名は未確認）
- やらないこと: 他の検査の変更

## 検証手順
check-foo を再実行して結果を確かめる。
`;

/** AIシェルを示す環境変数を外した環境（人間が自分のターミナルで打つのと同じ）。 */
export const envNoAi = () => {
  const e = { ...process.env };
  delete e.CLAUDE_CODE_SESSION_ID;
  return e;
};

/**
 * 偽の Ollama を起動する。
 * @param {string} answer /api/chat の応答として返す本文
 * @returns {Promise<{ server: import('node:http').Server, seen: any[], port: number }>}
 */
export function startStub(answer) {
  /** @type {any[]} */
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(JSON.stringify({ message: { content: answer.slice(0, 20) }, done: false }) + '\n');
      res.write(JSON.stringify({ message: { content: answer.slice(20) }, done: false }) + '\n');
      res.end(JSON.stringify({ done: true }) + '\n');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: /** @type {any} */ (server.address()).port })));
}

/**
 * node の子プロセスを非同期に走らせ、終了コードと出力を返す（偽サーバーを同じプロセスで動かすため、spawnSync は使えない）。
 * @param {string[]} args @param {string} [input] @param {NodeJS.ProcessEnv} [env] @param {string} [cwd]
 * @returns {Promise<{ status: number|null, out: string, err: string }>}
 */
export const runAsync = (args, input, env, cwd) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, args, { env: env ?? envNoAi(), cwd });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (status) => resolve({ status, out, err }));
    if (input !== undefined) p.stdin.end(input);
    else p.stdin.end();
  });
