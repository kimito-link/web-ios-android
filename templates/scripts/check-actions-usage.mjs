#!/usr/bin/env node
// @ts-check
/**
 * Actions の消費を「暴走ジョブ」の観点で見張る計器。
 *
 * ■ 何のためか
 *   2026-08-06 に Actions の予算上限で**全リポの CI が停止**した（Linux 6,801分/6日）。
 *   真因は timeout 未設定ジョブのハング。上限は scripts/check-workflow-timeouts.mjs で
 *   強制するようにしたが、**上限内に収まっていても本数×回数で溶ける**経路は残る
 *   （実例: 一度も成功しない Lightpanda が毎push 30分・8月で446分）。
 *   この計器はそれを「その日のうちに」見つけるためのもの。
 *
 * ■ ★測っていないもの（過信しないこと）
 *   - **請求額そのもの**。分数と金額は無料枠・OS別単価(Linux 1x/macOS 10x)で変わる。
 *     金額を出す billing API は gh の `user` スコープが要るので、権限を広げず分数で見る。
 *   - **Vercel / Clerk / Upstash の費用**は対象外（このリポの Actions だけ）。
 *   - GitHub API が返す直近ぶん（既定100件）より前は分からない。
 *
 * ■ 終了コード（instrument-core の3値）
 *   0 = 合格（根拠つき） / 1 = 測れた上での赤 / ★2 = 測れなかった（緑ではない）
 *
 * 使い方:
 *   node scripts/check-actions-usage.mjs
 *   node scripts/check-actions-usage.mjs --limit 200
 *   node scripts/check-actions-usage.mjs --json
 *   node scripts/check-actions-usage.mjs --selftest   # ★毒を入れて赤になることを確かめる
 */
import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";
import {
  EXIT,
  computeExitCode,
  formatProbeReport,
  runSelfTest,
} from "./lib/instrument-core.mjs";
import { DEFAULT_THRESHOLDS, analyzeRuns } from "./lib/actions-usage-core.mjs";

const execFileAsync = promisify(execFile);

const LIMITATION =
  "請求額そのものは測っていない（分数のみ／無料枠・OS別単価は考慮しない）。" +
  "Vercel/Clerk/Upstash の費用と、直近の取得件数より前の実行は対象外。";

function parseArgs(argv) {
  const args = { limit: 100, json: false, selftest: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--limit") args.limit = Number(argv[++i]) || 100;
    else if (argv[i] === "--json") args.json = true;
    else if (argv[i] === "--selftest") args.selftest = true;
  }
  return args;
}

/** gh CLI で実行一覧を取る。取れなければ null（★0件と区別する）。 */
async function fetchRuns(limit) {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["api", `repos/{owner}/{repo}/actions/runs?per_page=${limit}`, "--jq", ".workflow_runs"],
      { maxBuffer: 20 * 1024 * 1024, windowsHide: true }
    );
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return { error: err?.stderr || err?.message || String(err) };
  }
}

