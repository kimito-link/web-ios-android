import { describe, expect, it } from "vitest";
import { classifyHttp, logLooksFailed, parseRunLogName, statusOfBrain, summarizeRuns } from "./brain-status-core.mjs";

describe("classifyHttp", () => {
  it("通信失敗は down(最優先)", () => {
    expect(classifyHttp({ error: "TimeoutError", status: 200 })).toBe("down");
  });
  it("2xx は ok", () => {
    expect(classifyHttp({ status: 200, bodyText: "{}" })).toBe("ok");
    expect(classifyHttp({ status: 204 })).toBe("ok");
  });
  it("枠切れの語があり 402/403/429 なら quota(2026-10-19 の実際の応答)", () => {
    expect(classifyHttp({ status: 402, bodyText: "Grok Build usage balance exhausted Payment Required" })).toBe("quota");
    expect(classifyHttp({ status: 403, bodyText: '{"code":"insufficient_quota"}' })).toBe("quota");
    expect(classifyHttp({ status: 429, bodyText: "RESOURCE_EXHAUSTED" })).toBe("quota");
  });
  it("枠切れの語が無い 429 は rate(少し待てば使える)", () => {
    expect(classifyHttp({ status: 429, bodyText: "slow down" })).toBe("rate");
  });
  it("401 と、枠切れの語が無い 403 は badkey", () => {
    expect(classifyHttp({ status: 401, bodyText: "" })).toBe("badkey");
    expect(classifyHttp({ status: 403, bodyText: "forbidden" })).toBe("badkey");
  });
  it("それ以外(500・404・引数なし)は down", () => {
    expect(classifyHttp({ status: 500 })).toBe("down");
    expect(classifyHttp({ status: 404, bodyText: "model not found" })).toBe("down");
    expect(classifyHttp()).toBe("down");
  });
});

describe("parseRunLogName", () => {
  it("ローカル時刻を UTC に直す(日本=+9時間)", () => {
    expect(parseRunLogName("20261019-192245-cf.log")).toEqual({ at: "2026-10-19T10:22:45.000Z", brain: "cf" });
  });
  it("tz を変えられる", () => {
    expect(parseRunLogName("20261019-192245-grok.log", 0).at).toBe("2026-10-19T19:22:45.000Z");
  });
  it("ハイフン入りの頭脳名も読める", () => {
    expect(parseRunLogName("20261019-000000-my-brain.log").brain).toBe("my-brain");
  });
  it("形式違い・実在しない日付・文字列でないものは null", () => {
    expect(parseRunLogName("task-20261019-192245-cf.txt")).toBeNull();
    expect(parseRunLogName("20261331-192245-cf.log")).toBeNull();
    expect(parseRunLogName("20260231-192245-cf.log")).toBeNull();
    expect(parseRunLogName(undefined)).toBeNull();
  });
});

describe("logLooksFailed", () => {
  const marks = ["insufficient_quota", "API Error"];
  it("合図を含めば true / 含まなければ false", () => {
    expect(logLooksFailed("xx insufficient_quota yy", marks)).toBe(true);
    expect(logLooksFailed("すべて成功", marks)).toBe(false);
  });
  it("大文字小文字は区別する", () => {
    expect(logLooksFailed("api error", marks)).toBe(false);
  });
  it("空・文字列でない・合図が配列でないなら false", () => {
    expect(logLooksFailed("", marks)).toBe(false);
    expect(logLooksFailed(null, marks)).toBe(false);
    expect(logLooksFailed("API Error", undefined)).toBe(false);
  });
});

describe("summarizeRuns", () => {
  const e = (at, ok) => ({ at, ok });
  it("空なら空のまとめ", () => {
    expect(summarizeRuns([])).toEqual({ last: null, recent: [], okCount: 0, failCount: 0, streak: null });
  });
  it("順不同でも新しい順に並べ、最新を last にする", () => {
    const r = summarizeRuns([e("2026-10-19T01:00:00Z", true), e("2026-10-19T03:00:00Z", false), e("2026-10-19T02:00:00Z", true)]);
    expect(r.last.at).toBe("2026-10-19T03:00:00Z");
    expect(r.recent.map((x) => x.at)).toEqual(["2026-10-19T03:00:00Z", "2026-10-19T02:00:00Z", "2026-10-19T01:00:00Z"]);
  });
  it("max で切り、failCount は recent の中だけ数える", () => {
    const list = [e("2026-10-19T05:00:00Z", true), e("2026-10-19T04:00:00Z", false), e("2026-10-19T03:00:00Z", false), e("2026-10-19T02:00:00Z", true)];
    const r = summarizeRuns(list, 2);
    expect(r.recent).toHaveLength(2);
    expect(r.failCount).toBe(1);
    expect(r.okCount).toBe(2);
  });
  it("連続の数え方: 最新と同じ結果が何件続くか", () => {
    const r = summarizeRuns([e("2026-10-19T05:00:00Z", false), e("2026-10-19T04:00:00Z", false), e("2026-10-19T03:00:00Z", true), e("2026-10-19T02:00:00Z", false)]);
    expect(r.streak).toEqual({ ok: false, count: 2 });
  });
});

describe("statusOfBrain", () => {
  it("鍵が無ければ nokey(探り結果より優先)", () => {
    expect(statusOfBrain({ hasKey: false, probe: "ok" }).status).toBe("nokey");
  });
  it("探り結果の各分類", () => {
    expect(statusOfBrain({ hasKey: true, probe: "ok" })).toEqual({ status: "ok", label: "使える" });
    expect(statusOfBrain({ hasKey: true, probe: "quota" }).status).toBe("quota");
    expect(statusOfBrain({ hasKey: true, probe: "rate" }).status).toBe("rate");
    expect(statusOfBrain({ hasKey: true, probe: "badkey" }).status).toBe("badkey");
    expect(statusOfBrain({ hasKey: true, probe: "down" }).status).toBe("down");
  });
  it("探り結果が無ければ直近の実行の成否で決める", () => {
    expect(statusOfBrain({ hasKey: true, recent: { last: { ok: true } } }).status).toBe("ok");
    expect(statusOfBrain({ hasKey: true, recent: { last: { ok: false } } }).status).toBe("degraded");
  });
  it("何も無ければ unknown", () => {
    expect(statusOfBrain({ hasKey: true }).status).toBe("unknown");
    expect(statusOfBrain({ hasKey: true, recent: { last: null } }).status).toBe("unknown");
  });
});
