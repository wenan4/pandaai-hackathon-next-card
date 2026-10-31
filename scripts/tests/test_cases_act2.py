"""第二幕 R4–R6（YOU-164）：筛选条件、R6 历史信号的窗口与去重、发布数据的方向翻转。离线运行。"""
import json
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import build_cases as bc  # noqa: E402
import build_cases_act2 as a2  # noqa: E402


def frame(n=800, surge_at=(), drift=0.0):
    days = pd.bdate_range("20200101", periods=n).strftime("%Y%m%d").tolist()
    close = 100.0 * np.cumprod(np.full(n, 1 + drift))
    vol = np.full(n, 1000.0)
    for i in surge_at:
        close[i:] *= 1.06
        vol[i] = 4000.0
    g = pd.DataFrame({"close": close, "open": close, "volume": vol, "amount": 1e6, "trade_status": 0, "limit_up": close * 1.1}, index=days)
    return days, g


class ConditionTests(unittest.TestCase):
    def test_r4_needs_asset_ahead_of_benchmark_by_3pp(self):
        days, g = frame()
        t = days[700]
        g.loc[days[640]:t, "close"] = np.linspace(100, 115, 61)
        bench = pd.Series(100.0, index=days)
        bench.loc[days[640]:t] = np.linspace(100, 111, 61)
        self.assertTrue(a2.check_r4(g, bench, t)["pass"])
        bench.loc[days[640]:t] = np.linspace(100, 113, 61)  # 只高 2pp
        self.assertFalse(a2.check_r4(g, bench, t)["pass_asset_higher_by_3pp"])

    def test_r5_up_overall_but_drawdown_beyond_claim(self):
        days, g = frame()
        t = days[760]
        path = np.concatenate([np.linspace(100, 160, 400), np.linspace(160, 110, 230), np.linspace(110, 170, 100)])
        g.loc[days[760 - bc.WIN_LONG]:t, "close"] = path
        c = a2.check_r5(g, t)
        self.assertGreaterEqual(c["mdd3y"], 0.2)
        self.assertTrue(c["pass"])
        g.loc[days[760 - bc.WIN_LONG]:t, "close"] = np.linspace(100, 150, bc.WIN_LONG + 1)  # 稳步上涨，回撤为 0
        self.assertFalse(a2.check_r5(g, t)["pass_mdd_ge_20pct"])


class SignalHistoryTests(unittest.TestCase):
    def test_signals_need_finished_window_before_t_and_do_not_overlap(self):
        days, g = frame(surge_at=(500, 505, 600, 690))
        table = a2.surge_table(g, set())
        # 505 落在 500 的 20 日观察窗口里，去掉
        self.assertEqual([x["pos"] for x in table], [500, 600, 690])
        t = days[700]
        c = a2.check_r6(g, t, table)
        # 690 之后 20 日到 710，T=700 时还没结束，不计
        self.assertEqual([s["offset"] for s in c["signals"]], [-200, -100])
        self.assertTrue(all(s["offset"] + a2.R6["horizon"] <= 0 for s in c["signals"]))

    def test_r6_needs_3_to_6_signals_with_mixed_outcomes(self):
        days, g = frame(surge_at=(470, 520, 600), drift=0.001)
        g.loc[days[521]:days[540], "close"] *= 0.8  # 第二次之后下跌
        c = a2.check_r6(g, days[700], a2.surge_table(g, set()))
        self.assertEqual((c["n_signals"], c["n_positive"]), (3, 2))
        self.assertTrue(c["pass"])
        days, g = frame(surge_at=(470, 520, 600), drift=0.001)  # 三次之后都上涨：不算参差
        self.assertFalse(a2.check_r6(g, days[700], a2.surge_table(g, set()))["pass_mixed"])
        days, g = frame(surge_at=(470, 600), drift=0.001)
        self.assertFalse(a2.check_r6(g, days[700], a2.surge_table(g, set()))["pass_count_3_to_6"])

    def test_split_in_lookback_is_not_a_signal(self):
        days, g = frame(surge_at=(500,))
        self.assertEqual(a2.surge_table(g, {days[490]}), [])


PUBLISHED = ROOT / "public/data/cases_act2_reveal.json"


@unittest.skipUnless(PUBLISHED.exists(), "先运行 build_cases_act2.py")
class PublishedTests(unittest.TestCase):
    def test_directions_flip_and_symbols_are_new(self):
        act2 = json.loads(PUBLISHED.read_text(encoding="utf-8"))
        act1 = json.loads((ROOT / "public/data/cases_reveal.json").read_text(encoding="utf-8"))
        task_a = json.loads((ROOT / "public/data/taskA.json").read_text(encoding="utf-8"))
        self.assertEqual([r["source"]["evidence_verdict"] for r in act2["rounds"]], ["supports", "refutes", "insufficient"])
        symbols = [r["source"]["symbol"] for r in act1["rounds"] + act2["rounds"]] + [task_a["source"]["symbol"]]
        self.assertEqual(len(set(symbols)), 7)
        visible = json.loads((ROOT / "public/data/cases_act2_visible.json").read_text(encoding="utf-8"))
        self.assertNotIn("symbol", json.dumps(visible))


if __name__ == "__main__":
    unittest.main()
