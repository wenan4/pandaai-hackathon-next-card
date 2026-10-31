"""任务 B（YOU-153）：共用判定、信号与不重叠规则、口径检查能抓到反例。"""
import copy
import json
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import build_taskB as tb  # noqa: E402
import check_taskB as ck  # noqa: E402
from pd_common.taskb import comparison, verdict  # noqa: E402

CASES = json.loads((ROOT / "src/engine/fixtures/taskB_verdict_cases.json").read_text(encoding="utf-8"))
PUBLISHED = ROOT / "public/data/taskB_cheetah.json"


def as_data(case):
    out = {}
    for seg in ("display", "test"):
        out[seg] = {grp: {"n_records": case[seg][key][0], "primary_metric": case[seg][key][1]}
                    for grp, key in (("signal_group", "signal"), ("baseline_group", "baseline"))}
    return out


class VerdictTests(unittest.TestCase):
    def test_shared_cases(self):
        for case in CASES["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(verdict(as_data(case), CASES["thresholds"]), case["expected"])

    def test_comparison_exact_margin_and_missing(self):
        self.assertEqual(comparison(0.6, 0.55, 0.05), (0.05, True))
        self.assertEqual(comparison(None, 0.5, 0.05), (None, None))


def frame(n=80, surge_at=(), split_at=(), suspend_at=()):
    days = pd.bdate_range("20210104", periods=n).strftime("%Y%m%d").tolist()
    close = np.full(n, 10.0)
    vol = np.full(n, 1000.0)
    for i in surge_at:
        close[i:] *= 1.06
        vol[i] = 2500.0
    df = pd.DataFrame({"date": days, "open": close.copy(), "close": close, "volume": vol,
                       "trade_status": 0.0, "limit_up": close * 1.1})
    for i in suspend_at:
        df.loc[i, ["volume", "trade_status"]] = [0.0, 1.0]
    return days, df, {days[i] for i in split_at}


class SignalTests(unittest.TestCase):
    def rows(self, seg_end_index=None, **kw):
        days, df, splits = frame(**kw)
        g = tb.prepare(df, days)
        seg = (days[0], days[seg_end_index if seg_end_index is not None else -1])
        return days, tb.candidates(g, days, splits, seg)

    def test_signal_needs_20_prior_days_and_excludes_trigger_day_from_average(self):
        days, (rows, cov) = self.rows(surge_at=(30,))
        self.assertEqual(cov["no_volume_reference"], 20)
        sig = [r for r in rows if r["signal"]]
        self.assertEqual([r["t"] for r in sig], [days[30]])
        self.assertEqual(sig[0]["vol_ratio"], 2.5)
        self.assertEqual(sig[0]["entry"], days[31])
        self.assertEqual(sig[0]["exit"], days[50])

    def test_window_crossing_segment_end_is_excluded(self):
        days, (rows, _) = self.rows(surge_at=(30,), seg_end_index=45)
        sig = [r for r in rows if r["signal"]]
        self.assertEqual(sig[0]["excluded"], "window_crosses_segment")

    def test_split_in_lookback_and_suspended_exit(self):
        _, (rows, cov) = self.rows(surge_at=(30,), split_at=(25,))
        self.assertFalse(any(r["signal"] for r in rows))
        self.assertGreater(cov["split_in_lookback"], 0)
        _, (rows, _) = self.rows(surge_at=(30,), suspend_at=(50,))
        self.assertEqual([r.get("excluded") for r in rows if r["signal"]], ["exit_unavailable"])

    def test_non_overlap_keeps_earliest_then_strictly_after_exit(self):
        rows = [{"t": "20210105", "entry": "20210106", "exit": "20210201"},
                {"t": "20210110", "entry": "20210111", "exit": "20210205"},
                {"t": "20210201", "entry": "20210201", "exit": "20210301"},
                {"t": "20210202", "entry": "20210202", "exit": "20210302"}]
        kept, dropped = tb.keep_non_overlapping(rows)
        self.assertEqual([r["t"] for r in kept], ["20210105", "20210202"])
        self.assertEqual(dropped, 2)

    def test_baseline_is_not_filtered_by_signal(self):
        _, (rows, _) = self.rows(n=120, surge_at=(30,))
        sig, _ = tb.select(rows, "signal_group")
        base, ex = tb.select(rows, "baseline_group")
        self.assertEqual(len(sig), 1)
        self.assertGreater(len(base), len(sig))
        self.assertGreater(ex["overlap"], 0)


@unittest.skipUnless(PUBLISHED.exists() and (ROOT / "scripts/out/taskB_cheetah_records.json").exists(),
                     "先运行 build_taskB.py")
class CheckerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rec = json.loads((ROOT / "scripts/out/taskB_cheetah_records.json").read_text(encoding="utf-8"))
        cls.pub = json.loads(PUBLISHED.read_text(encoding="utf-8"))

    def test_published_data_passes(self):
        self.assertEqual(ck.run_checks(self.rec, self.pub), [])

    def test_cross_segment_window_fails(self):
        rec = copy.deepcopy(self.rec)
        r = next(r for r in rec["records"] if r["segment"] == "display")
        i = max(k for k, d in enumerate(rec["calendar"]) if d <= rec["segments"]["display"][1])
        r["t"], r["inputs_through"] = rec["calendar"][i - 5], rec["calendar"][i - 5]
        r["entry"], r["exit"] = rec["calendar"][i - 4], rec["calendar"][i + 15]
        self.assertTrue(any("越过分段" in p for p in ck.run_checks(rec, self.pub)))

    def test_overlap_fails(self):
        rec = copy.deepcopy(self.rec)
        r = next(r for r in rec["records"] if r["group"] == "signal_group")
        rec["records"].append({**r, "t": r["entry"], "inputs_through": r["entry"],
                               "entry": rec["calendar"][rec["calendar"].index(r["entry"]) + 1],
                               "exit": rec["calendar"][rec["calendar"].index(r["entry"]) + 20]})
        self.assertTrue(any("重叠" in p for p in ck.run_checks(rec, self.pub)))

    def test_tampered_summary_fails(self):
        pub = copy.deepcopy(self.pub)
        pub["test"]["signal_group"]["primary_metric"] = 0.99
        self.assertTrue(ck.run_checks(self.rec, pub))


if __name__ == "__main__":
    unittest.main()
