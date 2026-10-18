#!/usr/bin/env node
/**
 * loop-adapter-diagnostics.mjs — 自己改善ループの第2のアダプタ: 汎用診断の出力 → 症状カード（どのプロジェクトでも使える）。
 *
 * 使い方: node scripts/diagnostics/run.mjs . 2>&1 | node scripts/loop-adapter-diagnostics.mjs --project <プロジェクト名> [--out <カードの置き場>]
 *   出力先は --out > 環境変数 LOOP_OUT_DIR（ランナーが渡す）> 既定、の順
 *   （run.mjs は異常があると exit 1/2 だが、ここは標準入力を読むだけなので、パイプの上流の終了コードは見ない）
 *   既定の置き場: _loop/<project>/symptoms/（git 管理外）
 * 守ること: 判定は lib/loop-adapter-diagnostics-core.mjs（検査名の形の語と状態だけを読む）。書く前に症状カード検査（symptom-card-core）を全カードに通し、
 *   1枚でも違反したら**何も書かない**（fail-closed）。診断のまとめが入力に無ければ exit 2（測れていない。空のカードで緑にしない）。
 * 終了コード: 0=カードを書いた / 1=カードが検査に通らない（何も書かない） / 2=診断のまとめが無い・引数不足
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EXIT } from './lib/instrument-core.mjs';
import { buildCardsFromDiagnostics, safeToken } from './lib/loop-adapter-diagnostics-core.mjs';
import { validateSymptomCard } from './lib/symptom-card-core.mjs';

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--') && i + 1 < argv.length) a[argv[i].slice(2)] = argv[++i];
  return a;
}
const a = parseArgs(process.argv.slice(2));
if (!a.project) {
  console.error('[loop-adapter-diagnostics] --project が要る（使い方はファイル先頭のコメント）');
  process.exit(EXIT.INCONCLUSIVE);
}
let version = 'unknown';
try {
  version = safeToken(JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')).version, 'unknown');
} catch {
  /* package.json が無いプロジェクトは unknown */
}
const now = new Date();
const cards = buildCardsFromDiagnostics(readFileSync(0, 'utf8'), { project: safeToken(a.project, 'project'), version, now });
if (cards.length === 0) {
  console.error('[loop-adapter-diagnostics] 診断のまとめ（--- 診断結果まとめ ---）が入力に無い（測れていない。緑ではない）');
  process.exit(EXIT.INCONCLUSIVE);
}
const bad = [];
for (const c of cards) {
  const r = validateSymptomCard(c, { byteLength: Buffer.byteLength(JSON.stringify(c)) });
  if (!r.ok) for (const x of r.violations) bad.push(`${c.id} ${x.path}: ${x.rule}`);
}
if (bad.length > 0) {
  console.error('[loop-adapter-diagnostics] 症状カードが検査に通らない。何も書かない（fail-closed）');
  for (const b of bad) console.error('    ' + b);
  process.exit(EXIT.FAIL);
}
const dir = a.out || process.env.LOOP_OUT_DIR || join('_loop', safeToken(a.project, 'project'), 'symptoms'); // LOOP_OUT_DIR: ランナー(loop-run.mjs)が全アダプタ共通で渡す出力先
mkdirSync(dir, { recursive: true });
const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
for (const c of cards) {
  const file = join(dir, `${stamp}-${c.id}.json`);
  writeFileSync(file, JSON.stringify(c, null, 2) + '\n', 'utf8');
  console.log(file);
}
process.exit(EXIT.PASS);
