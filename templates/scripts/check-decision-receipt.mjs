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
 * ■ ★Just-in-time提示（2026-09-02、パイロット#1の実損を受けて追加）
 *   実損: check-decision-receipt.mjs/record-decision-receipt.mjs自身を新規作成した際、
 *   CANONICAL CHECKを行わずfindRepoRootを既存ファイルからそのままコピーし、事後に
 *   check-shared-parts-usedで重複を指摘されるまで気づかなかった。原因は「Decisionが
 *   間違っていた」ことではなく「必要な情報が実装の瞬間のクリティカルパスに無かった」こと。
 *   ★対策: receiptが無い（inconclusive）新規ファイルについて、templates/diagnostics/
 *   check-shared-parts-used.mjsの判定関数（extractDefinedFunctions/judgeSharedPartsUsed、
 *   新規に作らずそのままimport）を使い、そのファイルが定義する関数のうち共有dirと同名の
 *   ものを「関連する既存共有部品の候補」として提示する。新しい重複検出器は作らない。
 *   ★これは強制ではなく提示のみ：判定結果（pass/fail/inconclusive）は変えない。
 *   「候補があるのにLOCAL以外を選んだらfailにする」のようなSemantic Judgmentの自動化はしない
 *   （規約の原則：機械は客観的事実だけを見る）。
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from './lib/instrument-core.mjs';
import { judgeDecisionReceipt } from './lib/instrument-proof.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));

// ★check-shared-parts-used.mjs の置き場所は配布先ごとに違う（2026-09-03・実損）。
//   キット内は templates/scripts/ の隣が templates/diagnostics/ なので '../diagnostics/' で届くが、
//   surechigai-romi.link は scripts/ の【下】に scripts/diagnostics/ を置いている。
//   ★静的 import だと解決できない配置で **読み込んだ瞬間に落ちる**（--selftest すら動かない）。
//   実測: Cannot find module '.../surechigai-romi.link/diagnostics/check-shared-parts-used.mjs'
//   ⟹ 実在する場所を順に探して動的に読む。どこにも無ければ「その判定だけ諦める」で、
//     この検査自体は動かす（依存が1本無いだけで全部止めない）。
const SHARED_PARTS_CANDIDATES = [
  join(HERE, '..', 'diagnostics', 'check-shared-parts-used.mjs'),
  join(HERE, 'diagnostics', 'check-shared-parts-used.mjs'),
  join(HERE, 'check-shared-parts-used.mjs'),
];
let extractDefinedFunctions = null;
let judgeSharedPartsUsed = null;
for (const p of SHARED_PARTS_CANDIDATES) {
  if (!existsSync(p)) continue;
  try {
    const m = await import(pathToFileURL(p).href);
    extractDefinedFunctions = m.extractDefinedFunctions;
    judgeSharedPartsUsed = m.judgeSharedPartsUsed;
    break;
  } catch { /* 次の候補へ */ }
}

// ★findRepoRootはtemplates/scripts/check-instrument-proof.mjs・record-instrument-proof.mjs・
// check-instrument-ran.mjsと同一実装の意図的な複製（KEEP_SEPARATE、2026-09-02のCANONICAL CHECKで
// DECLARED）。templates/scripts/は配布先にそのままコピーされるファイルで、scripts/lib/repo-root.mjs
// （scripts/側の正本）をimportできない配布境界があるため。Decision Receipt: .decision-receipts.json参照。
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

/**
 * ★共有dirの一覧を取得する。check-shared-parts-used.mjsのDEFAULT_SHARED_DIRSと
 * diagnostics.jsonのsharedDir宣言（配列も可）の両方を合成する。新しい設定源は作らない。
 * @returns {string[]}
 */
function resolveSharedDirs() {
  const DEFAULTS = ['shared', 'common', 'lib/shared'];
  const cfgPath = join(ROOT, 'diagnostics.json');
  if (!existsSync(cfgPath)) return DEFAULTS;
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    if (Array.isArray(cfg.sharedDir)) return cfg.sharedDir;
    if (typeof cfg.sharedDir === 'string' && cfg.sharedDir) return [cfg.sharedDir];
    return DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/**
 * ★新規ファイル1件が定義する関数のうち、共有dirと同名のものを「関連する既存共有部品の候補」
 * として返す（提示のみ・判定には使わない）。extractDefinedFunctions/judgeSharedPartsUsedは
 * check-shared-parts-used.mjsからのimportで、新しい重複検出ロジックは作らない。
 * @param {string} file 新規ファイルの相対パス
 * @param {string[]} sharedDirs
 * @returns {{name:string, sharedAt:string}[]}
 */
function relatedSharedCandidates(file, sharedDirs) {
  const isShared = (p) => sharedDirs.some((d) => p === d || p.startsWith(`${d}/`));
  if (isShared(file)) return []; // ★共有dir自身の新規ファイルは対象外（自分自身との比較になる）

  const abs = resolve(ROOT, file);
  if (!existsSync(abs)) return [];
  let defined;
  try { defined = extractDefinedFunctions(readFileSync(abs, 'utf8')); } catch { return []; }
  if (defined.length === 0) return [];

  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files', '*.js', '*.mjs', '*.ts', '*.tsx'], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
    }).split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
  const load = (p) => {
    try { return { path: p, defined: extractDefinedFunctions(readFileSync(join(ROOT, p), 'utf8')) }; }
    catch { return null; }
  };
  const sharedFiles = tracked.filter(isShared).map(load).filter(Boolean);
  const judged = judgeSharedPartsUsed(sharedFiles, [{ path: file, defined }], null);
  if (judged.verdict === 'inconclusive') return [];
  return judged.duplicates.map((d) => ({ name: d.name, sharedAt: d.sharedAt }));
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
const sharedDirs = resolveSharedDirs();

// ★新規ファイルごとに、そのファイルをscopePathsに含むreceiptが1件でもあるかを見る。
const results = newFiles.map((file) => {
  const matching = receipts.find((r) => Array.isArray(r?.scopePaths) && r.scopePaths.includes(file));
  const judged = judgeDecisionReceipt(matching, {
    changedFiles,
    sourceExists: (p) => existsSync(resolve(ROOT, p))
  });
  return { ...judged, probe: `Decision Receipt: ${file}`, _file: file };
});

console.log(formatProbeReport(results, { label: 'check-decision-receipt' }));
for (const r of results) {
  if (r.verdict !== 'pass') {
    console.log('   → この検査はreceiptの客観的な形（有無・enum値・pathの実在）だけを見ます。判断の中身の妥当性は見ません');
  }
  // ★Just-in-time提示: receiptがまだ無い（inconclusive）ファイルについて、
  //   このファイルが定義する関数のうち共有dirと同名のものを候補として見せる。
  //   提示のみ・判定には使わない（規約の原則: 機械は客観的事実だけを見る）。
  if (r.verdict === 'inconclusive') {
    const candidates = relatedSharedCandidates(r._file, sharedDirs);
    if (candidates.length > 0) {
      console.log(`   💡 関連する既存共有部品の候補（CANONICAL CHECKの材料。判定はしません）:`);
      for (const c of candidates) {
        console.log(`      - ${c.name}() は ${c.sharedAt} に既に定義されています`);
      }
    }
  }
}

process.exit(computeExitCode(results));
