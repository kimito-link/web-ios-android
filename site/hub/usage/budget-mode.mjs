/**
 * budget-mode.mjs — Claude の残り枠から「いまの節約の段階」と「仕事の振り分け先」を決める純関数。
 *
 * なぜ要るか（2026-11-25 りんく「かなり減ってきたので、無料のものとかをバランスを使って、全体設定で」）:
 *   振り分けの目安（週50%で実装は Codex へ等）は MULTI-BRAIN-HOWTO §1e に書いてあったが、
 *   AI が自分で使用量の画面を見に行かない限り効かなかった。実際 11/25 は週75%・Fable 98% なのに、
 *   どのセッションにも知らせが届いていなかった。数字（usage-data ブランチの usage.json）から段階を
 *   機械で決め、hook（.claude/hooks/inject-ai-budget-mode.mjs）が各セッションへ配る。
 *
 * 使い方:
 *   import { budgetMode, budgetNotice } from "./budget-mode.mjs";
 *   const mode = budgetMode(usageJson, Date.now());   // usageJson = usage.json の中身（読めなければ null）
 *   const text = budgetNotice(mode);                  // セッションに渡す数行の日本語（normal なら ""）
 *
 * 依存は usage-history.mjs（paceOf/statusOf/WINDOW_MS）だけ。fs/ネットワークは使わない。
 * 振り分け先の順番そのものは dispatch.py の AUTO_CHAIN / TEXT_CHAIN が正本（ここに複製しない）。
 */
import { WINDOW_MS, statusOf } from "./usage-history.mjs";

/** 記録がこれより古ければ「止まっている」と知らせる（定期タスクは4時間ごと。2回分の取りこぼしまで許す）。 */
export const STALE_MS = 12 * 60 * 60 * 1000;

/** 週全体の段階のしきい値(%)。50 は MULTI-BRAIN-HOWTO §1e の既定（2026-11-12）と同じ。 */
export const WEEKLY_STEPS = Object.freeze({ save: 50, strict: 80, empty: 95 });
/** Fable の段階のしきい値(%)。70 は同 §1e。95 以上はプランモード自体に入らない。 */
export const FABLE_STEPS = Object.freeze({ limit: 70, off: 95 });

const LEVELS = ["normal", "save", "strict", "empty"];

/**
 * @param {{updatedAt?:string, current?:{windows?:object}}|null} usage usage.json の中身
 * @param {number} nowMs
 * @returns {{level:"normal"|"save"|"strict"|"empty", fable:"ok"|"limit"|"off", weekly:number|null,
 *            fablePct:number|null, pace:string, stale:boolean, ageHours:number|null, resetsAt:string|null}}
 */
export function budgetMode(usage, nowMs) {
  const updated = usage && Date.parse(usage.updatedAt);
  const ageMs = Number.isFinite(updated) ? nowMs - updated : null;
  const w = (usage && usage.current && usage.current.windows) || {};
  const weeklyWin = w.weekly && typeof w.weekly.percentUsed === "number" ? w.weekly : null;
  const fableWin = w.fable && typeof w.fable.percentUsed === "number" ? w.fable : null;
  // 記録が古い、または週の数字が無い＝数字を信用できない。その場合も「止まっている」ことを知らせる。
  const stale = ageMs === null || ageMs > STALE_MS || !weeklyWin;
  const base = {
    weekly: weeklyWin ? weeklyWin.percentUsed : null,
    fablePct: fableWin ? fableWin.percentUsed : null,
    stale,
    ageHours: ageMs === null ? null : Math.round(ageMs / 3600000),
    resetsAt: weeklyWin ? weeklyWin.resetsAt : null,
  };
  // 枠は resetsAt を過ぎたら戻っている。古い数字で締め付けない。
  const reset = weeklyWin && Date.parse(weeklyWin.resetsAt) <= nowMs;
  if (!weeklyWin || reset) return { ...base, level: "normal", fable: "ok", pace: "unknown" };

  const pct = weeklyWin.percentUsed;
  const pace = statusOf(weeklyWin, WINDOW_MS.weekly, nowMs);
  let i = pct >= WEEKLY_STEPS.empty ? 3 : pct >= WEEKLY_STEPS.strict ? 2 : pct >= WEEKLY_STEPS.save ? 1 : 0;
  // このペースだと枠の終わりより前に尽きる（danger）なら一段きつくする（empty は超えない）。
  if (pace === "danger" && i < 3) i += 1;

  const f = fableWin && Date.parse(fableWin.resetsAt) > nowMs ? fableWin.percentUsed : 0;
  const fable = f >= FABLE_STEPS.off ? "off" : f >= FABLE_STEPS.limit ? "limit" : "ok";
  return { ...base, level: LEVELS[i], fable, pace };
}

