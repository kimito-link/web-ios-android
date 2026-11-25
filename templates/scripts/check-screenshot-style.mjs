#!/usr/bin/env node
// 役割: このアプリのリポで、ストアのスクショ計画(store-assets/screenshot-plan.json)が「明るい背景・短い見出し」になっているかを見る。
// なぜ要るか: 背景が濃く説明文の多いスクショは、明るい背景＋短い見出しより転換率が低かった公開事例がある(16.66%→21.97%、1件の事例)。
//   キットの金型が濃い背景を既定にしていたので、作るたびに同じ見た目に戻っていた。りんくの指示(2026-11-25「全体設計にいれて」)。
//   ルール本文: docs/ai-rules/10_STORE_FIELDS.md §4、判定の部品: lib/screenshot-style.mjs
// 使い方:
//   node scripts/check-screenshot-style.mjs   # 点検(lint-pre-submission の CHECK 38 と同じ判定)
// 終了コード: 0 = ok / warn / skip、1 = fail
// ★見ているのは計画(文字数・色)まで。出来た画像そのものの見た目は、作った後に AI が画像を開いて確かめる(10 §1-4)。

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCREENSHOT_PLAN_PATH, checkScreenshotStyle } from './lib/screenshot-style.mjs';

export function screenshotStyleReport(root) {
  let brandPrimary;
  try {
    brandPrimary = JSON.parse(fs.readFileSync(path.join(root, 'app.config.json'), 'utf8'))?.brand?.primaryColor;
  } catch { /* 無くてもよい */ }
  const file = process.env.SCREENSHOT_PLAN || path.join(root, SCREENSHOT_PLAN_PATH);
  let plan = null;
  let planError;
  if (fs.existsSync(file)) {
    try { plan = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { planError = e.message; }
  }
  return checkScreenshotStyle({ plan, planError, brandPrimary });
}

function main() {
  const r = screenshotStyleReport(process.cwd());
  const mark = { ok: '✓', warn: '!', skip: '-', fail: '✗' }[r.status] ?? '?';
  console.log(`${mark} ${r.name}: ${r.status === 'ok' || r.status === 'skip' ? r.detail : ''}`);
  for (const p of r.problems) console.log(`   - ${p}`);
  if (r.status === 'fail') {
    console.log('\n直し方: 見出しを短くする(1行13字・2行まで、補足は無しか20字まで)／背景を明るい色にする(framedStyle を消せば既定の明るい色)。');
    console.log('自分のアプリの A/B で別の見た目が勝ったなら、framedStyle.abTestEvidence に結果(URL か 数字と日付)を書く。');
  }
  process.exit(r.status === 'fail' ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
