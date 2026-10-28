"""dispatch.py の --brain muse（OpenCode Zen + Meta Muse Spark）の単体テスト。実行: python -m unittest docs/ai-workflows/tools/test_dispatch_muse.py
opencode は起動しない（コマンドの組み立て・順番・失敗の合図だけを見る）。
なぜ要るか: muse は「無料」が前提で順番の2番目に置いている。既定のモデルが有料版に変わったり、Zen の枠切れの返事を
成功と読んだりすると、気づかないまま課金されるか、何もしていないのに DONE になる。"""
import importlib.util, os, unittest

spec = importlib.util.spec_from_file_location("dispatch", os.path.join(os.path.dirname(__file__), "dispatch.py"))
dispatch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatch)


class MuseBuild(unittest.TestCase):
    def test_default_is_the_free_zen_model(self):
        cmd, _, model = dispatch.build("muse", "do x", "", None)
        self.assertEqual(model, "opencode/muse-spark-1.3-contributor-free")
        self.assertEqual(cmd[:4], ["opencode", "run", "-m", model])

    def test_model_override_for_paid_fallback(self):
        _, _, model = dispatch.build("muse", "do x", "", "openrouter/meta/muse-spark-1.3-contributor")
        self.assertEqual(model, "openrouter/meta/muse-spark-1.3-contributor")

    def test_second_in_auto_chain(self):
        self.assertEqual(dispatch.AUTO_CHAIN[:2], ["grok", "muse"])
        self.assertIn("muse", dispatch.TIMEOUTS)

    def test_zen_failures_fall_through(self):
        for msg in ("FreeUsageLimitError", "Upstream request failed: Model is unavailable."):
            self.assertTrue(any(m in msg for m in dispatch.FAIL_MARKS), msg)


if __name__ == "__main__":
    unittest.main()
