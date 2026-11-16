// LINEシミュレーション: 利用者がLINEでやること（文字・ボタン・ファイル）を、スマホなしで本番の webhook にそのまま流し、
// Bot が返すはずだった返信・push を記録（D1 の e2e_capture）から読んで確かめるための道具。
// 正本: docs/ai-rules/12_LINE_SIMULATION.md ／ 使い方: templates/line-bot/e2e/README.md
// 出典: kimito-link/linebot scripts/e2e-bunshin.mjs（本番E2E 39/39、2026-11-16）から、Bot 固有の部分を抜いた共通部分。
//
// 必要な環境変数（GitHub Actions の secrets / vars から渡す。ログに出さない）:
//   WEBHOOK_URL       本番の webhook（例: https://xxx-line.<account>.workers.dev/webhook）
//   CHANNEL_SECRET    LINE のチャネルシークレット（署名 x-line-signature を作る）
//   E2E_USER_ID       偽の利用者ID（Worker の env.E2E_USER_ID と同じ値。U + 32桁の16進）
//   D1_DATABASE_NAME  記録を読む D1（wrangler d1 execute --remote で読む。CLOUDFLARE_API_TOKEN が要る）
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function createLineSim(env = process.env) {
  const { WEBHOOK_URL, CHANNEL_SECRET, E2E_USER_ID: USER, D1_DATABASE_NAME: DB } = env;
  if (!/^https:\/\/\S+$/.test(WEBHOOK_URL ?? '')) throw new Error('WEBHOOK_URL が無い');
  if (!CHANNEL_SECRET) throw new Error('CHANNEL_SECRET が無い');
  if (!/^U[0-9a-f]{32}$/.test(USER ?? '')) throw new Error('E2E_USER_ID は U + 32桁の16進');
  if (!/^[A-Za-z0-9_-]+$/.test(DB ?? '')) throw new Error('D1_DATABASE_NAME が無い');

  /** D1 に SQL を投げて results を返す（混雑で落ちたら20秒おいて3回まで再試行）。 */
  const q = (sql) => {
    for (let i = 0; ; i++) {
      try {
        const out = execFileSync('npx', ['-y', 'wrangler@4', 'd1', 'execute', DB, '--remote', '--json', '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
        return JSON.parse(out)[0].results;
      } catch (e) { if (i >= 3) throw e; execFileSync('sleep', ['20']); }
    }
  };

  /** 記録を読んで消す（読んだ分は次の確認に混ざらない）。 */
  const takeCapture = () => q('DELETE FROM e2e_capture RETURNING method, payload, created_at')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((r) => { try { return { method: r.method, args: JSON.parse(r.payload) }; } catch { return null; } })
    .filter(Boolean);

  let n = 0;
  let lastEntries = [];

  /**
   * イベントを1つ署名して本番 webhook に送り、返事が記録に出るまで待つ。
   * 返り値は texts() で平らにした文字列（本文・ボタンの label・postback・URL を ' | ' でつないだもの）。
   */
  async function post(ev, label, wait = 40000) {
    const body = JSON.stringify({ destination: 'e2e', events: [{
      ...ev,
      replyToken: `e2e-${randomBytes(8).toString('hex')}`,
      timestamp: Date.now(),
      source: { type: 'user', userId: USER },
      webhookEventId: `e2e-${Date.now()}-${n++}`,
      deliveryContext: { isRedelivery: false },
      mode: 'active',
    }] });
    const sig = createHmac('sha256', CHANNEL_SECRET).update(body).digest('base64');
    const r = await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': sig }, body });
    const entries = [];
    for (let waited = 0; waited < wait; waited += 4000) {
      await sleep(4000);
      entries.push(...takeCapture());
      // 1通目が来たら、続けて届く push を拾うため少しだけ待つ
      if (texts(entries).length) { await sleep(3000); entries.push(...takeCapture()); break; }
    }
    lastEntries = entries;
    const got = texts(entries).join(' | ');
    console.log(`\n### ${label}  (HTTP ${r.status})\n  返事: ${got.replace(/\s+/g, ' ').slice(0, 500) || '（なし）'}`);
    return got;
  }

  const say = (text, label) => post({ type: 'message', message: { type: 'text', id: `e2e${Date.now()}${n}`, text } }, label ?? text);
  const tap = (data, label) => post({ type: 'postback', postback: { data } }, label ?? data);
  const follow = (label = '友だち追加') => post({ type: 'follow' }, label);

  /**
   * ファイル・画像・動画・音声を「送った」ことにする。中身は e2e_files に置き、messageId を e2e-file:<name> にする。
   * Worker 側は e2eFileFetch が LINE の取り出しだけを差し替え、変換・保存・AI は本番そのまま通る。
   */
  async function sendFile({ name, path, type = 'file', fileName, contentType = null, wait = 90000, label }) {
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(name)) throw new Error(`name は英数字と ._- の40字まで: ${name}`);
    const b64 = readFileSync(path).toString('base64');
    q(`INSERT INTO e2e_files (name, content_type, body_base64) VALUES (${sqlStr(name)}, ${contentType ? sqlStr(contentType) : 'NULL'}, '${b64}')
       ON CONFLICT(name) DO UPDATE SET content_type = excluded.content_type, body_base64 = excluded.body_base64`);
    const message = { type, id: `e2e-file:${name}` };
    if (type === 'file') Object.assign(message, { fileName: fileName ?? name, fileSize: Buffer.byteLength(b64, 'base64') });
    if (type === 'image') message.contentProvider = { type: 'line' };
    return post({ type: 'message', message }, label ?? `${type} を送る: ${fileName ?? name}`, wait);
  }

  const results = [];
  const check = (name, ok, note = '') => { results.push({ name, ok: !!ok, note: String(note) }); };

  /** E2E が使ったものを全部消す。必ず finally で呼ぶ。Bot 固有のデータ（作った分身など）は呼び出し側で消す。 */
  const cleanup = () => { q('DELETE FROM e2e_capture'); q('DELETE FROM e2e_files'); };

  /** 結果を出し、1つでも × なら exit 1。GitHub Actions では Summary にも書く。 */
  function report(title = 'LINEシミュレーション') {
    const ok = results.filter((r) => r.ok).length;
    console.log(`\n## ${title} ${ok}/${results.length}`);
    for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.note ? `  — ${r.note}` : ''}`);
    if (env.GITHUB_STEP_SUMMARY) {
      appendFileSync(env.GITHUB_STEP_SUMMARY, `## ${title} ${ok}/${results.length}\n\n${results.map((r) => `- ${r.ok ? '✅' : '❌'} ${r.name}${r.note ? ` — ${r.note.replace(/\|/g, '/')}` : ''}`).join('\n')}\n`);
    }
    if (ok !== results.length || results.length === 0) process.exitCode = 1;
  }

  return { USER, q, post, say, tap, follow, sendFile, check, cleanup, report, takeCapture, get lastEntries() { return lastEntries; } };
}

