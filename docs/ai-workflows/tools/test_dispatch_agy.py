"""dispatch.py の --brain agy（Antigravity CLI headless）の単体テスト。実行: python -m unittest docs/ai-workflows/tools/test_dispatch_agy.py
agy は起動しない（コマンドの組み立てと結果の判定だけを見る）。
なぜ要るか: --dangerously-skip-permissions は拒否リストを無視して push まで通した（2026-10-21 PC 実測）。
誰かが「止まるから」と足した瞬間にここで落とす。"""
import importlib.util, os, unittest

spec = importlib.util.spec_from_file_location("dispatch", os.path.join(os.path.dirname(__file__), "dispatch.py"))
dispatch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatch)


class AgyBuild(unittest.TestCase):
    def test_never_skips_permissions(self):
        cmd, _, _ = dispatch.build("agy", "do x", "", None)
        self.assertFalse(any("skip-permissions" in c or "always-approve" in c for c in cmd))

    def test_headless_json_with_default_model(self):
        cmd, _, model = dispatch.build("agy", "do x", "", None)
        self.assertEqual(model, dispatch.AGY_DEFAULT_MODEL)
        self.assertIn("-p", cmd)
        self.assertEqual(cmd[cmd.index("--model") + 1], dispatch.AGY_DEFAULT_MODEL)
        self.assertEqual(cmd[cmd.index("--output-format") + 1], "json")

    def test_task_gets_one_command_per_call_preamble(self):
        cmd, _, _ = dispatch.build("agy", "do x", "", None)
        prompt = cmd[cmd.index("-p") + 1]
        self.assertTrue(prompt.startswith(dispatch.AGY_PREAMBLE) and prompt.endswith("do x"))

    def test_prompt_is_one_line_for_cmd_exe(self):
        # 2026-11-18: cmd.exe cut the prompt at the first newline; the task body and --model never reached agy.
        cmd, _, _ = dispatch.build("agy", "line1\nline2\r\nline3", "", None)
        prompt = cmd[cmd.index("-p") + 1]
        self.assertNotIn("\n", prompt)
        self.assertNotIn("\r", prompt)
        self.assertTrue(prompt.endswith("line3"))

    def test_model_override(self):
        cmd, _, model = dispatch.build("agy", "do x", "", "gemini-4-argon-medium")
        self.assertEqual(model, "gemini-4-argon-medium")
        self.assertIn("gemini-4-argon-medium", cmd)

    def test_not_in_auto_chain(self):
        self.assertNotIn("agy", dispatch.AUTO_CHAIN)  # 有料枠・PC ごとの allow 設定が要るので明示指定のときだけ

    def test_outward_block_applies(self):
        env = {}
        dispatch.block_outward(env)
        self.assertIn("pushInsteadOf", " ".join(v for k, v in env.items() if k.startswith("GIT_CONFIG_KEY_")))


class AgyQuota(unittest.TestCase):
    # 2026-11-12 PC 実測の枠切れの文（全モデル同じ残り時間）。分かっている枠切れで毎回 20 秒使わず、すぐ次の頭脳へ回す。
    OUT = "Individual quota reached for this model. Resets in 76h3m. (429 RESOURCE_EXHAUSTED)"

    def test_pools_are_recorded_separately(self):
        # 2026-11-18 PC: Claude pool 429 while Gemini answered; the Gemini fallback must not be skipped by the Claude record.
        self.assertEqual(dispatch.agy_pool("claude-sonnet-5-5-medium"), "claude")
        self.assertEqual(dispatch.agy_pool("gemini-4-argon-medium"), "gemini")
        self.assertEqual(dispatch.agy_pool(None), "claude")
        self.assertNotEqual(dispatch.agy_quota_file("claude-opus-5-5-medium"), dispatch.agy_quota_file("gemini-4-argon-medium"))

    def test_parse_reset(self):
        self.assertEqual(dispatch.agy_reset_seconds(self.OUT), 76 * 3600 + 3 * 60)
        self.assertEqual(dispatch.agy_reset_seconds("Resets in 45m"), 45 * 60)
        self.assertIsNone(dispatch.agy_reset_seconds("some other error"))

    def test_remember_then_skip_until_reset(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "q.json")
            self.assertEqual(dispatch.agy_quota_wait(now=1000, path=path), 0)  # 記録なし＝止めない
            dispatch.agy_remember_reset(self.OUT, now=1000, path=path)
            self.assertEqual(dispatch.agy_quota_wait(now=1000 + 3600, path=path), 75 * 3600 + 3 * 60)
            self.assertEqual(dispatch.agy_quota_wait(now=1000 + 77 * 3600, path=path), 0)  # 戻ったら通す


