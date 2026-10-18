#!/usr/bin/env node
/**
 * loop-run.mjs — 自己改善ループのランナー: 入口 → アダプタ → カード検査 → （症状があれば）提案書づくり → 受信箱、を1回分、一続きに回す。
 *
 * 役割: 部品（アダプタ・症状カード検査・loop-propose・形式検査・台帳）を順に呼ぶだけの薄い司令塔。判断は lib/loop-run-core.mjs（純関数）。
 *   設計: _docs/DESIGN-self-improvement-loop-2026-10-18.md §2・§4 部品5。人間への出口は _loop/<project>/INBOX.md（追記専用の受信箱）。承認は人間が自分のターミナルで台帳に書く。
 * 使い方: node scripts/loop-run.mjs --project <名前> --adapter '["node","scripts/loop-adapter-status-live.mjs"]' --model <Ollamaのモデル名>
 *           [--source '["node","scripts/status-live.mjs","--json"]']  アダプタの標準入力へ渡す文字列を出すコマンド（無ければ空）
 *           [--glossary <用語集>] [--repo <対象リポ>] [--ollama http://127.0.0.1:11434] [--timeout 秒] [--force] [--root <_loop/<project>>] [--cwd <作業ディレクトリ>]
 *           [--config <JSONファイル>]  上のキーを JSON で持てる（フラグが優先。--source/--adapter は配列のまま書く）
 *   --source / --adapter は **JSON の配列（実行ファイルと引数）**で渡し、シェルは通さない。人間（または設定ファイル）が決めた固定のコマンドだけを走らせる。
 * 守ること（設計 §3・§8）: 症状が無ければ AI を呼ばない／同じ症状の提案が台帳にあれば止める（効果なしになったものだけ再提案）／Ollama に届かなければ止まる
 *   （外部AIへは落とさない）／アダプタ・カード検査・提案書の形式検査のどれかが落ちたら先へ進まない（fail-closed）。AIに渡るのは検査済みのカードだけ。
 * 終了コード: 0=正常に終えた（提案書を置いた／症状なし／重複で止めた） / 1=カードまたは提案書が検査に通らない / 2=測れていない（入口・アダプタ・Ollama に届かない・引数不足）
 * 出力: 最後に `RESULT: <proposed|no-symptoms|skip-duplicate> …` の1行。実行の記録は <root>/runs/<時刻>/run.json（症状IDと件数だけ。データは含めない）。
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './lib/instrument-core.mjs';
import { assertLocalUrl } from './lib/loop-propose-core.mjs';
import { decideAction, formatInboxEntry } from './lib/loop-run-core.mjs';
import { validateSymptomCard } from './lib/symptom-card-core.mjs';

const KIT_SCRIPTS = dirname(fileURLToPath(import.meta.url));

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    if (k === 'force') a.force = true;
    else if (i + 1 < argv.length) a[k] = argv[++i];
  }
  return a;
}
/** @param {string} msg @param {number} code */
function die(msg, code) {
  console.error('[loop-run] ' + msg);
  process.exit(code);
}
/** JSON の配列（文字列だけ）を argv として取り出す。 @param {unknown} v @param {string} name */
function argvOf(v, name) {
  let x = v;
  if (typeof v === 'string') {
    try {
      x = JSON.parse(v);
    } catch {
      die(`--${name} は JSON の配列で渡す（例: '["node","x.mjs"]'）`, EXIT.INCONCLUSIVE);
    }
  }
  if (!Array.isArray(x) || x.length === 0 || x.some((e) => typeof e !== 'string' || e === '')) die(`--${name} は空でない文字列の配列にする`, EXIT.INCONCLUSIVE);
  return /** @type {string[]} */ (x);
}

const flags = parseArgs(process.argv.slice(2));
/** @type {Record<string, any>} */
let cfg = {};
if (flags.config) {
  try {
    cfg = JSON.parse(readFileSync(String(flags.config), 'utf8'));
  } catch {
    die('--config が JSON として読めない（測れていない）', EXIT.INCONCLUSIVE);
  }
}
/** @param {string} k */
const opt = (k) => (flags[k] !== undefined ? flags[k] : cfg[k]);
const project = opt('project');
if (!project || !opt('adapter') || !opt('model')) die('--project / --adapter / --model が要る（使い方はファイル先頭のコメント）', EXIT.INCONCLUSIVE);
const adapter = argvOf(opt('adapter'), 'adapter');
const source = opt('source') !== undefined ? argvOf(opt('source'), 'source') : null;
// 送り先がローカルでなければ、何も走らせる前に止める（外部へ出る設定を、入口やアダプタを動かす前に弾く）
try {
  assertLocalUrl(String(opt('ollama') || 'http://127.0.0.1:11434'));
} catch (e) {
  die('送り先がローカル(127.0.0.1)ではない。外部へは送らない: ' + (e instanceof Error ? e.message : String(e)), EXIT.FAIL);
}
const cwd = resolve(String(opt('cwd') || process.cwd()));
const root = resolve(cwd, String(opt('root') || join('_loop', String(project))));
const force = Boolean(flags.force || cfg.force);
const now = new Date();
const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const runDir = join(root, 'runs', stamp);
const symptomsDir = join(runDir, 'symptoms');
mkdirSync(symptomsDir, { recursive: true });

