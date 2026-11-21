#!/usr/bin/env node
// 役割: このアプリのリポで、アプリ名の商標確認の記録(store-assets/trademark-check.json)があり、いまの名前と合っているかを見る。
// なぜ要るか: App Store・Google Play には商標侵害の申し立て窓口があり、通るとアプリの削除・改名になる。名前は公開後に変えるほど高い。
//   りんくの指示(2026-11-21「これも全体設定に」)。ルール本文: docs/ai-rules/14_TRADEMARK_CHECK.md
// 使い方:
//   node scripts/check-trademark.mjs          # 点検(lint-pre-submission の CHECK 36 と同じ判定)
//   node scripts/check-trademark.mjs --init   # 記録の雛形を作る(既にあれば上書きしない)。検索は AI が J-PlatPat で行って埋める
// 終了コード: 0 = ok / warn / skip、1 = fail
// ★J-PlatPat はロボットアクセスを禁止しているので、このスクリプトは検索しない。検索は内蔵ブラウザで1回ずつ(14 §2)。

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JPLATPAT_URL, TRADEMARK_RECORD_PATH, checkTrademarkRecord, trademarkRecordTemplate } from './lib/trademark-check.mjs';

export function trademarkReport(root) {
  let displayName = '';
  try {
    displayName = JSON.parse(fs.readFileSync(path.join(root, 'app.config.json'), 'utf8'))?.identity?.displayName ?? '';
  } catch { /* 無くてもよい */ }
  if (/^<.*>$/.test(displayName)) displayName = ''; // プレースホルダのまま
  let record = null;
  let recordError;
  const file = path.join(root, TRADEMARK_RECORD_PATH);
  if (fs.existsSync(file)) {
    try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { recordError = e.message; }
  }
  return { displayName, ...checkTrademarkRecord({ record, recordError, displayName }) };
}

function main() {
  const root = process.cwd();
  if (process.argv.includes('--init')) {
    const file = path.join(root, TRADEMARK_RECORD_PATH);
    if (fs.existsSync(file)) {
      console.log(`${TRADEMARK_RECORD_PATH} は既にある(上書きしない)`);
    } else {
      const { displayName } = trademarkReport(root);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(trademarkRecordTemplate({ displayName }), null, 2)}\n`);
      console.log(`${TRADEMARK_RECORD_PATH} を作った。J-PlatPat(${JPLATPAT_URL})で調べて searches・similar・verdict を埋める`);
    }
  }
  const r = trademarkReport(root);
  const mark = { ok: '✓', warn: '!', fail: '✗', skip: '-' }[r.status];
  console.log(`${mark} 商標確認: ${r.detail}`);
  return r.status === 'fail' ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main());
