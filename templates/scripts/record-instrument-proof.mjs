#!/usr/bin/env node
/**
 * record-instrument-proof.mjs — ★run-instruments.mjs の --report 出力から証明3点台帳を更新する「記録の口」。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ 何をするか
 *   `.instrument-report.json`（run-instruments.mjsが--reportで書く実行結果）を読み、
 *   各検査の pass/fail を `.instrument-proof.json`（証明3点台帳）へ書き込む。
 *   inconclusiveは書かない（測れなかったを証明に混ぜない。判定は lib/instrument-proof.mjs 側）。
 *
 * ■ ★なぜ run-instruments.mjs の中に直接書き込まないか
 *   `check-instrument-ran.mjs --stamp` と同じ理由: 記録の書き込み経路を検査本体の
 *   実行ロジックから分離しておくと、「本当に実行から来た記録か」を later に検証しやすい。
 *   ★このスクリプト自体は「report を信じて転記するだけ」であり、report が本物かは
 *   見ない（このスクリプトの限界。README §6 に明記する）。
 *
 * ■ 使い方
 *   node scripts/run-instruments.mjs --report .instrument-report.json .
 *   node scripts/record-instrument-proof.mjs --report .instrument-report.json .
 *   node scripts/record-instrument-proof.mjs --report ... --preflight .ai-hub-search.log .
 *
 * ■ ★PRE-FLIGHT/POST-FLIGHT証拠の記録方針（2026-09-02、AIの行動監視ではなく証拠の有無で判定するための拡張）
 *   - `changedFiles`（POST-FLIGHT証拠）は★常にGitから自動取得する（`git diff --name-only HEAD`。
 *     ステージ済み・未ステージ両方を含む「HEADから見た現在の作業ツリーの差分」で、基準commitは
 *     常にHEADと一意に決まるため自己申告(--files)は不要と判断した。gitが使えない/対象がgit管理下に
 *     無い場合のみ自動取得を諦め、その旨をログに出す（無音で空配列にしない）
 *   - `preflightSearchPath`（PRE-FLIGHT証拠）はAIが`hub.mjs find --log <path>`で書いたログファイルへの
 *     パスを`--preflight`で渡す。ai-hub側の検索は本スクリプトの外で起きる行為なので、これだけは
 *     自動取得できず引数で受け取る（ただし記録するのは「そのログファイルが存在するか」という
 *     事実であって、検索結果の中身ではない。中身の検証はcheck-instrument-proof.mjs側の責務）
 *
 * ■ 終了コード
 *   0 = 記録できた（1件以上のpass/failを反映） / 1 = report がJSONとして壊れている
 *   2 = report が無い、または反映対象が0件（測れなかった）
 * ───────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { EXIT } from './lib/instrument-core.mjs';
import { applyProofUpdate, codeOnly, hashSource } from './lib/instrument-proof.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(startDir, '..');
}

const argv = process.argv.slice(2);
function opt(name, fallback = null) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}
const VALUE_OPTIONS = new Set(['--report', '--preflight']);
const positional = argv.find((arg, index) => !arg.startsWith('-') && !VALUE_OPTIONS.has(argv[index - 1]));

const ROOT = positional ? resolve(positional) : findRepoRoot(HERE);
const REPORT_PATH = resolve(ROOT, opt('--report', '.instrument-report.json'));
const PROOF_PATH = join(ROOT, '.instrument-proof.json');
const PREFLIGHT_PATH = opt('--preflight'); // ★hub.mjs find --logが書いたログファイルへの相対パス。無指定なら記録しない

function git(args, cwd = ROOT) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8', cwd, timeout: 15000, stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

function readJson(path) {
  if (!existsSync(path)) return { ok: false, missing: true, value: null };
  try {
    return { ok: true, missing: false, value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return { ok: false, missing: false, value: null };
  }
}

const report = readJson(REPORT_PATH);
if (report.missing) {
  console.log(`[record-instrument-proof] 🟡 report が見つかりません: ${REPORT_PATH}（先に run-instruments.mjs --report を実行してください）`);
  process.exit(EXIT.INCONCLUSIVE);
}
if (!report.ok) {
  console.error(`[record-instrument-proof] 🔴 report がJSONとして読めません: ${REPORT_PATH}`);
  process.exit(EXIT.FAIL);
}

const results = Array.isArray(report.value?.results) ? report.value.results : [];
const head = git(['rev-parse', 'HEAD']);
const at = new Date().toISOString();

/**
 * ★POST-FLIGHT証拠: 記録時点でHEADとの差分として存在するworkspace変更のファイル一覧を
 * Gitから自動取得する。★「このタスクだけが変更したファイル」という意味ではない
 * （タスク単位で区切る入れ物はまだ無い。持たせるのは③の話で、今回は作らない）。
 *
 * 2つを合成する:
 *   - `git diff --name-only HEAD`      … tracked（ステージ済み・未ステージ両方）
 *   - `git ls-files --others --exclude-standard` … untracked（gitignore対象は除く新規ファイル）
 * ★untrackedを含めないと、AIが新規ファイルだけを作ったタスクの証拠が抜ける
 *   （既存ファイルの変更が0件の回はchangedFilesが常に空になってしまう）。
 * 取れなければnull（自己申告での穴埋めはしない。fail-closedのまま「取れなかった」を明示する）。
 */
function changedFilesFromGit() {
  if (!head) return null;
  const tracked = git(['diff', '--name-only', 'HEAD']);
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  if (tracked === null || untracked === null) return null;
  const combined = new Set([
    ...tracked.split('\n').map((l) => l.trim()).filter(Boolean),
    ...untracked.split('\n').map((l) => l.trim()).filter(Boolean)
  ]);
  return [...combined].sort();
}
const changedFiles = changedFilesFromGit();
if (changedFiles === null) {
  console.log('[record-instrument-proof] 🟡 Gitから変更ファイル一覧を取得できません（changedFilesは記録しません）');
}

