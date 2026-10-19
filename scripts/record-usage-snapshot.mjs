#!/usr/bin/env node
// 役割: Claude の使用量(get_usage の出力)を、専用ブランチ usage-data の usage.json へ畳み込んで保存する。
// なぜ要るか: kimito-skill.link/hub/usage/ のダッシュボードは、このファイルを読んで「どれだけ減っているか・いつ回復するか」を描く。
//   ページを作り直して再デプロイしなくても、データだけを更新できるようにするため、データはサイトとは別の場所(専用ブランチ)に置く。
//   main を汚さない・履歴はコミットとして残る。リポは公開なので、載せるのは使用量の割合と回復時刻だけ(鍵・会話内容は載せない)。
// 使い方:
//   get_usage の出力JSONを標準入力に渡す:  node scripts/record-usage-snapshot.mjs < usage.json
//   初回(専用ブランチが無いとき):           node scripts/record-usage-snapshot.mjs --init
//   書き込まずに結果だけ見る:               node scripts/record-usage-snapshot.mjs --dry-run < usage.json
// 前提: gh がログイン済み(このリポへ書ける)。判定の中身は site/hub/usage/usage-history.mjs(純関数・テスト付き)。
import { mergeSnapshot, normalizeUsage } from '../site/hub/usage/usage-history.mjs';
import { initBranch, readFile, writeFile } from './lib/data-branch.mjs';

const FILE = 'usage.json';

async function main() {
  if (process.argv.includes('--init')) {
    console.log(initBranch() ? '専用ブランチを作った' : '専用ブランチは既にある');
    return;
  }
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const snap = normalizeUsage(raw);
  if (!snap) throw new Error('使用量を読めない状態(plan.status が ok ではない)。保存しない');
  const existing = readFile(FILE);
  const merged = mergeSnapshot(existing?.json && existing.json.history ? existing.json : null, snap, Date.now());
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ points: merged.history.length, current: merged.current.windows, updatedAt: merged.updatedAt }));
    return;
  }
  if (!existing) initBranch();
  writeFile(FILE, merged, `usage snapshot ${merged.updatedAt}`);
  console.log(`保存した: 履歴 ${merged.history.length} 点 / 更新 ${merged.updatedAt}`);
}

main().catch((e) => {
  console.error(`record-usage-snapshot FATAL: ${String(e.message).split('\n')[0]}`);
  process.exit(1);
});
