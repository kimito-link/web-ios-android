"""
dispatch.py - run one task headlessly on a free/cheap brain, with automatic fallback.

  python dispatch.py "task text"                         # --brain auto: AUTO_CHAIN below (codex -> neon -> sakura -> grok -> ... -> local)
  python dispatch.py --brain codex --cwd <dir> "task"    # OpenAI Codex CLI (ChatGPT plan quota, separate from Claude's weekly limit)
  python dispatch.py --brain grok  --cwd <dir> "task"    # Grok Build headless (--always-approve so file edits do not block)
  python dispatch.py --brain qwen  --cwd <dir> "task"    # Claude Code + Alibaba (model chain, skips exhausted quotas; via local relay)
  python dispatch.py --brain oc    --cwd <dir> "task"    # OpenCode + Alibaba qwen3.8-27b (direct)
  python dispatch.py --brain cf    --cwd <dir> "task"    # OpenCode + Cloudflare qwen3.8-27b (free daily quota)
  python dispatch.py --brain muse  --cwd <dir> "task"    # OpenCode Zen + Meta Muse Spark 1.3 Contributor (free; prompts may train Meta's models)
  python dispatch.py --brain nvidia --cwd <dir> "task"   # OpenCode + NVIDIA NIM DeepSeek V4.1 Flash (free, 80-model catalog)
  python dispatch.py --brain mistral --cwd <dir> "task"  # OpenCode + Mistral Codestral (free monthly, coding-specialised)
  python dispatch.py --brain hydrogen --cwd <dir> "task" # OpenCode + Google AI Studio gemini-4-hydrogen (free pro-class helper; slow)
  python dispatch.py --brain sakura --cwd <dir> "task"   # OpenCode + さくらのAI Engine DeepSeek-V4.1-Flash-1017 (free 3,000 req/month, stops at the cap)
  python dispatch.py --brain glm   --cwd <dir> "task"    # OpenCode + OpenRouter GLM-5.3-Flash (cheap, Opus-class; after free quotas)
  python dispatch.py --brain local --cwd <dir> "task"    # Claude Code + local Ollama (free, slow)
  python dispatch.py --brain agy   --cwd <dir> "task"    # Antigravity CLI headless (Opus 5.5 etc. on the Google quota; explicit only)
  python dispatch.py --brain neon  --cwd <dir> "task"    # = agy with gemini-4-neon-medium (AI Pro flat fee, Gemini pool; 2nd in auto)
  python dispatch.py --cwd <dir> --verify "npm test" "task"   # auto needs a pass/fail command ("delegate only what a machine can judge")
  python dispatch.py --cwd <dir> --out tests/x.test.mjs --context src/x.mjs --verify "npx vitest run tests/x.test.mjs" "unit tests for x"
                                                              # one file, machine-checked: FILE_CHAIN (Groq -> local Ollama -> Gemini, all free)

Why fallback exists: free quotas die without warning (Alibaba flash and max each ran out within about 1.5 days on
2026-09-15/16), and a headless brain that blocks on a permission prompt looks like a hang. A failed brain must never
stop the work; the next brain takes over and the log says which one actually did it.

Failure signatures treated as "try the next brain": non-zero exit, timeout, or output containing any of FAIL_MARKS.
Full output: %LOCALAPPDATA%\\llm-proxy\\runs\\<timestamp>-<brain>.log. Canonical copy: web-ios-android/docs/ai-workflows/tools/.
Secrets: none here. Keys come from user env vars DASHSCOPE_API_KEY / CF_WORKERS_AI_TOKEN / OPENCODE_API_KEY etc.
"""
import argparse, json, os, subprocess, sys, time, urllib.request

