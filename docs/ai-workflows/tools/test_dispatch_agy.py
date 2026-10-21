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


class AgyStatus(unittest.TestCase):
    def test_success(self):
        self.assertEqual(dispatch.agy_status('{"status": "SUCCESS", "result": "ok"}'), "SUCCESS")

    def test_last_status_wins(self):
        self.assertEqual(dispatch.agy_status('{"status":"RUNNING"}\n{"status":"ERROR"}'), "ERROR")

    def test_no_json_is_none(self):
        self.assertIsNone(dispatch.agy_status("plain text, rc 0"))


if __name__ == "__main__":
    unittest.main()
