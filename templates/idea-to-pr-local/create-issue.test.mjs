// create-issue.sh を、127.0.0.1 の偽 GitHub サーバーに向けて実際に動かす。本物の GitHub にはつながらない。
// bash が無い環境（素の Windows 等）では丸ごと skip する（skip を緑と誤読しないよう、理由を出す）。
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, 'create-issue.sh');
const hasBash = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0;
if (!hasBash) console.warn('★create-issue.test: bash が無いので skip（未検査）');
const d = hasBash ? describe : describe.skip;

/** @type {http.Server} */
let server;
let port = 0;
/** @type {{headers:any, body:any}[]} */
let seen = [];
let mode = 'ok';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ headers: req.headers, body: raw ? JSON.parse(raw) : null, url: req.url });
      if (mode === 'forbidden') {
        res.writeHead(403, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ message: 'Resource not accessible by personal access token' }));
      }
      const labels = mode === 'nolabel' ? [] : (JSON.parse(raw).labels || []).map((name) => ({ name }));
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ number: 12, html_url: 'https://github.com/o/r/issues/12', labels }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = /** @type {any} */ (server.address()).port;
});
afterAll(() => server && server.close());

/** @param {string[]} args @param {NodeJS.ProcessEnv} [env] @param {string} [stdin] */
function run(args, env = {}, stdin) {
  // 同期の spawnSync だとテスト内の偽サーバーの応答がブロックされる。非同期で動かす。
  return new Promise((resolve) => {
    const p = spawn('bash', [SCRIPT, ...args], { env: { ...process.env, IDEA_TEST_API_BASE: `http://127.0.0.1:${port}`, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (err += c));
    p.on('close', (code) => resolve({ code, out, err }));
    if (stdin !== undefined) p.stdin.write(stdin);
    p.stdin.end();
  });
}

d('create-issue.sh', () => {
  it('Issue を作り、番号・URL・ラベルを JSON で返す。トークンはヘッダに載るが、出力には出ない', async () => {
    seen = []; mode = 'ok';
    const token = 'ghp_' + 'x'.repeat(36);
    const r = await run(['-R', 'o/r', '-t', 'タイトル', '-b', '本文'], { GH_TOKEN: token });
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out.trim());
    expect(j).toMatchObject({ ok: true, number: 12, url: 'https://github.com/o/r/issues/12', labels: 'ai-task' });
    expect(seen[0].headers.authorization).toBe('Bearer ' + token);
    expect(seen[0].url).toBe('/repos/o/r/issues');
    expect(r.out + r.err).not.toContain(token);
  });

  it('引用符・改行・$・日本語・絵文字を含む本文でも壊れずに送れる（標準入力でも可）', async () => {
    seen = []; mode = 'ok';
    const body = '行1 "引用" \'単\'\n行2 $HOME `date` \\n 日本語 🎉\n- [ ] 項目';
    const r = await run(['-R', 'o/r', '-t', 'T "q" $x'], { GH_TOKEN: 'ghp_' + 'y'.repeat(36) }, body);
    expect(r.code).toBe(0);
    expect(seen[0].body.body).toBe(body);
    expect(seen[0].body.title).toBe('T "q" $x');
    expect(seen[0].body.labels).toEqual(['ai-task']);
  });

  it('【毒】HTTP エラー（403）は終了コード 1・ok:false。成功と言わない', async () => {
    mode = 'forbidden';
    const r = await run(['-R', 'o/r', '-t', 'T', '-b', 'B'], { GH_TOKEN: 'ghp_' + 'z'.repeat(36) });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out.trim())).toMatchObject({ ok: false, http: 403 });
  });

  it('【毒】Issue は作れたがラベルが付かなかったら終了コード 3（ワーカーが拾わない Issue を黙って作らない）', async () => {
    mode = 'nolabel';
    const r = await run(['-R', 'o/r', '-t', 'T', '-b', 'B'], { GH_TOKEN: 'ghp_' + 'w'.repeat(36) });
    expect(r.code).toBe(3);
    expect(r.err).toContain('ラベル');
  });

  it('【毒】トークン未設定・不正な引数は終了コード 2（何も送らない）', async () => {
    seen = []; mode = 'ok';
    const env = { GH_TOKEN: '' };
    expect((await run(['-R', 'o/r', '-t', 'T', '-b', 'B'], env)).code).toBe(2);
    expect((await run(['-R', 'not-a-repo', '-t', 'T', '-b', 'B'], { GH_TOKEN: 'x' })).code).toBe(2);
    expect((await run(['-R', 'o/r', '-b', 'B'], { GH_TOKEN: 'x' })).code).toBe(2);
    expect(seen).toEqual([]);
  });

  it('【毒】接続先の差し替えは 127.0.0.1 / localhost だけ。他のホストへはトークンを送らない', async () => {
    seen = [];
    const r = await run(['-R', 'o/r', '-t', 'T', '-b', 'B'], { GH_TOKEN: 'ghp_' + 'v'.repeat(36), IDEA_TEST_API_BASE: 'http://evil.example.com' });
    expect(r.code).toBe(2);
    expect(seen).toEqual([]);
  });

  it('--dry-run は何も送らず、送る内容だけ表示する（トークン不要）', async () => {
    seen = [];
    const r = await run(['-R', 'o/r', '-t', 'T', '-b', 'B', '--dry-run'], { GH_TOKEN: '' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('(dry-run)');
    expect(seen).toEqual([]);
  });
});
