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
const VALUE_OPTIONS = new Set(['--report']);
const positional = argv.find((arg, index) => !arg.startsWith('-') && !VALUE_OPTIONS.has(argv[index - 1]));

const ROOT = positional ? resolve(positional) : findRepoRoot(HERE);
const REPORT_PATH = resolve(ROOT, opt('--report', '.instrument-report.json'));
const PROOF_PATH = join(ROOT, '.instrument-proof.json');

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
  checks = applyProofUpdate(checks, item, { commit: head || '', at, sourceHash });
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