/**
 * ★PRE-FLIGHT証拠: ログファイルの最小限の構造だけを見て、receipt（最小限の中身）を取り出す
 * （署名検証・改ざん防止はしない。目的は「全く関係ないファイルを誤ってpreflight証拠として
 * 渡す事故」を防ぐことだけ）。hub.mjs find --logは1行1JSON追記形式なので、末尾の
 * （＝最新の）行を見る。
 *
 * ★なぜreceiptを取り出すか（pathを保存するだけでは不十分な理由）:
 *   ログファイル自体は一時ファイル（/tmp・gitignore対象等）になりうる。台帳に
 *   「ログがあった場所」というpath文字列だけを残すと、そのログが後から削除された
 *   時点で★検証不能な文字列が残るだけになる。台帳自身が「その時ログに何が書いて
 *   あったか」の最小限の写しを持てば、元ログが消えても検証できる。
 *
 * @param {string} text
 * @returns {{cmd:string, at:string, tag:string[]|null, sig:string|null, exitCode:number, hits:number}|null}
 */
function parseHubFindLogReceipt(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  let last;
  try { last = JSON.parse(lines[lines.length - 1]); } catch { return null; }
  if (!last || typeof last !== 'object') return null;
  if (last.cmd !== 'find') return null;
  if (typeof last.at !== 'string' || !last.at) return null;
  if (typeof last.exitCode !== 'number') return null;
  if (typeof last.hits !== 'number') return null;
  if (!last.tag && !last.sig) return null; // ★検索条件(tag/sig)のどちらかは要る
  return {
    cmd: last.cmd,
    at: last.at,
    tag: Array.isArray(last.tag) ? last.tag : null,
    sig: typeof last.sig === 'string' ? last.sig : null,
    exitCode: last.exitCode,
    hits: last.hits
  };
}

/**
 * ★PRE-FLIGHT証拠: ログファイルが実在し最小構造を満たすかを見て、receiptを取り出す。
 * preflightSearchPathは★補助情報（元ログの場所）としてのみ残す。pass判定の根拠は
 * receipt本体（台帳に永続コピーされる）であり、path文字列の存在だけでは判定しない
 * （lib/instrument-proof.mjs の judgePreflight 参照）。
 */
const preflightAbs = PREFLIGHT_PATH ? resolve(ROOT, PREFLIGHT_PATH) : null;
const preflightReceipt = preflightAbs && existsSync(preflightAbs)
  ? parseHubFindLogReceipt(readFileSync(preflightAbs, 'utf8'))
  : null;
const preflightSearchPath = preflightReceipt ? PREFLIGHT_PATH : null;
if (PREFLIGHT_PATH && !preflightReceipt) {
  console.log(`[record-instrument-proof] 🟡 --preflightで指定されたファイルがai-hub検索ログの形をしていません: ${PREFLIGHT_PATH}（preflightSearchは記録しません）`);
}

const existingProof = readJson(PROOF_PATH);
if (existingProof.value && !existingProof.ok) {
  console.error(`[record-instrument-proof] 🔴 既存の台帳がJSONとして壊れています: ${PROOF_PATH}`);
  process.exit(EXIT.FAIL);
}
let checks = existingProof.value?.checks && typeof existingProof.value.checks === 'object'
  ? existingProof.value.checks
  : {};

/**
 * ★対象スクリプトの現在のソースからhashを計算する。読めなければnull（0埋めしない）。
 * `item.script` は run-instruments.mjs が ROOT 相対で記録している（run-instruments.mjs:49 参照）。
 */
function currentSourceHash(scriptRelPath) {
  const abs = resolve(ROOT, scriptRelPath);
  if (!existsSync(abs)) return null;
  try {
    return hashSource(codeOnly(readFileSync(abs, 'utf8')));
  } catch {
    return null;
  }
}

let applied = 0;
let skippedNoHash = 0;
for (const item of results) {
  if (!item || !item.script) continue; // ★scriptキーが無い結果は台帳に書けない（実体を持たない集約結果等）
  if (item.verdict !== 'pass' && item.verdict !== 'fail') continue;
  const sourceHash = currentSourceHash(item.script);
  if (!sourceHash) { skippedNoHash++; continue; } // ★hashが測れない結果を無音の空hashで書かない(fail-closed)
  const before = checks;
  checks = applyProofUpdate(checks, item, {
    commit: head || '', at, sourceHash,
    ...(preflightSearchPath ? { preflightSearchPath } : {}),
    ...(preflightReceipt ? { preflightSearch: preflightReceipt } : {}),
    ...(changedFiles !== null ? { changedFiles } : {})
  });
  if (checks !== before) applied++;
}

if (!head) {
  console.log('[record-instrument-proof] 🟡 git が使えないため記録しません（★測れませんでした）');
  process.exit(EXIT.INCONCLUSIVE);
}
if (applied === 0) {
  console.log('[record-instrument-proof] 🟡 反映対象がありません（reportにpass/failのscript付き結果が無い）');
  process.exit(EXIT.INCONCLUSIVE);
}

mkdirSync(dirname(PROOF_PATH), { recursive: true });
writeFileSync(PROOF_PATH, JSON.stringify({ schemaVersion: 1, checks }, null, 2) + '\n');
const skipNote = skippedNoHash ? `（hash未計算のため${skippedNoHash}件は見送り）` : '';
console.log(`[record-instrument-proof] ✅ ${applied}件を記録: ${PROOF_PATH} @ ${head.slice(0, 8)}${skipNote}`);
process.exit(EXIT.PASS);
