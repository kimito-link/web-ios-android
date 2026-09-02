#!/usr/bin/env node
/**
 * check-decision-receipt.mjs — ★新規source fileがある変更に、Decision Receiptを要求する門番。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ 何をするか
 *   _docs/DESIGN-canonical-boundary-rules.md（v1.0、正式採用）の実装。
 *   「新しい実装を作る前にCANONICAL CHECKを通した記録が無ければ、完了扱いにできない」
 *   という最小の仕組み。
 *
 *   Gitから客観的に取得できる「新規追加source file」を検出し（tracked=diff --diff-filter=A、
 *   untracked=ls-files --others）、1件でもあれば `.decision-receipts.json` を読み、
 *   対応するDecision Receiptが記録されているかを見る。
 *
 * ■ ★何を判定しないか（限界の明記。規約の原則そのもの）
 *   ・その判断（REUSE/ESTABLISH_REHOME/CONTRACT/SYNC/KEEP_SEPARATE/LOCAL）が
 *     責務として正しかったか（Semantic Judgment）。これは人間/AIがCANONICAL CHECKで
 *     判断するものであり、機械が自動判定しない
 *   ・新規関数・新規class・新規CSS selector・類似ロジック（MVPの対象外。新規source fileのみ）
 *   ・receiptがそのタスクの意図と一致しているか（記録があるかだけを見る）
 *
 * ■ 使い方
 *   node scripts/check-decision-receipt.mjs --check [対象リポ]
 *   node scripts/check-decision-receipt.mjs --selftest
 *
 * ■ 終了コード（3値規約）
 *   0 = 新規source fileが無い、または全て有効なreceiptがある
 *   1 = receiptのdecisionがenum外、またはcanonicalSourceが不正（客観的に壊れている）
 *   2 = 新規source fileがあるのにreceiptが無い（測れなかった＝未記録）
 * ───────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';
import { judgeDecisionReceipt } from './lib/instrument-proof.mjs';

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
const has = (f) => argv.includes(f);
const positional = argv.find((arg) => !arg.startsWith('-'));

const ROOT = positional ? resolve(positional) : findRepoRoot(HERE);
const RECEIPTS_FILE = join(ROOT, '.decision-receipts.json');

/** ★このMVPが対象にするsource拡張子（check-tracked-imports.mjsのSOURCE_EXTと揃える）。 */
const SOURCE_EXT = /\.(js|mjs|ts|tsx|jsx)$/;

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

/**
 * ★新規追加source fileを客観的に検出する（Gitの2つの一覧を合成、changedFilesFromGitと同型）。
 *   - `git diff --diff-filter=A --name-only HEAD` … HEADとの差分でAdd（tracked、ステージ済み含む）
 *   - `git ls-files --others --exclude-standard`   … untracked新規ファイル
 * 取れなければnull（自己申告での穴埋めはしない。fail-closed）。
 * @returns {string[]|null}
 */
function newSourceFilesFromGit() {
  const added = git(['diff', '--diff-filter=A', '--name-only', 'HEAD']);
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  if (added === null || untracked === null) return null;
  const combined = new Set([
    ...added.split('\n').map((l) => l.trim()).filter(Boolean),
    ...untracked.split('\n').map((l) => l.trim()).filter(Boolean)
  ]);
  return [...combined].filter((p) => SOURCE_EXT.test(p)).sort();
}

/** ★changedFiles（新規に限らず今回の変更全体）。ESTABLISH_REHOMEのcanonicalSource照合に使う。 */
function changedFilesFromGit() {
  const tracked = git(['diff', '--name-only', 'HEAD']);
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  if (tracked === null || untracked === null) return null;
  const combined = new Set([
    ...tracked.split('\n').map((l) => l.trim()).filter(Boolean),
    ...untracked.split('\n').map((l) => l.trim()).filter(Boolean)
  ]);
  return [...combined].sort();
}

function readReceipts(file = RECEIPTS_FILE) {
  if (!existsSync(file)) return { receipts: [] }; // ★台帳が無い＝まだ一度も記録していない
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return j && typeof j === 'object' && Array.isArray(j.receipts) ? j : { receipts: [] };
  } catch {
    return null; // ★壊れている（無いのと区別する）
  }
}

