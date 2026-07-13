#!/usr/bin/env node
// LP claims⇔実装 ドリフト検証 — 「site/index.html が自動化を訴求しているのに、
// 対応するスクリプトが実在しない/動かない」を機械的に検出する
// (設計: _docs/DESIGN-lp-first-domain-connect-2026-07-13.md §D)。
//
// verify-doc-impl-coverage.mjs（_docs/*.md の impl 注記ドリフト検証）とは別物。
// 対象は site/claims.json（LPの訴求の唯一の正本）で、site/index.html との整合と、
// level:"auto" を名乗る claim の対応スクリプトが実在し --dry-run が緑であることを検証する。
//
// RULE 1: claims.json の全 claim が site/index.html 内で言及されていること
//         （claim.id が index.html 内の data-claim 属性、または claim.label の
//           部分文字列として現れることを許容。将来 LP 生成に切り替える際の橋渡し）。
// RULE 2: level:"auto" の claim は verify に指定されたスクリプトが実在すること。
// RULE 3: level:"auto" の claim は対応スクリプトの `--dry-run` が exit 0 で終わること
//         （実行不能なclaimを auto と偽らせない・fail-closed）。
//
// 実行: node scripts/verify-claims-coverage.mjs
// exit 0 = ドリフトなし / exit 1 = ドリフト検出。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ANSI_RED = '\x1b[31m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_DIM = '\x1b[2m';
const ANSI_RESET = '\x1b[0m';

const failures = [];
function fail(where, message) {
  failures.push({ where, message });
}
function ok(msg, detail) {
  console.log(`${ANSI_GREEN}✓${ANSI_RESET} ${msg}${detail ? `  ${ANSI_DIM}${detail}${ANSI_RESET}` : ''}`);
}

const claimsPath = path.join(ROOT, 'site', 'claims.json');
if (!fs.existsSync(claimsPath)) {
  console.error(`claims.json not found: ${claimsPath}`);
  process.exit(1);
}

const { claims } = JSON.parse(fs.readFileSync(claimsPath, 'utf8'));
if (!Array.isArray(claims) || claims.length === 0) {
  console.error('site/claims.json に claims 配列がありません。');
  process.exit(1);
}

const VALID_LEVELS = new Set(['auto', 'assisted', 'manual']);
for (const claim of claims) {
  if (!claim.id || !claim.label || !VALID_LEVELS.has(claim.level)) {
    fail('site/claims.json', `claim の形式が不正: ${JSON.stringify(claim)}`);
  }
}

// ---------------------------------------------------------------------------
// RULE 1 — index.html が claim に言及しているか（緩い一致。claim.id をキーとする
//   data-claim 属性を優先し、無ければ label の一部が本文に含まれるかで代替判定）。
// ---------------------------------------------------------------------------
const indexPath = path.join(ROOT, 'site', 'index.html');
const indexHtml = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
for (const claim of claims) {
  if (!indexHtml) continue; // index.html が無いのは別の問題として RULE 1 は skip
  const hasDataAttr = indexHtml.includes(`data-claim="${claim.id}"`);
  const labelHead = claim.label.slice(0, 10);
  const hasLabelHint = labelHead.length > 0 && indexHtml.includes(labelHead);
  if (!hasDataAttr && !hasLabelHint) {
    fail(
      'site/index.html',
      `claim "${claim.id}" (${claim.label}) への言及が見つからない。` +
        'LPに追記するか、claims.jsonから削除すること',
    );
  }
}

// ---------------------------------------------------------------------------
// RULE 2 + RULE 3 — level:"auto" の claim は対応スクリプトが実在し --dry-run が緑。
// ---------------------------------------------------------------------------
for (const claim of claims) {
  if (claim.level !== 'auto') continue;
  if (!claim.verify) {
    fail('site/claims.json', `claim "${claim.id}" は level:auto なのに verify が未指定`);
    continue;
  }
  const scriptPath = path.join(ROOT, claim.verify);
  if (!fs.existsSync(scriptPath)) {
    fail('site/claims.json', `claim "${claim.id}" の verify先が実在しない: ${claim.verify}`);
    continue;
  }
  try {
    execFileSync('node', [scriptPath, '--dry-run'], { cwd: ROOT, stdio: 'pipe' });
    ok(`claim "${claim.id}": ${claim.verify} --dry-run 緑`);
  } catch (e) {
    const stderrText = e && e.stderr ? String(e.stderr).trim().split('\n')[0] : '(詳細不明)';
    fail(
      'site/claims.json',
      `claim "${claim.id}" は level:auto を名乗るが ${claim.verify} --dry-run が失敗: ${stderrText}`,
    );
  }
}

// assisted/manual は実行検証しない（人手が残る前提を正直に宣言しているだけなので、
// 対応スクリプトが無いこと自体は正常）。
for (const claim of claims) {
  if (claim.level === 'auto') continue;
  ok(`claim "${claim.id}": level:${claim.level}（実行検証なし・正常）`);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
console.log('');
if (failures.length > 0) {
  console.log(`${ANSI_RED}--- LP claims drift (${failures.length}) ---${ANSI_RESET}`);
  for (const f of failures) console.log(`${ANSI_RED}✗${ANSI_RESET} ${f.where}: ${f.message}`);
  console.log('');
  console.log(`${ANSI_RED}verify-claims-coverage failed.${ANSI_RESET} LPの訴求と実装がズレている。`);
  process.exit(1);
}
console.log(`${ANSI_GREEN}LP claims drift なし${ANSI_RESET} (claim ${claims.length} 件を照合)`);