class AgyStatus(unittest.TestCase):
    def test_success(self):
        self.assertEqual(dispatch.agy_status('{"status": "SUCCESS", "result": "ok"}'), "SUCCESS")

    def test_last_status_wins(self):
        self.assertEqual(dispatch.agy_status('{"status":"RUNNING"}\n{"status":"ERROR"}'), "ERROR")

    def test_success_with_denied_action_is_detected(self):
        # 2026-10-21 PC 実測の形（status は SUCCESS だが何もしていない）
        out = ('jetski: no output produced \u2014 a tool required the "command" permission that headless mode cannot '
               'prompt for, so it was auto-denied.\n'
               '{"status":"SUCCESS","response":"","num_turns":1,"denied_actions":[{"action":"command","display_name":"RunCommand"}]}')
        self.assertEqual(dispatch.agy_status(out), "SUCCESS")
        self.assertTrue(dispatch.agy_denied(out))
        self.assertTrue(any(m in out for m in dispatch.FAIL_MARKS))

    def test_empty_denied_list_is_fine(self):
        self.assertFalse(dispatch.agy_denied('{"status":"SUCCESS","denied_actions":[]}'))

    def test_claude_pool_exhaustion_falls_back_to_gemini(self):
        out = 'AGY_ERROR: {"status":"RESOURCE_EXHAUSTED","error_code":429}'  # 2026-10-21 PC 実測の形
        self.assertTrue(dispatch.agy_pool_exhausted(out, "claude-opus-5-5-medium"))
        self.assertFalse(dispatch.agy_pool_exhausted(out, "gemini-4-argon-medium"))  # Gemini 側も尽きたらやり直さない
        self.assertFalse(dispatch.agy_pool_exhausted('{"status":"ERROR"}', "claude-opus-5-5-medium"))
        self.assertTrue(dispatch.AGY_FALLBACK_MODEL.startswith("gemini-"))
        # 2026-11-25: Gemini 側のやり直しは Neon（Google が Argon の後継に指定・PC 実測で SUCCESS）。古い Argon に戻さない。
        self.assertTrue(dispatch.AGY_FALLBACK_MODEL.startswith("gemini-4-neon-"))

    def test_no_json_is_none(self):
        self.assertIsNone(dispatch.agy_status("plain text, rc 0"))



class NeonInAutoChain(unittest.TestCase):
    """2026-11-27: Neon on the AI Pro flat fee goes 2nd in auto (after codex), as an alias of agy with a fixed model."""

    def test_right_after_codex(self):
        c = dispatch.AUTO_CHAIN
        self.assertEqual(c.index("neon"), c.index("codex") + 1)
        self.assertLess(c.index("neon"), c.index("grok"))

    def test_alias_is_agy_on_the_gemini_pool(self):
        real, model = dispatch.BRAIN_ALIASES["neon"]
        self.assertEqual(real, "agy")
        self.assertTrue(model.startswith("gemini-4-neon-"))
        self.assertEqual(dispatch.agy_pool(model), "gemini")
        self.assertIn(real, dispatch.TIMEOUTS)

    def test_not_skipped_by_the_claude_pool_record(self):
        # the dashboard's "agy" row follows the Claude pool; a spent Claude pool must not skip Neon
        self.assertNotEqual(dispatch.BRAIN_RECORD_ID.get("neon"), "agy")

    def test_main_runs_agy_with_the_neon_model(self):
        import sys
        from unittest import mock
        calls = []

        def fake_run_one(brain, task, cwd, allowed, timeout, model=None):
            calls.append((brain, model))
            return True, "ok", "done", model

        argv = ["dispatch.py", "--brain", "neon", "--cwd", os.getcwd(), "--verify", "true", "add a unit test for x"]
        with mock.patch.object(dispatch, "run_one", fake_run_one), mock.patch.object(sys, "argv", argv):
            rc = dispatch.main()
        self.assertEqual(rc, 0)
        self.assertEqual(calls, [("agy", dispatch.BRAIN_ALIASES["neon"][1])])


if __name__ == "__main__":
    unittest.main()
