"""dispatch.py の --brain hydrogen（OpenCode + Google AI Studio gemini-4-hydrogen）の単体テスト。
実行: python -m unittest docs/ai-workflows/tools/test_dispatch_hydrogen.py
opencode は起動しない（コマンドの組み立て・順番・失敗の合図だけを見る）。
なぜ要るか: hydrogen は「無料の手伝い役」が前提。既定が同じキーで有料専用の argon に変わると 429 で毎回落ちる。
混雑(503)の返事を成功と読むと、何もしていないのに DONE になる。主力(codex/grok)より前に入ると遅い頭脳が先に走る。"""
import importlib.util, os, unittest

spec = importlib.util.spec_from_file_location("dispatch", os.path.join(os.path.dirname(__file__), "dispatch.py"))
dispatch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatch)


class HydrogenBuild(unittest.TestCase):
    def test_default_is_the_free_hydrogen_model(self):
        cmd, _, model = dispatch.build("hydrogen", "do x", "", None)
        self.assertEqual(model, "google/gemini-4-hydrogen")
        self.assertEqual(cmd[:4], ["opencode", "run", "-m", model])
        self.assertNotIn("argon", model)

    def test_gemini_key_is_handed_to_opencode_under_its_name(self):
        # 2026-11-18 PC: OpenCode 1.18.35 の google は GOOGLE_GENERATIVE_AI_API_KEY しか読まず、5秒で失敗した。
        old = {k: os.environ.pop(k, None) for k in ("GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY")}
        os.environ["GEMINI_API_KEY"] = "test-key"
        try:
            _, env, _ = dispatch.build("hydrogen", "do x", "", None)
            self.assertEqual(env["GOOGLE_GENERATIVE_AI_API_KEY"], "test-key")
        finally:
            for k, v in old.items():
                os.environ.pop(k, None)
                if v is not None:
                    os.environ[k] = v

    def test_in_auto_chain_right_after_grok(self):
        self.assertEqual(dispatch.AUTO_CHAIN.index("hydrogen"), dispatch.AUTO_CHAIN.index("grok") + 1)

    def test_long_timeout_because_one_call_takes_about_a_minute(self):
        self.assertGreaterEqual(dispatch.TIMEOUTS["hydrogen"], 1800)

    def test_helper_never_ahead_of_the_main_brains(self):
        if "hydrogen" in dispatch.AUTO_CHAIN:
            i = dispatch.AUTO_CHAIN.index("hydrogen")
            self.assertGreater(i, dispatch.AUTO_CHAIN.index("codex"))
            self.assertGreater(i, dispatch.AUTO_CHAIN.index("grok"))

    def test_overload_and_quota_fall_through(self):
        for msg in ('{"error": {"code": 503, "message": "The model is overloaded. Please try again later.", "status": "UNAVAILABLE"}}',
                    "RESOURCE_EXHAUSTED"):
            self.assertTrue(any(m in msg for m in dispatch.FAIL_MARKS), msg)

    def test_skipped_without_key(self):
        old = {k: os.environ.pop(k, None) for k in ("GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY")}
        try:
            ok, info, _, _ = dispatch.run_one("hydrogen", "do x", os.getcwd(), "", 1)
            self.assertIsNone(ok)
            self.assertIn("GEMINI_API_KEY", info)
        finally:
            for k, v in old.items():
                if v is not None:
                    os.environ[k] = v


if __name__ == "__main__":
    unittest.main()