/**
 * 記録（LINE に送るはずだった引数）を、確かめやすい文字列の列に平らにする。
 * ★ボタンの文字は action.label にあり text には出ない → `L:` で拾う。postback は `PB:`、URL は `URI:`、Flex の altText は `[...]`。
 */
const ACTION_TYPES = new Set(['postback', 'uri', 'message', 'datetimepicker', 'camera', 'cameraRoll', 'location', 'richmenuswitch', 'clipboard']);
export function texts(entries) {
  const out = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (typeof o.text === 'string') out.push(o.text);
    if (o.altText) out.push(`[${o.altText}]`);
    // ボタン（action）。クイックリプライ・Flex は { action: {...} }、テンプレートは actions: [{...}] の直下にある。
    // どちらも下の再帰で action オブジェクトそのものに来るので、ここ1か所で拾う。
    if (ACTION_TYPES.has(o.type) && (typeof o.label === 'string' || o.data || o.uri)) {
      if (o.type === 'uri') out.push(`URI:${o.uri}`);
      if (o.data) out.push(`PB:${o.data}`);
      if (typeof o.label === 'string') out.push(`L:${o.label}`);
    }
    for (const v of Object.values(o)) walk(v);
  };
  entries.forEach((e) => walk(e.args));
  return out;
}

// 自己試験: node line-sim.mjs --selftest（本番に触らない）
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href && process.argv.includes('--selftest')) {
  const t = texts([{ method: 'replyMessage', args: ['tok', [{ type: 'template', altText: 'メニュー', template: { text: '選んでね', actions: [{ type: 'postback', label: '作る', data: 'make' }, { type: 'uri', label: '開く', uri: 'https://example.com' }] } }, { type: 'text', text: 'ほか', quickReply: { items: [{ type: 'action', action: { type: 'postback', label: 'やめる', data: 'leave' } }] } }]] }]);
  const want = ['[メニュー]', '選んでね', 'PB:make', 'L:作る', 'URI:https://example.com', 'L:開く', 'PB:leave', 'L:やめる'];
  const once = t.filter((x) => x === 'PB:leave').length === 1;
  const okAll = want.every((w) => t.includes(w)) && once;
  let threw = false; try { createLineSim({}); } catch { threw = true; }
  console.log(okAll && threw ? 'selftest OK' : `selftest NG: ${JSON.stringify(t)} threw=${threw}`);
  if (!(okAll && threw)) process.exit(1);
}
