"""
dispatch.py - run one task headlessly on a free/cheap brain, with automatic fallback.

  python dispatch.py "task text"                         # --brain auto: grok -> qwen -> oc -> cf -> local
  python dispatch.py --brain grok  --cwd <dir> "task"    # Grok Build headless (--always-approve so file edits do not block)
  python dispatch.py --brain qwen  --cwd <dir> "task"    # Claude Code + Alibaba (model chain, skips exhausted quotas; via local relay)
  python dispatch.py --brain oc    --cwd <dir> "task"    # OpenCode + Alibaba qwen3.8-27b (direct)
  python dispatch.py --brain cf    --cwd <dir> "task"    # OpenCode + Cloudflare qwen3.8-27b (free daily quota)
  python dispatch.py --brain local --cwd <dir> "task"    # Claude Code + local Ollama (free, slow)

Why fallback exists: free quotas die without warning (Alibaba flash and max each ran out within about 1.5 days on
2026-09-15/16), and a headless brain that blocks on a permission prompt looks like a hang. A failed brain must never
stop the work; the next brain takes over and the log says which one actually did it.

Failure signatures treated as "try the next brain": non-zero exit, timeout, or output containing any of FAIL_MARKS.
Full output: %LOCALAPPDATA%\\llm-proxy\\runs\\<timestamp>-<brain>.log. Canonical copy: web-ios-android/docs/ai-workflows/tools/.
Secrets: none here. Keys come from user env vars DASHSCOPE_API_KEY / CF_WORKERS_AI_TOKEN.
"""
import argparse, json, os, subprocess, sys, time, urllib.request

