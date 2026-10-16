import { describe, expect, it } from "vitest";
import { buildTimeline, parseIntroducedRows, renderTimelineMarkdown } from "./improvement-timeline.mjs";

// ★毒テスト方針: 「緑のまま嘘をつく台帳」を作らないため、誤判定しやすい実例（向きの取り違え・
//   推測での割り当て）を実際の入力で示す。

const METRICS = [
  { id: "lo", label: "小さいほど良い", better: "lower", unit: "ms" },
  { id: "hi", label: "大きいほど良い", better: "higher", unit: "件" }
];
const commit = (c, subject = `題${c}`) => ({ sha: c.repeat(40).slice(0, 40), short: c.repeat(7), date: "2026-10-16T00:00:00+09:00", subject });
const row = (version, metric, value, extra = {}) => ({ version, metric, value, source: "s", ...extra });

describe("parseIntroducedRows", () => {
  const rec = (sha, date, subject, body) => `\u001e${sha}\u001f${date}\u001f${subject}\n\n${body}`;

  it("追加行から (version, metric) を最初に書き足したコミットを取る", () => {
    const text = rec("a".repeat(40), "2026-10-01", "初回", "+    version: '0.1.0', metric: 'lo', value: 5,\n")
      + rec("b".repeat(40), "2026-10-02", "別の行", "+    version: '0.1.1', metric: 'lo', value: 4,\n");
    const m = parseIntroducedRows(text);
    expect(m.get("0.1.0\u0000lo")?.subject).toBe("初回");
    expect(m.get("0.1.1\u0000lo")?.subject).toBe("別の行");
    expect(m.get("0.1.0\u0000lo")?.short).toBe("aaaaaaa");
  });

  it("同じ行が後から再登場しても、最初のコミットを動かさない（書式直しで測定の時点がずれない）", () => {
    const body = "+    version: '0.1.0', metric: 'lo', value: 5,\n";
    const m = parseIntroducedRows(rec("a".repeat(40), "d1", "初回", body) + rec("b".repeat(40), "d2", "書式直し", body));
    expect(m.get("0.1.0\u0000lo")?.subject).toBe("初回");
  });

  it("削除行・ファイル見出し・文脈行は台帳の行として数えない", () => {
    const body = "-    version: '0.1.0', metric: 'lo', value: 5,\n+++ b/scripts/improvement-history.mjs\n     version: '0.1.0', metric: 'lo', value: 5,\n";
    expect(parseIntroducedRows(rec("a".repeat(40), "d", "s", body)).size).toBe(0);
  });

  it("空・不正な入力は空の Map（例外にしない）", () => {
    expect(parseIntroducedRows("").size).toBe(0);
    expect(parseIntroducedRows(null).size).toBe(0);
    expect(parseIntroducedRows("\u001e\n").size).toBe(0);
  });
});

describe("buildTimeline: 判定", () => {
  it("小さいほど良い指標の増加は悪化", () => {
    const tl = buildTimeline({ history: [row("v1", "lo", 5), row("v2", "lo", 9)], metrics: METRICS });
    expect(tl.metrics[0].entries[1].direction).toBe("regressed");
    expect(tl.summary.regressed).toBe(1);
  });

  it("★大きいほど良い指標の増加を悪化と誤判定しない（向きは宣言から取る）", () => {
    const tl = buildTimeline({ history: [row("v1", "hi", 5), row("v2", "hi", 9)], metrics: METRICS });
    expect(tl.metrics[0].entries[1].direction).toBe("improved");
  });

  it("初回は baseline、同値は same", () => {
    const tl = buildTimeline({ history: [row("v1", "lo", 5), row("v2", "lo", 5)], metrics: METRICS });
    expect(tl.metrics[0].entries[0].direction).toBe("baseline");
    expect(tl.metrics[0].entries[1].direction).toBe("same");
  });

  it("★理由(note)つきの悪化は許容の印を付けるが、悪化として数える", () => {
    const tl = buildTimeline({ history: [row("v1", "lo", 5), row("v2", "lo", 9, { note: "機能を足したため" })], metrics: METRICS });
    const e = tl.metrics[0].entries[1];
    expect(e.direction).toBe("regressed");
    expect(e.accepted).toBe(true);
    expect(tl.summary.accepted).toBe(1);
    expect(tl.summary.regressed).toBe(1);
  });

  it("空白だけの note は理由として認めない（黙らせられない）", () => {
    const tl = buildTimeline({ history: [row("v1", "lo", 5), row("v2", "lo", 9, { note: "   " })], metrics: METRICS });
    expect(tl.metrics[0].entries[1].accepted).toBe(false);
  });

  it("★未宣言の指標は判定できず（勝手に方向を決めない）", () => {
    const tl = buildTimeline({ history: [row("v1", "zz", 1), row("v2", "zz", 9)], metrics: METRICS });
    expect(tl.metrics[0].entries[1].direction).toBe("unknown");
    expect(tl.metrics[0].label).toBe("zz");
  });

  it("★測れていない行（null/NaN/文字列）は載せない（0として扱わない）", () => {
    const tl = buildTimeline({ history: [row("v1", "lo", 5), row("v2", "lo", null), row("v3", "lo", NaN), row("v4", "lo", "7"), row("v5", "lo", 7)], metrics: METRICS });
    expect(tl.metrics[0].entries.map((e) => e.version)).toEqual(["v1", "v5"]);
  });

  it("history が配列でなくても落ちない", () => {
    expect(buildTimeline({ history: null, metrics: METRICS }).metrics).toEqual([]);
    expect(buildTimeline({ history: undefined, metrics: undefined }).summary.baseline).toBe(0);
  });
});

