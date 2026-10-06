import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectRisky, failingChecks, parsePrMerge, stripQuotedAndHeredocs } from "./guard-external-actions.mjs";

const HOOK = resolve(fileURLToPath(new URL("./guard-external-actions.mjs", import.meta.url)));

describe("detectRisky（外向き・取り消せない操作だけを拾う）", () => {
  it("push / マージ / workflow 実行 / secret / デプロイを拾う", () => {
    expect(detectRisky("git push origin feat/x")).toContain("git push");
    expect(detectRisky("cd a && git -C /tmp/r push -u origin b")).toContain("git push");
    expect(detectRisky("gh pr merge 32 -R kimito-link/x --squash")).toContain("gh pr merge");
    expect(detectRisky("gh workflow run ios-appstore-release.yml --ref main")).toContain("gh workflow run/enable");
    expect(detectRisky("gh workflow enable foo.yml")).toContain("gh workflow run/enable");
    expect(detectRisky("gh secret set X < v")).toContain("gh secret set");
    expect(detectRisky("gh api -X POST repos/o/r/issues")).toContain("gh api (変更系)");
    expect(detectRisky("npx vercel --prod")).toContain("vercel deploy");
    expect(detectRisky("npx wrangler secret put FOO")).toContain("wrangler deploy");
    expect(detectRisky("npm publish")).toContain("npm publish");
  });
  it("読み取りや、無関係な git/gh は拾わない", () => {
    for (const c of [
      "git status",
      "git push --dry-run origin x",
      "gh pr view 32",
      "gh pr checks 32",
      "gh workflow list",
      "gh api repos/o/r/pulls",
      "gh pr create --title x",
      "ls -la",
    ]) {
      expect(detectRisky(c), c).toEqual([]);
    }
  });
  it("引用符の中・heredoc の本文に書いてあるだけでは拾わない（誤検知を減らす）", () => {
    expect(detectRisky('git commit -m "docs: gh pr merge の手順と git push の注意"')).toEqual([]);
    expect(detectRisky("gh pr create --body \"$(cat <<'EOF'\nあとで gh pr merge する\nEOF\n)\"")).toEqual([]);
    expect(detectRisky("echo 'git push'")).toEqual([]);
  });
  it("引用符の外の本物は、引用符つきの文と並んでいても拾う", () => {
    expect(detectRisky('echo "x" && git push origin y')).toContain("git push");
  });
});

describe("parsePrMerge / failingChecks", () => {
  it("PR 番号とリポを取り出す", () => {
    expect(parsePrMerge("gh pr merge 74 -R kimito-link/surechigai-romi.link --squash")).toEqual({
      number: "74",
      repo: "kimito-link/surechigai-romi.link",
    });
    expect(parsePrMerge("gh pr merge --squash")).toEqual({ number: null, repo: null });
  });
  it("失敗しているチェックだけ返す", () => {
    expect(
      failingChecks([
        { name: "diff-check", bucket: "fail" },
        { name: "lint", bucket: "pass" },
        { name: "x", state: "FAILURE" },
      ])
    ).toEqual(["diff-check", "x"]);
    expect(failingChecks(null)).toEqual([]);
  });
  it("stripQuotedAndHeredocs は引用符の中身を落とす", () => {
    expect(stripQuotedAndHeredocs(`a "b c" 'd'`)).toBe(`a "" ''`);
  });
});

