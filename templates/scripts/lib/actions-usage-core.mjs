// @ts-check
/**
 * actions-usage-core.mjs — GitHub Actions の消費を「暴走ジョブ」の観点で判定する純関数。
 *
 * ■ なぜ月次合計ではなく1回あたりの所要時間を見るか（★設計の要）
 *   2026-08-06 に Actions の予算上限で全リポの CI が停止した実損がある
 *   （memory/actions-budget-exhausted-2026-08-06.md）。そのとき溶けた実測は
 *   **6日で 6,801分**。8/1 が 2,969分、8/3 が 2,560分で全体の8割。
 *
 *   会議（council/infra-hosting-brief.md）は「月1,000分超で警告」を提案したが、
 *   ★月次合計の閾値では**予算が溶けた後にしか鳴らない**。
 *   実際の焼き方は「1本のワークフローが毎push 30分回り続ける」形だった
 *   （kimitolink の Lightpanda が8月で446分／一度も成功しないまま）。
 *
 *   → だから **1回あたりの所要時間**と**ワークフロー別の合計**で見る。
 *     これなら暴走を「その日のうちに」捕まえられる。
 *
 * ■ ★この計器が判定しないこと（過信を防ぐ・limitation に出す）
 *   - **請求額そのものは測っていない。** 分数と金額は無料枠・OS別単価
 *     (Linux 1x / macOS 10x) で変わる。gh の user スコープが要る billing API は
 *     権限を広げないと叩けないため、あえて触っていない。
 *   - Vercel / Clerk / Upstash の費用は**対象外**。
 *   - GitHub API が返す直近ぶん（既定100件）しか見ない。それ以前は分からない。
 */

/** 既定のしきい値。実測に基づく（下の理由を読んでから変えること）。 */
export const DEFAULT_THRESHOLDS = Object.freeze({
  /**
   * 1回の実行がこれを超えたら赤。
   * 現状の実測は CI 平均4.1分・最大5分、Playwright smoke 平均3.6分。
   * 20分は「明らかに異常」の水準（Lightpanda の暴走時が毎push 30分だった）。
   */
  singleRunMinutes: 20,
  /**
   * 1ワークフローの合計がこれを超えたら赤（観測窓の中で）。
   * 直近100件で CI 83分・smoke 63分。300分は平常の3〜4倍。
   */
  workflowTotalMinutes: 300,
  /** 観測窓の合計がこれを超えたら赤。事故時は6日で6,801分だった。 */
  windowTotalMinutes: 1500,
});

/**
 * 実行1件の所要分を出す。
 * @param {{run_started_at?: string, created_at?: string, updated_at?: string}} run
 * @returns {number|null} 分。計算できなければ null
 */
export function runMinutes(run) {
  const start = Date.parse(run?.run_started_at || run?.created_at || "");
  const end = Date.parse(run?.updated_at || "");
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const min = (end - start) / 60000;
  if (min < 0) return null;
  return min;
}

/**
 * 実行一覧から、暴走の兆候を判定する。
 *
 * @param {Array<object>} runs GitHub の workflow_runs 相当
 * @param {typeof DEFAULT_THRESHOLDS} [thresholds]
 * @returns {{
 *   measuredRuns: number,
 *   totalMinutes: number,
 *   windowFrom: string|null,
 *   windowTo: string|null,
 *   byWorkflow: Array<{name: string, runs: number, totalMinutes: number, maxMinutes: number}>,
 *   violations: Array<{kind: string, name: string, minutes: number, limit: number}>,
 * }}
 */
export function analyzeRuns(runs, thresholds = DEFAULT_THRESHOLDS) {
  const list = Array.isArray(runs) ? runs : [];
  const completed = list.filter((r) => r && r.status === "completed");

  /** @type {Map<string, {name: string, runs: number, totalMinutes: number, maxMinutes: number}>} */
  const byName = new Map();
  let totalMinutes = 0;
  let measuredRuns = 0;
  let from = null;
  let to = null;

  for (const run of completed) {
    const min = runMinutes(run);
    if (min === null) continue; // 測れないものは黙って0扱いにせず、母数から外す
    measuredRuns += 1;
    totalMinutes += min;

    const stamp = run.created_at || run.run_started_at;
    if (stamp) {
      if (!from || stamp < from) from = stamp;
      if (!to || stamp > to) to = stamp;
    }

    const name = String(run.name || "(no name)");
    const cur = byName.get(name) || { name, runs: 0, totalMinutes: 0, maxMinutes: 0 };
    cur.runs += 1;
    cur.totalMinutes += min;
    if (min > cur.maxMinutes) cur.maxMinutes = min;
    byName.set(name, cur);
  }

  const byWorkflow = [...byName.values()].sort((a, b) => b.totalMinutes - a.totalMinutes);

  const violations = [];
  for (const w of byWorkflow) {
    if (w.maxMinutes > thresholds.singleRunMinutes) {
      violations.push({
        kind: "single-run",
        name: w.name,
        minutes: Math.round(w.maxMinutes),
        limit: thresholds.singleRunMinutes,
      });
    }
    if (w.totalMinutes > thresholds.workflowTotalMinutes) {
      violations.push({
        kind: "workflow-total",
        name: w.name,
        minutes: Math.round(w.totalMinutes),
        limit: thresholds.workflowTotalMinutes,
      });
    }
  }
  if (totalMinutes > thresholds.windowTotalMinutes) {
    violations.push({
      kind: "window-total",
      name: "(観測窓の合計)",
      minutes: Math.round(totalMinutes),
      limit: thresholds.windowTotalMinutes,
    });
  }

  return {
    measuredRuns,
    totalMinutes: Math.round(totalMinutes),
    windowFrom: from,
    windowTo: to,
    byWorkflow,
    violations,
  };
}
