"""
job-runner.py - execute job files written by an always-on bot that cannot run commands itself (Grok Bot).

Why: Grok Bot (desktop app) can read/write files on this PC but its local shell fails with "Can't find Bash"
(2026-09-16, unresolved). Grok Build CLI does work here. So the bot writes a job file, and this runner
(Task Scheduler, every 10 minutes) executes it through dispatch.py and writes the result next to it.

Job file: <root>/_jobs/inbox/<name>.md   (UTF-8 Markdown; the whole file is the task text)
  Optional first lines (key: value) before a blank line:
    cwd: C:\path\to\work\folder        (default: <root>)
    brain: grok|qwen|oc|cf|local|auto  (default: grok)
    timeout: 3600                      (seconds, default 3600)
    expect: commit|no-commit           (default: commit when the task text says "commit" / "コミット", else no-commit)
    isolate: yes|no                    (default: yes when cwd is a git repo)
    base: origin/main                  (what the isolated worktree starts from; default origin/main)
Result: <root>/_jobs/done/<name>.md   + <name>.result.md   when the job really did its work
        <root>/_jobs/failed/<name>.md + <name>.result.md   otherwise (the "- status:" line says why)
Running marker: <root>/_jobs/running/<name>.md while it executes (so a second runner instance skips it).
Pause marker:   <root>/_jobs/paused.md is written when every brain failed (quota/billing). While it exists the
                runner does nothing, so one outage does not drain the whole inbox into failed/. Delete it to resume.

"Did its work" (2026-10-18): the old runner moved every job to done/ whatever happened. 15 jobs (10-24, 2026-10-17)
landed in done/ with no commit at all (opencode auto-rejected paths outside cwd and still exited 0; Grok/Qwen were
out of credit). A job is done only when dispatch exits 0 AND, for a job that expects a commit, a NEW branch appeared.
A branch that already existed and moved means the brain touched someone else's work -> failed.

Isolation (2026-10-18): job 10 ran in the repo's main checkout, which was sitting on another task's branch. The brain
(mistral) committed there, pushed it into that task's open PR, commented and created a label. Now, when cwd is a git
repo, the runner makes a fresh worktree <repo>-wt-job-<name> from origin/main and runs the brain THERE (the brain
never sees the main checkout). dispatch.py blocks git push / gh / deploys for the brain by default.
The worktree is removed afterwards if the brain left nothing in it; otherwise it stays and the result names it.

Usage: python job-runner.py --root "C:\...\ouenmovie"
"""
import argparse, os, re, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
DISPATCH = os.path.join(HERE, "dispatch.py")
ALL_FAILED = "ALL BRAINS FAILED"


def parse_job(text):
    meta, body = {}, text
    head, _, rest = text.partition("\n\n")
    if all(":" in ln for ln in head.strip().splitlines()) and head.strip():
        for ln in head.strip().splitlines():
            k, _, v = ln.partition(":")
            meta[k.strip().lower()] = v.strip()
        body = rest
    return meta, body.strip()


def expects_commit(meta, task):
    exp = (meta.get("expect") or "").lower()
    if exp in ("commit", "no-commit"):
        return exp == "commit"
    # ジョブ10は「コミットは feat/... にだけする」と日本語だけで書いていて、英語の commit しか見ない判定をすり抜けた。
    return re.search(r"commit|コミット", task, re.I) is not None