describe("buildTimeline: 変更の紐付け", () => {
  const commits = { "v1\u0000lo": commit("a"), "v2\u0000lo": commit("b"), "v4\u0000lo": commit("d") };
  const commitOf = (v, m) => commits[`${v}\u0000${m}`] || null;
  const changesBetween = (from, to) => [`範囲 ${from.slice(0, 1)}→${to.slice(0, 1)}`];

  it("前回の測定〜今回の測定の範囲の変更を、特定できた行に付ける", () => {
    const tl = buildTimeline({ history: [row("v1", "lo", 5), row("v2", "lo", 4)], metrics: METRICS, commitOf, changesBetween });
    const e = tl.metrics[0].entries[1];
    expect(e.traceable).toBe(true);
    expect(e.changes).toEqual(["範囲 a→b"]);
    expect(e.commit?.short).toBe("bbbbbbb");
  });

  it("★コミットを特定できない行には、変更を推測で割り当てない", () => {
    const tl = buildTimeline({ history: [row("v1", "lo", 5), row("v3", "lo", 4)], metrics: METRICS, commitOf, changesBetween });
    const e = tl.metrics[0].entries[1];
    expect(e.traceable).toBe(false);
    expect(e.changes).toEqual([]);
    expect(tl.summary.untraceable).toBe(1);
  });

  it("コミット不明の行をまたいでも、直近に分かっていた測定を比較元にする", () => {
    const tl = buildTimeline({ history: [row("v2", "lo", 5), row("v3", "lo", 4), row("v4", "lo", 3)], metrics: METRICS, commitOf, changesBetween });
    expect(tl.metrics[0].entries[2].changes).toEqual(["範囲 b→d"]);
  });

  it("commitOf / changesBetween を渡さなくても動く（gitなしでも判定は出る）", () => {
    const tl = buildTimeline({ history: [row("v1", "lo", 5), row("v2", "lo", 4)], metrics: METRICS });
    expect(tl.metrics[0].entries[1].direction).toBe("improved");
    expect(tl.metrics[0].entries[1].traceable).toBe(false);
  });

  it("event は 行の event → note → コミットの題 の順に使う", () => {
    const history = [
      row("v1", "lo", 5),
      row("v2", "lo", 4, { event: "起きたこと" }),
      row("v4", "lo", 3, { note: "理由" })
    ];
    const tl = buildTimeline({ history, metrics: METRICS, commitOf, changesBetween });
    expect(tl.metrics[0].entries[0].event).toBe("題a");
    expect(tl.metrics[0].entries[1].event).toBe("起きたこと");
    expect(tl.metrics[0].entries[2].event).toBe("理由");
  });
});

describe("renderTimelineMarkdown", () => {
  const history = [row("v1", "lo", 5), row("v2", "lo", 9, { note: "機能を足したため" }), row("v3", "lo", 12)];
  const tl = buildTimeline({ history, metrics: METRICS });

  it("相関であって因果の証明ではないという注意を必ず出す", () => {
    expect(renderTimelineMarkdown(tl)).toContain("全部が原因とは限りません");
  });

  it("特定できない行は『変更を特定できません』と理由を出す（空欄にしない）", () => {
    expect(renderTimelineMarkdown(tl)).toContain("変更を特定できません");
  });

  it("理由つき悪化は🟡、理由なしの悪化は🔴で区別する", () => {
    const md = renderTimelineMarkdown(tl);
    expect(md).toContain("🟡 悪化（理由つきで許容）");
    expect(md).toContain("🔴 悪化");
  });

  it("表のセルに | や改行があっても表が崩れない", () => {
    const t = buildTimeline({ history: [row("v1", "lo", 5, { note: "a|b\nc" })], metrics: METRICS });
    const md = renderTimelineMarkdown(t);
    expect(md).toContain("a\\|b c");
  });

  it("記録が無いときは、指標を宣言して記録するよう案内する", () => {
    expect(renderTimelineMarkdown(buildTimeline({ history: [], metrics: METRICS }))).toContain("まだ実測値の記録がありません");
  });

  it("--limit は各指標の直近だけ表示し、省略した件数を言う", () => {
    const md = renderTimelineMarkdown(tl, { limit: 1 });
    expect(md).toContain("古い 2 件は省略");
  });
});
