"""
dispatch.py - run one task headlessly on a free/cheap brain and save the result.

  python dispatch.py --brain qwen   --cwd <dir> "task text"   # Claude Code + Qwen3.8-Max (Alibaba, via local relay)
  python dispatch.py --brain oc     --cwd <dir> "task text"   # OpenCode   + Qwen3.8-27B (Alibaba direct)
  python dispatch.py --brain cf     --cwd <dir> "task text"   # OpenCode   + Cloudflare Qwen3.8-27B (free daily quota)
  python dispatch.py --brain local  --cwd <dir> "task text"   # Claude Code + local Ollama (free, slow)
  python dispatch.py --brain grok   --cwd <dir> "task text"   # Grok Build headless (needs `grok` login)

Writes full output to %LOCALAPPDATA%\llm-proxy\runs\<timestamp>-<brain>.log and prints a short tail.
Purpose: the real Claude session only plans and reviews; the work itself runs here without touching the Claude quota.
"""
import argparse, os, subprocess, sys, time

# Canonical copy lives in web-ios-android/docs/ai-workflows/tools/ (see MULTI-BRAIN-HOWTO.md). Logs go to the machine-local folder below.
RUNS = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "llm-proxy", "runs"); os.makedirs(RUNS, exist_ok=True)
RELAY = "http://127.0.0.1:18081"
CLAUDE_COMMON = {"ANTHROPIC_API_KEY": "", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"}

def build(brain, task, allowed):
    env = dict(os.environ)
    if brain == "qwen":
        env.update(CLAUDE_COMMON, ANTHROPIC_BASE_URL=RELAY, ANTHROPIC_AUTH_TOKEN=env.get("DASHSCOPE_API_KEY", ""), ANTHROPIC_MODEL="qwen3.8-max")
        cmd = ["claude", "-p", task, "--model", "qwen3.8-max"] + (["--allowedTools", allowed] if allowed else [])
    elif brain == "local":
        env.update(CLAUDE_COMMON, ANTHROPIC_BASE_URL="http://127.0.0.1:11434", ANTHROPIC_AUTH_TOKEN="ollama", ANTHROPIC_MODEL="qwen3.6:35b-a3b")
        cmd = ["claude", "-p", task, "--model", "qwen3.6:35b-a3b"] + (["--allowedTools", allowed] if allowed else [])
    elif brain == "oc":
        cmd = ["opencode", "run", "-m", "alibaba/qwen3.8-27b", task]
    elif brain == "cf":
        cmd = ["opencode", "run", "-m", "cloudflare/@cf/qwen/qwen3.8-27b", task]
    elif brain == "grok":
        cmd = [os.path.expanduser("~/.grok/bin/grok.exe"), "-p", task]
    else:
        sys.exit("unknown brain: " + brain)
    return cmd, env

def ensure_relay():
    """Start the local relay via the scheduled task if it is not listening (it dies with the shell that started it)."""
    import urllib.request
    try:
        urllib.request.urlopen(RELAY + "/healthz", timeout=2).read(); return
    except Exception:
        pass
    subprocess.run(["schtasks", "/Run", "/TN", "QwenProxy"], capture_output=True)
    for _ in range(10):
        time.sleep(1)
        try:
            urllib.request.urlopen(RELAY + "/healthz", timeout=2).read(); return
        except Exception:
            continue
    print("[dispatch] warning: relay not reachable", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brain", required=True, choices=["qwen", "oc", "cf", "local", "grok"])
    ap.add_argument("--cwd", default=os.getcwd())
    ap.add_argument("--allowed", default="Read,Write,Edit,Glob,Grep,Bash", help="Claude Code allowedTools (qwen/local only)")
    ap.add_argument("--timeout", type=int, default=1800)
    ap.add_argument("task")
    a = ap.parse_args()
    if a.brain == "qwen":
        ensure_relay()
    cmd, env = build(a.brain, a.task, a.allowed)
    stamp = time.strftime("%Y%m%d-%H%M%S"); log = os.path.join(RUNS, f"{stamp}-{a.brain}.log")
    t0 = time.time()
    with open(log, "w", encoding="utf-8", errors="replace") as f:
        f.write(f"# brain={a.brain} cwd={a.cwd}\n# task: {a.task}\n\n")
        f.flush()
        try:
            r = subprocess.run(cmd, cwd=a.cwd, env=env, stdin=subprocess.DEVNULL, stdout=f, stderr=subprocess.STDOUT, timeout=a.timeout, shell=(os.name == "nt"))
            rc = r.returncode
        except subprocess.TimeoutExpired:
            rc = -1; f.write("\n# TIMEOUT\n")
    sec = time.time() - t0
    tail = open(log, encoding="utf-8", errors="replace").read().strip().splitlines()[-12:]
    print(f"[dispatch] brain={a.brain} rc={rc} {sec:.0f}s log={log}")
    print("\n".join(tail))

if __name__ == "__main__":
    main()