/* ── --selftest ─────────────────────────────────────────────── */
if (has('--selftest')) {
  const exists = (p) => new Set(['scripts/lib/repo-root.mjs']).has(p);
  const { ok, fails } = runSelfTest([
    {
      name: '★新規source fileありReceiptなしは緑にしない',
      poison: () => {}, restore: () => {},
      isRed: () => judgeDecisionReceipt(undefined, { changedFiles: [] }).verdict === 'inconclusive'
    },
    {
      name: '★LOCALはcanonicalSource不要でpassする',
      poison: () => {}, restore: () => {},
      isRed: () => judgeDecisionReceipt(
        { at: new Date().toISOString(), responsibility: 'x', decision: 'LOCAL', canonicalSource: null, scopePaths: ['a.mjs'] },
        { changedFiles: [] }
      ).verdict === 'pass'
    },
    {
      name: '★REUSEでcanonicalSourceが無ければfail',
      poison: () => {}, restore: () => {},
      isRed: () => judgeDecisionReceipt(
        { at: new Date().toISOString(), responsibility: 'x', decision: 'REUSE', canonicalSource: null, scopePaths: [] },
        { changedFiles: [] }
      ).verdict === 'fail'
    },
    {
      name: '★REUSEでcanonicalSourceが不実在ならfail',
      poison: () => {}, restore: () => {},
      isRed: () => judgeDecisionReceipt(
        { at: new Date().toISOString(), responsibility: 'x', decision: 'REUSE', canonicalSource: 'no/such/file.mjs', scopePaths: [] },
        { changedFiles: [], sourceExists: exists }
      ).verdict === 'fail'
    },
    {
      name: '★ESTABLISH_REHOMEでcanonicalSourceがchangedFiles内ならpass',
      poison: () => {}, restore: () => {},
      isRed: () => judgeDecisionReceipt(
        { at: new Date().toISOString(), responsibility: 'x', decision: 'ESTABLISH_REHOME', canonicalSource: 'scripts/lib/repo-root.mjs', scopePaths: [] },
        { changedFiles: ['scripts/lib/repo-root.mjs'], sourceExists: exists }
      ).verdict === 'pass'
    },
    {
      name: '★ESTABLISH_REHOMEでcanonicalSourceがchangedFiles外ならfail',
      poison: () => {}, restore: () => {},
      isRed: () => judgeDecisionReceipt(
        { at: new Date().toISOString(), responsibility: 'x', decision: 'ESTABLISH_REHOME', canonicalSource: 'scripts/lib/repo-root.mjs', scopePaths: [] },
        { changedFiles: [], sourceExists: exists }
      ).verdict === 'fail'
    },
    {
      name: '★decisionが6種類のenum外ならfail',
      poison: () => {}, restore: () => {},
      isRed: () => judgeDecisionReceipt(
        { at: new Date().toISOString(), responsibility: 'x', decision: 'MERGE_EVERYTHING', canonicalSource: null, scopePaths: [] },
        { changedFiles: [] }
      ).verdict === 'fail'
    },
    {
      name: '★台帳が無いのを壊れているのと混同しない',
      poison: () => {}, restore: () => {},
      isRed: () => {
        const missing = readReceipts(join(HERE, '__does-not-exist__.json'));
        return missing !== null && Array.isArray(missing.receipts);
      }
    },
    {
      name: '★KEEP_SEPARATEはcanonicalSource不要でpassする',
      poison: () => {}, restore: () => {},
      isRed: () => judgeDecisionReceipt(
        { at: new Date().toISOString(), responsibility: 'x', decision: 'KEEP_SEPARATE', canonicalSource: null, scopePaths: [] },
        { changedFiles: [] }
      ).verdict === 'pass'
    }
  ]);
  if (!ok) {
    console.error('[check-decision-receipt] ★selftest 失敗(検知器が効いていません):');
    for (const f of fails) console.error('  - ' + f);
    process.exit(EXIT.FAIL);
  }
  console.log('[check-decision-receipt] selftest OK（新規source fileありReceiptなし/enum外/canonicalSource不正 を緑にしない・6種類の判定が正しく通る）');
  process.exit(EXIT.PASS);
}

/* ── --check ────────────────────────────────────────────────── */
const newFiles = newSourceFilesFromGit();
if (newFiles === null) {
  console.log('[check-decision-receipt] 🟡 Gitから新規ファイル一覧を取得できません（測れませんでした）');
  process.exit(EXIT.INCONCLUSIVE);
}

if (newFiles.length === 0) {
  console.log('[check-decision-receipt] ✅ 新規source fileが無いため、Decision Receiptは不要です');
  process.exit(EXIT.PASS);
}

const receiptsDoc = readReceipts();
if (receiptsDoc === null) {
  console.error(`[check-decision-receipt] 🔴 台帳がJSONとして壊れています: ${RECEIPTS_FILE}`);
  process.exit(EXIT.FAIL);
}

const changedFiles = changedFilesFromGit() || [];
const receipts = receiptsDoc.receipts;

// ★新規ファイルごとに、そのファイルをscopePathsに含むreceiptが1件でもあるかを見る。
const results = newFiles.map((file) => {
  const matching = receipts.find((r) => Array.isArray(r?.scopePaths) && r.scopePaths.includes(file));
  const judged = judgeDecisionReceipt(matching, {
    changedFiles,
    sourceExists: (p) => existsSync(resolve(ROOT, p))
  });
  return { ...judged, probe: `Decision Receipt: ${file}` };
});

console.log(formatProbeReport(results, { label: 'check-decision-receipt' }));
for (const r of results) {
  if (r.verdict !== 'pass') {
    console.log('   → この検査はreceiptの客観的な形（有無・enum値・pathの実在）だけを見ます。判断の中身の妥当性は見ません');
  }
}

process.exit(computeExitCode(results));
