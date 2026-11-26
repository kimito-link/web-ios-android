"""dispatch.py の「機械で合否を決められる仕事だけ渡す」決まり（2026-11-26 コスパ運用会議）の単体テスト。
実行: python -m unittest docs/ai-workflows/tools/test_dispatch_delegation.py
なぜ要るか: 会議の結論は「委譲するかは CI/テストで合否を機械判定できるかだけで決める」。
- 判定できない仕事（設計・見た目・審査・法令）は Claude に戻す
- 委譲先がテストを消す・skip を足す・CI を書き換えると --verify が素通りになるので、それも失敗にする
- 1ファイルの仕事（--out）は無料の Ollama → Groq → Gemini で書かせ、--verify が通るまで1回だけ直させる"""
import importlib.util, os, subprocess, tempfile, unittest

spec = importlib.util.spec_from_file_location("dispatch", os.path.join(os.path.dirname(__file__), "dispatch.py"))
dispatch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatch)


def git(d, *a):
    subprocess.run(["git", "-C", d, "-c", "user.name=t", "-c", "user.email=t@t", *a], check=True, capture_output=True)


def repo(files):
    d = tempfile.mkdtemp()
    git(d, "init", "-q")
    for p, t in files.items():
        os.makedirs(os.path.dirname(os.path.join(d, p)) or d, exist_ok=True)
        open(os.path.join(d, p), "w").write(t)
    git(d, "add", "-A")
    git(d, "commit", "-q", "-m", "base")
    return d, subprocess.run(["git", "-C", d, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()


class Verdict(unittest.TestCase):
    def test_judgment_jobs_stay_with_claude(self):
        for t in ["LP のデザインを作り直して", "この PR をレビューして", "利用規約を書いて", "新しい課金の設計をして",
                  "アプリをストアに提出して", "商標を調べて"]:
            self.assertEqual(dispatch.delegation_verdict(t, "npm test")[0], "claude", t)

    def test_checkable_jobs_go_out(self):
        for t in ["parse_job の単体テストを追加", "budget-mode.mjs に JSDoc の型を付ける", "lint エラーを直して commit",
                  "Linux で落ちるテストを直す", "レビュー指摘の typo を直す"]:
            self.assertEqual(dispatch.delegation_verdict(t, "npm test")[0], "ok", t)

    def test_no_verify_is_flagged_and_text_is_free(self):
        self.assertEqual(dispatch.delegation_verdict("テストを足す", None)[0], "need_verify")
        self.assertEqual(dispatch.delegation_verdict("LP のデザイン案を文章で要約", None, text_only=True)[0], "ok")
        self.assertEqual(dispatch.delegation_verdict("LP のデザイン", None, override="りんく指定")[0], "ok")


class Weakened(unittest.TestCase):
    def test_clean_change_passes(self):
        d, base = repo({"src/a.py": "x = 1\n", "tests/test_a.py": "def test_a():\n    assert 1\n"})
        open(os.path.join(d, "src/a.py"), "w").write("x = 2\n")
        open(os.path.join(d, "tests/test_a.py"), "a").write("def test_b():\n    assert 2\n")
        self.assertEqual(dispatch.weakened_checks(d, base), [])

    def test_skips_deletions_and_ci_edits_are_caught(self):
        d, base = repo({"a.test.mjs": "it('a', () => { expect(1).toBe(1) })\n", "test_b.py": "def test_b():\n    assert 1\n",
                        ".github/workflows/ci.yml": "on: push\n"})
        open(os.path.join(d, "a.test.mjs"), "w").write("it.skip('a', () => {})\n")
        os.remove(os.path.join(d, "test_b.py"))
        open(os.path.join(d, ".github/workflows/ci.yml"), "a").write("    continue-on-error: true\n")
        git(d, "add", "-A")
        git(d, "commit", "-q", "-m", "brain")  # committed or not, both are compared with base
        found = " | ".join(dispatch.weakened_checks(d, base))
        self.assertIn("test file removed: test_b.py", found)
        self.assertIn("skip/ignore added in a.test.mjs", found)
        self.assertIn("assertions removed from a.test.mjs", found)
        self.assertIn("check machinery edited: .github/workflows/ci.yml", found)


class FileJob(unittest.TestCase):
    def setUp(self):
        self.d, _ = repo({"calc.py": "def add(a, b):\n    return a + b\n"})
        self.verify = "python -m unittest -q test_calc.py"
        dispatch.ALLOW_CHECK_EDITS = False

    def run_job(self, answers):
        calls = []

        def ask_for(brain, model):
            if brain not in answers:
                return None, "not here"
            seq = answers[brain]
            def ask(prompt):
                calls.append((brain, prompt))
                return seq.pop(0)
            return ask, brain + "-m"
        ok, brain, _, _ = dispatch.run_file_job("add の単体テスト", self.d, "test_calc.py", self.verify, ["calc.py"],
                                                dispatch.FILE_CHAIN, ask_for=ask_for)
        return ok, brain, calls

    GOOD = "```python\nimport unittest\nfrom calc import add\nclass T(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add(1, 2), 3)\n```"
    BAD = "```python\nimport unittest\nfrom calc import add\nclass T(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add(1, 2), 4)\n```"

    def test_repair_round_gets_the_failure(self):
        ok, brain, calls = self.run_job({"ollama": [self.BAD, self.GOOD]})
        self.assertTrue(ok)
        self.assertEqual(brain, "ollama")
        self.assertIn("failed this check", calls[1][1])
        self.assertIn("def add", calls[0][1])  # --context reached the brain

    def test_falls_through_to_groq_and_restores_between(self):
        ok, brain, calls = self.run_job({"ollama": [self.BAD, self.BAD], "groq": [self.GOOD]})
        self.assertTrue(ok)
        self.assertEqual(brain, "groq")

    def test_all_fail_leaves_no_file(self):
        ok, _, _ = self.run_job({"ollama": [self.BAD, self.BAD], "groq": [self.BAD, self.BAD]})
        self.assertFalse(ok)
        self.assertFalse(os.path.exists(os.path.join(self.d, "test_calc.py")))

    def test_skip_marks_are_refused_before_running(self):
        skip = self.GOOD.replace("    def test_add", "    @unittest.skip('x')\n    def test_add")
        ok, brain, calls = self.run_job({"ollama": [skip, self.GOOD]})
        self.assertTrue(ok)
        self.assertIn("Rejected before running", calls[1][1])

    def test_out_must_stay_inside_cwd(self):
        ok, _, _, info = dispatch.run_file_job("x", self.d, "../evil.py", "true", [], ["ollama"], ask_for=lambda b, m: (None, ""))
        self.assertFalse(ok)
        self.assertIn("inside --cwd", info)


class OllamaPick(unittest.TestCase):
    def test_only_installed_models(self):
        self.assertEqual(dispatch.pick_ollama_model(installed=["qwen3:8b", "llama3:latest"]), "qwen3:8b")
        self.assertIsNone(dispatch.pick_ollama_model(installed=["llama3:latest"]))
        self.assertIsNone(dispatch.pick_ollama_model(installed=[]))

    def test_extract_largest_block_without_think(self):
        self.assertEqual(dispatch.extract_file("<think>```x```</think>ok\n```py\nA = 1\n```\n"), "A = 1\n")


class ClaudeBrainsDeny(unittest.TestCase):
    def test_local_and_qwen_get_tool_level_denies(self):
        for brain in ("local", "qwen"):
            cmd, _, _ = dispatch.build(brain, "do x", "Read,Bash", "m")
            deny = cmd[cmd.index("--disallowedTools") + 1]
            for pat in ("Bash(git push:*)", "Bash(git remote:*)", "Bash(gh:*)", "Bash(env:*)"):
                self.assertIn(pat, deny, brain)


if __name__ == "__main__":
    unittest.main()
