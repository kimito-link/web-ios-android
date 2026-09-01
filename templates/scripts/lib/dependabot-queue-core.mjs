// @ts-check
/**
 * dependabot-queue-core.mjs — Dependabot の「PR枠が埋まって止まる」を検知する純関数。
 *
 * ■ ★何を解決するか（2026-09-01 に実際に起きていた）
 *   `.github/dependabot.yml` の `open-pull-requests-limit: 10` に対して
 *   **オープンPRがちょうど10本**あり、17日間 Dependabot が
 *   **新しいPRを1本も作れない**状態になっていた。★セキュリティ更新も含めて止まる。
 *
 *   ★これは「赤いCI」としてはどこにも現れない。誰も見ていない場所で静かに止まる。
 *   しかも1本もマージされた履歴が無かった＝放置するほど枠が埋まり、
 *   さらに更新が来なくなるという**自己増悪する構造**だった。
 *
 * ■ ★なぜ「件数」ではなく「枠に対する比率」で見るか
 *   限度が10で10本なら満杯だが、限度が20なら10本は健全。
 *   ★閾値を数字でベタ書きすると設定変更で嘘になるので、必ず設定値と突き合わせる。
 *
 * ■ ★この判定が見ないもの（限界）
 *   - PRの中身の安全性（メジャー更新かどうか等）は見ない。詰まりだけを見る。
 *   - Dependabot 以外のPRは数えない（人間のPRで枠は埋まらないため）。
 */

/** 枠に対して何割から警告するか。満杯の手前で気づきたいので8割。 */
export const WARN_RATIO = 0.8;

/**
 * dependabot.yml の本文から ecosystem ごとの上限を読む。
 * ★YAMLライブラリに依存しない（CIで確実に解決できる保証が無いため）。
 *
 * @param {string} source
 * @returns {{ ecosystems: Array<{name: string, limit: number}> }}
 */
export function parseDependabotLimits(source) {
  const lines = String(source).split(/\r?\n/);
  const ecosystems = [];
  let current = null;

  for (const line of lines) {
    const eco = line.match(/^\s*-?\s*package-ecosystem:\s*["']?([A-Za-z0-9_-]+)["']?/);
    if (eco) {
      current = { name: eco[1], limit: 5 }; // Dependabot の既定は5
      ecosystems.push(current);
      continue;
    }
    const lim = line.match(/^\s*open-pull-requests-limit:\s*(\d+)/);
    if (lim && current) current.limit = Number(lim[1]);
  }
  return { ecosystems };
}

/**
 * 詰まり具合を判定する。
 *
 * @param {{openCount: number, limit: number, oldestDays?: number|null, mergedEver?: boolean}} input
 * @returns {{verdict: 'pass'|'fail', reasons: string[], ratio: number}}
 */
export function judgeQueue({ openCount, limit, oldestDays = null, mergedEver = true }) {
  const reasons = [];
  const safeLimit = limit > 0 ? limit : 1;
  const ratio = openCount / safeLimit;

  if (openCount >= safeLimit) {
    reasons.push(
      `オープン ${openCount}本 / 上限 ${limit}本 ＝ ★満杯。新しい更新PR（セキュリティ含む）が作られません`
    );
  } else if (ratio >= WARN_RATIO) {
    reasons.push(
      `オープン ${openCount}本 / 上限 ${limit}本 ＝ ${Math.round(ratio * 100)}% 埋まっています（満杯が近い）`
    );
  }

  // ★古いPRが残り続けること自体が詰まりの前触れ。
  if (typeof oldestDays === "number" && oldestDays >= 30) {
    reasons.push(`最も古い更新PRが ${oldestDays}日 放置されています`);
  }

  // ★一度もマージしていないなら、運用が回っていない（枠は埋まる一方）。
  if (!mergedEver && openCount > 0) {
    reasons.push("更新PRが一度もマージされていません（枠が埋まり続けます）");
  }

  return { verdict: reasons.length > 0 ? "fail" : "pass", reasons, ratio };
}
