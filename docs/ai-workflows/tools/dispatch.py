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
# Agent brains (can read/write files, run commands): auto tries them in this order.
AUTO_CHAIN = ["grok", "qwen", "oc", "cf", "local"]
# Text-only brains (one answer, no tools): used with --text. gemini = Gemini API free tier, groq = Groq free tier.
TEXT_CHAIN = ["gemini", "groq", "qwen"]
FAIL_MARKS = ["insufficient_quota", "Free quota exhausted", "data_inspection_failed", "API Error", "Unable to connect",
              "Failed to authenticate", "Unexpected server error", "Open this URL to sign in", "ECONNREFUSED", "rate limit",
              "Opening authentication page", "RESOURCE_EXHAUSTED", "quota exceeded"]
TIMEOUTS = {"grok": 900, "gemini": 900, "groq": 600, "qwen": 900, "oc": 900, "cf": 600, "local": 1800}


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


GEMINI_CHAIN = ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"]


def gemini_model_ok(model):
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        return False
    body = {"contents": [{"parts": [{"text": "OK"}]}], "generationConfig": {"maxOutputTokens": 1}}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
                                 data=json.dumps(body).encode(), headers={"content-type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=30).read()
        return True
    except Exception:
        return False


def pick_gemini_model(preferred=None):
    chain = ([preferred] if preferred and preferred != "default" else []) + [m for m in GEMINI_CHAIN if m != preferred]
    for m in chain:
        if gemini_model_ok(m):
            return m
    return None


def pick_alibaba_model(preferred=None):
    chain = ([preferred] if preferred else []) + [m for m in QWEN_CHAIN if m != preferred]
    for m in chain:
        if alibaba_model_ok(m):
            return m
    return None


def spool_task(task, brain):
    """Windows cmd.exe truncates command lines at ~8191 chars (shell=True). Long tasks go through a file:
    text brains read it directly (@path); agent brains are told to read the file first."""
    if len(task) <= 6000:
        return task
    path = os.path.join(RUNS, "task-%s-%s.txt" % (time.strftime("%Y%m%d-%H%M%S"), brain))
    with open(path, "w", encoding="utf-8") as f:
        f.write(task)
    if brain in ("gemini", "groq"):
        return "@" + path
    return "Read the file %s (UTF-8) and carry out the task written in it exactly." % path


def build(brain, task, allowed, model=None):
    env = dict(os.environ)
    task = spool_task(task, brain)
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
    elif brain == "groq":
        # Groq free tier caps tokens per minute (8000 on gpt-oss-120b, similar on qwen3.8-27b), so an agent's
        # system prompt does not fit. Use it as a text-only brain: one chat completion, answer goes to the log.
        model = model or "qwen/qwen3.8-27b"
        cmd = [sys.executable, os.path.abspath(__file__), "--groq-chat", model, task]
    elif brain == "grok":
        model = model or "grok-build"
        cmd = [os.path.expanduser("~/.grok/bin/grok.exe"), "-p", task, "--always-approve"]
    elif brain == "gemini":
        # Text-only via the Gemini API (free tier is per model; flash-lite models have the larger daily quotas).
        # The Gemini CLI agent is NOT used: on 2026-09-16 it kept calling gemini-3.5-flash (20 requests/day free)
        # regardless of -m, and the Google-login tier answered IneligibleTierError (moved to Antigravity).
        model = model or GEMINI_CHAIN[0]
        cmd = [sys.executable, os.path.abspath(__file__), "--gemini-chat", model, task]
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
    if brain == "groq" and not os.environ.get("GROQ_API_KEY"):
        return None, "GROQ_API_KEY not set", "", None
    if brain == "gemini":
        if not os.environ.get("GEMINI_API_KEY"):
            return None, "GEMINI_API_KEY not set", "", None
        # Free-tier quota is per model and small for some (gemini-3.5-flash: 20 requests/day on 2026-09-16).
        # Probe the chain with one tiny call and use the first model that still answers.
        model = pick_gemini_model(model)
        if not model:
            return None, "all Gemini free quotas exhausted for today", "", None
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


def groq_chat(model, task):
    """Text-only brain: one chat completion on Groq's OpenAI-compatible API. Prints the answer; exit 1 on API error."""
    key = os.environ.get("GROQ_API_KEY", "")
    body = {"model": model, "messages": [{"role": "user", "content": task}], "max_tokens": 4096, "temperature": 0.3}
    # Groq sits behind Cloudflare; the default "Python-urllib" User-Agent gets "403 error code: 1010", so send a plain UA.
    req = urllib.request.Request("https://api.groq.com/openai/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json", "authorization": "Bearer " + key, "user-agent": "dispatch/1.0"})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=300))
        print(r["choices"][0]["message"]["content"])
        return 0
    except urllib.error.HTTPError as e:
        print("API Error: %s %s" % (e.code, e.read().decode("utf-8", "replace")[:400]))
        return 1


def gemini_chat(model, task):
    """Text-only brain: one generateContent call on the Gemini API free tier. Prints the answer; exit 1 on API error."""
    key = os.environ.get("GEMINI_API_KEY", "")
    body = {"contents": [{"parts": [{"text": task}]}], "generationConfig": {"maxOutputTokens": 4096, "temperature": 0.3}}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
                                 data=json.dumps(body).encode(), headers={"content-type": "application/json", "user-agent": "dispatch/1.0"})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=300))
        print("".join(p.get("text", "") for p in r["candidates"][0]["content"]["parts"]))
        return 0
    except urllib.error.HTTPError as e:
        print("API Error: %s %s" % (e.code, e.read().decode("utf-8", "replace")[:400]))
        return 1


def unspool(task):
    return open(task[1:], encoding="utf-8").read() if task.startswith("@") and os.path.exists(task[1:]) else task


def main():
    if len(sys.argv) >= 4 and sys.argv[1] == "--groq-chat":
        sys.exit(groq_chat(sys.argv[2], unspool(" ".join(sys.argv[3:]))))
    if len(sys.argv) >= 4 and sys.argv[1] == "--gemini-chat":
        sys.exit(gemini_chat(sys.argv[2], unspool(" ".join(sys.argv[3:]))))
    ap = argparse.ArgumentParser()
    ap.add_argument("--brain", default="auto", choices=["auto", "grok", "gemini", "groq", "qwen", "oc", "cf", "local"])
    ap.add_argument("--model", default=None, help="preferred model for the chosen brain (qwen: an Alibaba model id)")
    ap.add_argument("--cwd", default=os.getcwd())
    ap.add_argument("--allowed", default="Read,Write,Edit,Glob,Grep,Bash", help="Claude Code allowedTools (qwen/local)")
    ap.add_argument("--timeout", type=int, default=0, help="seconds per brain (0 = per-brain default)")
    ap.add_argument("--text", action="store_true", help="text-only task (translation, summary, drafting): gemini -> groq -> qwen")
    ap.add_argument("task")
    a = ap.parse_args()
    chain = (TEXT_CHAIN if a.text else AUTO_CHAIN) if a.brain == "auto" else [a.brain]
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