// ---- 実プロセスで動かす（標準入力 → 出力）。一時リポと一時 transcript を作る ----
function makeRepo({ claudeMd = true, coord = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "guard-"));
  mkdirSync(join(dir, ".git"));
  if (claudeMd) writeFileSync(join(dir, "CLAUDE.md"), "# ルール\nline2\nline3\n");
  if (coord) {
    mkdirSync(join(dir, ".agent"));
    writeFileSync(join(dir, ".agent", "coord.md"), "write_lock: FREE\n");
  }
  return dir;
}
function transcript(dir, entries) {
  const p = join(dir, "t.jsonl");
  writeFileSync(p, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return p;
}
const readClaude = (dir, text = "# ルール\nline2\nline3\n") => [
  { message: { content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: join(dir, "CLAUDE.md") } }] } },
  {
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "r1",
          content: text
            .replace(/\n$/, "")
            .split("\n")
            .map((l, i) => `${i + 1}\t${l}`)
            .join("\n"),
        },
      ],
    },
  },
];
const touchCoord = (dir) => [
  { message: { content: [{ type: "tool_use", id: "c1", name: "Read", input: { file_path: join(dir, ".agent", "coord.md") } }] } },
];
function run(dir, command, tpath, env = {}) {
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify({ cwd: dir, transcript_path: tpath, tool_name: "Bash", tool_input: { command } }),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { out: r.stdout.trim(), rc: r.status };
}
const denied = (r) => r.out.includes('"permissionDecision":"deny"');

describe("実プロセス（毒テスト＝止まること／緑＝通ること）", () => {
  it("【毒】CLAUDE.md を読んでいないセッションでは git push を止める", () => {
    const dir = makeRepo({ coord: false });
    const r = run(dir, "git push origin x", transcript(dir, []));
    expect(denied(r)).toBe(true);
    expect(r.out).toContain("CLAUDE.md");
  });
  it("【毒】CLAUDE.md を読んだ後に更新されていたら止める（古い指示書のまま外へ出さない）", () => {
    const dir = makeRepo({ coord: false });
    const t = transcript(dir, readClaude(dir, "# 古い版\nold\n"));
    expect(denied(run(dir, "gh pr merge 1 -R o/r", t, { GUARD_TEST_CHECKS_JSON: "[]" }))).toBe(true);
  });
  it("【毒】coord.md に触れていなければ止める", () => {
    const dir = makeRepo();
    const r = run(dir, "git push origin x", transcript(dir, readClaude(dir)));
    expect(denied(r)).toBe(true);
    expect(r.out).toContain("coord.md");
  });
  it("CLAUDE.md を現在の内容のまま全文 Read し、coord.md にも触れていれば通る", () => {
    const dir = makeRepo();
    const t = transcript(dir, [...readClaude(dir), ...touchCoord(dir)]);
    expect(run(dir, "git push origin x", t)).toEqual({ out: "", rc: 0 });
  });
  it("【毒】gh pr merge はチェックに失敗があれば止め、バイパス承認の記述があれば通す", () => {
    const dir = makeRepo();
    const t = transcript(dir, [...readClaude(dir), ...touchCoord(dir)]);
    const failing = { GUARD_TEST_CHECKS_JSON: JSON.stringify([{ name: "diff-check", bucket: "fail" }, { name: "lint", bucket: "pass" }]) };
    const blocked = run(dir, "gh pr merge 74 -R o/r --squash", t, failing);
    expect(denied(blocked)).toBe(true);
    expect(blocked.out).toContain("diff-check");
    const bypass = run(dir, 'GATE_BYPASS_APPROVED_BY_USER="本人が承認" gh pr merge 74 -R o/r --squash', t, failing);
    expect(bypass.out).toBe("");
  });
  it("チェックが全部緑なら gh pr merge は通る", () => {
    const dir = makeRepo();
    const t = transcript(dir, [...readClaude(dir), ...touchCoord(dir)]);
    const green = { GUARD_TEST_CHECKS_JSON: JSON.stringify([{ name: "lint", bucket: "pass" }]) };
    expect(run(dir, "gh pr merge 74 -R o/r --squash", t, green).out).toBe("");
  });
  it("外向きでないコマンドは、CLAUDE.md を読んでいなくても止めない", () => {
    const dir = makeRepo();
    expect(run(dir, "git status && ls", transcript(dir, [])).out).toBe("");
  });
  it("リポが無い・入力が壊れているときは止めない（hook 自体の不具合でセッションを止めない）", () => {
    const r1 = spawnSync("node", [HOOK], { input: "not json", encoding: "utf8" });
    expect(r1.stdout).toBe("");
    const dir = mkdtempSync(join(tmpdir(), "norepo-"));
    expect(run(dir, "git push origin x", join(dir, "none.jsonl")).out).toBe("");
  });
});
