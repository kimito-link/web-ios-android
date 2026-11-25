"""dispatch.py の「記録上つかえない頭脳を auto で飛ばす」(brain_unavailable)の単体テスト。
実行: python -m unittest docs/ai-workflows/tools/test_dispatch_brain_skip.py  ネットワークには出ない(fetch を差し替える)。"""
import datetime, importlib.util, json, os, unittest

spec = importlib.util.spec_from_file_location("dispatch", os.path.join(os.path.dirname(__file__), "dispatch.py"))
dispatch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatch)

NOW = datetime.datetime(2026, 11, 25, 12, 0, tzinfo=datetime.timezone.utc)


def rec(updated="2026-11-25T10:00:00Z", **status):
    return json.dumps({"updatedAt": updated, "brains": [{"id": k, "status": v, "statusLabel": "x"} for k, v in status.items()]})


def check(brain, raw, now=NOW):
    return dispatch.brain_unavailable(brain, now=now, fetch=lambda u: raw)


class BrainSkip(unittest.TestCase):
    def test_quota_and_down_are_skipped(self):
        self.assertIn("quota", check("grok", rec(grok="quota")))
        self.assertIn("down", check("local", rec(local="down")))

    def test_ok_and_degraded_are_tried(self):
        self.assertIsNone(check("grok", rec(grok="ok")))
        self.assertIsNone(check("hydrogen", rec(hydrogen="degraded")))

    def test_qwen_and_oc_read_the_alibaba_row(self):
        self.assertIsNotNone(check("qwen", rec(alibaba="quota")))
        self.assertIsNotNone(check("oc", rec(alibaba="quota")))

    def test_unknown_brain_is_tried(self):
        self.assertIsNone(check("codex", rec(grok="quota")))

    def test_old_record_is_not_trusted(self):
        self.assertIsNone(check("grok", rec(updated="2026-11-25T05:00:00Z", grok="quota")))

    def test_broken_record_is_not_trusted(self):
        self.assertIsNone(check("grok", "not json"))
        self.assertIsNone(dispatch.brain_unavailable("grok", now=NOW, fetch=lambda u: (_ for _ in ()).throw(OSError("offline"))))


if __name__ == "__main__":
    unittest.main()
