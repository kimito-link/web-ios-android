#!/usr/bin/env node
/**
 * check-drift.mjs — ★計器の土台が【実コードとして】割れていないか見る。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ■ ★何を見て、何を見ないか
 *   見る   : 実コード（コメント・空行を除いたもの）
 *   ★見ない: コメント
 *
 *   ★理由: 各リポは自分が踏んだ事故をヘッダに書く。それは**正しい**
 *   （読む人が自分の事故で理解できる）。コメントまで一致を強制すると、
 *   ★各リポが自分の事例を書けなくなり、土台が「読めないもの」になる。
 *   実測(2026-08-21): tsuioku とキットは ★コメント66行違い・実コード71行一致。
 *
 * ■ 終了コード（この土台自身の3値規約に従う）
 *   0 = 一致 / 1 = ★実コードが割れている / ★2 = 測れなかった(ファイルが無い等)
 *
 * ■ 使い方
 *   node _docs/instruments/check-drift.mjs
 *   node _docs/instruments/check-drift.mjs --selftest   ★毒を入れて赤くなるか確認
 * ───────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = resolve(HERE, '../..');
const GH_ROOT = resolve(KIT_ROOT, '..');

const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 });
const SELFTEST = process.argv.includes('--selftest');

/** ★正本（キット側）と、追随するコピー。 */
const CANONICAL = resolve(KIT_ROOT, 'templates/scripts/lib/instrument-core.mjs');
const COPIES = [
  resolve(GH_ROOT, 'tsuioku-no-kirameki.com/scripts/lib/instrument-core.mjs')
];

/** ★コメント・文字列内は触らず、行コメント/ブロックコメント/空行だけ落とす。 */
function codeOnly(text) {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .filter((l) => l.trim() !== '')
    .map((l) => l.trimEnd())
    .join('\n');
}

function rel(p) {
  return p.split(GH_ROOT).join("").replace(/^[\/]+/, "");
}

function compare(canonicalPath, copies) {
  if (!existsSync(canonicalPath)) {
    return {
      verdict: 'inconclusive',
      detail: `正本が見つかりません: ${canonicalPath}`,
      howToFix: 'キットの templates/scripts/lib/instrument-core.mjs を復旧する'
    };
  }
  const base = codeOnly(readFileSync(canonicalPath, 'utf8'));
  const checked = [];
  const drifted = [];
  const missing = [];

  for (const p of copies) {
    if (!existsSync(p)) { missing.push(p); continue; }
    checked.push(p);
    if (codeOnly(readFileSync(p, 'utf8')) !== base) drifted.push(p);
  }

  // ★1本も比較できていないなら「緑」ではない（測れなかった）
  if (checked.length === 0) {
    return {
      verdict: 'inconclusive',
      detail: `比較できたコピーが0本（見つからない: ${missing.length}本）`,
      howToFix: 'COPIES のパスを実在するものに直す。リポを clone していないなら、それは正常'
    };
  }
  if (drifted.length) {
    return {
      verdict: 'fail',
      evidence: { 比較: checked.length, 割れ: drifted.length },
      detail: `★実コードが割れています: ${drifted.map((p) => rel(p)).join(", ")}`,
      howToFix: '正本(キット側)の実コードに合わせる。★コメントは各リポの事例のままでよい',
      limitation: '★実コードの一致だけを見ます。土台の中身が正しいかは見ません'
    };
  }
  return {
    verdict: 'pass',
    evidence: { 比較: checked.length, 割れ: 0, 未存在: missing.length },
    limitation: '★実コードの一致だけを見ます。土台の中身が正しいかは見ません'
  };
}

/* ── --selftest: ★毒を食わせ、赤が出ることを確認する ───────────────── */
if (SELFTEST) {
  const fails = [];

  // 毒1: 実コードが違うコピーを渡す → fail になるべき
  const poisonFile = resolve(HERE, '.drift-poison.tmp.mjs');
  const { writeFileSync, rmSync } = await import('node:fs');
  try {
    writeFileSync(poisonFile, readFileSync(CANONICAL, 'utf8') + '\nexport const POISON = 1;\n');
    const r = compare(CANONICAL, [poisonFile]);
    if (r.verdict !== 'fail') fails.push(`実コードの差を検知できない(得た: ${r.verdict})`);
  } finally {
    try { rmSync(poisonFile, { force: true }); } catch { /* 復帰は best-effort */ }
  }

  // 毒2: ★コメントだけ違うコピー → pass のままであるべき(誤検知しない)
  const commentFile = resolve(HERE, '.drift-comment.tmp.mjs');
  try {
    writeFileSync(commentFile, '// ★このリポ固有の事故の記録\n' + readFileSync(CANONICAL, 'utf8'));
    const r = compare(CANONICAL, [commentFile]);
    if (r.verdict !== 'pass') fails.push(`★コメント差を割れと誤検知した(得た: ${r.verdict})`);
  } finally {
    try { rmSync(commentFile, { force: true }); } catch { /* 復帰は best-effort */ }
  }

  // 毒3: ★1本も存在しない → inconclusive であるべき(緑にしない)
  const r3 = compare(CANONICAL, [resolve(HERE, '.nope-does-not-exist.mjs')]);
  if (r3.verdict !== 'inconclusive') fails.push(`★0本を緑にした(得た: ${r3.verdict})`);

  if (fails.length) {
    console.error('[check-drift] ★selftest 失敗（検知器が効いていません）:');
    for (const f of fails) console.error('  - ' + f);
    process.exit(EXIT.FAIL);
  }
  console.log('[check-drift] selftest OK（実コードの差を検知 / ★コメント差は誤検知しない / 0本を緑にしない）');
  process.exit(EXIT.PASS);
}

const r = compare(CANONICAL, COPIES);
const mark = r.verdict === 'pass' ? '✅' : r.verdict === 'fail' ? '🔴' : '🟡';
console.log(`[check-drift] ${mark} 計器の土台 — ${r.verdict}`);
if (r.evidence) console.log('  根拠: ' + JSON.stringify(r.evidence, null, 0));
if (r.detail) console.log('  ' + r.detail);
if (r.howToFix) console.log('  → 直し方: ' + r.howToFix);
if (r.limitation) console.log('  → この検査の限界: ' + r.limitation);
process.exit(r.verdict === 'pass' ? EXIT.PASS : r.verdict === 'fail' ? EXIT.FAIL : EXIT.INCONCLUSIVE);
