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
    expect: commit|no-commit           (default: commit when the task text mentions "commit", else no-commit)
Result: <root>/_jobs/done/<name>.md   + <name>.result.md   when the job really did its work
        <root>/_jobs/failed/<name>.md + <name>.result.md   otherwise (first line of the result says why)
Running marker: <root>/_jobs/running/<name>.md while it executes (so a second runner instance skips it).
Pause marker:   <root>/_jobs/paused.md is written when every brain failed (quota/billing). While it exists the
                runner does nothing, so one outage does not drain the whole inbox into failed/. Delete it to resume.

"Did its work" (2026-10-18): the old runner moved every job to done/ whatever happened. 15 jobs (10-24, 2026-10-17)
landed in done/ with no commit at all: opencode auto-rejected file access outside cwd and still exited 0, and Grok/Qwen
were out of credit. Now a job is done only when dispatch exits 0 AND, for a job that expects a commit, some branch
of the git repo at cwd moved during the run (refs/heads are shared by all worktrees, so a commit in a new worktree counts).

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
    return re.search(r"commit", task, re.I) is not None


def branch_heads(cwd):
    """{refname: sha} of local branches of the repo at cwd, or None when cwd is not a git repo."""
    try:
        r = subprocess.run(["git", "-C", cwd, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        return None
    return dict(ln.split(" ", 1) for ln in r.stdout.splitlines() if " " in ln)


def moved_branches(before, after):
    if before is None or after is None:
        return []
    return sorted(ref for ref, sha in after.items() if before.get(ref) != sha)


def classify(rc, out, needs_commit, before, after):
    """Returns (ok, reason). Pure so it can be tested without running a brain."""
    if ALL_FAILED in out:
        return False, "all brains failed (quota / billing / auth) - see dispatch output"
    if rc != 0:
        return False, "dispatch exit %s" % rc
    if needs_commit:
        if before is None or after is None:
            return False, "job expects a commit but cwd is not a git repo (set 'expect: no-commit' if that is intended)"
        moved = moved_branches(before, after)
        if not moved:
            return False, "job expects a commit but no branch moved during the run"
        return True, "commit on " + ", ".join(m.replace("refs/heads/", "") for m in moved)
    return True, "dispatch exit 0 (no commit expected)"


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
    cmd = [sys.executable, DISPATCH, "--brain", brain, "--timeout", str(timeout), "--cwd", cwd, task]
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, timeout=timeout + 120)
        rc, out = p.returncode, (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired as e:
        rc, out = -1, "runner timeout after %ss\n%s" % (timeout + 120, e.stdout if isinstance(e.stdout, str) else "")
    sec = time.time() - t0
    ok, reason = classify(rc, out, needs_commit, before, branch_heads(cwd))
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
              "- brain: %s  cwd: %s" % (brain, cwd), "- dispatch exit: %s" % rc, "- expects commit: %s" % needs_commit,
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
