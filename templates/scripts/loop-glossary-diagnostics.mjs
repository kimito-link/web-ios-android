#!/usr/bin/env node
/**
 * loop-glossary-diagnostics.mjs — 診断アダプタ用の用語集を、各検査(check-*.mjs)の先頭コメントから機械的に作る。
 *
 * 役割: ローカルAIに渡す固定の知識（検査名＝診断カードのidの意味、指標の意味）を生成する。手書きだと検査が増えるたびにずれる。
 *   そのまま `loop-propose.mjs --glossary <出力>`（ランナーなら設定の glossary）に渡す。設計・実測: _docs/SPEC-loop-propose-v1.md。
 * 使い方: node scripts/loop-glossary-diagnostics.mjs --project <名前> [--dir <検査のディレクトリ>] [--cards <カードの置き場>] [--stdout]
 *   --dir    検査スクリプト(check-*.mjs)の場所。既定: templates/diagnostics があればそれ、無ければ scripts/diagnostics
 *   --cards  渡すと、そのカードに出てくる検査だけを載せる（用語集を小さく・的を絞る。検査が多いプロジェクトで4KiBを超えるときに使う）
 *   出力先: _loop/<project>/glossary.txt（--stdout で標準出力）
 * 守ること: 書く前に、用語集の検査（loop-propose-core の assertGlossary: 秘密・メールらしき形・4KiB 上限）を通す。通らなければ何も書かない。
 *   先頭コメントから説明が取れない検査は「説明が書かれていない」と書く（作り話をしない）。
 * 終了コード: 0=書いた / 1=用語集が検査に通らない（大きすぎる等。--cards で絞る） / 2=検査のディレクトリ・引数が無い
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT } from './lib/instrument-core.mjs';
import { CARD_GLOSSARY } from './lib/loop-adapter-diagnostics-core.mjs';
import { describeCheck, formatDiagnosticsGlossary } from './lib/loop-glossary-diagnostics-core.mjs';
import { assertGlossary } from './lib/loop-propose-core.mjs';

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    if (argv[i] === '--stdout') a.stdout = true;
    else if (i + 1 < argv.length) a[argv[i].slice(2)] = argv[++i];
  }
  return a;
}
const a = parseArgs(process.argv.slice(2));
if (!a.project && !a.stdout) {
  console.error('[loop-glossary-diagnostics] --project（または --stdout）が要る');
  process.exit(EXIT.INCONCLUSIVE);
}
const dir = String(a.dir || (existsSync('templates/diagnostics') ? 'templates/diagnostics' : 'scripts/diagnostics'));
if (!existsSync(dir)) {
  console.error('[loop-glossary-diagnostics] 検査のディレクトリが無い（測れていない）: --dir で指定する');
  process.exit(EXIT.INCONCLUSIVE);
}

let checks = readdirSync(dir)
  .filter((f) => /^check-[a-z0-9-]+\.mjs$/.test(f))
  .sort()
  .map((f) => ({ name: f.replace(/\.mjs$/, ''), desc: describeCheck(readFileSync(join(dir, f), 'utf8'), f) }));

if (a.cards) {
  if (!existsSync(String(a.cards))) {
    console.error('[loop-glossary-diagnostics] --cards のディレクトリが無い（測れていない）');
    process.exit(EXIT.INCONCLUSIVE);
  }
  const ids = readdirSync(String(a.cards)).filter((f) => f.endsWith('.json')).map((f) => String(JSON.parse(readFileSync(join(String(a.cards), f), 'utf8')).id));
  checks = checks.filter((c) => ids.some((id) => id === c.name || id.startsWith(c.name + '-')));
}

const text = formatDiagnosticsGlossary(checks, CARD_GLOSSARY);
try {
  assertGlossary(text);
} catch (e) {
  console.error('[loop-glossary-diagnostics] 用語集が検査に通らない: ' + (e instanceof Error ? e.message : String(e)) + '（検査が多いときは --cards で絞る）');
  process.exit(EXIT.FAIL);
}
if (a.stdout) {
  process.stdout.write(text);
  process.exit(EXIT.PASS);
}
const outDir = join('_loop', String(a.project));
mkdirSync(outDir, { recursive: true });
const file = join(outDir, 'glossary.txt');
writeFileSync(file, text, 'utf8');
console.log(file);
process.exit(EXIT.PASS);
