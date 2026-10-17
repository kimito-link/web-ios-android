#!/usr/bin/env node
/**
 * check-symptom-card.mjs — 症状カード(JSON)が「AIに渡してよい形」かを検査する CLI（3値 exit）。
 *
 * 使い方: node scripts/check-symptom-card.mjs <カード.json | ディレクトリ> [...]
 *   ディレクトリを渡すと直下の *.json を全部検査する。ループのランナーが、AIを呼ぶ前に必ず通す入口。
 * 終了コード: 0=全部合格 / 1=1件でも違反（読めない・JSONでない・許可外を含む） / 2=検査対象が1件も無い（測れていない＝緑ではない）
 * 判定の本体は lib/symptom-card-core.mjs。ここは読み込みと出力だけ。違反の出力にカードの**値は載せない**（パスと規則名だけ）。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT } from './lib/instrument-core.mjs';
import { validateSymptomCard } from './lib/symptom-card-core.mjs';

/** @param {string} p */
function collect(p) {
  if (!existsSync(p)) return [];
  if (statSync(p).isDirectory()) return readdirSync(p).filter((f) => f.endsWith('.json')).map((f) => join(p, f));
  return [p];
}

const targets = process.argv.slice(2).flatMap(collect);
if (targets.length === 0) {
  console.error('[check-symptom-card] 検査対象のカードが1件も無い（測れていない。緑ではない）');
  process.exit(EXIT.INCONCLUSIVE);
}

let red = 0;
for (const file of targets) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    console.error(`✗ ${file}: 読めない`);
    red++;
    continue;
  }
  let card;
  try {
    card = JSON.parse(raw);
  } catch {
    console.error(`✗ ${file}: JSONとして読めない`);
    red++;
    continue;
  }
  const { ok, violations } = validateSymptomCard(card, { byteLength: Buffer.byteLength(raw) });
  if (ok) {
    console.log(`✓ ${file}`);
  } else {
    red++;
    console.error(`✗ ${file}`);
    for (const x of violations) console.error(`    ${x.path}: ${x.rule}`);
  }
}
console.log(red === 0 ? `[check-symptom-card] ${targets.length}件すべて合格` : `[check-symptom-card] ${red}/${targets.length}件が違反（AIへ渡さない）`);
process.exit(red === 0 ? EXIT.PASS : EXIT.FAIL);
