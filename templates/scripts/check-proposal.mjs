#!/usr/bin/env node
/**
 * check-proposal.mjs — 自己改善ループの提案書(Markdown)が決まった形かを検査する CLI（3値 exit）。
 *
 * 使い方: node scripts/check-proposal.mjs <提案書.md> [--cards <カードのディレクトリ>] [--ledger <decisions.jsonl>]
 *   --cards を付けると、ヘッダーの cards: が指すカードを読み、観測の数字がカードの値だけかを照合する。
 *   --ledger を付けると、本文の「却下済み: <id>」が台帳で本当に rejected かを照合する。
 * 終了コード: 0=合格 / 1=違反（人間に渡さない。台帳に rejected(format) を記録する） / 2=対象が読めない（測れていない＝緑ではない）
 * 判定の本体は lib/proposal-format-core.mjs。違反の出力には本文を載せない（場所と規則名だけ）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT } from './lib/instrument-core.mjs';
import { validateProposal } from './lib/proposal-format-core.mjs';

const args = process.argv.slice(2);
const file = args.find((x) => !x.startsWith('--'));
/** @param {string} k */
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
if (!file || !existsSync(file)) {
  console.error('[check-proposal] 提案書が読めない（測れていない。緑ではない）');
  process.exit(EXIT.INCONCLUSIVE);
}

/** @type {{ cards?: any[], ledger?: any[] }} */
const opts = {};
try {
  const cardsDir = opt('cards');
  if (cardsDir) opts.cards = readdirSync(cardsDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(cardsDir, f), 'utf8')));
  const ledger = opt('ledger');
  if (ledger) opts.ledger = existsSync(ledger) ? readFileSync(ledger, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
} catch {
  console.error('[check-proposal] カードまたは台帳が読めない（測れていない。緑ではない）');
  process.exit(EXIT.INCONCLUSIVE);
}

const res = validateProposal(readFileSync(file, 'utf8'), opts);
if (res.ok) {
  console.log(`✓ ${file}`);
  process.exit(EXIT.PASS);
}
console.error(`✗ ${file}`);
for (const x of res.violations) console.error(`    ${x.where}: ${x.rule}`);
process.exit(EXIT.FAIL);
