"""dispatch.py の --brain codex（OpenAI Codex CLI）の単体テスト。実行: python -m unittest docs/ai-workflows/tools/test_dispatch_codex.py
codex は起動しない（コマンドの組み立て・順番・失敗の合図・push 止めだけを見る）。
なぜ要るか: Codex は Claude の週間上限と別の財布（ChatGPT の定額）で動く「手を動かす係」の先頭。
既定モデルが外れる（PC の config.toml の既定は ChatGPT ログインで model_not_found）・安全装置を外すフラグが
混ざる・push 止めが Codex の環境変数フィルタで消える、のどれかが起きると、黙って失敗するか、勝手に push される。"""
import importlib.util, os, shlex, subprocess, tempfile, unittest

spec = importlib.util.spec_from_file_location("dispatch", os.path.join(os.path.dirname(__file__), "dispatch.py"))
dispatch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatch)


class CodexBuild(unittest.TestCase):
    def test_pins_a_chatgpt_login_model(self):
        cmd, _, model = dispatch.build("codex", "do x", "", None)
        self.assertEqual(model, "gpt-5.6-sol")
        self.assertEqual(cmd[:4], ["codex", "exec", "-m", "gpt-5.6-sol"])

    def test_sandbox_stays_on(self):
        cmd, _, _ = dispatch.build("codex", "do x", "", None)
        self.assertIn("workspace-write", cmd)
        for bad in ("--dangerously-bypass-approvals-and-sandbox", "danger-full-access", "--yolo"):
            self.assertNotIn(bad, cmd)

    def test_first_in_auto_chain(self):
        # 2026-11-12: Claude の週枠を空けるため、定額で別財布の Codex を先頭に置く。
        self.assertEqual(dispatch.AUTO_CHAIN[0], "codex")
        self.assertIn("codex", dispatch.TIMEOUTS)

    def test_codex_failures_fall_through(self):
        for msg in ('{"error":{"code":"model_not_found"}}', "You've hit your usage limit. Try again at 13:07."):
            self.assertTrue(any(m in msg for m in dispatch.FAIL_MARKS), msg)


class PushBlockSurvivesEnvFilter(unittest.TestCase):
    def test_git_config_parameters_alone_blocks_push(self):
        # Codex は名前に KEY を含む環境変数（GIT_CONFIG_KEY_n）を落としてからコマンドを打つ。
        # それが落ちても GIT_CONFIG_PARAMETERS だけで push 先が潰れることを、本物の git で確かめる。
        env = {}
        dispatch.block_outward(env)
        filtered = {k: v for k, v in env.items() if not any(w in k.upper() for w in ("KEY", "TOKEN", "SECRET"))}
        self.assertIn("GIT_CONFIG_PARAMETERS", filtered)
        run_env = dict(os.environ, **filtered)
        for k in [k for k in run_env if k.startswith("GIT_CONFIG_KEY_") or k.startswith("GIT_CONFIG_VALUE_") or k == "GIT_CONFIG_COUNT"]:
            run_env.pop(k)
        with tempfile.TemporaryDirectory() as d:
            subprocess.run(["git", "init", "-q", d], check=True)
            r = subprocess.run(["git", "-C", d, "config", "--get-regexp", "pushinsteadof"], env=run_env, capture_output=True, text=True)
            self.assertIn("no-push-from-dispatch", r.stdout)


if __name__ == "__main__":
    unittest.main()
