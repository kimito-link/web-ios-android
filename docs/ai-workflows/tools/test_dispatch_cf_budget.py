"""dispatch.py の Cloudflare 予算ガード(cf_over_budget)の単体テスト。実行: python -m unittest docs/ai-workflows/tools/test_dispatch_cf_budget.py
ネットワークには出ない(fetch を差し替える)。"""
import datetime, importlib.util, json, os, unittest

spec = importlib.util.spec_from_file_location("dispatch", os.path.join(os.path.dirname(__file__), "dispatch.py"))
dispatch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatch)

UTC = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 19, 12, 0, tzinfo=UTC)


def rec(updated="2026-10-19T10:00:00Z", over=61975, used=71975, has_gauge=True):
    gauges = [{"label": "x", "over": over, "used": used}] if has_gauge else []
    return json.dumps({"updatedAt": updated, "brains": [{"id": "grok"}, {"id": "cf", "gauges": gauges}]})


def check(raw, now=NOW):
    return dispatch.cf_over_budget(now=now, fetch=lambda u: raw)


class CfBudget(unittest.TestCase):
    def setUp(self):
        os.environ.pop("CF_ALLOW_OVERAGE", None)

    def test_over_today_is_blocked_with_reason(self):
        r = check(rec())
        self.assertIsNotNone(r)
        self.assertIn("71,975", r)

    def test_not_over_passes(self):
        self.assertIsNone(check(rec(over=0, used=3000)))

    def test_stale_record_is_ignored(self):
        self.assertIsNone(check(rec(updated="2026-10-18T23:00:00Z")))  # 前日(UTC)は信用しない

    def test_record_older_than_12h_same_day_is_ignored(self):
        now = datetime.datetime(2026, 10, 19, 20, 0, tzinfo=UTC)
        self.assertIsNone(check(rec(updated="2026-10-19T05:00:00Z"), now=now))

    def test_missing_gauge_or_broken_json_does_not_block(self):
        self.assertIsNone(check(rec(has_gauge=False)))
        self.assertIsNone(check("not json"))

    def test_fetch_failure_does_not_block(self):
        def boom(u):
            raise OSError("down")
        self.assertIsNone(dispatch.cf_over_budget(now=NOW, fetch=boom))

    def test_env_override_passes(self):
        os.environ["CF_ALLOW_OVERAGE"] = "1"
        self.assertIsNone(check(rec()))


if __name__ == "__main__":
    unittest.main()