RUNS = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "llm-proxy", "runs")
os.makedirs(RUNS, exist_ok=True)
RELAY = "http://127.0.0.1:18081"
ALIBABA_OPENAI = "https://ws-udyvfona8qqwei1q.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
CLAUDE_COMMON = {"ANTHROPIC_API_KEY": "", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"}
# Alibaba models with independent free quotas, best first. Exhausted ones are skipped by a cheap probe.
QWEN_CHAIN = ["kimi-k3", "glm-5.2", "deepseek-v4.1-flash", "qwen3.8-27b", "qwen3.8-max", "qwen3.8-flash"]
# gemini = Gemini CLI (Google login, 1000 requests/day free as of 2026-09; survey: research/free-llm-survey-2026-09-16.md)
AUTO_CHAIN = ["grok", "gemini", "qwen", "oc", "cf", "local"]
FAIL_MARKS = ["insufficient_quota", "Free quota exhausted", "data_inspection_failed", "API Error", "Unable to connect",
              "Failed to authenticate", "Unexpected server error", "Open this URL to sign in", "ECONNREFUSED", "rate limit",
              "Opening authentication page", "RESOURCE_EXHAUSTED", "quota exceeded"]
TIMEOUTS = {"grok": 900, "gemini": 900, "qwen": 900, "oc": 900, "cf": 600, "local": 1800}


def say(msg):
    print(msg, flush=True)


def ensure_relay():
    try:
        urllib.request.urlopen(RELAY + "/healthz", timeout=2).read()
        return True
    except Exception:
        pass
    subprocess.run(["schtasks", "/Run", "/TN", "QwenProxy"], capture_output=True)
    for _ in range(10):
        time.sleep(1)
        try:
            urllib.request.urlopen(RELAY + "/healthz", timeout=2).read()
            return True
        except Exception:
            continue
    return False


def alibaba_model_ok(model):
    """Tiny probe on the OpenAI-compatible endpoint: an exhausted quota answers 403 insufficient_quota immediately."""
    key = os.environ.get("DASHSCOPE_API_KEY", "")
    if not key:
        return False
    body = {"model": model, "messages": [{"role": "user", "content": "OK"}], "max_tokens": 1, "enable_thinking": False}
    req = urllib.request.Request(ALIBABA_OPENAI + "/chat/completions", data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json", "authorization": "Bearer " + key})
    try:
        urllib.request.urlopen(req, timeout=30).read()
        return True
    except Exception:
        return False


def pick_alibaba_model(preferred=None):
    chain = ([preferred] if preferred else []) + [m for m in QWEN_CHAIN if m != preferred]
    for m in chain:
        if alibaba_model_ok(m):
            return m
    return None


def build(brain, task, allowed, model=None):
    env = dict(os.environ)
    if brain == "qwen":
        env.update(CLAUDE_COMMON, ANTHROPIC_BASE_URL=RELAY, ANTHROPIC_AUTH_TOKEN=env.get("DASHSCOPE_API_KEY", ""), ANTHROPIC_MODEL=model)
        cmd = ["claude", "-p", task, "--model", model] + (["--allowedTools", allowed] if allowed else [])
    elif brain == "local":
        model = model or "qwen3.6:35b-a3b"
        env.update(CLAUDE_COMMON, ANTHROPIC_BASE_URL="http://127.0.0.1:11434", ANTHROPIC_AUTH_TOKEN="ollama", ANTHROPIC_MODEL=model)
        cmd = ["claude", "-p", task, "--model", model] + (["--allowedTools", allowed] if allowed else [])
    elif brain == "oc":
        model = model or "alibaba/qwen3.8-27b"
        cmd = ["opencode", "run", "-m", model, task]
    elif brain == "cf":
        model = model or "cloudflare/@cf/qwen/qwen3.8-27b"
        cmd = ["opencode", "run", "-m", model, task]
    elif brain == "grok":
        model = model or "grok-build"
        cmd = [os.path.expanduser("~/.grok/bin/grok.exe"), "-p", task, "--always-approve"]
    elif brain == "gemini":
        # Gemini CLI: Google-login free tier. Needs one interactive `gemini` login first (browser OAuth).
        model = model or "default"
        # Headless runs refuse untrusted folders; the task cwd is always one of our own project folders.
        env["GEMINI_CLI_TRUST_WORKSPACE"] = "true"
        cmd = ["gemini", "-p", task, "--yolo"] + (["-m", model] if model != "default" else [])
    else:
        sys.exit("unknown brain: " + brain)
    return cmd, env, model


def run_one(brain, task, cwd, allowed, timeout, model=None):
    """Returns (ok, info, output, model). ok is None when the brain was skipped before running."""
    if brain == "qwen":
        if not ensure_relay():
            return None, "relay down", "", None
        model = pick_alibaba_model(model)
        if not model:
            return None, "all Alibaba quotas exhausted", "", None
    if brain == "gemini":
        gem = os.path.expanduser("~/.gemini")
        # Two valid auth states: Google login (oauth_creds.json, 1000 req/day) or settings.json selecting
        # "gemini-api-key" with GEMINI_API_KEY set (free API tier, Flash 250/day). Anything else would open a
        # browser login and hang headless, so skip immediately.
        selected = ""
        try:
            selected = json.load(open(os.path.join(gem, "settings.json"), encoding="utf-8")).get("security", {}).get("auth", {}).get("selectedType", "")
        except Exception:
            pass
        has_oauth = os.path.exists(os.path.join(gem, "oauth_creds.json"))
        has_key = selected == "gemini-api-key" and bool(os.environ.get("GEMINI_API_KEY"))
        if not (has_oauth or has_key):
            return None, "gemini not logged in (run `gemini` once and sign in with Google)", "", None
    cmd, env, model = build(brain, task, allowed, model)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    log = os.path.join(RUNS, f"{stamp}-{brain}.log")
    t0 = time.time()
    with open(log, "w", encoding="utf-8", errors="replace") as f:
        f.write(f"# brain={brain} model={model} cwd={cwd}\n# task: {task}\n\n")
        f.flush()
        try:
            r = subprocess.run(cmd, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=f, stderr=subprocess.STDOUT,
                               timeout=timeout, shell=(os.name == "nt"))
            rc = r.returncode
        except subprocess.TimeoutExpired:
            rc = -1
            f.write("\n# TIMEOUT\n")
    out = open(log, encoding="utf-8", errors="replace").read()
    failed = rc != 0 or any(m in out for m in FAIL_MARKS)
    return (not failed), f"rc={rc} {time.time() - t0:.0f}s log={log}", out, model


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brain", default="auto", choices=["auto", "grok", "gemini", "qwen", "oc", "cf", "local"])
    ap.add_argument("--model", default=None, help="preferred model for the chosen brain (qwen: an Alibaba model id)")
    ap.add_argument("--cwd", default=os.getcwd())
    ap.add_argument("--allowed", default="Read,Write,Edit,Glob,Grep,Bash", help="Claude Code allowedTools (qwen/local)")
    ap.add_argument("--timeout", type=int, default=0, help="seconds per brain (0 = per-brain default)")
    ap.add_argument("task")
    a = ap.parse_args()
    chain = AUTO_CHAIN if a.brain == "auto" else [a.brain]
    for brain in chain:
        ok, info, out, model = run_one(brain, a.task, a.cwd, a.allowed, a.timeout or TIMEOUTS[brain], a.model)
        if ok is None:
            say(f"[dispatch] {brain}: skipped ({info})")
            continue
        if ok:
            say(f"[dispatch] DONE brain={brain} model={model} {info}")
            say("\n".join(out.strip().splitlines()[-12:]))
            return 0
        say(f"[dispatch] {brain} failed ({info}); trying next")
    say("[dispatch] ALL BRAINS FAILED - escalate to the human/Claude")
    return 1


if __name__ == "__main__":
    sys.exit(main())
