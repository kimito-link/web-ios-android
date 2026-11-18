"""dispatch.py の --brain sakura（OpenCode + さくらのAI Engine）の単体テスト。
実行: python -m unittest docs/ai-workflows/tools/test_dispatch_sakura.py
なぜ要るか: さくらの無償プランは「上限で止まる(429)」のが採用理由。429 を成功と読むと何もせず DONE になる。
鍵を設定文やコマンドに直接書くと、ログや画面に鍵が残る。"""
import importlib.util, json, os, unittest

spec = importlib.util.spec_from_file_location("dispatch", os.path.join(os.path.dirname(__file__), "dispatch.py"))
dispatch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatch)


class SakuraBuild(unittest.TestCase):
    def setUp(self):
        self.old = os.environ.get("SAKURA_AI_ENGINE_TOKEN")
        os.environ["SAKURA_AI_ENGINE_TOKEN"] = "uuid:secret-test"

    def tearDown(self):
        os.environ.pop("SAKURA_AI_ENGINE_TOKEN", None)
        if self.old is not None:
            os.environ["SAKURA_AI_ENGINE_TOKEN"] = self.old

    def test_default_model_and_inline_provider(self):
        cmd, env, model = dispatch.build("sakura", "do x", "", None)
        self.assertEqual(model, "sakura/preview/DeepSeek-V4.1-Flash-1017")
        self.assertEqual(cmd[:4], ["opencode", "run", "-m", model])
        conf = json.loads(env["OPENCODE_CONFIG_CONTENT"])
        p = conf["provider"]["sakura"]
        self.assertEqual(p["options"]["baseURL"], "https://api.ai.sakura.ad.jp/v1")
        self.assertIn("preview/DeepSeek-V4.1-Flash-1017", p["models"])

    def test_token_never_inlined(self):
        cmd, env, _ = dispatch.build("sakura", "do x", "", None)
        self.assertNotIn("secret-test", env["OPENCODE_CONFIG_CONTENT"])
        self.assertNotIn("secret-test", " ".join(cmd))

    def test_other_model_by_flag(self):
        _, env, model = dispatch.build("sakura", "do x", "", "sakura/preview/GLM-5.3-Flash")
        self.assertIn("preview/GLM-5.3-Flash", json.loads(env["OPENCODE_CONFIG_CONTENT"])["provider"]["sakura"]["models"])

    def test_monthly_cap_falls_through(self):
        msg = "APICallError: 429 Too Many Requests"
        self.assertTrue(any(m in msg for m in dispatch.FAIL_MARKS))

    def test_skipped_without_token(self):
        os.environ.pop("SAKURA_AI_ENGINE_TOKEN", None)
        ok, info, _, _ = dispatch.run_one("sakura", "do x", os.getcwd(), "", 1)
        self.assertIsNone(ok)
        self.assertIn("SAKURA_AI_ENGINE_TOKEN", info)


class SakuraChain(unittest.TestCase):
    def test_after_hydrogen_before_paid_or_overage_brains(self):
        c = dispatch.AUTO_CHAIN
        self.assertEqual(c.index("sakura"), c.index("hydrogen") + 1)
        self.assertLess(c.index("sakura"), c.index("cf"))
        self.assertLess(c.index("sakura"), c.index("glm"))
