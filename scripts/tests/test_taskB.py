"""任务 B（YOU-153、YOU-166）：共用判定、三个主题的信号与不重叠规则、口径检查能抓到反例。"""
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
    # [n_records, primary_metric]；少写一项表示字段不存在
    def group(pair):
        return dict(zip(("n_records", "primary_metric"), pair))
    out = {}
    for seg in ("display", "test"):
        out[seg] = {grp: group(case[seg][key]) for grp, key in (("signal_group", "signal"), ("baseline_group", "baseline"))}
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


def month_frame(n, drift=0.001, start="20200102", nan_at=()):
    days = pd.bdate_range(start, periods=n).strftime("%Y%m%d").tolist()
    close = 10.0 * np.cumprod(np.full(n, 1 + drift))
    df = pd.DataFrame({"date": days, "open": close.copy(), "close": close, "volume": 1000.0,
                       "trade_status": 0.0, "limit_up": close * 1.1})
    for i in nan_at:
        df.loc[i, "close"] = np.nan
    return days, df


class ElephantTests(unittest.TestCase):
    def test_month_end_candidates_need_full_250_day_history(self):
        days, df = month_frame(700)
        g = tb.prepare(df, days)
        rows, cov = tb.candidates_elephant(g, days, (days[0], days[-1]))
        ends = {days[i] for i in tb.month_ends(days)}
        self.assertTrue(rows and all(r["t"] in ends for r in rows))
        self.assertTrue(all(days.index(r["t"]) - days.index(r["lookback_from"]) == 250 for r in rows))
        self.assertGreater(cov["history_incomplete"], 0)  # 前 250 天的月末没有完整回看
        first = rows[0]
        self.assertTrue(first["signal"])  # 稳步上涨：累计收益 > 0，回撤为 0
        self.assertEqual(days.index(first["exit"]) - days.index(first["t"]), 250)
        late = [r for r in rows if days.index(r["t"]) + 250 > len(days) - 1]
        self.assertTrue(late and all(r["excluded"] == "window_crosses_segment" for r in late))

    def test_drawdown_of_15pct_is_not_a_signal_and_gaps_are_not_filled(self):
        days, df = month_frame(700)
        df.loc[300:, ["open", "close"]] *= 0.84  # 跌 16%
        df.loc[300:, "limit_up"] *= 0.84
        g = tb.prepare(df, days)
        rows, _ = tb.candidates_elephant(g, days, (days[0], days[-1]))
        hit = [r for r in rows if days.index(r["lookback_from"]) < 300 <= days.index(r["t"])]
        self.assertTrue(hit and not any(r["signal"] for r in hit))
        days, df = month_frame(700, nan_at=(400,))
        rows, cov = tb.candidates_elephant(tb.prepare(df, days), days, (days[0], days[-1]))
        self.assertFalse(any(days.index(r["lookback_from"]) <= 400 <= days.index(r["t"]) for r in rows))

    def test_one_record_per_symbol_after_non_overlap_in_two_year_segment(self):
        days, df = month_frame(700)
        rows, _ = tb.candidates_elephant(tb.prepare(df, days), days, (days[260], days[-1]))
        kept, ex = tb.select(rows, "baseline_group")
        self.assertEqual(len(kept), 1)
        self.assertGreater(ex["overlap"], 0)