/** 段階ごとの振り分け（セッションに渡す文）。上の段階は下の段階の決まりも含む。 */
const LEVEL_LINES = {
  save: [
    "実装・テスト追加・定型修正は自分で書かず `python docs/ai-workflows/tools/dispatch.py --cwd <dir> --verify \"<合否を決めるコマンド>\" \"<やること>\"`（auto: Codex が先頭、枠切れの頭脳は自動で飛ばす）へ。自分で直すのは1〜2ファイル・10分ほどのものだけ。",
    "1ファイルで済む単体テスト・型付けは `dispatch.py --out <ファイル> --context <元のファイル> --verify \"<そのテスト>\"`（無料の Ollama → Groq → Gemini。通るまで dispatch が確かめる）へ。",
    "合否をコマンドで決められない仕事（設計・見た目・審査・法令）は渡さない（dispatch も断る）。自分でやる。",
    "文章だけの仕事（要約・翻訳・下書き）は `dispatch.py --text`（Gemini・Groq の無料枠）へ。",
  ],
  strict: [
    "調べ物もサブエージェントを立てない（Claude の枠を使う）。ファイルの読み回しは `--brain codex`、PC が要らない調べ物・見張りは dot（Issue にラベル `dot` だけ）、文章は `--text` へ。",
    "Claude（自分）は、判断・差分の検品・マージ・報告だけにする。読むときは grep・jq で要る行だけ。",
  ],
  empty: [
    "新しい作業は始めない。手を動かす仕事は dot の Issue か夜の一括（job-runner・`brain: local`）に積み、検品は枠が戻ってから。",
  ],
};
const FABLE_LINES = {
  limit: "Fable が上限の7割を超えた: プランモード（Fable）は「方針が割れていて、間違えると戻すのが大変な設計」だけ。それ以外は Opus のまま計画する。",
  off: "Fable がほぼ上限: プランモードに入らない（入ると Fable を使う）。計画も Opus で立てる。",
};

const LABEL = { normal: "ふつう", save: "節約", strict: "強い節約", empty: "ほぼ空" };

/**
 * セッションに渡す文。何も変えなくてよいとき（normal・Fable ok・記録が新しい）は空文字。
 * @param {ReturnType<typeof budgetMode>} m
 */
export function budgetNotice(m) {
  const out = [];
  if (m.stale) {
    out.push(
      `[AIの枠] 使用量の記録が${m.ageHours === null ? "読めない" : `${m.ageHours}時間前で止まっている`}（または週の数字が空）。` +
        "会社PCの定期タスク record-claude-usage が動いているか確かめる。数字が無い間は「節約」として振る舞う。",
    );
  }
  const level = m.stale && m.level === "normal" ? "save" : m.level;
  if (level === "normal" && m.fable === "ok") return out.join("\n");
  if (!m.stale) {
    const reset = m.resetsAt ? `（${new Date(m.resetsAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "numeric" })}に戻る）` : "";
    out.push(
      `[AIの枠] いま「${LABEL[level]}」: 週 ${m.weekly}%・Fable ${m.fablePct ?? "?"}%${reset}${m.pace === "danger" ? "・このペースだと戻る前に尽きる" : ""}。`,
    );
  }
  const steps = ["save", "strict", "empty"];
  for (const s of steps.slice(0, steps.indexOf(level) + 1)) out.push(...LEVEL_LINES[s].map((t) => `- ${t}`));
  if (m.fable !== "ok") out.push(`- ${FABLE_LINES[m.fable]}`);
  out.push("- 正本: docs/ai-workflows/MULTI-BRAIN-HOWTO.md §1g");
  return out.join("\n");
}
