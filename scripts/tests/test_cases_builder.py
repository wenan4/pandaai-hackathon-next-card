"""Exercise the case generator with missing dates and suspended sessions, offline."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import build_cases as bc  # noqa: E402


def market_fixture():
    days = pd.bdate_range("20200101", periods=800).strftime("%Y%m%d").tolist()
    t = days[760]
    frame = pd.DataFrame({
        "symbol": "600001.SH", "name": "fixture", "date": days,
        "close": 90.0, "open": 90.0, "volume": 100.0,
        "amount": 10000.0, "trade_status": 0, "limit_up": 999.0,
    }).set_index("date")
    frame.loc[days[700]:days[760], "close"] = np.linspace(100, 112, 61)
    frame.loc[days[761]:, "close"] = 126.0
    frame.loc[days[761]:, "open"] = 112.0
    benchmark = pd.Series(110.0, index=days, name="close")
    benchmark.loc[days[700]] = 100.0
    benchmark.loc[days[760]] = 120.0
    return days, t, frame, benchmark


def scan_fixture(days, t, frame, benchmark):
    loaded = (days, [t], {t: ["600001.SH"]}, frame.reset_index(),
              benchmark.rename_axis("date").reset_index(),
              pd.DataFrame(columns=["symbol", "date", "close"]),
              pd.DataFrame(columns=["symbol", "ex_factor", "ex_date"]))
    with patch.object(bc, "load", return_value=loaded), \
         patch.object(bc.data, "industry_membership", return_value=pd.DataFrame()):
        return bc.scan()


class CalendarAndExecutionTests(unittest.TestCase):
    def test_complete_candidate_uses_identical_screen_and_export_returns(self):
        days, t, frame, benchmark = market_fixture()
        candidates, *_ = scan_fixture(days, t, frame, benchmark)
        candidate = candidates["R1"][0]
        visible, _ = bc.export_round(candidate, frame, benchmark)
        self.assertAlmostEqual(candidate.checks["r60"], visible["cards"]["fox"]["asset_return"])
        self.assertAlmostEqual(candidate.checks["bench_r60"], visible["cards"]["fox"]["benchmark_return"])

    def test_missing_comparison_date_cannot_reverse_the_exported_verdict(self):
        days, t, frame, benchmark = market_fixture()
        frame.loc[days[699], "close"] = 100.0
        benchmark.loc[days[699]] = 200.0
        frame = frame.drop(days[750])
        self.assertIsNone(bc.check_r1(frame, benchmark, t))
        candidate = bc.Candidate("R1", "600001.SH", "fixture", t, 10000)
        with self.assertRaisesRegex(ValueError, "incomplete_comparison_window"):
            bc.export_round(candidate, frame, benchmark)

    def test_missing_older_history_is_not_compressed_into_729_days(self):
        days, t, frame, benchmark = market_fixture()
        candidates, stats, *_ = scan_fixture(days, t, frame.drop(days[500]), benchmark)
        self.assertFalse(any(candidates.values()))
        self.assertEqual(stats["excluded_records"]["incomplete_history"], 1)

    def test_missing_future_date_does_not_shift_t_plus_20(self):
        days, t, frame, benchmark = market_fixture()
        candidates, stats, *_ = scan_fixture(days, t, frame.drop(days[770]), benchmark)
        self.assertFalse(any(candidates.values()))
        self.assertEqual(stats["excluded_records"]["incomplete_reveal_window"], 1)

    def test_suspended_entry_is_excluded_from_scan_and_export(self):
        days, t, frame, benchmark = market_fixture()
        frame.loc[days[761], ["trade_status", "volume", "close"]] = [1, 0, 112.0]
        candidates, stats, *_ = scan_fixture(days, t, frame, benchmark)
        self.assertFalse(any(candidates.values()))
        self.assertEqual(stats["excluded_records"]["entry_suspended_or_missing"], 1)
        candidate = bc.Candidate("R1", "600001.SH", "fixture", t, 10000)
        with self.assertRaisesRegex(ValueError, "entry_suspended_or_missing"):
            bc.export_round(candidate, frame, benchmark)

    def test_missing_entry_price_is_excluded(self):
        days, t, frame, benchmark = market_fixture()
        frame.loc[days[761], "open"] = np.nan
        candidates, stats, *_ = scan_fixture(days, t, frame, benchmark)
        self.assertFalse(any(candidates.values()))
        self.assertEqual(stats["excluded_records"]["invalid_entry_price"], 1)

    def test_unknown_status_and_volume_is_not_normal_trading(self):
        _, _, frame, _ = market_fixture()
        frame.loc[frame.index[-1], ["trade_status", "volume"]] = np.nan
        grouped = bc.by_symbol(frame.reset_index())
        self.assertEqual(grouped["600001.SH"]["trade_status"].iloc[-1], 1)


class VolumeWindowTests(unittest.TestCase):
    def setUp(self):
        self.days = pd.bdate_range("20260101", periods=26).strftime("%Y%m%d").tolist()
        self.frame = pd.DataFrame({"close": 100.0, "volume": 100.0, "trade_status": 0}, index=self.days)
        self.frame.loc[self.days[:5], "volume"] = 1000.0
        self.frame.loc[self.days[5:10], ["trade_status", "volume"]] = [1, 0.0]
        self.frame.loc[self.days[25], ["close", "volume"]] = [106.0, 400.0]

    def test_twenty_non_suspended_days_prevent_false_surge(self):
        self.assertEqual(bc.surge_days(self.frame, self.days[-1], set()), [])
        self.assertAlmostEqual(bc.volume_ratios(self.frame, 25, 1)[0], 400 / 325, places=4)

    def test_surge_and_chart_share_the_same_volume_reference(self):
        self.frame.loc[self.days[-1], "volume"] = 2000.0
        surge = bc.surge_days(self.frame, self.days[-1], set())[-1]
        self.assertAlmostEqual(surge["vol_ratio"], bc.volume_ratios(self.frame, 25, 1)[0], places=4)

    def test_extended_lookback_also_extends_split_exclusion(self):
        self.frame.loc[self.days[-1], "volume"] = 2000.0
        self.assertTrue(bc.surge_days(self.frame, self.days[-1], set()))
        self.assertEqual(bc.surge_days(self.frame, self.days[-1], {self.days[2]}), [])

    def test_insufficient_non_suspended_history_has_no_ratio(self):
        short = self.frame.iloc[1:]
        self.assertIsNone(bc.volume_ratios(short, len(short) - 1, 1)[0])
        self.assertEqual(bc.surge_days(short, self.days[-1], set()), [])

    def test_missing_volume_has_no_ratio(self):
        self.frame.loc[self.days[10], "volume"] = np.nan
        self.assertIsNone(bc.volume_ratios(self.frame, 25, 1)[0])

    def test_one_row_has_no_surge_or_index_error(self):
        tiny = self.frame.iloc[:1]
        self.assertEqual(bc.surge_days(tiny, tiny.index[0], set()), [])


if __name__ == "__main__":
    unittest.main()
