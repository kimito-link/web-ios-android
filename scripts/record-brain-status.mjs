#!/usr/bin/env node
// 役割: 作業を任せる「頭脳」(無料API・従量API・ローカルLLM)が、いま使えるか・どれだけ残っているかを調べ、専用ブランチ usage-data の
//   brains.json へ保存する。ダッシュボード kimito-skill.link/hub/usage/ の「頭脳の状況」がこれを読んでゲージにする。
// なぜ要るか: 無料枠は頭脳ごとに別々に切れる(2026-10-19 は Grok Build の残高切れ・Alibaba の無料枠切れ・OpenRouter の残高切れが重なっていた)。
//   切れている頭脳へ投げて失敗→次へ、を繰り返さないよう、使える頭脳と残量を一目で見えるようにする。
// 何を調べるか(いずれも1トークン以下の軽い確認。鍵の値は出力にも保存にも載せない):
//   Alibaba のモデルごと / Gemini のモデルごと / Cloudflare / Groq(応答ヘッダの残量) / OpenRouter(残高$) / NVIDIA / Mistral / ローカル(Ollama・GPU)
//   Grok Build は確認用の口が無いので、実行ログの最新結果から判定する。
// 使い方: node scripts/record-brain-status.mjs            (保存)
//         node scripts/record-brain-status.mjs --dry-run  (保存せず結果を表示)
// 前提: 鍵はユーザー環境変数(DASHSCOPE_API_KEY / GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY / NVIDIA_API_KEY / MISTRAL_API_KEY /
//   CF_WORKERS_AI_TOKEN + CLOUDFLARE_ACCOUNT_ID)。無ければ「鍵が未設定」と出す。順序・モデル鎖・失敗の合図は dispatch.py を読む(複製しない)。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initBranch, writeFile } from './lib/data-branch.mjs';
import { classifyHttp, logLooksFailed, parseRunLogName, statusOfBrain, summarizeRuns } from './lib/brain-status-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const E = process.env;
const TIMEOUT = 20000;

// ---- dispatch.py から設定を読む(正本は dispatch.py。ここに複製しない) -------------------------------
const py = fs.readFileSync(path.join(ROOT, 'docs/ai-workflows/tools/dispatch.py'), 'utf8');
const pyList = (name) => {
  const m = new RegExp(`^${name} = \\[([\\s\\S]*?)\\]`, 'm').exec(py);
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
};
const QWEN_CHAIN = pyList('QWEN_CHAIN');
const GEMINI_CHAIN = pyList('GEMINI_CHAIN');
const AUTO_CHAIN = pyList('AUTO_CHAIN');
const TEXT_CHAIN = pyList('TEXT_CHAIN');
const FAIL_MARKS = pyList('FAIL_MARKS');
const ALIBABA_BASE = /^ALIBABA_OPENAI = "([^"]+)"/m.exec(py)?.[1];

// ---- 小道具 ------------------------------------------------------------------------------------
async function http(url, opts = {}) {
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT) });
    return { status: r.status, bodyText: await r.text(), headers: r.headers };
  } catch (e) {
    return { error: e.name || 'error' }; // 鍵がURLに入る場合があるので、メッセージは載せない
  }
}
const post = (url, headers, body) => http(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const bearer = (k) => ({ authorization: `Bearer ${k}` });
// statusOfBrain は { status, label } を返すが、label は頭脳の名前と衝突するので statusLabel に直して使う
const S = (o) => ({ status: o.status, statusLabel: o.label });
const gauge = (label, remaining, total, unit, extra = {}) => ({ label, remaining, total, unit, pct: total > 0 ? Math.max(0, Math.min(100, Math.round((remaining / total) * 100))) : null, ...extra });

// ---- 実行ログ(dispatch.py が書く)から、頭脳ごとの直近の成否を出す -----------------------------------
function recentRuns() {
  const dir = path.join(E.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'llm-proxy', 'runs');
  const by = {};
  if (!fs.existsSync(dir)) return by;
  const files = fs.readdirSync(dir).map((n) => ({ n, p: parseRunLogName(n) })).filter((x) => x.p).sort((a, b) => (a.p.at < b.p.at ? 1 : -1)).slice(0, 400);
  for (const { n, p } of files) {
    const list = (by[p.brain] ||= []);
    if (list.length >= 12) continue;
    let text = '';
    try {
      const fd = fs.openSync(path.join(dir, n), 'r');
      const size = fs.fstatSync(fd).size;
      const buf = Buffer.alloc(Math.min(size, 6000));
      fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - buf.length));
      fs.closeSync(fd);
      text = buf.toString('utf8');
    } catch { /* 読めないログは数えない */ }
    const mark = FAIL_MARKS.find((m) => text.includes(m));
    list.push({ at: p.at, ok: !logLooksFailed(text, FAIL_MARKS), reason: mark || null });
  }
  return by;
}

