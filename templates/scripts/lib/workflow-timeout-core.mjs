// @ts-check
/**
 * workflow-timeout-core.mjs — ワークフローの全ジョブに timeout-minutes があるかを判定する純関数。
 *
 * なぜこの検査が要るか（予防ではなく実損の再発防止）:
 *   2026-08-06、GitHub Actions の予算上限に達して**全リポのCIが停止**した。
 *   真因は timeout-minutes 未設定のジョブが40リポに77件あり、ハングすると
 *   GitHub 既定の6時間まで回り続けていたこと（8/1-8/6 で Linux 6,801分）。
 *   記憶: memory/actions-budget-exhausted-2026-08-06.md
 *
 *   ★対策を入れた当時、検査は無かったので「また未設定のジョブが増えても気づけない」状態だった。
 *   実際 2026-09-01 時点で auth-state-health.yml の check ジョブが未設定のまま残っていた
 *   （週2回 cron・npm ci あり＝ハングすれば6時間コース）。
 *
 * 設計判断:
 *   - ★YAMLライブラリに依存しない。yaml は未宣言・js-yaml は推移的依存でしかなく、
 *     CI で確実に解決できる保証がない。ここが落ちると「緑なのに検査していない」に直結する。
 *   - そのため jobs: 直下のキーだけを見る素朴パーサにしてある。GitHub Actions の
 *     ワークフローは jobs 直下が2スペース固定なので、この範囲では十分に厳密。
 *   - `uses:` のみのジョブ（reusable workflow 呼び出し）は timeout-minutes を
 *     書けないため除外する（呼び出し先が持つ）。
 */

/**
 * ワークフローYAMLの本文から、timeout-minutes が無いジョブ名を返す。
 * @param {string} source ワークフローYAMLの中身
 * @returns {{ jobs: string[], missing: string[] }}
 */
export function findJobsWithoutTimeout(source) {
  const lines = String(source).split(/\r?\n/);
  const jobs = [];
  const missing = [];

  let inJobs = false;
  let current = null;
  let hasTimeout = false;
  let isUsesOnly = false;

  const flush = () => {
    if (!current) return;
    jobs.push(current);
    // reusable workflow 呼び出しは timeout-minutes を書けないので対象外。
    if (!hasTimeout && !isUsesOnly) missing.push(current);
    current = null;
  };

  for (const line of lines) {
    if (/^#/.test(line) || line.trim() === "") continue;

    // jobs: に入る / 出る（トップレベルの別キーが来たら終わり）
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (inJobs && /^[A-Za-z]/.test(line)) {
      flush();
      inJobs = false;
      continue;
    }
    if (!inJobs) continue;

    // jobs 直下（2スペース）のキー＝ジョブ名
    const jobName = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (jobName) {
      flush();
      current = jobName[1];
      hasTimeout = false;
      isUsesOnly = false;
      continue;
    }
    if (!current) continue;

    // ジョブ直下（4スペース）の設定のみ見る。steps の中の同名キーを拾わないため。
    if (/^ {4}timeout-minutes:\s*\S/.test(line)) hasTimeout = true;
    if (/^ {4}uses:\s*\S/.test(line)) isUsesOnly = true;
  }
  flush();

  return { jobs, missing };
}
