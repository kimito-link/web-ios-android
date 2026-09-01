#!/usr/bin/env node
// @ts-check
/**
 * Dependabot の更新PRが「枠を使い切って止まっていないか」を見張る計器。
 *
 * ■ ★なぜ要るか（2026-09-01 に実際に起きていた）
 *   `.github/dependabot.yml` の上限が10で、オープンPRがちょうど10本。
 *   → **17日間、新しい更新PRが1本も作られていなかった**。★セキュリティ更新も含む。
 *   さらに一度もマージされた履歴が無く、放置するほど枠が埋まって
 *   さらに更新が来なくなる**自己増悪する構造**になっていた。
 *
 *   ★この故障はCIの赤としてはどこにも出ない。「何も起きない」形で壊れる。
 *   ＝ 誰も気づけないまま依存が古くなる。100年単位では最も高くつく壊れ方。
 *
 * ■ ★測っていないもの（過信を防ぐ）
 *   - PRの中身の安全性（メジャー更新か・破壊的変更か）は見ない。**詰まりだけ**を見る。
 *   - 実際にマージしてよいかの判断はしない（人間が決める）。
 *
 * ■ 終了コード（instrument-core の3値）
 *   0 = 詰まっていない / 1 = 詰まっている / ★2 = 測れなかった（緑ではない）
 *
 * 使い方:
 *   node scripts/check-dependabot-queue.mjs
 *   node scripts/check-dependabot-queue.mjs --selftest
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { EXIT, computeExitCode, formatProbeReport, runSelfTest } from "./lib/instrument-core.mjs";
import { judgeQueue, parseDependabotLimits } from "./lib/dependabot-queue-core.mjs";

const execFileAsync = promisifyExecFile();
function promisifyExecFile() {
  return (cmd, args, opts) =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, opts, (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stderr }));
        else resolve({ stdout, stderr });
      });
    });
}

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "..");
const CONFIG = path.join(repoRoot, ".github", "dependabot.yml");

const LIMITATION =
  "PRの中身（メジャー更新か・破壊的変更か）は見ていない。詰まりだけを判定する。";

function selftest() {
  const { ok, fails } = runSelfTest([
    {
      name: "満杯を検知する",
      poison() {},
      isRed: () => judgeQueue({ openCount: 10, limit: 10 }).verdict === "fail",
      restore() {},
    },
    {
      name: "一度もマージが無い状態を検知する",
      poison() {},
      isRed: () => judgeQueue({ openCount: 2, limit: 10, mergedEver: false }).verdict === "fail",
      restore() {},
    },
    {
      name: "余裕があるときは誤検知しない",
      poison() {},
      isRed: () => judgeQueue({ openCount: 2, limit: 10 }).verdict === "pass",
      restore() {},
    },
    {
      name: "設定の上限を読める（件数ベタ書きにしない）",
      poison() {},
      isRed: () =>
        parseDependabotLimits("  - package-ecosystem: npm\n    open-pull-requests-limit: 7\n")
          .ecosystems[0].limit === 7,
      restore() {},
    },
  ]);
  if (!ok) {
    console.error("❌ selftest 失敗:");
    for (const f of fails) console.error(`   - ${f}`);
    process.exit(EXIT.FAIL);
  }
  console.log("✅ selftest: 満杯・放置を検知し、余裕があるときは誤検知しないことを確認した");
  process.exit(EXIT.PASS);
}

async function gh(args) {
  const { stdout } = await execFileAsync("gh", args, {
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

async function main() {
  if (process.argv.includes("--selftest")) return selftest();

  const inconclusive = (detail, howToFix) => {
    const result = {
      probe: "dependabot-queue",
      verdict: "inconclusive",
      evidence: null,
      detail,
      howToFix,
      limitation: LIMITATION,
    };
    console.log(formatProbeReport([result], { label: "Dependabot枠" }));
    process.exit(computeExitCode([result]));
  };

  if (!fs.existsSync(CONFIG)) {
    inconclusive(
      ".github/dependabot.yml が見つからない",
      "Dependabot を使っていないなら、この検査は外してよい。"
    );
  }

  const { ecosystems } = parseDependabotLimits(fs.readFileSync(CONFIG, "utf8"));
  if (ecosystems.length === 0) {
    inconclusive(
      "dependabot.yml から ecosystem を1件も読めなかった",
      "設定の書式を確認する（package-ecosystem: の行があるか）。"
    );
  }

  // npm の枠が実務上いちばん詰まる。設定にある最大の上限で見る。
  const limit = Math.max(...ecosystems.map((e) => e.limit));

  let openPrs;
  let mergedEver;
  try {
    openPrs = JSON.parse(
      await gh(["pr", "list", "--state", "open", "--limit", "100", "--json", "number,createdAt,headRefName"])
    );
    const merged = JSON.parse(
      await gh(["pr", "list", "--state", "merged", "--limit", "100", "--json", "headRefName"])
    );
    mergedEver = merged.some((p) => String(p.headRefName || "").startsWith("dependabot/"));
  } catch (err) {
    inconclusive(
      `GitHub からPR一覧を取得できなかった: ${err?.stderr || err?.message || err}`,
      "gh auth status で認証を確認する。"
    );
  }

  const bots = openPrs.filter((p) => String(p.headRefName || "").startsWith("dependabot/"));
  const oldestDays = bots.length
    ? Math.max(
        ...bots.map((p) => Math.floor((Date.now() - Date.parse(p.createdAt)) / 86400000))
      )
    : null;

  const judged = judgeQueue({ openCount: bots.length, limit, oldestDays, mergedEver });

  const result = {
    probe: "dependabot-queue",
    verdict: judged.verdict,
    evidence: {
      openDependabotPrs: bots.length,
      limit,
      oldestDays,
      mergedEver,
      verifiedAt: new Date().toISOString(),
    },
    detail: judged.reasons.join(" / "),
    howToFix:
      "古い更新PRを流すか閉じて枠を空ける。恒常的に溢れるなら dependabot.yml で " +
      "groups を使ってPRをまとめる（本数が減る）か open-pull-requests-limit を上げる。",
    limitation: LIMITATION,
  };

  console.log(formatProbeReport([result], { label: "Dependabot枠" }));
  // ★緑でも数字を出す（測っていない緑と区別が付かなくならないように）。
  console.log(
    `   測定: オープン ${bots.length}本 / 上限 ${limit}本` +
      (oldestDays !== null ? ` / 最古 ${oldestDays}日` : "") +
      ` / 過去にマージ: ${mergedEver ? "あり" : "★なし"}`
  );
  console.log(`   ★測っていないもの: ${LIMITATION}`);
  process.exit(computeExitCode([result]));
}

main().catch((err) => {
  console.error("check-dependabot-queue: 予期しないエラー", err);
  process.exit(EXIT.INCONCLUSIVE);
});
