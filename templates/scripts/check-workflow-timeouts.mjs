#!/usr/bin/env node
// @ts-check
/**
 * ワークフローの全ジョブに timeout-minutes があることを確かめる門番。
 *
 * 背景: 2026-08-06 に Actions の予算上限で全リポのCIが止まった。真因は
 * timeout-minutes 未設定ジョブがハングし、GitHub既定の6時間まで回り続けたこと。
 * 当時ジョブに上限を入れて回復したが、**再発を検知する仕組みは無かった**ため、
 * その後に追加された auth-state-health.yml の check が未設定のまま残っていた。
 *
 * 判定は scripts/lib/workflow-timeout-core.mjs（テスト済み）に置いてある。
 *
 * 使い方:
 *   node scripts/check-workflow-timeouts.mjs
 *
 * 終了コード: 0=全ジョブOK / 1=未設定あり / 2=実行時エラー
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { findJobsWithoutTimeout } from "./lib/workflow-timeout-core.mjs";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * .github/workflows を上へ辿って探す。
 * ★キット内(templates/scripts/)から実行しても、プロジェクトへコピーされた後でも
 *   同じように動くようにするため。固定の相対パスにすると、格上げ元では動くのに
 *   格上げ先で「見つかりません」になる（2026-09-01 に実際に踏んだ）。
 * ★環境変数 WORKFLOW_DIR があればそれを最優先（CI等で明示したい場合）。
 */
function findWorkflowDir() {
  if (process.env.WORKFLOW_DIR) return process.env.WORKFLOW_DIR;
  let cur = dirname;
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(cur, ".github", "workflows");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  // 見つからなければ従来どおりの位置を返す（エラーメッセージで場所が分かるように）
  return path.resolve(dirname, "..", ".github", "workflows");
}

const workflowDir = findWorkflowDir();

function main() {
  if (!fs.existsSync(workflowDir)) {
    console.error(`check-workflow-timeouts: ${workflowDir} が見つかりません`);
    process.exit(2);
  }

  const files = fs
    .readdirSync(workflowDir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort();

  if (files.length === 0) {
    console.error("check-workflow-timeouts: ワークフローが1件も見つかりません（検査対象ゼロ）");
    process.exit(2);
  }

  const violations = [];
  let jobCount = 0;

  for (const file of files) {
    // ★非UTF-8のワークフローが混ざっていても壊さないようバイトで読む
    //   （memory/actions-budget-exhausted-2026-08-06.md の地雷）。
    const source = fs.readFileSync(path.join(workflowDir, file)).toString("utf8");
    const { jobs, missing } = findJobsWithoutTimeout(source);
    jobCount += jobs.length;
    for (const job of missing) violations.push({ file, job });
  }

  // 件数0で緑にしない（検査対象を数え損ねていたら異常として落とす）。
  if (jobCount === 0) {
    console.error("check-workflow-timeouts: ジョブを1件も検出できませんでした（パーサ異常の疑い）");
    process.exit(2);
  }

  if (violations.length > 0) {
    console.error(`❌ timeout-minutes が無いジョブが ${violations.length} 件あります:`);
    for (const v of violations) console.error(`   - ${v.file} :: ${v.job}`);
    console.error("");
    console.error("   ハングすると GitHub 既定の6時間まで回り続け、予算を溶かします。");
    console.error("   実測の最大所要時間に余裕を持たせた値を timeout-minutes に入れてください。");
    console.error("   （2026-08-06 に実際に全リポのCIが停止しました）");
    process.exit(1);
  }

  console.log(`✅ ワークフロー ${files.length} 本・ジョブ ${jobCount} 件すべてに timeout-minutes があります`);
  process.exit(0);
}

main();
