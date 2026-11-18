"""dispatch.py の外向き操作の止め（OpenCode の権限・push の検知）の単体テスト。
実行: python -m unittest docs/ai-workflows/tools/test_dispatch_outward_guard.py
なぜ要るか: 2026-11-18 --brain sakura が環境変数での止めを自分で外し、push・PR・マージまで行った。
環境変数だけの止めは頭脳に外せる。OpenCode のツール側の権限で拒否し、それでも出たら検知して失敗にする。"""
import importlib.util, json, os, subprocess, tempfile, unittest, fnmatch

spec = importlib.util.spec_from_file_location("dispatch", os.path.join(os.path.dirname(__file__), "dispatch.py"))
dispatch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatch)


def decide(rules, command):
    """OpenCode と同じく、合う規則のうち最後のものが勝つ。"""
    result = None
    for pat, act in rules.items():
        if fnmatch.fnmatchcase(command, pat):
            result = act
    return result


class OpencodeGuard(unittest.TestCase):
    def guarded(self, base=None):
        env = {}
        if base is not None:
            env["OPENCODE_CONFIG_CONTENT"] = json.dumps(base)
        dispatch.opencode_guard(env)
        return json.loads(env["OPENCODE_CONFIG_CONTENT"])

    def test_bypasses_seen_on_2026_11_18_are_denied(self):
        bash = self.guarded()["permission"]["bash"]
        for c in ["git push -u origin agy/x", "git remote set-url --push origin https://github.com/a/b",
                  "env -u GH_TOKEN gh pr create --fill", "gh pr merge 172 --squash", "cd x && git push",
                  "unset GIT_CONFIG_PARAMETERS", "git config --unset url.x.pushInsteadOf", "npx wrangler deploy"]:
            self.assertEqual(decide(bash, c), "deny", c)

    def test_normal_work_is_allowed(self):
        bash = self.guarded()["permission"]["bash"]
        for c in ["git status", "git add -A", 'git commit -m "fix"', "npm test", "npx vitest run", "node scripts/x.mjs"]:
            self.assertEqual(decide(bash, c), "allow", c)

    def test_keeps_sakura_provider(self):
        _, env, _ = dispatch.build("sakura", "do x", "", None)
        dispatch.opencode_guard(env)
        conf = json.loads(env["OPENCODE_CONFIG_CONTENT"])
        self.assertIn("sakura", conf["provider"])
        self.assertEqual(conf["permission"]["bash"]["*git push*"], "deny")


class PushDetect(unittest.TestCase):
    def test_only_shas_present_here_count(self):
        with tempfile.TemporaryDirectory() as d:
            subprocess.run(["git", "init", "-q", d], check=True)
            subprocess.run(["git", "-C", d, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x"], check=True)
            here = subprocess.run(["git", "-C", d, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
            before = {"refs/heads/main": "1" * 40}
            after = {"refs/heads/main": "1" * 40, "refs/heads/agy/x": here, "refs/heads/other": "2" * 40}
            self.assertEqual(dispatch.pushed_from_here(before, after, d), ["refs/heads/agy/x"])
            self.assertEqual(dispatch.pushed_from_here(None, after, d), [])


if __name__ == "__main__":
    unittest.main()