/** ★毒テスト: 暴走データを食わせて赤になることを確かめる。 */
function selftest() {
  const base = (min, name = "CI") => ({
    name,
    status: "completed",
    created_at: "2026-08-31T10:00:00Z",
    run_started_at: "2026-08-31T10:00:00Z",
    updated_at: new Date(Date.parse("2026-08-31T10:00:00Z") + min * 60000).toISOString(),
  });

  const { ok, fails } = runSelfTest([
    {
      name: "1回30分の暴走を検知する",
      poison() {},
      isRed: () => analyzeRuns([base(30, "runaway")]).violations.length > 0,
      restore() {},
    },
    {
      name: "合計が膨らんだ場合を検知する",
      poison() {},
      isRed: () =>
        analyzeRuns([...Array(25)].map(() => base(15, "smoke"))).violations.length > 0,
      restore() {},
    },
    {
      name: "平常データでは赤にならない（誤検知しない）",
      poison() {},
      isRed: () => analyzeRuns([...Array(20)].map(() => base(4))).violations.length === 0,
      restore() {},
    },
  ]);

  if (!ok) {
    console.error("❌ selftest 失敗:");
    for (const f of fails) console.error(`   - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log("✅ selftest: 毒を入れると赤になり、平常では緑のままになることを確認した");
  process.exit(EXIT.PASS);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) return selftest();

  const runs = await fetchRuns(args.limit);

  // ★取れなかったときは緑にも赤にもしない（測れなかった＝2）。
  if (runs === null || (runs && runs.error)) {
    const result = {
      probe: "actions-usage",
      verdict: "inconclusive",
      evidence: null,
      detail: `GitHub API から実行一覧を取得できなかった: ${runs?.error || "不明な形式"}`,
      howToFix: "gh auth status で認証を確認する（gh CLI が必要）。",
      limitation: LIMITATION,
    };
    if (args.json) console.log(JSON.stringify({ results: [result] }, null, 2));
    else console.log(formatProbeReport([result], { label: "Actions 消費" }));
    process.exit(computeExitCode([result]));
  }

  const analysis = analyzeRuns(runs, DEFAULT_THRESHOLDS);

  // ★1件も測れなかったなら「0件で緑」にしない。
  if (analysis.measuredRuns === 0) {
    const result = {
      probe: "actions-usage",
      verdict: "inconclusive",
      evidence: null,
      detail: "完了した実行を1件も測れなかった（API は応答したが中身が空）。",
      howToFix: "リポジトリに実行履歴があるか確認する。--limit を増やして再実行する。",
      limitation: LIMITATION,
    };
    if (args.json) console.log(JSON.stringify({ results: [result] }, null, 2));
    else console.log(formatProbeReport([result], { label: "Actions 消費" }));
    process.exit(computeExitCode([result]));
  }

  const top = analysis.byWorkflow
    .slice(0, 3)
    .map((w) => `${w.name} ${Math.round(w.totalMinutes)}分(最大${Math.round(w.maxMinutes)}分/${w.runs}回)`)
    .join(" / ");

  const result = {
    probe: "actions-usage",
    verdict: analysis.violations.length > 0 ? "fail" : "pass",
    evidence: {
      measuredRuns: analysis.measuredRuns,
      totalMinutes: analysis.totalMinutes,
      windowFrom: analysis.windowFrom,
      windowTo: analysis.windowTo,
      topWorkflows: top,
      thresholds: DEFAULT_THRESHOLDS,
      verifiedAt: new Date().toISOString(),
    },
    detail:
      analysis.violations.length > 0
        ? analysis.violations
            .map((v) => `${v.kind}: ${v.name} が ${v.minutes}分（上限 ${v.limit}分）`)
            .join(" / ")
        : "",
    howToFix:
      "そのワークフローが毎回失敗していないか・timeout-minutes が実測に対して大きすぎないかを見る。" +
      "意図した増加なら DEFAULT_THRESHOLDS を理由付きで上げてよい。",
    limitation: LIMITATION,
  };

  if (args.json) {
    console.log(JSON.stringify({ analysis, results: [result] }, null, 2));
  } else {
    console.log(formatProbeReport([result], { label: "Actions 消費" }));
    // ★緑のときも「何を測ったか」を必ず出す。数字の見えない緑は
    //   「測っていない緑」と区別が付かない（instrument-core の掟）。
    const window =
      analysis.windowFrom && analysis.windowTo
        ? `${analysis.windowFrom.slice(0, 10)} 〜 ${analysis.windowTo.slice(0, 10)}`
        : "期間不明";
    console.log(
      `   測定: ${analysis.measuredRuns}件 / 合計 ${analysis.totalMinutes}分 (${window})`
    );
    for (const w of analysis.byWorkflow.slice(0, 5)) {
      console.log(
        `   - ${w.name}: ${Math.round(w.totalMinutes)}分 (${w.runs}回・最大 ${Math.round(w.maxMinutes)}分)`
      );
    }
    console.log(`   ★測っていないもの: ${LIMITATION}`);
  }
  process.exit(computeExitCode([result]));
}

main().catch((err) => {
  console.error("check-actions-usage: 予期しないエラー", err);
  process.exit(EXIT.INCONCLUSIVE);
});
