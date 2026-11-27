"""dispatch.py が全部の「手を動かす頭脳」に同じ短い前置き（AGENTS.md を読む・push しない・合否のコマンド）を渡すかの単体テスト。
実行: python -m unittest docs/ai-workflows/tools/test_dispatch_brief.py
なぜ要るか: 頭脳ごとに読む指示ファイルが違い（Codex・Antigravity・OpenCode は AGENTS.md、Claude Code CLI は CLAUDE.md、
Grok Build は不明）、キットの決まりが届かない頭脳があった（2026-11-27）。前置きを1か所で足せば、どの頭脳にも同じ入口が届く。"""
import importlib.util, os, unittest

spec = importlib.util.spec_from_file_location("dispatch", os.path.join(os.path.dirname(__file__), "dispatch.py"))
dispatch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatch)


class Brief(unittest.TestCase):
    def test_agent_brains_get_the_map_pointer_and_the_verify_command(self):
        for brain in ("codex", "agy", "grok", "hydrogen", "sakura", "oc", "qwen", "local"):
            t = dispatch.brief_task(brain, "do x", "npm test")
            self.assertIn("AGENTS.md", t, brain)
            self.assertIn("never push", t, brain)
            self.assertIn("npm test", t, brain)
            self.assertTrue(t.endswith("Task: do x"), brain)

    def test_without_verify_the_command_line_is_left_out(self):
        self.assertNotIn("Done means", dispatch.brief_task("codex", "do x", None))

    def test_text_brains_get_the_task_unchanged(self):
        for brain in dispatch.TEXT_BRAINS:
            self.assertEqual(dispatch.brief_task(brain, "do x", "npm test"), "do x")

    def test_brief_is_short(self):
        # トークン節約: 前置きは地図への入口だけ。決まりの本文は AGENTS.md に置く。
        self.assertLess(len(dispatch.brief_task("codex", "", "npm test")), 600)

    def test_run_one_passes_the_brief_to_build(self):
        src = open(os.path.join(os.path.dirname(__file__), "dispatch.py"), encoding="utf-8").read()
        self.assertIn("build(brain, brief_task(brain, task, VERIFY_CMD)", src)


if __name__ == "__main__":
    unittest.main()