class FoxTests(unittest.TestCase):
    def setUp(self):
        self.days, stock = month_frame(130, drift=0.002, start="20201102")
        _, bench = month_frame(130, drift=0.001, start="20201102")
        self.g = tb.prepare(stock, self.days)
        self.bench = bench.set_index("date")

    def test_signal_is_last_month_vs_index_and_result_is_excess_return(self):
        days = self.days
        rows, cov = tb.candidates_fox(self.g, days, self.bench, ("20210101", days[-1]))
        self.assertTrue(rows and all(r["signal"] for r in rows))  # 个股每月都比指数涨得多
        r = rows[0]
        self.assertEqual(r["entry"][:6], "202101")
        self.assertEqual(days.index(r["entry"]) - days.index(r["t"]), 1)
        self.assertNotEqual(r["t"][:6], r["entry"][:6])
        self.assertEqual(r["exit"], max(d for d in days if d[:6] == "202101"))
        self.assertAlmostEqual(r["ret"], r["asset_ret"] - r["bench_ret"], places=6)
        self.assertGreater(r["ret"], 0)
        self.assertEqual(cov["prior_month_close_missing"], 0)

    def test_index_beating_stock_is_baseline_only_when_it_lags(self):
        days = self.days
        rows, _ = tb.candidates_fox(self.g, days, self.bench.assign(close=self.bench["close"] * np.linspace(1, 1.5, len(days))),
                                    ("20210101", days[-1]))
        self.assertFalse(any(r["signal"] for r in rows))
        sig, _ = tb.select(rows, "signal_group")
        base, ex = tb.select(rows, "baseline_group")
        self.assertEqual(sig, [])
        self.assertEqual(len(base), len([r for r in rows if "excluded" not in r]))
        self.assertEqual(ex["overlap"], 0)  # 自然月持有期天然不重叠


def checker_case(topic):
    rec_path = ROOT / f"scripts/out/taskB_{topic}_records.json"
    pub_path = ROOT / f"public/data/taskB_{topic}.json"
    if not (rec_path.exists() and pub_path.exists()):
        return None, None
    return json.loads(rec_path.read_text(encoding="utf-8")), json.loads(pub_path.read_text(encoding="utf-8"))


class MonthlyCheckerTests(unittest.TestCase):
    def test_published_elephant_and_fox_pass(self):
        for topic in ("elephant", "fox"):
            rec, pub = checker_case(topic)
            if rec is None:
                self.skipTest("先运行 build_taskB.py --topic " + topic)
            with self.subTest(topic):
                self.assertEqual(ck.run_checks(rec, pub), [])

    def test_elephant_signal_and_horizon_violations_fail(self):
        rec, pub = checker_case("elephant")
        if rec is None:
            self.skipTest("先运行 build_taskB.py --topic elephant")
        r = next(r for r in rec["records"] if r["group"] == "signal_group")
        bad = copy.deepcopy(rec)
        next(x for x in bad["records"] if x == r)["lb_mdd"] = 0.2
        self.assertTrue(any("信号条件" in p for p in ck.run_checks(bad, pub)))
        bad = copy.deepcopy(rec)
        x = next(x for x in bad["records"] if x == r)
        x["exit"] = bad["calendar"][bad["calendar"].index(x["exit"]) - 1]
        self.assertTrue(any("T+250" in p for p in ck.run_checks(bad, pub)))

    def test_fox_plain_return_instead_of_excess_fails(self):
        rec, pub = checker_case("fox")
        if rec is None:
            self.skipTest("先运行 build_taskB.py --topic fox")
        bad = copy.deepcopy(rec)
        x = next(x for x in bad["records"] if abs(x["bench_ret"]) > 0.01)
        x["ret"] = x["asset_ret"]
        self.assertTrue(any("超额收益" in p for p in ck.run_checks(bad, pub)))
        bad = copy.deepcopy(rec)
        x = bad["records"][0]
        x["exit"] = bad["calendar"][bad["calendar"].index(x["exit"]) - 1]
        self.assertTrue(any("持有月最后一个交易日" in p for p in ck.run_checks(bad, pub)))

    def test_metric_must_match_topic(self):
        rec, pub = checker_case("fox")
        if rec is None:
            self.skipTest("先运行 build_taskB.py --topic fox")
        pub = copy.deepcopy(pub)
        pub["header"]["primary_metric"]["id"] = "share_positive_return"
        self.assertTrue(any("主指标口径" in p for p in ck.run_checks(rec, pub)))


if __name__ == "__main__":
    unittest.main()
