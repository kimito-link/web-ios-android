#!/usr/bin/env node
/**
 * record-decision-receipt.mjs — ★CANONICAL CHECKを行った結果（Decision Receipt）を台帳へ記録する「記録の口」。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ 何をするか
 *   _docs/DESIGN-canonical-boundary-rules.md（v1.0）のSEARCH → CANONICAL CHECK →
 *   REUSE/ESTABLISH_REHOME/CONTRACT/SYNC/KEEP_SEPARATE/LOCAL という判定結果を、
 *   `.decision-receipts.json`（リポ直下）へ1件追記する。
 *
 * ■ ★receipt本体を台帳へ永続コピーする（PRE-FLIGHT拡張と同じ設計）
 *   一時ファイルpathだけを保存すると、元ファイルが削除された時点で検証不能になる
 *   （instrument-proof.mjsのpreflightSearchPath問題と同型）。record-decision-receipt.mjsは
 *   最初からreceiptの中身（responsibility/decision/canonicalSource/scopePaths）を
 *   引数で受け取り、そのまま台帳へ書く。一時ファイル経由にしない。
 *
 * ■ 使い方
 *   node scripts/record-decision-receipt.mjs \
 *     --responsibility "user-avatar-rendering" \
 *     --decision LOCAL \
 *     --scope "src/components/Avatar.tsx" \
 *     [--canonical-source "scripts/lib/avatar.mjs"] \
 *     [--scope "src/components/AvatarFallback.tsx" ...]
 *
 * ■ 終了コード
 *   0 = 記録できた / 1 = 引数が客観的に不正（decisionがenum外等） / 2 = 台帳が壊れている
 * ───────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './lib/instrument-core.mjs';

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
function optAll(name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && i + 1 < argv.length) out.push(argv[i + 1]);
  }
  return out;
}

const ROOT = findRepoRoot(HERE);
const RECEIPTS_PATH = join(ROOT, '.decision-receipts.json');

const VALID_DECISIONS = new Set(['REUSE', 'ESTABLISH_REHOME', 'CONTRACT', 'SYNC', 'KEEP_SEPARATE', 'LOCAL']);

const responsibility = opt('--responsibility');
const decision = opt('--decision');
const canonicalSource = opt('--canonical-source', null);
const scopePaths = optAll('--scope');

if (!responsibility) {
  console.error('[record-decision-receipt] 🔴 --responsibility が必要です');
  process.exit(EXIT.FAIL);
}
if (!VALID_DECISIONS.has(decision)) {
  console.error(`[record-decision-receipt] 🔴 --decision は次のいずれかである必要があります: ${[...VALID_DECISIONS].join(', ')}`);
  process.exit(EXIT.FAIL);
}
if (scopePaths.length === 0) {
  console.error('[record-decision-receipt] 🔴 --scope が最低1つ必要です');
  process.exit(EXIT.FAIL);
}
if ((decision === 'REUSE' || decision === 'ESTABLISH_REHOME') && !canonicalSource) {
  console.error(`[record-decision-receipt] 🔴 decision=${decision} には --canonical-source が必要です`);
  process.exit(EXIT.FAIL);
}

function readReceipts() {
  if (!existsSync(RECEIPTS_PATH)) return { schemaVersion: 1, receipts: [] };
  try {
    const j = JSON.parse(readFileSync(RECEIPTS_PATH, 'utf8'));
    return j && typeof j === 'object' && Array.isArray(j.receipts) ? j : null;
  } catch {
    return null;
  }
}

const existing = readReceipts();
if (existing === null) {
  console.error(`[record-decision-receipt] 🔴 既存の台帳がJSONとして壊れています: ${RECEIPTS_PATH}`);
  process.exit(EXIT.INCONCLUSIVE);
}

const receipt = {
  at: new Date().toISOString(),
  responsibility,
  decision,
  canonicalSource: canonicalSource || null,
  scopePaths
};

existing.receipts.push(receipt);
mkdirSync(dirname(RECEIPTS_PATH), { recursive: true });
writeFileSync(RECEIPTS_PATH, JSON.stringify({ schemaVersion: 1, receipts: existing.receipts }, null, 2) + '\n');
console.log(`[record-decision-receipt] ✅ 記録しました: ${responsibility} → ${decision} (${RECEIPTS_PATH})`);
process.exit(EXIT.PASS);
