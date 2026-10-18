#!/usr/bin/env node
/**
 * loop-propose.mjs — 自己改善ループ第5歩: ローカルの Ollama に、症状カードから提案書を書かせる。
 *
 * 使い方: node scripts/loop-propose.mjs --project <名前> --cards <カードのディレクトリ> --model <Ollamaのモデル名>
 *           [--glossary <用語集.txt>] [--out <提案書の置き場>] [--ledger <decisions.jsonl>] [--ollama http://127.0.0.1:11434]
 *   既定の置き場: _loop/<project>/proposals/ と _loop/<project>/decisions.jsonl
 * 守ること（設計 §3・§5）:
 *   - 送り先はローカルだけ（assertLocalUrl）。dispatch.py は使わない（道具つきエージェントで、外部へ落ちる経路もあるため）。Ollama の /api/chat を
 *     道具なし・1回だけ呼ぶ。外部AIへは自動で落ちない。落ちたら止まる。
 *   - AIに渡すのは、症状カード検査（symptom-card-core）を**通ったカードだけ**。1枚でも違反したら何も送らない。
 *   - 提案書のヘッダーは機械が付け、最後に proposal-format-core で全体を検査。通った提案書だけを proposals/ に置き、台帳に proposed（ai:）を追記する。
 *     通らなかった出力は proposals/_invalid/ に違反の一覧と一緒に置く（台帳には書かない。台帳は人間の決定の記録）。人間には渡さない。
 * 終了コード: 0=提案書を置いた / 1=提案書が形式検査に通らない or カードが検査に通らない / 2=測れていない（Ollama に届かない・引数不足・タイムアウト）
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './lib/instrument-core.mjs';
import { assembleProposal, assertLocalUrl, buildPrompt, extractBody, writerOf } from './lib/loop-propose-core.mjs';
import { validateProposal } from './lib/proposal-format-core.mjs';
import { validateSymptomCard } from './lib/symptom-card-core.mjs';

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--') && i + 1 < argv.length) a[argv[i].slice(2)] = argv[++i];
  return a;
}
const a = parseArgs(process.argv.slice(2));
for (const k of ['project', 'cards', 'model']) {
  if (!a[k]) {
    console.error(`[loop-propose] --${k} が要る（使い方はファイル先頭のコメント）`);
    process.exit(EXIT.INCONCLUSIVE);
  }
}
const base = a.ollama || 'http://127.0.0.1:11434';
try {
  assertLocalUrl(base);
} catch (e) {
  console.error('[loop-propose] 拒否: ' + (e instanceof Error ? e.message : String(e)));
  process.exit(EXIT.FAIL);
}

// 1) カードを読み、検査に通ったものだけを使う
if (!existsSync(a.cards)) {
  console.error('[loop-propose] カードのディレクトリが無い（測れていない）');
  process.exit(EXIT.INCONCLUSIVE);
}
const cards = [];
let badCards = 0;
for (const f of readdirSync(a.cards).filter((x) => x.endsWith('.json'))) {
  const raw = readFileSync(join(a.cards, f), 'utf8');
  let c;
  try {
    c = JSON.parse(raw);
  } catch {
    console.error(`✗ ${f}: JSONとして読めない`);
    badCards++;
    continue;
  }
  const r = validateSymptomCard(c, { byteLength: Buffer.byteLength(raw) });
  if (!r.ok) {
    badCards++;
    console.error(`✗ ${f}: 症状カードの検査に通らない（AIへ渡さない）`);
    for (const x of r.violations) console.error(`    ${x.path}: ${x.rule}`);
  } else cards.push(c);
}
if (badCards > 0) process.exit(EXIT.FAIL);
if (cards.length === 0) {
  console.error('[loop-propose] カードが1枚も無い（測れていない）');
  process.exit(EXIT.INCONCLUSIVE);
}

// 2) ローカルの Ollama を1回呼ぶ（道具なし）
let glossary;
if (a.glossary) {
  try {
    glossary = readFileSync(a.glossary, 'utf8');
  } catch {
    console.error('[loop-propose] 用語集が読めない（測れていない）');
    process.exit(EXIT.INCONCLUSIVE);
  }
}
let prompt;
try {
  prompt = buildPrompt({ cards, glossary });
} catch (e) {
  console.error('[loop-propose] 拒否: ' + (e instanceof Error ? e.message : String(e)));
  process.exit(EXIT.FAIL);
}
const { system, user } = prompt;
/** @param {boolean} withThink */
async function chat(withThink) {
  const body = {
    model: a.model,
    stream: true, // ★stream:false だと生成が終わるまでヘッダーが返らず、Node標準の通信が5分で切れる（実測）。逐次受け取る
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    options: { temperature: 0.2, num_ctx: 8192, num_predict: 3000 },
    ...(withThink ? { think: false } : {}),
  };
  return fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(Number(a.timeout || 900) * 1000) });
}
/** NDJSON のストリームから message.content をつなげる。 @param {Response} res */
async function readStream(res) {
  const dec = new TextDecoder();
  let buf = '';
  let out = '';
  for await (const chunk of /** @type {any} */ (res.body)) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const j = JSON.parse(line);
      if (j.error) throw new Error('ollama: ' + String(j.error).slice(0, 120));
      out += j?.message?.content ?? '';
    }
  }
  return out;
}
let raw;
const t0 = Date.now();
try {
  let res = await chat(true);
  if (res.status === 400) res = await chat(false); // thinking 非対応のモデル
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  raw = await readStream(res);
} catch (e) {
  console.error('[loop-propose] Ollama に届かない/応答が壊れた（測れていない）。外部AIへは落とさない: ' + (e instanceof Error ? e.message + (e.cause ? ' / ' + (/** @type {any} */ (e.cause).code || '') : '') : String(e)));
  process.exit(EXIT.INCONCLUSIVE);
}
const seconds = Math.round((Date.now() - t0) / 1000);