// ---- 確認(1トークン以下) -----------------------------------------------------------------------
async function probeAlibaba() {
  if (!E.DASHSCOPE_API_KEY) return { hasKey: false };
  const rs = await Promise.all(QWEN_CHAIN.map(async (m) => {
    const r = await post(`${ALIBABA_BASE}/chat/completions`, bearer(E.DASHSCOPE_API_KEY), { model: m, messages: [{ role: 'user', content: 'OK' }], max_tokens: 1, enable_thinking: false });
    return { model: m, state: classifyHttp(r) };
  }));
  return { hasKey: true, models: rs };
}
async function probeGemini() {
  if (!E.GEMINI_API_KEY) return { hasKey: false };
  const rs = await Promise.all(GEMINI_CHAIN.map(async (m) => {
    const r = await post(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${E.GEMINI_API_KEY}`, {}, { contents: [{ parts: [{ text: 'OK' }] }], generationConfig: { maxOutputTokens: 1 } });
    return { model: m, state: classifyHttp(r) };
  }));
  return { hasKey: true, models: rs };
}
async function probeGroq() {
  if (!E.GROQ_API_KEY) return { hasKey: false };
  const r = await post('https://api.groq.com/openai/v1/chat/completions', bearer(E.GROQ_API_KEY), { model: 'qwen/qwen3.8-27b', messages: [{ role: 'user', content: 'OK' }], max_tokens: 1 });
  const h = r.headers;
  const n = (k) => (h && h.get(k) != null ? Number(h.get(k)) : null);
  return { hasKey: true, state: classifyHttp(r), reqRemaining: n('x-ratelimit-remaining-requests'), reqLimit: n('x-ratelimit-limit-requests'), tokRemaining: n('x-ratelimit-remaining-tokens'), tokLimit: n('x-ratelimit-limit-tokens') };
}
async function probeOpenRouter() {
  if (!E.OPENROUTER_API_KEY) return { hasKey: false };
  const r = await http('https://openrouter.ai/api/v1/credits', { headers: bearer(E.OPENROUTER_API_KEY) });
  let total = null, used = null;
  try { const d = JSON.parse(r.bodyText).data; total = d.total_credits; used = d.total_usage; } catch { /* 読めない */ }
  return { hasKey: true, state: classifyHttp(r), total, used };
}
async function probeList(url, key) {
  if (!key) return { hasKey: false };
  return { hasKey: true, state: classifyHttp(await http(url, { headers: bearer(key) })) };
}
async function probeCloudflare() {
  if (!E.CF_WORKERS_AI_TOKEN || !E.CLOUDFLARE_ACCOUNT_ID) return { hasKey: false };
  const r = await post(`https://api.cloudflare.com/client/v4/accounts/${E.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/qwen/qwen3.8-27b`, bearer(E.CF_WORKERS_AI_TOKEN), { messages: [{ role: 'user', content: 'OK' }], max_tokens: 1 });
  // Cloudflare は枠切れを 4006 で返す
  const state = /4006|daily free allocation|neurons/i.test(r.bodyText || '') && r.status !== 200 ? 'quota' : classifyHttp(r);
  return { hasKey: true, state };
}
async function probeLocal() {
  const out = { up: false, models: [], loaded: [], gpu: null };
  const tags = await http('http://127.0.0.1:11434/api/tags');
  if (tags.status === 200) {
    out.up = true;
    try { out.models = JSON.parse(tags.bodyText).models.map((m) => m.name); } catch { /* 空 */ }
    const ps = await http('http://127.0.0.1:11434/api/ps');
    try { out.loaded = JSON.parse(ps.bodyText).models.map((m) => m.name); } catch { /* 空 */ }
  }
  try {
    const s = execFileSync('nvidia-smi', ['--query-gpu=memory.used,memory.total,name', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 8000 }).trim().split(',').map((x) => x.trim());
    out.gpu = { usedMiB: Number(s[0]), totalMiB: Number(s[1]), name: s[2] };
  } catch { /* GPU なし・取得不可 */ }
  return out;
}

// Cloudflare の「今日使ったニューロン」は、スクリプトからは取れない(トークンに分析の権限が無い)ので、
// Cloudflare 公式 MCP を使える Claude の予約タスクが取得して、このファイルに書く。古ければ使わない。
const CF_FREE_NEURONS_PER_DAY = 10000;
function readCfNeurons() {
  const p = process.env.CF_NEURONS_FILE || path.join(os.tmpdir(), 'cf-neurons.json');
  try {
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Number.isFinite(d.totalNeurons) || Date.now() - Date.parse(d.fetchedAt) > 8 * 3600000) return null;
    return d;
  } catch { return null; }
}

// ---- まとめる ----------------------------------------------------------------------------------
const REASON_LABEL = { 'usage balance exhausted': '残高切れ(402)', 'Payment Required': '残高切れ(402)', 'Free quota exhausted': '無料枠切れ', insufficient_quota: '無料枠切れ', 'rate limit': '混み合い', RESOURCE_EXHAUSTED: '枠切れ', 'quota exceeded': '枠切れ', 'auto-rejecting': '権限で止まった' };

function build(runs, P) {
  const recentOf = (brain) => summarizeRuns(runs[brain] || [], 5);
  const lastReason = (brain) => { const f = (runs[brain] || []).find((x) => !x.ok); return f?.reason ? REASON_LABEL[f.reason] || f.reason : null; };
  const lastRunOf = (brain) => { const r = recentOf(brain); return r.last ? { at: r.last.at, ok: r.last.ok, reason: r.last.ok ? null : lastReason(brain), recent: r.recent.map((x) => x.ok) } : null; };
  const brains = [];

  // Grok Build: 確認の口が無い。ログの最新結果で判定
  const gr = recentOf('grok');
  const grokSt = statusOfBrain({ hasKey: true, recent: gr });
  if (grokSt.status === 'degraded' && lastReason('grok')) grokSt.label = `直近の実行は失敗: Grok Build ${lastReason('grok')}`;
  brains.push({ id: 'grok', label: 'Grok Build', kind: 'subscription', role: 'agent', ...S(grokSt), gauges: [], note: '残量を調べる口が無いので、実行ログの最新結果で判定しています。', lastRun: lastRunOf('grok') });

  // Alibaba(qwen / oc)
  const a = P.alibaba;
  const aOk = (a.models || []).filter((m) => m.state === 'ok').length;
  const aSt = !a.hasKey ? statusOfBrain({ hasKey: false }) : aOk > 0 ? { status: 'ok', label: `使えるモデル ${aOk} / ${a.models.length}` } : statusOfBrain({ hasKey: true, probe: (a.models || [])[0]?.state || 'down' });
  brains.push({ id: 'alibaba', label: 'Alibaba(Qwen本家・OpenCode)', kind: 'free', role: 'agent', ...S(aSt), gauges: a.hasKey ? [gauge('使えるモデル', aOk, a.models.length, '個', { items: a.models.map((m) => ({ name: m.model, state: m.state })) })] : [], note: 'モデルごとに別々の無料枠(新規登録から90日)。1つずつ軽く確認しています。', lastRun: lastRunOf('qwen') });

  // Cloudflare
  const cfSt = !P.cloudflare.hasKey ? statusOfBrain({ hasKey: false }) : statusOfBrain({ hasKey: true, probe: P.cloudflare.state });
  const nz = readCfNeurons();
  const cfGauges = nz ? [gauge('今日の無料枠(ニューロン)', Math.max(0, CF_FREE_NEURONS_PER_DAY - nz.totalNeurons), CF_FREE_NEURONS_PER_DAY, '', { over: Math.max(0, Math.round(nz.totalNeurons - CF_FREE_NEURONS_PER_DAY)), used: Math.round(nz.totalNeurons), resetNote: '毎日 日本時間 9:00 にリセット(UTC 0:00)' })] : [];
  if (nz && nz.totalNeurons > CF_FREE_NEURONS_PER_DAY && cfSt.status === 'ok') cfSt.label = '使えるが、今日は無料枠を超えて使っている';
  brains.push({ id: 'cf', label: 'Cloudflare Workers AI', kind: 'free', role: 'agent', ...S(cfSt), gauges: cfGauges, note: nz ? `今日(UTC)の合計 ${Math.round(nz.totalNeurons).toLocaleString()} ニューロン(最大のモデル: ${nz.topModel || '?'})。無料枠は1日 10,000 で、契約は Workers Paid(2026-10-19 に請求画面で確認。次回更新 10/24)なので、超えた分は従量課金です。` : '1日 10,000 ニューロンの無料枠。今日の使用量はまだ取得できていません(予約タスクが Cloudflare の MCP で取得します)。使えるかどうかだけ確認しています。', lastRun: lastRunOf('cf') });

  // NVIDIA / Mistral
  for (const [id, label, p, note] of [['nvidia', 'NVIDIA NIM', P.nvidia, '無料の評価枠(毎分40回ほど)。残量は取得できません。'], ['mistral', 'Mistral Codestral', P.mistral, '毎月の無料枠。残量は取得できません。']]) {
    brains.push({ id, label, kind: 'free', role: 'agent', ...S(!p.hasKey ? statusOfBrain({ hasKey: false }) : statusOfBrain({ hasKey: true, probe: p.state })), gauges: [], note, lastRun: lastRunOf(id) });
  }

  // OpenRouter(GLM・従量)
  const o = P.openrouter;
  const oLeft = o.total != null && o.used != null ? Math.max(0, +(o.total - o.used).toFixed(2)) : null;
  const oSt = !o.hasKey ? statusOfBrain({ hasKey: false }) : oLeft === 0 ? { status: 'quota', label: '残高が尽きている' } : statusOfBrain({ hasKey: true, probe: o.state });
  brains.push({ id: 'glm', label: 'OpenRouter(GLM・従量)', kind: 'paid', role: 'agent', ...S(oSt), gauges: oLeft != null ? [gauge('残高', oLeft, o.total, 'USD', { decimals: 2 })] : [], note: o.total != null ? `チャージ ${o.total} USD のうち、使用済み ${o.used.toFixed(2)} USD。` : '', lastRun: lastRunOf('glm') });

  // ローカル
  const L = P.local;
  const lSt = L.up ? { status: 'ok', label: `動いている(モデル ${L.models.length} 個${L.loaded.length ? `・読み込み中 ${L.loaded.join(', ')}` : ''})` } : { status: 'down', label: 'Ollama が止まっている' };
  brains.push({ id: 'local', label: 'ローカルLLM(Ollama)', kind: 'local', role: 'agent', ...S(lSt), gauges: L.gpu ? [gauge('GPUメモリの空き', L.gpu.totalMiB - L.gpu.usedMiB, L.gpu.totalMiB, 'MiB')] : [], note: L.gpu ? `${L.gpu.name}。入っているモデル: ${L.models.join(', ') || 'なし'}` : `入っているモデル: ${L.models.join(', ') || 'なし'}`, lastRun: lastRunOf('local') });

  // Gemini(文章専用)
  const g = P.gemini;
  const gOk = (g.models || []).filter((m) => m.state === 'ok').length;
  const gSt = !g.hasKey ? statusOfBrain({ hasKey: false }) : gOk > 0 ? { status: 'ok', label: `使えるモデル ${gOk} / ${g.models.length}` } : statusOfBrain({ hasKey: true, probe: (g.models || [])[0]?.state || 'down' });
  brains.push({ id: 'gemini', label: 'Gemini API(文章専用)', kind: 'free', role: 'text', ...S(gSt), gauges: g.hasKey ? [gauge('使えるモデル', gOk, g.models.length, '個', { items: g.models.map((m) => ({ name: m.model, state: m.state })) })] : [], note: '無料枠はモデルごと。1日の残り回数は取得できません。', lastRun: lastRunOf('gemini') });

  // Groq(文章専用): 応答ヘッダに残量が付く
  const q = P.groq;
  const qSt = !q.hasKey ? statusOfBrain({ hasKey: false }) : statusOfBrain({ hasKey: true, probe: q.state });
  const qg = [];
  if (q.reqRemaining != null && q.reqLimit) qg.push(gauge('今日のリクエスト', q.reqRemaining, q.reqLimit, '回'));
  if (q.tokRemaining != null && q.tokLimit) qg.push(gauge('1分あたりのトークン', q.tokRemaining, q.tokLimit, 'トークン'));
  brains.push({ id: 'groq', label: 'Groq(文章専用)', kind: 'free', role: 'text', ...S(qSt), gauges: qg, note: '応答ヘッダの残量をそのまま表示しています。1回の入力が小さいので文章専用です。', lastRun: lastRunOf('groq') });

  // 自動の順番(dispatch.py)で、いま最初に使われる頭脳
  const idOf = (c) => (c === 'qwen' || c === 'oc' ? 'alibaba' : c);
  const stOf = (id) => brains.find((b) => b.id === id)?.status;
  const nextOf = (chain) => { for (const c of chain) if (stOf(idOf(c)) === 'ok') return idOf(c); return null; };
  const labelOf = (id) => brains.find((b) => b.id === id)?.label || id;
  return {
    updatedAt: new Date().toISOString(),
    brains,
    chain: { agent: AUTO_CHAIN.map(idOf).filter((x, i, arr) => arr.indexOf(x) === i), text: TEXT_CHAIN.map(idOf) },
    next: { agent: nextOf(AUTO_CHAIN), text: nextOf(TEXT_CHAIN) },
    nextLabels: { agent: labelOf(nextOf(AUTO_CHAIN)), text: labelOf(nextOf(TEXT_CHAIN)) },
  };
}

async function main() {
  const [alibaba, gemini, groq, openrouter, nvidia, mistral, cloudflare, local] = await Promise.all([
    probeAlibaba(), probeGemini(), probeGroq(), probeOpenRouter(),
    probeList('https://integrate.api.nvidia.com/v1/models', E.NVIDIA_API_KEY), probeList('https://api.mistral.ai/v1/models', E.MISTRAL_API_KEY),
    probeCloudflare(), probeLocal(),
  ]);
  const result = build(recentRuns(), { alibaba, gemini, groq, openrouter, nvidia, mistral, cloudflare, local });
  if (process.env.BRAINS_OUT) fs.writeFileSync(process.env.BRAINS_OUT, JSON.stringify(result)); // 画面確認用に全文を書き出す(保存はしない)
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ next: result.nextLabels, brains: result.brains.map((b) => ({ id: b.id, status: b.status, label: b.statusLabel, gauges: b.gauges.map((g) => `${g.label} ${g.remaining}/${g.total}${g.unit}`) })) }, null, 1));
    return;
  }
  initBranch();
  writeFile('brains.json', result, `brain status ${result.updatedAt}`);
  console.log(`保存した: 頭脳 ${result.brains.length} 件 / 次に使われる: エージェント=${result.nextLabels.agent} 文章=${result.nextLabels.text}`);
}

main().catch((e) => {
  console.error(`record-brain-status FATAL: ${String(e.message).split('\n')[0]}`);
  process.exit(1);
});