/** @param {string} cmd @param {string[]} args @param {import('node:child_process').SpawnSyncOptionsWithStringEncoding} o */
const run = (cmd, args, o) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...o });

// 1) 入口（任意）: アダプタの標準入力へ渡す文字列。異常終了でも、出力があれば先へ進む（診断のように異常で exit 1/2 になる入口がある）
let input = '';
if (source) {
  const r = run(source[0], source.slice(1), { cwd });
  if (r.error || !r.stdout || r.stdout.trim() === '') die('入口コマンドの出力が空（測れていない）', EXIT.INCONCLUSIVE);
  input = r.stdout;
}

// 2) アダプタ → 症状カード（出力先と検査器の場所は環境変数で渡す）
const ad = run(adapter[0], adapter.slice(1), { cwd, input, env: { ...process.env, LOOP_OUT_DIR: symptomsDir, LOOP_KIT_DIR: KIT_SCRIPTS } });
if (ad.stderr) process.stderr.write(ad.stderr);
if (ad.status === 1) die('アダプタの症状カードが検査に通らない。先へ進まない', EXIT.FAIL);
if (ad.status !== 0) die('アダプタが動かなかった（測れていない）', EXIT.INCONCLUSIVE);

// 3) カード検査（アダプタの自己検査とは別に、ランナーが必ず通す）
/** @type {Array<Record<string, any>>} */
const cards = [];
for (const f of readdirSync(symptomsDir).filter((x) => x.endsWith('.json'))) {
  const raw = readFileSync(join(symptomsDir, f), 'utf8');
  let c;
  try {
    c = JSON.parse(raw);
  } catch {
    die('症状カードがJSONとして読めない。先へ進まない', EXIT.FAIL);
  }
  const v = validateSymptomCard(c, { byteLength: Buffer.byteLength(raw) });
  if (!v.ok) die('症状カードが検査に通らない。先へ進まない', EXIT.FAIL);
  cards.push(c);
}
if (cards.length === 0) die('アダプタがカードを1枚も作らなかった（測れていない。緑ではない）', EXIT.INCONCLUSIVE);

// 4) 判断（症状なし／重複／提案）
const ledgerPath = join(root, 'decisions.jsonl');
const statePath = join(root, 'state.json');
/** @type {Array<Record<string, any>>} */
let ledger = [];
/** @type {{ bySignature: Record<string, string> }} */
let state = { bySignature: {} };
try {
  if (existsSync(ledgerPath)) ledger = readFileSync(ledgerPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  if (existsSync(statePath)) state = JSON.parse(readFileSync(statePath, 'utf8'));
} catch {
  die('台帳または state.json が読めない。壊れた状態では進まない', EXIT.FAIL);
}
const decision = decideAction({ cards, ledger, state, force });
const symptomCount = cards.filter((c) => c.verdict === 'fail' || c.verdict === 'warn').length;
const unmeasuredCount = cards.filter((c) => c.verdict === 'unmeasured').length;
/** @param {Record<string, unknown>} extra */
const writeRun = (extra) =>
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ schema: 1, at: now.toISOString(), project, action: decision.action, reason: decision.reason, signature: decision.signature, cards: cards.length, symptomCount, unmeasuredCount, ...extra }, null, 2) + '\n', 'utf8');

if (decision.action !== 'propose') {
  writeRun({ exit: 0 });
  console.log(`RESULT: ${decision.action} ${decision.reason}`);
  process.exit(EXIT.PASS);
}

// 5) 提案書づくり（ローカルの Ollama。落ちたら止まる。外部AIへは落とさない）
const proposalsDir = join(root, 'proposals');
const pArgs = ['--project', String(project), '--cards', symptomsDir, '--model', String(opt('model')), '--out', proposalsDir, '--ledger', ledgerPath];
for (const k of ['glossary', 'repo', 'ollama', 'timeout']) if (opt(k) !== undefined) pArgs.push(`--${k}`, String(opt(k)));
const pr = run(process.execPath, [join(KIT_SCRIPTS, 'loop-propose.mjs'), ...pArgs], { cwd });
if (pr.stderr) process.stderr.write(pr.stderr);
if (pr.status !== 0) {
  writeRun({ exit: pr.status });
  if (pr.status === 1) die('提案書が形式検査に通らなかった（_invalid に隔離。人間には渡さない）', EXIT.FAIL);
  die('提案書づくりが動かなかった（Ollama に届かない等）。外部AIへは落とさず止まる', EXIT.INCONCLUSIVE);
}

// 6) 受信箱へ
const entries = readFileSync(ledgerPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const proposalId = String(entries[entries.length - 1].proposal);
const proposalPath = join(proposalsDir, `${proposalId}.md`);
state.bySignature[decision.signature] = proposalId;
writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
appendFileSync(join(root, 'INBOX.md'), formatInboxEntry({ at: now.toISOString(), project: String(project), action: 'proposed', reason: decision.reason, proposalPath, signature: decision.signature }), 'utf8');
writeRun({ exit: 0, proposal: proposalId });
console.log(`RESULT: proposed ${proposalId} ${proposalPath}`);
process.exit(EXIT.PASS);