RUNS = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "llm-proxy", "runs")
os.makedirs(RUNS, exist_ok=True)
RELAY = "http://127.0.0.1:18081"
ALIBABA_OPENAI = "https://ws-udyvfona8qqwei1q.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
CLAUDE_COMMON = {"ANTHROPIC_API_KEY": "", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"}
# Alibaba models with independent free quotas, best first. Exhausted ones are skipped by a cheap probe.
QWEN_CHAIN = ["kimi-k3", "glm-5.2", "deepseek-v4.1-flash", "qwen3.8-27b", "qwen3.8-max", "qwen3.8-flash"]
# Full picture: MULTI-BRAIN-HOWTO.md §0. Grok Bot writes jobs into <repo>/_jobs/inbox; job-runner.py (Task
# Scheduler, every 10 min) runs them through this dispatch. "The real Claude only plans/judges; hands are free brains."
# Agent brains (can read/write files, run commands): auto tries them in this order.
# muse (OpenCode Zen free Muse Spark) is NOT in the chain yet: on 2026-10-28 the PC test with a valid key got
# "Model is unavailable". Only brains that actually answered go in. When the usage page shows it "ok", put it 2nd
# (after grok): it is free and a strong agentic coder, ahead of Alibaba and Cloudflare (which bills overage here).
# codex first (2026-11-12): ChatGPT team plan = flat fee already paid, a wallet separate from Claude's weekly limit,
# and the strongest coder in the chain. PC-measured: commit OK in 242s, 5h window 13%->15% for one small task.
# hydrogen after grok (2026-11-18): free pro-class helper, PC run committed in 250s. Ahead of qwen/oc (Alibaba quotas
# often spent) and cf (bills overage here), never ahead of codex/grok: slow (about a minute per call) and 503-prone.
# sakura after hydrogen (2026-11-18): PC run committed in 22s, function calling OK on all 3 models. Free plan stops at
# 3,000 requests/month with 429 (no billing); that pool is shared with the council seats (see the 2026-11-28 note below).
# neon after codex (2026-11-27): Antigravity's gemini-4-neon-medium on the Google AI Pro plan = flat fee already paid,
# its own "Gemini" pool (separate from Antigravity's Claude pool and from Claude Code's weekly limit). PC-measured SUCCESS
# in about 5s on agy 1.5.17 (2026-11-25). Google's Antigravity team said on X (2026-11-22..25) that caching/harness work
# stretched Neon's subscription quota by close to 75%. It is NOT unlimited: the "unlimited from 11/26" posts had no
# Google source (Gemini app limits stay compute-based, Pro = 4x Free). Ahead of grok (paid credits run out with 402).
# A PC without agy or its allow list just fails fast and the chain moves on; --verify still decides the result.
# sakura moved ahead of grok (2026-11-28): in the 30 days to 11/26 grok ran 58 times and sakura 9. sakura sat behind
# grok and hydrogen, so it only ran when both failed, while its free 3,000 requests/month expire unused every month and
# Grok Build spends credits that end with 402. Since #207 every auto run needs --verify, so a weaker free brain going
# first costs at most one failed try before the chain moves on; it cannot ship a wrong answer. Rule: among brains that
# pass the same --verify, a free quota that expires goes before a paid or finite one. sakura still stops with 429 at
# the cap (no billing), so the council's 2 reserve seats on the same pool only lose a seat, never cost money.
AUTO_CHAIN = ["codex", "neon", "sakura", "grok", "hydrogen", "qwen", "oc", "cf", "nvidia", "mistral", "glm", "local"]
# Text-only brains (one answer, no tools): used with --text. gemini = Gemini API free tier, groq = Groq free tier.
TEXT_CHAIN = ["gemini", "groq", "qwen"]
# One-file jobs with a pass/fail command (--out + --verify): unit tests, type annotations, small pure functions.
# 2026-11-26 cost council: the company PC's Ollama (RTX 4070 Ti, ~10GB VRAM free) and Groq (1,000 requests/day free)
# had 0 runs in 30 days, because they were only reachable as the LAST step of AUTO_CHAIN or through --text, where nobody
# checks the answer. A one-file job that a command can judge suits a fast/weak text model: dispatch writes the file,
# runs --verify, feeds the failure back once, and moves on if it still fails. No Codex/Claude quota is spent on these.
# Order (PC run 2026-11-26, the same add() unit-test job): groq qwen3.8-27b passed in 1s, ollama qwen3.6:35b-a3b in 110s
# (RTX 4070 Ti, model load included). Both are free, so the fast one goes first; Ollama takes over when Groq's daily
# quota or rate limit stops it, and is the one to name (--brain ollama) for code that must not leave the PC.
FILE_CHAIN = ["groq", "ollama", "gemini"]
# Ollama models for one-file jobs, best first. Only installed ones are used (asked via /api/tags each run): the
# 11/26 council named qwen2.5-coder-14b, which was not on the PC, and every call failed. Never assume a model exists.
OLLAMA_CODER_CHAIN = ["qwen3-coder:30b", "qwen2.5-coder:14b", "qwen3.6:35b-a3b", "qwen3:14b", "qwen3:8b"]
FAIL_MARKS = ["insufficient_quota", "Free quota exhausted", "data_inspection_failed", "API Error", "Unable to connect",
              "Failed to authenticate", "Unexpected server error", "Open this URL to sign in", "ECONNREFUSED", "rate limit",
              "Opening authentication page", "RESOURCE_EXHAUSTED", "quota exceeded",
              # 2026-10-18: opencode は headless で権限を自動拒否しても rc=0 で終わる（何もせず「DONE」扱いだった）。
              # Grok Build の残高切れは "API error (status 402 ..." で、上の "API Error" と大文字小文字が違い拾えなかった。
              "auto-rejecting", "rejected permission to use this specific tool call", "Payment Required",
              "usage balance exhausted",
              # 2026-10-21 agy 実測: headless で許可の無いコマンドを自動拒否しても status=SUCCESS・rc=0 で終わる。
              "so it was auto-denied",
              # 2026-10-28 OpenCode Zen 実測: 無料モデルの枠切れと、上流(Meta 等)が止まっているときの返事。
              "FreeUsageLimitError", "Model is unavailable",
              # 2026-11-12 Codex CLI 0.147 実測: ChatGPT ログインで使えないモデルは model_not_found(rc=1)。枠切れの返事。
              "model_not_found", "hit your usage limit",
              # 2026-11-12: the sandbox refused the real .git (Codex then faked a commit in .git-codex).
              "index.lock': Permission denied",
              # 2026-11-17 hydrogen: Gemini API が混雑(503)のときの返事。会議の実測で10本中2〜3本出る。次の頭脳へ回す。
              "The model is overloaded", '"status": "UNAVAILABLE"',
              # 2026-11-18 sakura: 無償プランは月3,000回を超えると課金でなく 429 で止まる（公式 manual 02-howto）。次の頭脳へ。
              "Too Many Requests"]
TIMEOUTS = {"codex": 1800, "agy": 1800, "grok": 900, "gemini": 900, "groq": 600, "qwen": 900, "oc": 900, "cf": 600, "muse": 900, "nvidia": 900, "mistral": 900, "hydrogen": 1800, "sakura": 900, "glm": 900, "local": 1800, "ollama": 900}


def say(msg):
    # Windows consoles default to cp932 here; brain output can contain chars it cannot encode
    # (e.g. GLM returns "·"), which made print() raise UnicodeEncodeError and abort the run after
    # the work had already succeeded. Re-encode to the stream's codec with replacement as a fallback.
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        enc = (getattr(sys.stdout, "encoding", None) or "utf-8")
        sys.stdout.buffer.write((msg + "\n").encode(enc, "replace"))
        sys.stdout.flush()


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


CODEX_DEFAULT_MODEL = "gpt-5.6-sol"  # ChatGPT-login models on 2026-11-12: gpt-5.6-sol / terra / luna
# Unattended runs must not reach for the screen: on 2026-11-12, when the sandbox refused a write, Codex read its
# computer-use skill and tried to drive git-gui.exe (it failed to start, so no harm). PC-measured the same day:
# "--disable plugins" removes every computer/browser/chrome/cua tool and skill (per-plugin -c did not remove cua_repl),
# and node_repl (the base the screen tools run on) is a config.toml MCP server, switched off for this run only.
CODEX_UNATTENDED_ARGS = ["--disable", "plugins", "-c", "mcp_servers.node_repl.enabled=false"]


def codex_fake_git(cwd):
    """Codex worked around a refused .git by copying it to .git-codex and committing there (PC 2026-11-12)."""
    d = os.path.abspath(cwd)
    try:
        return any(n.startswith(".git-") and os.path.isdir(os.path.join(d, n)) for n in os.listdir(d))
    except OSError:
        return False
AGY_DEFAULT_MODEL = "claude-opus-5-5-medium"  # role: heavy implementation (ANTIGRAVITY-HOWTO.md role table)
# 2026-10-21 PC 実走: allow を regex で書いても、ファイル作成をシェル（リダイレクト・Set-Content）でやったり
# `a ; b` とつないだりした1手が丸ごと自動拒否され、1ターンで何もせず終わった。Windows では分けられない行は完全一致になる
# （https://antigravity.google/docs/permissions?tab=cli）。ファイルは編集ツールで、コマンドは1つずつ出させる。
AGY_PREAMBLE = ("Headless run. Create and edit files only with your file-editing tools, never with shell commands or redirects. "
                "Run shell commands one per tool call; never chain them with ; && || or pipes. ")
AGY_OK_STATUS = "SUCCESS"
# Antigravity の枠は「Claude・GPT」と「Gemini」で別（各5時間＋週）。2026-10-21 実測で Claude 側が週の上限に達し
# RESOURCE_EXHAUSTED(429, 残り81時間)になった。そのときは Gemini 側の一番賢いモデルで1回だけやり直す。
# ★同日 gemini-3.8-flash も同じ残り時間で 429 だった＝枠が共通の可能性あり。やり直しは数秒で失敗するだけなので残す。
# 2026-11-25: Argon → Neon。Neon は Carbon 由来の中位モデル（2026-11-18 公開）で、Google の移行案内が Argon の後継に
# 指定している。会社PC の agy 1.5.17 で gemini-4-neon-{medium,high} が SUCCESS（Argon と同じ「Gemini」枠・約5秒）。
AGY_FALLBACK_MODEL = "gemini-4-neon-medium"
# Chain names that run another brain with a fixed model: (real brain, model). Logs and quota records use the real brain.
BRAIN_ALIASES = {"neon": ("agy", AGY_FALLBACK_MODEL)}


def agy_pool_exhausted(out, model):
    """Claude/GPT pool hit its limit, so the Gemini pool may still have room."""
    return "RESOURCE_EXHAUSTED" in out and not (model or "").startswith("gemini-")  # headless statuses: SUCCESS ERROR CANCELED INTERRUPTED INVALID WAITING RUNNING


AGY_THINKING_LEVELS = ("minimal", "low", "medium", "high", "xhigh")  # model slug suffixes, not part of the quota family
AGY_QUOTA_FILE = os.path.join(RUNS, "agy-quota.json")  # legacy single file (before 2026-11-18); no longer read (nor agy-quota-gemini.json, before 2026-11-27)


def agy_pool(model):
    """Which Antigravity quota a model draws from. 2026-11-18 PC: Claude Sonnet answered 429 "Resets in 4h50m" while
    gemini-3.8-flash and gemini-4-argon answered SUCCESS in the same minute = the pools are separate (the 11-12 note
    of one shared pool no longer holds). A single record made the Gemini fallback skip itself.
    2026-11-27 PC: the same mistake one level down. A gemini-4-argon 429 from 11/23 ("Resets in 162h") was kept as the
    one "gemini" record, so dispatch skipped gemini-4-neon for days while agy answered Neon with SUCCESS in 15s.
    Gemini models are recorded per family (model minus its thinking level): a wrong split costs one fast 429 and a
    record, a wrong merge stops a working brain for days."""
    m = model or ""
    if not m.startswith("gemini-"):
        return "claude"
    head, _, level = m.rpartition("-")
    return head if head and level in AGY_THINKING_LEVELS else m


def agy_quota_file(model):
    return os.path.join(RUNS, "agy-quota-%s.json" % agy_pool(model))


def agy_reset_seconds(out):
    """Seconds until the Antigravity quota comes back, from its 429 text ("... Resets in 76h3m"), or None.
    2026-11-12 PC: every model (Opus/Argon/Flash/GPT-OSS) answered the same remaining time = one shared pool."""
    import re
    m = re.search(r"Resets in (?:(\d+)h)?(?:(\d+)m)?", out)
    if not m or not (m.group(1) or m.group(2)):
        return None
    return int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60


def agy_remember_reset(out, now=None, path=None, model=None):
    sec = agy_reset_seconds(out)
    if sec is None:
        return
    try:
        with open(path or agy_quota_file(model), "w", encoding="utf-8") as f:
            json.dump({"until": (now or time.time()) + sec}, f)
    except OSError:
        pass


def agy_quota_wait(now=None, path=None, model=None):
    """Seconds left before the shared Antigravity quota resets, or 0. Lets dispatch skip agy in seconds instead of
    spending ~20s per run on a known 429 (and a second 429 on the Gemini retry)."""
    try:
        with open(path or agy_quota_file(model), encoding="utf-8") as f:
            until = json.load(f).get("until", 0)
    except (OSError, ValueError):
        return 0
    return max(0, int(until - (now or time.time())))


def agy_one_line(text):
    """cmd.exe (shell=True on Windows) cuts the command line at the first newline, so agy must get one line."""
    return " ".join(text.replace("\r", "\n").split("\n")).strip()


def agy_exe():
    p = os.path.join(os.environ.get("LOCALAPPDATA", ""), "agy", "bin", "agy.exe")
    return p if os.path.exists(p) else "agy"


def agy_status(out):
    """Last "status" value in agy --output-format json output, or None when there is none.
    rc=0 alone is not trusted: opencode taught us a headless brain can exit 0 after doing nothing (2026-10-18)."""
    import re
    found = re.findall(r'"status"\s*:\s*"([A-Z_]+)"', out)
    return found[-1] if found else None


def agy_denied(out):
    """True when agy's JSON lists any denied action. Measured 2026-10-21: a denied RunCommand still gave
    status SUCCESS with an empty response, so SUCCESS alone would have reported a no-op run as DONE."""
    import re
    return re.search(r'"denied_actions"\s*:\s*\[\s*\{', out) is not None


SAKURA_BASE_URL = "https://api.ai.sakura.ad.jp/v1"
SAKURA_DEFAULT_MODEL = "sakura/preview/DeepSeek-V4.1-Flash-1017"


def sakura_opencode_config(model_id):
    """OpenCode config that defines the sakura provider (OpenAI-compatible). The token is referenced, never inlined."""
    return {"$schema": "https://opencode.ai/config.json",
            "provider": {"sakura": {"npm": "@ai-sdk/openai-compatible", "name": "SAKURA AI Engine",
                                    "options": {"baseURL": SAKURA_BASE_URL, "apiKey": "{env:SAKURA_AI_ENGINE_TOKEN}"},
                                    "models": {model_id: {"name": model_id}}}}}


# The Claude Code brains (qwen, local) got only environment-variable blocks, which a brain holding the shell can undo
# (2026-11-18 sakura did exactly that through `git remote set-url --push` / `env -u GH_TOKEN`). Claude Code checks
# --disallowedTools itself, per sub-command of a compound command, so the brain cannot switch it off. Same shapes as
# OPENCODE_BASH_DENY: outward writes, and the commands that would remove the blocks.
CLAUDE_DENY_TOOLS = [
    "Bash(git push:*)", "Bash(git remote:*)", "Bash(git config:*)", "Bash(git credential:*)", "Bash(git commit --no-verify:*)",
    "Bash(gh:*)", "Bash(env:*)", "Bash(unset:*)", "Bash(export:*)", "Bash(wrangler:*)", "Bash(npx wrangler:*)",
    "Bash(vercel:*)", "Bash(npx vercel:*)", "Bash(npm publish:*)", "Bash(curl:*)", "WebFetch",
]


def claude_deny_args():
    return ["--disallowedTools", ",".join(CLAUDE_DENY_TOOLS)]


def build(brain, task, allowed, model=None, cwd=None):
    env = dict(os.environ)
    task = spool_task(task, brain)
    if brain == "qwen":
        env.update(CLAUDE_COMMON, ANTHROPIC_BASE_URL=RELAY, ANTHROPIC_AUTH_TOKEN=env.get("DASHSCOPE_API_KEY", ""), ANTHROPIC_MODEL=model)
        cmd = ["claude", "-p", task, "--model", model] + (["--allowedTools", allowed] if allowed else []) + claude_deny_args()
    elif brain == "local":
        model = model or "qwen3.6:35b-a3b"
        # DISPATCH_OLLAMA_URL: run on the second PC (Let's note) and borrow the company PC's GPU over Tailscale,
        # e.g. http://<company-pc-tailscale-name>:11434 (2026-11-11: reachable from other devices). Default = this PC.
        env.update(CLAUDE_COMMON, ANTHROPIC_BASE_URL=os.environ.get("DISPATCH_OLLAMA_URL", "http://127.0.0.1:11434"),
                   ANTHROPIC_AUTH_TOKEN="ollama", ANTHROPIC_MODEL=model)
        cmd = ["claude", "-p", task, "--model", model] + (["--allowedTools", allowed] if allowed else []) + claude_deny_args()
    elif brain == "oc":
        model = model or "alibaba/qwen3.8-27b"
        cmd = ["opencode", "run", "-m", model, task]
    elif brain == "cf":
        model = model or "cloudflare/@cf/qwen/qwen3.8-27b"
        cmd = ["opencode", "run", "-m", model, task]
    elif brain == "glm":
        # OpenCode + OpenRouter GLM-5.3-Flash (320B MoE, ~18B active, MIT). Paid but very cheap
        # (~$0.15/$0.50 per 1M in/out on 2026-10-08); Opus-4.8-class coding. Placed AFTER the free
        # brains (grok/qwen/oc/cf) and BEFORE local in AUTO_CHAIN: used when free quotas are spent,
        # in preference to local (free but slow + weak at agent tasks). Key: user env OPENROUTER_API_KEY.
        model = model or "openrouter/z-ai/glm-5.3-flash"
        cmd = ["opencode", "run", "-m", model, task]
    elif brain == "muse":
        # OpenCode Zen + Meta Muse Spark 1.3 Contributor (models.dev 2026-10-28: opencode/muse-spark-1.3-contributor-free,
        # $0 in/out). "Contributor" = Meta may train on prompts and outputs, so do not send secrets or code that must
        # not leave the PC (same stance as the other free tiers). Paid fallbacks of the same model, by --model:
        # meta/muse-spark-1.3-contributor ($0.10/$0.20 per 1M, key META_MODEL_API_KEY) or meta/muse-spark-1.3
        # ($1.25/$4.25, no training). Key: user env OPENCODE_API_KEY (or `opencode auth login` -> OpenCode Zen).
        model = model or "opencode/muse-spark-1.3-contributor-free"
        cmd = ["opencode", "run", "-m", model, task]
    elif brain == "nvidia":
        # OpenCode + NVIDIA NIM (free, 80-model catalog, ~40 rpm eval tier). DeepSeek V4.1 Flash is a
        # strong free coding model with 128K context. Key: user env NVIDIA_API_KEY. In AUTO_CHAIN after
        # the other free brains (grok/qwen/oc/cf), before the paid glm. Commercial use needs an NVIDIA license.
        model = model or "nvidia/deepseek-ai/deepseek-v4.1-flash"
        cmd = ["opencode", "run", "-m", model, task]
    elif brain == "mistral":
        # OpenCode + Mistral Codestral (free monthly allowance; coding-specialised). Key: user env MISTRAL_API_KEY.
        # After nvidia in AUTO_CHAIN. Free tier is non-commercial / monthly-capped; can 429 when the month's used up.
        model = model or "mistral/codestral-latest"
        cmd = ["opencode", "run", "-m", model, task]
    elif brain == "hydrogen":
        # OpenCode + Google AI Studio gemini-4-hydrogen (models.dev: google/gemini-4-hydrogen).
        # PC-measured 2026-11-18 (OpenCode 1.18.35): the google provider reads ONLY GOOGLE_GENERATIVE_AI_API_KEY, not
        # GEMINI_API_KEY ("API key is missing", rc=1 in 5s). So hand the existing GEMINI_API_KEY over under that name.
        # With it: Write -> run -> git commit done in 250s, no 503.
        # A free helper, NOT a replacement for codex/grok: pro-class on the free tier, but thinking cannot be switched off
        # (low is the floor), one call took 57-89s under council conditions and 2-3 calls in 10 got 503 (2026-11-15).
        # So: long timeout, and a 503 falls through to the next brain via FAIL_MARKS. Same key's gemini-4-argon is 429
        # (paid only) - never default to argon here. Free-tier prompts may be used by Google: no secrets, no private code.
        if env.get("GEMINI_API_KEY"):
            env.setdefault("GOOGLE_GENERATIVE_AI_API_KEY", env["GEMINI_API_KEY"])
        model = model or "google/gemini-4-hydrogen"
        cmd = ["opencode", "run", "-m", model, task]
    elif brain == "sakura":
        # OpenCode + さくらのAI Engine (OpenAI-compatible, https://api.ai.sakura.ad.jp/v1). 2026-11-18 契約: 基盤モデル無償プラン。
        # Why this one: chat completions 3,000 requests/month free, and past that the free plan answers 429 instead of
        # billing (manual.sakura.ad.jp/cloud/ai-engine/02-howto.html). cf bills overage here; this one cannot.
        # An agent task spends one request per tool step, so this is a helper for small/medium tasks, not a main hand.
        # Models (chat-models.html 11/18): preview/DeepSeek-V4.1-Flash-1017, preview/GLM-5.3-Flash, preview/Kimi-K2.7-Code,
        # all max_tokens 32,000, 1 request <= about 5 min. PC 2026-11-18: hello.py -> run -> commit in 22s (default model);
        # raw API at max_tokens 1600: DeepSeek 4.0s / GLM 9.6s / Kimi 8.6s, body never empty (reasoning comes apart in
        # message.reasoning), tool_calls returned by all three. "preview/" models may change or end without notice.
        # Key: user env SAKURA_AI_ENGINE_TOKEN ("<UUID>:<secret>", Bearer). The provider is not in models.dev, so it is
        # defined inline through OPENCODE_CONFIG_CONTENT ({env:...} keeps the token out of the config text and argv).
        model = model or SAKURA_DEFAULT_MODEL
        env["OPENCODE_CONFIG_CONTENT"] = json.dumps(sakura_opencode_config(model.split("/", 1)[1]))
        cmd = ["opencode", "run", "-m", model, task]
    elif brain == "groq":
        # Groq free tier caps tokens per minute (8000 on gpt-oss-120b, similar on qwen3.8-27b), so an agent's
        # system prompt does not fit. Use it as a text-only brain: one chat completion, answer goes to the log.
        model = model or "qwen/qwen3.8-27b"
        cmd = [sys.executable, os.path.abspath(__file__), "--groq-chat", model, task]
    elif brain == "agy":
        # Antigravity CLI headless (PC-measured 2026-10-21, agy 1.2.14). Uses the Google "Claude/GPT" or "Gemini" quota,
        # separate from the Claude Code weekly limit. Model slugs: claude-opus-5-5-{low,medium,high}, claude-sonnet-5-5-*,
        # gemini-4-neon-{low,medium,high,xhigh} (2026-11-25 agy 1.5.17), gemini-4-carbon-*, gemini-4-argon-*, gemini-4-hydrogen-*,
        # gemini-3.8-flash-*. Rules reach it through AGENTS.md (it does not read CLAUDE.md).
        # NEVER add --dangerously-skip-permissions: measured that it ignores the deny list and pushed (ANTIGRAVITY-HOWTO.md).
        # Headless auto-denies anything not in userSettings.globalPermissionGrants.allow (~/.gemini/config/config.json),
        # so the allow list must be set on the PC first. Not in AUTO_CHAIN: paid quota, and the allow list is per-PC.
        model = model or AGY_DEFAULT_MODEL
        # 2026-11-18 PC 実走: Windows の shell=True(cmd.exe) は引数の改行でコマンドラインを打ち切る。前置きの改行で
        # 本文と --model 以降が消え、agy は前置き1行だけを受け取って止まった。改行は空白にして1行で渡す。
        cmd = [agy_exe(), "-p", agy_one_line(AGY_PREAMBLE + task), "--model", model, "--output-format", "json"]
    elif brain == "codex":
        # OpenAI Codex CLI headless (PC-measured 2026-11-12, codex-cli 0.147.0, ChatGPT team login).
        # - The PC's config.toml default model (gpt-6.1-sol) answers model_not_found on a ChatGPT login: always pass -m.
        # - exec never asks for approval. workspace-write lets it edit only inside the working directory (subprocess cwd = --cwd). --dangerously-bypass-* is never used.
        # - config.toml has network_access=true, so the sandbox does NOT stop git push. block_outward() stops it instead
        #   (GIT_CONFIG_PARAMETERS survives Codex's default env filter, which drops names containing KEY/TOKEN/SECRET).
        # - Rules reach it through AGENTS.md (repo + ~/.codex/AGENTS.md); it does not read CLAUDE.md.
        # - Each run spends ~1-2 min warming up: send one batched task, not many tiny ones.
        model = model or CODEX_DEFAULT_MODEL
        # -C is required (PC 2026-11-12): without it the sandbox refused .git/index.lock, and Codex "committed" into a
        # copied .git-codex instead while reporting success. With -C the commit landed in the real repo.
        cmd = ["codex", "exec", "-m", model, "--sandbox", "workspace-write", "--skip-git-repo-check",
               "-C", os.path.abspath(cwd or os.getcwd())] + CODEX_UNATTENDED_ARGS + [task]
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


# Cloudflare Workers AI は、このアカウントでは Workers Paid 契約(2026-10-19 請求画面で確認)。1日 10,000 ニューロンの無料枠を
# 超えると止まらず従量課金になる。重い作業(1回で無料枠の数倍)を auto が自動で Cloudflare に流すと、気づかず課金が積み上がる。
# ダッシュボードの記録(使用量を4時間ごとに保存)で、今日(UTC)すでに超えていれば auto では飛ばす。明示的な --brain cf は止めない(警告のみ)。
# 読めない・古い・日をまたいだ場合は止めない(ダッシュボードの故障で作業を止めない)。環境変数 CF_ALLOW_OVERAGE=1 で常に通す。
BRAINS_JSON_URL = "https://raw.githubusercontent.com/kimito-link/web-ios-android/usage-data/brains.json"
CF_RECORD_MAX_AGE_SEC = 12 * 3600


def cf_over_budget(now=None, fetch=None):
    """今日(UTC)の Cloudflare 使用量が無料枠を超えていれば、その理由の文字列。そうでなければ None。"""
    if os.environ.get("CF_ALLOW_OVERAGE"):
        return None
    import datetime
    now = now or datetime.datetime.now(datetime.timezone.utc)
    try:
        raw = (fetch or (lambda u: urllib.request.urlopen(u, timeout=5).read().decode("utf-8")))(BRAINS_JSON_URL)
        data = json.loads(raw)
        updated = datetime.datetime.fromisoformat(data["updatedAt"].replace("Z", "+00:00"))
        if updated.date() != now.date() or (now - updated).total_seconds() > CF_RECORD_MAX_AGE_SEC:
            return None  # 古い・日をまたいだ記録(ニューロンは UTC 0:00 にリセット)は信用しない
        cf = next(b for b in data["brains"] if b.get("id") == "cf")
        over = max([g.get("over") or 0 for g in cf.get("gauges", [])] or [0])
        if over > 0:
            used = max([g.get("used") or 0 for g in cf.get("gauges", [])] or [0])
            return f"Cloudflare の今日の無料枠(10,000)を超えている(使用 {used:,}・超過 {over:,})。Workers Paid なので超過分は従量課金。CF_ALLOW_OVERAGE=1 か --brain cf で通せる"
    except Exception:
        return None
    return None


ALLOW_CF = False

# 自動の順番(auto)で、ダッシュボードの記録が「枠切れ(quota)」「つながらない(down)」と言っている頭脳は、起動せずに飛ばす。
# なぜ: 枠切れの頭脳も1つずつ起動して失敗を待つと、1件あたり数十秒〜数分を空費する(2026-10-19 は Grok・Alibaba・OpenRouter が
# 同時に切れていて Cloudflare に落ちるまで待たされた)。記録は4時間ごとに PC の定期タスクが取る(record-brain-status.mjs)。
# 古い記録(BRAIN_RECORD_MAX_AGE_SEC 超)・読めない記録では飛ばさない(ダッシュボードの故障で作業を止めない)。明示指定(--brain x)も止めない。
BRAIN_RECORD_MAX_AGE_SEC = 6 * 3600
BRAIN_RECORD_ID = {"qwen": "alibaba", "oc": "alibaba"}  # neon: no record on purpose (the "agy" row tracks the Claude pool; the Gemini pool is checked by agy_quota_wait)  # dispatch の名前 → brains.json の id(同じ名前のものは省略)
_brains_cache = {}


def brain_unavailable(brain, now=None, fetch=None):
    """記録上その頭脳が使えない(枠切れ・停止)なら理由の文字列。分からなければ None。"""
    import datetime
    now = now or datetime.datetime.now(datetime.timezone.utc)
    try:
        if fetch or "data" not in _brains_cache:
            raw = (fetch or (lambda u: urllib.request.urlopen(u, timeout=5).read().decode("utf-8")))(BRAINS_JSON_URL)
            data = json.loads(raw)
            if not fetch:
                _brains_cache["data"] = data
        else:
            data = _brains_cache["data"]
        updated = datetime.datetime.fromisoformat(data["updatedAt"].replace("Z", "+00:00"))
        if (now - updated).total_seconds() > BRAIN_RECORD_MAX_AGE_SEC:
            return None
        rid = BRAIN_RECORD_ID.get(brain, brain)
        b = next((x for x in data["brains"] if x.get("id") == rid), None)
        if b and b.get("status") in ("quota", "down"):
            return "dashboard says %s: %s (recorded %s)" % (b.get("status"), b.get("statusLabel", ""), data["updatedAt"])
    except Exception:
        return None
    return None


def run_one(brain, task, cwd, allowed, timeout, model=None):
    """Returns (ok, info, output, model). ok is None when the brain was skipped before running."""
    if brain == "cf" and not ALLOW_CF:
        reason = cf_over_budget()
        if reason:
            return None, reason, "", None
    if brain == "agy":
        wait = agy_quota_wait(model=model or AGY_DEFAULT_MODEL)
        if wait:
            return None, "Antigravity quota spent, resets in %dh%02dm" % (wait // 3600, wait % 3600 // 60), "", None
    if brain == "qwen":
        if not ensure_relay():
            return None, "relay down", "", None
        model = pick_alibaba_model(model)
        if not model:
            return None, "all Alibaba quotas exhausted", "", None
    if brain == "hydrogen" and not (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_GENERATIVE_AI_API_KEY")):
        return None, "GEMINI_API_KEY not set", "", None
    if brain == "sakura" and not os.environ.get("SAKURA_AI_ENGINE_TOKEN"):
        return None, "SAKURA_AI_ENGINE_TOKEN not set", "", None
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
    cmd, env, model = build(brain, task, allowed, model, cwd)
    # opencode は subprocess の cwd より環境変数 PWD を作業場所に使う（2026-10-18 実測）。Git Bash から呼ぶと
    # 呼び出し元の PWD が残り、--cwd と別のリポで branch を切って commit した。PWD を cwd に揃えて固定する。
    env["PWD"] = os.path.abspath(cwd)
    heads_before = None
    base_sha = head_sha(cwd)
    if not ALLOW_OUTWARD:
        block_outward(env)
        if cmd and cmd[0] == "opencode":
            opencode_guard(env)
        heads_before = remote_heads(cwd)
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
    if brain == "agy" and (agy_status(out) != AGY_OK_STATUS or agy_denied(out)):
        failed = True
    if brain == "agy" and failed:
        agy_remember_reset(out, model=model)
    if heads_before is not None:
        leaked = pushed_from_here(heads_before, remote_heads(cwd), cwd)
        if leaked:
            failed = True
            out += "\n# FAILED: OUTWARD PUSH DETECTED - the brain pushed %s itself. Check for PRs/merges it made before trusting anything.\n" % ", ".join(leaked)
    if brain == "codex" and codex_fake_git(cwd):
        failed = True
        out += "\n# FAILED: .git-codex found - Codex committed into a copy of .git, not the real repo\n"
    # The brain's own word is not the result (2026-11-26 cost council): the checks it was judged by must be intact, and
    # the pass/fail command must pass. Both go into the run log so the commander sees why (the usage page still
    # counts only FAIL_MARKS = availability, not quality).
    extra = ""
    if not failed and base_sha and not ALLOW_CHECK_EDITS:
        weak = weakened_checks(cwd, base_sha)
        if weak:
            failed = True
            extra += "\n# FAILED: CHECKS WEAKENED - %s. A delegated brain must not loosen the checks that judge it.\n" % "; ".join(weak)
    if not failed and VERIFY_CMD:
        vrc, vout = run_verify(VERIFY_CMD, cwd)
        extra += "\n# verify (%s): rc=%s\n%s\n" % (VERIFY_CMD, vrc, vout[-3000:])
        if vrc != 0:
            failed = True
            extra += "# FAILED: VERIFY - the pass/fail command did not pass\n"
    if extra:
        out += extra
        with open(log, "a", encoding="utf-8", errors="replace") as f:
            f.write(extra)
    return (not failed), f"rc={rc} {time.time() - t0:.0f}s log={log}", out, model


ALLOW_OUTWARD = False


def block_outward(env):
    """頭脳のプロセスから外向きの書き込み（git push・gh・デプロイ）を通さない。手元の commit と fetch は通る。
    なぜ: 2026-10-18 ジョブ10で mistral が別作業のブランチへ push し、その PR にコメント・ラベル作成までした。
    push・PR 操作・デプロイは司令塔（本物の Claude）が差分を見てから行う（CLAUDE.md「外向き操作の前は止める」）。
    - git push: pushInsteadOf で送り先を存在しないスキームに差し替える（fetch は insteadOf ではないので無傷）
    - gh / wrangler / vercel: 無効なトークンを環境変数で渡す（保存済みのログインより環境変数が優先される）
    外したいときだけ --allow-outward。"""
    pairs = [("url.no-push-from-dispatch://blocked/.pushInsteadOf", p) for p in ("https://", "http://", "git@", "ssh://")]
    base = int(env.get("GIT_CONFIG_COUNT") or 0)
    for i, (k, v) in enumerate(pairs):
        env["GIT_CONFIG_KEY_%d" % (base + i)] = k
        env["GIT_CONFIG_VALUE_%d" % (base + i)] = v
    env["GIT_CONFIG_COUNT"] = str(base + len(pairs))
    # Codex CLI drops env vars whose names contain KEY/TOKEN/SECRET before running shell commands, which removes
    # GIT_CONFIG_KEY_n. GIT_CONFIG_PARAMETERS carries the same rule under a name that survives that filter.
    params = " ".join("'%s'='%s'" % (k, v) for k, v in pairs)
    env["GIT_CONFIG_PARAMETERS"] = (env.get("GIT_CONFIG_PARAMETERS", "") + " " + params).strip()
    for k in ("GH_TOKEN", "GITHUB_TOKEN", "CLOUDFLARE_API_TOKEN", "VERCEL_TOKEN"):
        env[k] = "blocked-by-dispatch"
    env["GH_PROMPT_DISABLED"] = "1"


# 2026-11-18 事故: --brain sakura（OpenCode・Kimi-K2.7-Code）が `git remote set-url --push` と `env -u GH_TOKEN` で
# block_outward を自分で外し、push・PR 作成・マージまで行った（検品より先に main へ入った。web-health-check-app#172）。
# 環境変数での止め方は、シェルを握る頭脳には外せる。OpenCode の権限設定（ツール側で判定・頭脳には外せない）でも止める。
# 最後に勝つ規則が効くので "*": "allow" を先頭に置き、外向き・止め外しの形を後ろで deny する。
OPENCODE_BASH_DENY = [
    "*git push*", "*git remote*", "*git config*", "*git credential*", "*pushInsteadOf*",
    "gh", "gh *", "* gh *", "*;gh *", "*&gh *", "*|gh *", "*gh.exe*",
    "*env -u*", "*unset *", "*GIT_CONFIG*", "*GH_TOKEN*", "*GITHUB_TOKEN*", "*Remove-Item Env:*", "*$env:*",
    "*wrangler*", "*vercel*", "*npm publish*", "*deploy*",
    "*curl *", "*Invoke-WebRequest*", "*Invoke-RestMethod*", "*iwr *", "*irm *",
]


def opencode_guard(env):
    """OpenCode の頭脳に、外向き操作と止め外しのシェルを権限で拒否させる（OPENCODE_CONFIG_CONTENT に重ねる）。
    inline の設定は OpenCode の設定の中で最後に読まれるので、作業フォルダの opencode.json では上書きできない。"""
    try:
        conf = json.loads(env.get("OPENCODE_CONFIG_CONTENT") or "{}")
    except ValueError:
        conf = {}
    bash = {"*": "allow"}
    bash.update({pat: "deny" for pat in OPENCODE_BASH_DENY})
    perm = conf.setdefault("permission", {})
    perm["bash"] = bash
    conf.setdefault("$schema", "https://opencode.ai/config.json")
    env["OPENCODE_CONFIG_CONTENT"] = json.dumps(conf)


def remote_heads(cwd):
    """origin のブランチの先頭 {ref: sha}。読めなければ None（ネットが無い等で作業を止めない）。"""
    try:
        r = subprocess.run(["git", "ls-remote", "--heads", "origin"], cwd=cwd, capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            return None
        return dict((ln.split("\t")[1], ln.split("\t")[0]) for ln in r.stdout.splitlines() if "\t" in ln)
    except Exception:
        return None


def pushed_from_here(before, after, cwd):
    """実行中に origin で増えた・動いたブランチのうち、その先頭がこの手元にある（＝ここから push された）もの。
    同じ時間に別のセッションが push したブランチは、手元に無い sha なので数えない。"""
    if before is None or after is None:
        return []
    moved = [ref for ref, sha in after.items() if before.get(ref) != sha]
    hits = []
    for ref in moved:
        if subprocess.run(["git", "cat-file", "-e", after[ref] + "^{commit}"], cwd=cwd, capture_output=True).returncode == 0:
            hits.append(ref)
    return hits


VERIFY_CMD = None
ALLOW_CHECK_EDITS = False
VERIFY_TIMEOUT = 900


# ---- Delegate only what a machine can judge (2026-11-26 cost council) ------------------------------------------------
# Conclusion of the council: whether a job goes to another brain is decided by ONE question - can a command (tests,
# type check, lint, build) say pass or fail? If yes, a cheap brain does it and dispatch checks it. If no (design,
# look and feel, review, legal wording, store submission), a cheap brain's "done" cannot be trusted and Claude checking
# it costs as much as doing it, so the job stays with Claude. Matched on what the task ASKS FOR, not on any mention.
CLAUDE_ONLY_KINDS = [
    ("design", r"設計(し|を|書|案|して|する)|アーキテクチャ|方針を(決|立)|architect|design (doc|the|a )"),
    ("look", r"デザイン|見た目|配色|レイアウトを(作|変|直)|画面を(作り直|デザイン)|LP を作|ＬＰを作|UIを(作|作り直|デザイン)|\bUX\b|art direction|look and feel"),
    ("review", r"レビュー(して|を(して|お願い))|検品(して|を)|審査(して|を)|監査(して|を)|\breview (this|the|my|pr)\b|code review"),
    ("legal", r"法令|法的|規約(を|の)(作|書|確認)|利用規約|プライバシーポリシー|特商法|特定商取引|商標|景表法|薬機法|legal|terms of service|privacy policy|trademark"),
    ("store", r"(審査|ストア)に?提出|申請(して|を出)|submit for review|app review"),
]
CLAUDE_ONLY_LABEL = {"design": "設計・方針", "look": "見た目・UI", "review": "レビュー・審査", "legal": "法令・規約・商標", "store": "ストア提出"}


def delegation_verdict(task, verify, text_only=False, override=None):
    """("ok", "") / ("claude", reason) / ("need_verify", reason). Pure, so the rule is testable without any brain."""
    import re
    if override:
        return "ok", "delegated anyway: " + override
    if text_only:
        return "ok", ""  # text jobs (summaries, drafts) never touch files; the commander reads the answer
    hits = [k for k, pat in CLAUDE_ONLY_KINDS if re.search(pat, task, re.I)]
    if hits:
        return "claude", "「%s」は機械で合否を決められない仕事なので Claude が自分でやる" % "・".join(CLAUDE_ONLY_LABEL[k] for k in hits)
    if not verify:
        return "need_verify", "合否を決めるコマンドが無い。--verify \"<テスト・型検査など>\" を付ける（決められないなら Claude が自分でやる）"
    return "ok", ""


def head_sha(cwd):
    try:
        r = subprocess.run(["git", "rev-parse", "HEAD"], cwd=cwd, capture_output=True, text=True, timeout=30)
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


TEST_PATH = r"(^|/)(tests?|__tests__|spec)/|(^|/)test_[^/]*\.py$|_test\.(py|go)$|\.(test|spec)\.[cm]?[jt]sx?$"
CHECK_PATHS = (".github/workflows/", ".claude/hooks/", ".claude/settings", ".husky/", "lefthook", ".pre-commit-config",
               "templates/diagnostics/", "vitest.config", "jest.config", "pytest.ini", "tsconfig")
SKIP_MARKS = r"\.(skip|only|todo)\(|\bx(it|describe|test)\(|@pytest\.mark\.(skip|xfail)|pytest\.skip\(|@unittest\.skip|" \
             r"--no-verify|continue-on-error:\s*true|@ts-(ignore|nocheck)|eslint-disable|# type:\s*ignore|noqa"
ASSERT_LINE = r"\bexpect\(|\bassert|\.toBe|\.toEqual|\.toThrow|self\.assert"


def weakened_checks(cwd, base):
    """Ways the brain loosened the checks between base and the working tree. [] when none (or not a git repo).
    Why: 2026-11-18 sakura removed its own push block. A brain judged by tests can equally skip or delete the tests,
    and then --verify passes for nothing. Flags: test files deleted, skip/ignore marks added, assertions removed from a
    test file, or the checking machinery itself (CI, hooks, test/type config) edited. --allow-check-edits lets it through."""
    import re
    def git(*a):
        r = subprocess.run(["git", *a], cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
        return r.stdout if r.returncode == 0 else ""
    found = []
    for ln in git("diff", "--name-status", "-M", base).splitlines():
        parts = ln.split("\t")
        st, path = parts[0], parts[-1]
        old = parts[1] if len(parts) > 2 else path
        if st.startswith(("D", "R")) and re.search(TEST_PATH, old) and not (st.startswith("R") and re.search(TEST_PATH, path)):
            found.append("test file removed: " + old)
        if any(c in path for c in CHECK_PATHS) or any(c in old for c in CHECK_PATHS):
            found.append("check machinery edited: " + path)
    cur, removed, added = None, {}, {}
    lines = git("diff", "-U0", base).splitlines()
    # New files the brain did not `git add` are not in the diff; read them as added lines.
    for path in git("ls-files", "--others", "--exclude-standard").splitlines():
        if any(c in path for c in CHECK_PATHS):
            found.append("check machinery edited: " + path)
        try:
            with open(os.path.join(cwd, path), encoding="utf-8", errors="replace") as f:
                lines += ["+++ b/" + path] + ["+" + t for t in f.read(200000).splitlines()]
        except OSError:
            pass
    for ln in lines:
        if ln.startswith("+++ "):
            cur = ln[6:] if ln.startswith("+++ b/") else None
        elif ln.startswith("+") and not ln.startswith("+++") and cur:
            if re.search(SKIP_MARKS, ln[1:]):
                found.append("skip/ignore added in %s: %s" % (cur, ln[1:].strip()[:80]))
            if cur.endswith("package.json") and re.search(r'"(test|lint|typecheck|type-check|verify|check)[^"]*"\s*:', ln):
                found.append("check script changed in %s: %s" % (cur, ln[1:].strip()[:80]))
            if re.search(TEST_PATH, cur) and re.search(ASSERT_LINE, ln):
                added[cur] = added.get(cur, 0) + 1
        elif ln.startswith("-") and not ln.startswith("---") and cur and re.search(TEST_PATH, cur) and re.search(ASSERT_LINE, ln):
            removed[cur] = removed.get(cur, 0) + 1
    for path, n in removed.items():
        if n > added.get(path, 0):
            found.append("assertions removed from %s (-%d +%d)" % (path, n, added.get(path, 0)))
    return sorted(set(found))


def run_verify(cmd, cwd, timeout=None):
    """Run the pass/fail command. (rc, output). A brain's environment blocks are not applied: this is the commander's command."""
    # No .pyc: a rewritten file of the same size in the same second reuses the stale bytecode, so a fixed answer was
    # judged by the old one (2026-11-27: the repair round failed on "3 != 4" with the corrected test on disk).
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    try:
        r = subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True, encoding="utf-8", errors="replace",
                           timeout=timeout or VERIFY_TIMEOUT, stdin=subprocess.DEVNULL, env=env)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired:
        return -1, "# VERIFY TIMEOUT"


# ---- One-file jobs on free text brains (--out) ----------------------------------------------------------------------
def ollama_url():
    return os.environ.get("DISPATCH_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")


def ollama_models(fetch=None):
    try:
        raw = (fetch or (lambda u: urllib.request.urlopen(u, timeout=5).read().decode("utf-8")))(ollama_url() + "/api/tags")
        return [m.get("name", "") for m in json.loads(raw).get("models", [])]
    except Exception:
        return []


def pick_ollama_model(preferred=None, installed=None):
    """First model of the chain that is actually installed. None if Ollama is down or has none of them."""
    have = installed if installed is not None else ollama_models()
    norm = lambda n: n if ":" in n else n + ":latest"
    names = {norm(n) for n in have}
    for m in ([preferred] if preferred else []) + OLLAMA_CODER_CHAIN:
        if m and norm(m) in names:
            return m
    return None


def ollama_chat(model, prompt):
    body = {"model": model, "messages": [{"role": "user", "content": prompt}], "stream": False,
            "options": {"temperature": 0.2, "num_ctx": 16384}}
    req = urllib.request.Request(ollama_url() + "/api/chat", data=json.dumps(body).encode(), headers={"content-type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=TIMEOUTS["ollama"]))
    return r["message"]["content"]


def groq_text(model, prompt):
    key = os.environ.get("GROQ_API_KEY", "")
    body = {"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 6000, "temperature": 0.2}
    req = urllib.request.Request("https://api.groq.com/openai/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json", "authorization": "Bearer " + key, "user-agent": "dispatch/1.0"})
    return json.load(urllib.request.urlopen(req, timeout=TIMEOUTS["groq"]))["choices"][0]["message"]["content"]


def gemini_text(model, prompt):
    key = os.environ.get("GEMINI_API_KEY", "")
    body = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"maxOutputTokens": 8192, "temperature": 0.2}}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
                                 data=json.dumps(body).encode(), headers={"content-type": "application/json", "user-agent": "dispatch/1.0"})
    r = json.load(urllib.request.urlopen(req, timeout=TIMEOUTS["gemini"]))
    return "".join(p.get("text", "") for p in r["candidates"][0]["content"]["parts"])


def file_brain(brain, model=None):
    """(ask(prompt)->text, model) for a FILE_CHAIN brain, or (None, reason) when it cannot run here."""
    if brain == "ollama":
        m = pick_ollama_model(model)
        if not m:
            return None, "Ollama at %s has none of %s" % (ollama_url(), ", ".join(OLLAMA_CODER_CHAIN))
        return (lambda p: ollama_chat(m, p)), m
    if brain == "groq":
        if not os.environ.get("GROQ_API_KEY"):
            return None, "GROQ_API_KEY not set"
        m = model or "qwen/qwen3.8-27b"
        return (lambda p: groq_text(m, p)), m
    if brain == "gemini":
        if not os.environ.get("GEMINI_API_KEY"):
            return None, "GEMINI_API_KEY not set"
        m = pick_gemini_model(model)
        if not m:
            return None, "all Gemini free quotas exhausted for today"
        return (lambda p: gemini_text(m, p)), m
    return None, "not a file brain: " + brain


def extract_file(answer):
    """The file body from a model answer: the largest fenced block, else the whole answer without think tags."""
    import re
    answer = re.sub(r"<think>.*?</think>", "", answer, flags=re.S)
    blocks = re.findall(r"```[^\n]*\n(.*?)```", answer, flags=re.S)
    body = max(blocks, key=len) if blocks else answer
    return body.strip("\n") + "\n"


def file_prompt(task, out_rel, context, existing, failure=None):
    parts = ["You write exactly one file: %s. Reply with the complete file content in ONE fenced code block and nothing else." % out_rel,
             "Do not skip, disable or weaken any test. Do not add skip/only/todo marks.", "", "Task:", task]
    for path, text in context:
        parts += ["", "--- %s ---" % path, text]
    if existing is not None:
        parts += ["", "--- current content of %s ---" % out_rel, existing]
    if failure:
        parts += ["", "Your previous version failed this check. Fix the file so it passes:", failure[-3000:]]
    return "\n".join(parts)


def run_file_job(task, cwd, out, verify, context_paths, chain, model=None, ask_for=None):
    """Write one file with a free text brain until `verify` passes. Returns (ok, brain, model, info).
    ask_for(brain, model) can replace file_brain() in tests."""
    root = os.path.abspath(cwd)
    target = os.path.abspath(os.path.join(root, out))
    if os.path.commonpath([root, target]) != root:
        return False, None, None, "--out must be inside --cwd: " + out
    out_rel = os.path.relpath(target, root).replace(os.sep, "/")
    context = []
    for c in context_paths:
        p = os.path.abspath(os.path.join(root, c))
        if os.path.commonpath([root, p]) != root:
            return False, None, None, "--context must be inside --cwd: " + c
        with open(p, encoding="utf-8", errors="replace") as f:
            context.append((os.path.relpath(p, root).replace(os.sep, "/"), f.read()[:30000]))
    existing = open(target, encoding="utf-8").read() if os.path.exists(target) else None
    base = head_sha(cwd)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    for brain in chain:
        ask, m = (ask_for or file_brain)(brain, model)
        if ask is None:
            say(f"[dispatch] {brain}: skipped ({m})")
            continue
        log = os.path.join(RUNS, f"{stamp}-{brain}.log")
        failure, ok, t0 = None, False, time.time()
        with open(log, "w", encoding="utf-8", errors="replace") as lf:
            lf.write(f"# brain={brain} model={m} cwd={cwd} out={out_rel} verify={verify}\n# task: {task}\n\n")
            for attempt in (1, 2):  # one repair round with the failure fed back
                try:
                    answer = ask(file_prompt(task, out_rel, context, existing, failure))
                except Exception as e:
                    lf.write("API Error: %s\n" % e)
                    break
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with open(target, "w", encoding="utf-8", newline="\n") as f:
                    f.write(extract_file(answer))
                weak = weakened_checks(cwd, base) if base and not ALLOW_CHECK_EDITS else []
                if weak:
                    failure = "Rejected before running: " + "; ".join(weak)
                    lf.write("# attempt %d: CHECKS WEAKENED - %s\n" % (attempt, failure))
                    continue
                vrc, vout = run_verify(verify, cwd)
                lf.write("# attempt %d verify rc=%s\n%s\n" % (attempt, vrc, vout[-3000:]))
                if vrc == 0:
                    ok = True
                    break
                failure = vout
            if not ok:
                lf.write("# FAILED: VERIFY - file job did not pass\n")
        if ok:
            return True, brain, m, "%.0fs log=%s" % (time.time() - t0, log)
        # put the file back the way it was before the next brain starts
        if existing is None:
            if os.path.exists(target):
                os.remove(target)
        else:
            with open(target, "w", encoding="utf-8", newline="\n") as f:
                f.write(existing)
        say(f"[dispatch] {brain} ({m}) failed (log={log}); trying next")
    return False, None, None, "every file brain failed"


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
    # PC run 2026-11-26: through a pipe (Remote Control, job-runner without PYTHONIOENCODING) Python on Windows writes
    # cp932, and the Japanese lines (CLAUDE_ONLY reasons) arrived garbled. Callers read pipes as UTF-8, so write UTF-8.
    if not sys.stdout.isatty() and hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if len(sys.argv) >= 4 and sys.argv[1] == "--groq-chat":
        sys.exit(groq_chat(sys.argv[2], unspool(" ".join(sys.argv[3:]))))
    if len(sys.argv) >= 4 and sys.argv[1] == "--gemini-chat":
        sys.exit(gemini_chat(sys.argv[2], unspool(" ".join(sys.argv[3:]))))
    ap = argparse.ArgumentParser()
    ap.add_argument("--brain", default="auto", choices=["auto", "codex", "neon", "agy", "grok", "gemini", "groq", "qwen", "oc", "cf", "muse", "nvidia", "mistral", "hydrogen", "sakura", "glm", "local", "ollama"])
    ap.add_argument("--model", default=None, help="preferred model for the chosen brain (qwen: an Alibaba model id)")
    ap.add_argument("--cwd", default=os.getcwd())
    ap.add_argument("--allowed", default="Read,Write,Edit,Glob,Grep,Bash", help="Claude Code allowedTools (qwen/local)")
    ap.add_argument("--timeout", type=int, default=0, help="seconds per brain (0 = per-brain default)")
    ap.add_argument("--text", action="store_true", help="text-only task (translation, summary, drafting): gemini -> groq -> qwen")
    ap.add_argument("--allow-outward", action="store_true", help="let the brain git push / use gh / deploy (blocked by default)")
    ap.add_argument("--verify", default=None, help="pass/fail command run in --cwd after the brain; failing it = brain failed (required for auto)")
    ap.add_argument("--out", default=None, help="one-file job: the file to write (needs --verify). Runs FILE_CHAIN: groq -> ollama -> gemini")
    ap.add_argument("--context", action="append", default=[], help="file to show the brain in a --out job (repeatable)")
    ap.add_argument("--allow-check-edits", action="store_true", help="the task itself is to change tests/CI/hooks (otherwise such edits fail the run)")
    ap.add_argument("--delegate-anyway", default=None, metavar="REASON", help="run a job dispatch would keep for Claude; the reason goes to the log")
    ap.add_argument("task")
    a = ap.parse_args()
    global ALLOW_OUTWARD, ALLOW_CF, VERIFY_CMD, ALLOW_CHECK_EDITS
    ALLOW_OUTWARD = a.allow_outward
    VERIFY_CMD = a.verify
    ALLOW_CHECK_EDITS = a.allow_check_edits
    # Delegate only what a machine can judge (2026-11-26). Explicit --brain x (job-runner, agy queue) still runs without
    # --verify, but a job of a kind no command can judge is refused for every brain. Exit 3 = "do it yourself, Claude".
    verdict, why = delegation_verdict(a.task, a.verify, a.text, a.delegate_anyway)
    if verdict == "claude" or (verdict == "need_verify" and (a.brain == "auto" or a.out)):
        say("[dispatch] CLAUDE_ONLY: " + why)
        return 3
    if verdict == "need_verify":
        say("[dispatch] WARNING: no --verify, so nothing checks the result: " + why)
    if a.brain == "ollama" and not a.out:
        ap.error("--brain ollama is a one-file brain: give --out and --verify (for agent work on Ollama use --brain local)")
    if a.out:
        chain = FILE_CHAIN if a.brain == "auto" else [a.brain]
        ok, brain, model, info = run_file_job(a.task, a.cwd, a.out, a.verify, a.context, chain, a.model)
        if ok:
            say(f"[dispatch] DONE brain={brain} model={model} out={a.out} {info}")
            return 0
        say("[dispatch] ALL FILE BRAINS FAILED (%s) - do it with --verify on the agent chain, or yourself" % info)
        return 1
    ALLOW_CF = a.brain == "cf"  # 明示された cf は止めない(警告だけ)
    if ALLOW_CF:
        warn = cf_over_budget()
        if warn:
            say(f"[dispatch] WARNING: {warn}")
    chain = (TEXT_CHAIN if a.text else AUTO_CHAIN) if a.brain == "auto" else [a.brain]
    for brain in chain:
        if a.brain == "auto" and len(chain) > 1:
            gone = brain_unavailable(brain)
            if gone:
                say(f"[dispatch] {brain}: skipped ({gone})")
                continue
        real, fixed_model = BRAIN_ALIASES.get(brain, (brain, None))
        ok, info, out, model = run_one(real, a.task, a.cwd, a.allowed, a.timeout or TIMEOUTS[real], fixed_model or a.model)
        if brain == "agy" and ok is False and agy_pool_exhausted(out, model):
            say(f"[dispatch] agy {model}: quota exhausted ({info}); retrying on the Gemini pool with {AGY_FALLBACK_MODEL}")
            ok, info, out, model = run_one(brain, a.task, a.cwd, a.allowed, a.timeout or TIMEOUTS[brain], AGY_FALLBACK_MODEL)
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