// 3) 組み立て→検査→置き場所
const root = a.out ? resolve(a.out, '..') : join('_loop', a.project);
const proposalsDir = a.out || join(root, 'proposals');
const ledger = a.ledger || join(root, 'decisions.jsonl');
mkdirSync(proposalsDir, { recursive: true });
const n = readdirSync(proposalsDir).filter((f) => /^P\d{4}-/.test(f)).length + (existsSync(join(proposalsDir, '_invalid')) ? readdirSync(join(proposalsDir, '_invalid')).filter((f) => /^P\d{4}-.*\.md$/.test(f)).length : 0) + 1;
const head = String(cards[0].id).replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 40);
const proposalId = `P${String(n).padStart(4, '0')}-${head}`;
const text = assembleProposal({ proposalId, project: a.project, cardIds: cards.map((c) => c.id), writer: writerOf(a.model), body: extractBody(raw) });
const ledgerEntries = existsSync(ledger) ? readFileSync(ledger, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
const res = validateProposal(text, { cards, ledger: ledgerEntries });
if (!res.ok) {
  const inv = join(proposalsDir, '_invalid');
  mkdirSync(inv, { recursive: true });
  writeFileSync(join(inv, `${proposalId}.md`), text, 'utf8');
  writeFileSync(join(inv, `${proposalId}.violations.txt`), res.violations.map((x) => `${x.where}: ${x.rule}`).join('\n') + '\n', 'utf8');
  console.error(`[loop-propose] 提案書が形式検査に通らない（${seconds}秒）。人間には渡さない: ${join(inv, proposalId + '.md')}`);
  for (const x of res.violations) console.error(`    ${x.where}: ${x.rule}`);
  process.exit(EXIT.FAIL);
}
writeFileSync(join(proposalsDir, `${proposalId}.md`), text, 'utf8');
const here = dirname(fileURLToPath(import.meta.url));
const rec = spawnSync(process.execPath, [join(here, 'record-loop-decision.mjs'), '--ledger', ledger, '--proposal', proposalId, '--decision', 'proposed', '--by', writerOf(a.model)], { encoding: 'utf8' });
if (rec.status !== 0) {
  console.error('[loop-propose] 提案書は置いたが、台帳への追記に失敗:\n' + rec.stderr);
  process.exit(EXIT.FAIL);
}
console.log(`[loop-propose] 提案書を置いた（${seconds}秒・${a.model}）: ${join(proposalsDir, proposalId + '.md')}`);
process.exit(EXIT.PASS);
