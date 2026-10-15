import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectRisky, failingChecks, parseLeadingCd, parsePrMerge, parsePushTarget, PROTECTED_BRANCHES, stripQuotedAndHeredocs } from "./guard-external-actions.mjs";

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
      cd: null,
    });
    expect(parsePrMerge("gh pr merge --squash")).toEqual({ number: null, repo: null, cd: null });
  });

  // ★2026-10-14 の実害: surechigai #79 をマージしようとしたら、
  //   kimitolink-linktree #79(closed) の赤3件を報告された。
  //   gh はリポ指定が無いと**カレントディレクトリ**で番号を解決するため。
  //   ★逆向き（別リポの緑を見て赤い PR を通す）の方が危険。
  it("★cd 先のリポを取り出す（別リポの同番号 PR を見ないため）", () => {
    const cmd = 'cd "C:/Users/info/x/surechigai-romi.link" && gh pr merge 79 --squash';
    expect(parsePrMerge(cmd).cd).toBe("C:/Users/info/x/surechigai-romi.link");
    expect(parsePrMerge(cmd).number).toBe("79");
    // -R があればそちらが優先される（cd より明示が強い）
    expect(parsePrMerge('cd /a && gh pr merge 5 -R o/r').repo).toBe("o/r");
  });

  it("parseLeadingCd は引用符の有無を問わず取れる", () => {
    expect(parseLeadingCd('cd /tmp/foo && gh pr merge 1')).toBe("/tmp/foo");
    expect(parseLeadingCd('cd "a b/c" && gh pr merge 1')).toBe("a b/c");
    expect(parseLeadingCd("cd 'a b/c' && gh pr merge 1")).toBe("a b/c");
    expect(parseLeadingCd('gh pr merge 1')).toBe(null);
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
  it("【毒】サブエージェント(agent_id あり)の外向き操作は、親が全部満たしていても止め、理由を正しく言う", () => {
    const dir = makeRepo();
    const t = transcript(dir, [...readClaude(dir), ...touchCoord(dir)]);
    const input = { cwd: dir, transcript_path: t, tool_name: "Bash", agent_id: "subagent_x", agent_type: "general-purpose", tool_input: { command: "git push origin x" } };
    const r = spawnSync("node", [HOOK], { input: JSON.stringify(input), encoding: "utf8" });
    expect(r.stdout).toContain('"permissionDecision":"deny"');
    expect(r.stdout).toContain("サブエージェント");
    expect(r.stdout).toContain("親セッション");
    // 「Read してください」と案内して無限に誤誘導しない
    expect(r.stdout).not.toContain("を Read してください");
  });
  it("サブエージェントでも、外向きでないコマンドは止めない", () => {
    const dir = makeRepo();
    const input = { cwd: dir, transcript_path: transcript(dir, []), tool_name: "Bash", agent_id: "subagent_x", tool_input: { command: "git status" } };
    const r = spawnSync("node", [HOOK], { input: JSON.stringify(input), encoding: "utf8" });
    expect(r.stdout).toBe("");
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

describe("parsePushTarget（★main 直 push を止める）", () => {
  // ★2026-10-16 の実損: `git push -u origin HEAD` を main 上で実行し、
  //   PR を経ずに main が更新された。既存ガードは push を検知していたが
  //   「どのブランチへ押すか」を見ていなかった。
  it("今回踏んだコマンドを main と判定する", () => {
    expect(parsePushTarget("git push -u origin HEAD", "main").branch).toBe("main");
    expect(parsePushTarget("git push -u origin HEAD", "main").explicit).toBe(false);
  });

  it("feature ブランチ上なら素通りする", () => {
    const t = parsePushTarget("git push -u origin HEAD", "feat/x");
    expect(t.branch).toBe("feat/x");
    expect(PROTECTED_BRANCHES.includes(t.branch)).toBe(false);
  });

  it("明示した場合も拾う", () => {
    expect(parsePushTarget("git push origin main", "feat/x").branch).toBe("main");
    expect(parsePushTarget("git push origin HEAD:main", "feat/x").branch).toBe("main");
    expect(parsePushTarget("git push origin refs/heads/master", "feat/x").branch).toBe("master");
  });

  it("★master も保護する（リポごとに既定ブランチ名が違う）", () => {
    expect(PROTECTED_BRANCHES).toContain("main");
    expect(PROTECTED_BRANCHES).toContain("master");
  });

  it("push でなければ何も言わない", () => {
    expect(parsePushTarget("git status", "main").branch).toBe(null);
  });
});

describe("★cd 先のブランチを見る（セッションの cwd ではなく）", () => {
  // ★2026-10-16、この実装自身が踏んだ:
  //   フックは input.cwd（セッションの作業ディレクトリ）を見るので、
  //   `cd <別リポ> && git push` のとき別リポのブランチ名で判定してしまい、
  //   feature ブランチへの push を「main 直 push」と誤判定した。
  //   gh pr checks の -R 問題（#46）と同じ型。
  it("cd があればそちらのリポを見る", () => {
    const cmd = 'cd "C:/x/other-repo" && git push -u origin HEAD';
    expect(parseLeadingCd(cmd)).toBe("C:/x/other-repo");
  });

  it("cd が無ければ null（呼び出し側が repoRoot に倒す）", () => {
    expect(parseLeadingCd("git push -u origin HEAD")).toBe(null);
  });
});
