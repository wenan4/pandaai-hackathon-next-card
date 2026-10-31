"""Regression coverage for chronological dates in SDK probe reports."""
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import pd_probe  # noqa: E402


class ProbeDateOrderTests(unittest.TestCase):
    def test_pre_adjust_reports_oldest_and_latest_matching_prices(self):
        raw = pd.DataFrame({
            "date": ["20261030", "20220104"],
            "close": [1392.05, 2051.23],
            "volume": [10, 20],
        })
        adjusted = pd.DataFrame({
            "date": ["20220104", "20261030"],
            "close": [1772.94, 1392.05],
            "volume": [20, 10],
        })
        sdk = Mock()
        sdk.get_stock_daily.return_value = raw
        sdk.get_stock_daily_pre.return_value = adjusted
        sdk.get_adj_factor.return_value = pd.DataFrame()

        with patch.object(pd_probe, "pd_", sdk):
            report = pd_probe.p_pre_adjust()

        for symbol in ("600519.SH", "000001.SZ"):
            with self.subTest(symbol=symbol):
                result = report[symbol]
                self.assertEqual(result["first_date"], "20220104")
                self.assertEqual(result["last_date"], "20261030")
                self.assertEqual(result["first_close_raw"], 2051.23)
                self.assertEqual(result["first_close_pre"], 1772.94)
                self.assertEqual(result["last_close_raw"], 1392.05)
                self.assertEqual(result["last_close_pre"], 1392.05)
                self.assertTrue(result["volume_identical"])

    def test_segmented_span_reports_full_chronological_bounds(self):
        sdk = Mock()
        sdk.get_stock_daily.side_effect = RuntimeError("request span exceeds limit")
        sdk.get_stock_daily_pre.side_effect = [
            pd.DataFrame({"date": ["20221230", "20190102"]}),
            pd.DataFrame({"date": ["20261030", "20230103"]}),
        ]
        sdk.get_trade_cal.return_value = pd.DataFrame({
            "nature_date": ["20190102", "20221230", "20230103", "20261030"],
        })

        with patch.object(pd_probe, "pd_", sdk):
            result = pd_probe.p_span_limit()["segmented"]

        self.assertEqual(result["first"], "20190102")
        self.assertEqual(result["last"], "20261030")
        self.assertEqual(result["rows"], 4)
        self.assertEqual(result["trading_days"], 4)

    def test_index_bounds_do_not_depend_on_sdk_row_order(self):
        sdk = Mock()
        sdk.get_index_daily.return_value = pd.DataFrame({
            "date": ["20261030", "20231030", "20250102"],
            "close": [130, 100, 110],
        })

        with patch.object(pd_probe, "pd_", sdk):
            report = pd_probe.p_index()

        for symbol, result in report.items():
            with self.subTest(symbol=symbol):
                self.assertEqual(result["first"], "20231030")
                self.assertEqual(result["last"], "20261030")


if __name__ == "__main__":
    unittest.main()