def git(cwd, *args, timeout=120):
    try:
        r = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return 1, str(e)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def branch_heads(cwd):
    """{refname: sha} of local branches of the repo at cwd, or None when cwd is not a git repo."""
    rc, out = git(cwd, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", timeout=60)
    if rc != 0:
        return None
    return dict(ln.split(" ", 1) for ln in out.splitlines() if " " in ln)


def branch_changes(before, after):
    """(new_branches, moved_existing_branches) as short names."""
    if before is None or after is None:
        return [], []
    short = lambda r: r.replace("refs/heads/", "")
    new = sorted(short(r) for r in after if r not in before)
    moved = sorted(short(r) for r, sha in after.items() if r in before and before[r] != sha)
    return new, moved


def classify(rc, out, needs_commit, before, after):
    """Returns (ok, reason). Pure so it can be tested without running a brain."""
    if ALL_FAILED in out:
        return False, "all brains failed (quota / billing / auth) - see dispatch output"
    new, moved = branch_changes(before, after)
    if moved:
        return False, "touched branches that existed before the job: " + ", ".join(moved)
    if rc != 0:
        return False, "dispatch exit %s" % rc
    if needs_commit:
        if before is None or after is None:
            return False, "job expects a commit but cwd is not a git repo (set 'expect: no-commit' if that is intended)"
        if not new:
            return False, "job expects a commit but no new branch was created"
        return True, "commit on " + ", ".join(new)
    return True, "dispatch exit 0 (no commit expected)"


def make_worktree(cwd, name, base):
    """Fresh detached worktree <repo>-wt-job-<stem> from base. Returns (path, error)."""
    rc, top = git(cwd, "rev-parse", "--show-toplevel")
    if rc != 0:
        return None, "not a git repo"
    top = os.path.normpath(top.strip().splitlines()[-1])
    stem = re.sub(r"[^A-Za-z0-9._-]", "-", name[:-3])
    path = "%s-wt-job-%s" % (top, stem)
    if os.path.exists(path):
        return None, "worktree folder already exists: %s (remove it or rename the job)" % path
    git(cwd, "fetch", "-q", "origin", timeout=300)
    rc, out = git(cwd, "worktree", "add", "--detach", path, base, timeout=300)
    if rc != 0:
        return None, "git worktree add failed: %s" % out.strip()[-300:]
    copy_context_docs(top, path)
    return path, None


CONTEXT_DIR = ".job-context"


def copy_context_docs(main_checkout, worktree):
    """本体チェックアウトの _docs/ を、作業場所の .job-context/_docs/ に読むだけの写しとして置く。
    なぜ: 2026-10-18、ジョブ10〜24が「必読」とする設計書が origin/main に無く（別作業の PR と本体の未コミット変更にだけ
    あった）、origin/main から作った作業場所では読めなかった。写しは git の除外設定に入れ、コミットに混ざらないようにする。"""
    src = os.path.join(main_checkout, "_docs")
    if not os.path.isdir(src):
        return
    shutil.copytree(src, os.path.join(worktree, CONTEXT_DIR, "_docs"), dirs_exist_ok=True)
    rc, common = git(worktree, "rev-parse", "--git-common-dir")
    if rc != 0:
        return
    common = common.strip().splitlines()[-1]
    if not os.path.isabs(common):
        common = os.path.join(worktree, common)
    exclude = os.path.join(common, "info", "exclude")
    os.makedirs(os.path.dirname(exclude), exist_ok=True)
    lines = open(exclude, encoding="utf-8").read().splitlines() if os.path.exists(exclude) else []
    if "/%s/" % CONTEXT_DIR not in lines:
        open(exclude, "a", encoding="utf-8").write("\n/%s/\n" % CONTEXT_DIR)


def drop_worktree_if_empty(cwd, path, base_sha):
    """Remove the job worktree when the brain left no commit and no file change in it."""
    rc, status = git(path, "status", "--porcelain")
    rc2, head = git(path, "rev-parse", "HEAD")
    if rc == 0 and rc2 == 0 and not status.strip() and head.strip() == base_sha:
        shutil.rmtree(os.path.join(path, CONTEXT_DIR), ignore_errors=True)
        git(cwd, "worktree", "remove", path)
        return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    a = ap.parse_args()
    jobs = os.path.join(a.root, "_jobs")
    inbox, running, done, failed = (os.path.join(jobs, d) for d in ("inbox", "running", "done", "failed"))
    for d in (inbox, running, done, failed):
        os.makedirs(d, exist_ok=True)
    paused = os.path.join(jobs, "paused.md")
    if os.path.exists(paused):
        print("paused (%s exists); skip" % paused)
        return 0
    if os.listdir(running):
        print("another job is running; skip")
        return 0
    files = sorted(f for f in os.listdir(inbox) if f.endswith(".md"))
    if not files:
        print("no jobs")
        return 0
    name = files[0]
    src = os.path.join(inbox, name); run = os.path.join(running, name)
    shutil.move(src, run)
    meta, task = parse_job(open(run, encoding="utf-8").read())
    cwd = meta.get("cwd") or a.root
    brain = meta.get("brain") or "grok"
    timeout = int(meta.get("timeout") or 3600)
    needs_commit = expects_commit(meta, task)
    before = branch_heads(cwd)
    t0 = time.time()
    workdir, wt_note, base_sha = cwd, "", ""
    if before is not None and (meta.get("isolate") or "yes").lower() != "no":
        base = meta.get("base") or "origin/main"
        workdir, err = make_worktree(cwd, name, base)
        if err:
            rc, out, workdir = -2, "runner could not prepare an isolated worktree: %s" % err, None
        else:
            base_sha = git(workdir, "rev-parse", "HEAD")[1].strip()
            # 注意書きは本文の後ろに置く（先頭に置くと cf が「これが依頼の全部」と受け取り、作業せずに聞き返した。2026-10-18 実測）
            task = ("%s\n\n## 作業場所について（job-runner が付けた注意）\n"
                    "- いまのフォルダ（%s）は %s から作った、このジョブ専用の git worktree。上の作業はすべてここで行う。\n"
                    "- 「main から作る」「worktree を作る」と書いてあっても、ここで `git checkout -b <ブランチ名>` するだけでよい。\n"
                    "- ほかのフォルダ・既存のブランチには触れない。push・PR・デプロイはこの環境では通らないので試さない。\n"
                    "- 上で `_docs/...` を読めと書いてあってここに無いときは `.job-context/_docs/...` を読む（本体の最新の写し。読むだけで、書き換えない・コミットしない）。\n"
                    % (task, workdir, base))
    if workdir:
        cmd = [sys.executable, DISPATCH, "--brain", brain, "--timeout", str(timeout), "--cwd", workdir, task]
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, timeout=timeout + 120)
            rc, out = p.returncode, (p.stdout or "") + (p.stderr or "")
        except subprocess.TimeoutExpired as e:
            rc, out = -1, "runner timeout after %ss\n%s" % (timeout + 120, e.stdout if isinstance(e.stdout, str) else "")
    sec = time.time() - t0
    ok, reason = classify(rc, out, needs_commit, before, branch_heads(cwd))
    if workdir and workdir != cwd:
        wt_note = "removed (nothing left in it)" if drop_worktree_if_empty(cwd, workdir, base_sha) else "kept: %s" % workdir
    log_path = ""
    for ln in out.splitlines():
        if "log=" in ln:
            log_path = ln.split("log=", 1)[1].strip().rstrip(")")
    tail = ""
    if log_path and os.path.exists(log_path):
        tail = "\n".join(open(log_path, encoding="utf-8", errors="replace").read().splitlines()[-80:])
    status = "done" if ok else "failed"
    result = ["# result: %s" % name, "", "- status: %s (%s)" % (status, reason),
              "- finished: %s" % time.strftime("%Y-%m-%d %H:%M"), "- elapsed: %.0fs" % sec,
              "- brain: %s  cwd: %s" % (brain, cwd), "- worktree: %s" % (wt_note or "not isolated"),
              "- dispatch exit: %s" % rc, "- expects commit: %s" % needs_commit,
              "", "## dispatch output", "```", out.strip(), "```",
              "", "## run log (last 80 lines)", "```", tail, "```"]
    dest = done if ok else failed
    shutil.move(run, os.path.join(dest, name))
    open(os.path.join(dest, name[:-3] + ".result.md"), "w", encoding="utf-8").write("\n".join(result) + "\n")
    if ALL_FAILED in out:
        open(paused, "w", encoding="utf-8").write(
            "# paused %s\n\nEvery brain failed on %s (see failed/%s.result.md).\n"
            "Fix the quota/billing/auth, move the job back to inbox/, then delete this file.\n"
            % (time.strftime("%Y-%m-%d %H:%M"), name, name[:-3]))
    print("%s: %s exit %s %.0fs (%s)" % (status, name, rc, sec, reason))
    return 0


if __name__ == "__main__":
    sys.exit(main())
