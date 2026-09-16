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
Result: <root>/_jobs/done/<name>.md (the job) + <name>.result.md (dispatch summary + last 80 lines of the run log)
Running marker: <root>/_jobs/running/<name>.md while it executes (so a second runner instance skips it).

Usage: python job-runner.py --root "C:\...\ouenmovie"
"""
import argparse, os, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
DISPATCH = os.path.join(HERE, "dispatch.py")


def parse_job(text):
    meta, body = {}, text
    head, _, rest = text.partition("\n\n")
    if all(":" in ln for ln in head.strip().splitlines()) and head.strip():
        for ln in head.strip().splitlines():
            k, _, v = ln.partition(":")
            meta[k.strip().lower()] = v.strip()
        body = rest
    return meta, body.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    a = ap.parse_args()
    jobs = os.path.join(a.root, "_jobs")
    inbox, running, done = (os.path.join(jobs, d) for d in ("inbox", "running", "done"))
    for d in (inbox, running, done):
        os.makedirs(d, exist_ok=True)
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
    t0 = time.time()
    cmd = [sys.executable, DISPATCH, "--brain", brain, "--timeout", str(timeout), "--cwd", cwd, task]
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, timeout=timeout + 120)
    out = (p.stdout or "") + (p.stderr or "")
    sec = time.time() - t0
    log_path = ""
    for ln in out.splitlines():
        if "log=" in ln:
            log_path = ln.split("log=", 1)[1].strip()
    tail = ""
    if log_path and os.path.exists(log_path):
        tail = "\n".join(open(log_path, encoding="utf-8", errors="replace").read().splitlines()[-80:])
    result = ["# result: %s" % name, "", "- finished: %s" % time.strftime("%Y-%m-%d %H:%M"), "- elapsed: %.0fs" % sec,
              "- brain: %s  cwd: %s" % (brain, cwd), "- dispatch exit: %s" % p.returncode, "", "## dispatch output", "```", out.strip(), "```",
              "", "## run log (last 80 lines)", "```", tail, "```"]
    shutil.move(run, os.path.join(done, name))
    open(os.path.join(done, name[:-3] + ".result.md"), "w", encoding="utf-8").write("\n".join(result) + "\n")
    print("done:", name, "exit", p.returncode, "%.0fs" % sec)
    return 0


if __name__ == "__main__":
    sys.exit(main())
