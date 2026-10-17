#!/usr/bin/env node
/**
 * record-loop-decision.mjs — 自己改善ループの承認台帳(decisions.jsonl)へ1行を追記する唯一の入口。
 *
 * 使い方: node scripts/record-loop-decision.mjs --ledger _loop/<プロジェクト>/decisions.jsonl \
 *           --proposal <提案書の名前> --decision proposed|approved|rejected|deferred|no_effect \
 *           --by human:<名前>|ai:<モデル名> [--reason "理由"]
 * 守ること: 台帳は追記専用。追記前に既存の台帳を最初から再生して検査し、壊れていれば追記しない。
 *   承認系(approved/rejected/deferred/no_effect)は human: だけ。さらに、AIが走らせるシェル（環境変数 CLAUDE_CODE_SESSION_ID がある）
 *   からは承認系を拒否する＝**人間が自分のターミナルで打つ**運用。環境変数を外せば回避できる（意図的な回避で、コマンド履歴に残る）。
 * 終了コード: 0=追記した / 1=拒否（違反・壊れた台帳・AIシェルからの承認） / 2=使い方の誤り
 * 判定の本体は lib/loop-ledger-core.mjs。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { EXIT } from './lib/instrument-core.mjs';
import { AI_ALLOWED, SCHEMA_VERSION, nextId, replayLedger, validateEntry } from './lib/loop-ledger-core.mjs';

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length) a[argv[i].slice(2)] = argv[++i];
  }
  return a;
}

const a = parseArgs(process.argv.slice(2));
for (const k of ['ledger', 'proposal', 'decision', 'by']) {
  if (!a[k]) {
    console.error(`[record-loop-decision] --${k} が要る（使い方はファイル先頭のコメント）`);
    process.exit(EXIT.INCONCLUSIVE);
  }
}

if (!AI_ALLOWED.includes(a.decision) && process.env.CLAUDE_CODE_SESSION_ID) {
  console.error(
    '[record-loop-decision] 拒否: 承認・却下・保留・効果なしは、AIが走らせるシェルからは書けない。' +
      '人間が自分のターミナルでこのコマンドを実行する（承認は人間の文字で出す）。',
  );
  process.exit(EXIT.FAIL);
}

/** @type {Array<Record<string, any>>} */
let existing = [];
if (existsSync(a.ledger)) {
  const lines = readFileSync(a.ledger, 'utf8').split('\n').filter((l) => l.trim() !== '');
  try {
    existing = lines.map((l) => JSON.parse(l));
  } catch {
    console.error('[record-loop-decision] 拒否: 既存の台帳にJSONとして読めない行がある。壊れた台帳には追記しない');
    process.exit(EXIT.FAIL);
  }
  const rep = replayLedger(existing);
  if (!rep.ok) {
    console.error('[record-loop-decision] 拒否: 既存の台帳が検査に通らない。壊れた台帳には追記しない');
    for (const x of rep.violations) console.error(`    行${x.line} ${x.path}: ${x.rule}`);
    process.exit(EXIT.FAIL);
  }
}

const entry = {
  schema: SCHEMA_VERSION,
  id: nextId(existing),
  proposal: a.proposal,
  decision: a.decision,
  by: a.by,
  at: new Date().toISOString(),
  ...(a.reason !== undefined ? { reason: a.reason } : {}),
};
const res = validateEntry(entry, existing);
if (!res.ok) {
  console.error('[record-loop-decision] 拒否:');
  for (const x of res.violations) console.error(`    ${x.path}: ${x.rule}`);
  process.exit(EXIT.FAIL);
}
mkdirSync(dirname(a.ledger), { recursive: true });
appendFileSync(a.ledger, JSON.stringify(entry) + '\n', 'utf8');
console.log(`[record-loop-decision] 追記: ${entry.id} ${entry.proposal} -> ${entry.decision} (${entry.by})`);
process.exit(EXIT.PASS);
