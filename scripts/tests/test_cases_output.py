"""第一幕产物检查（YOU-151）：揭晓前文件不泄露未来与身份，数值可由数据重算。"""
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from pd_common.metrics import max_drawdown, period_return  # noqa: E402

VISIBLE_PATH = ROOT / "public/data/cases_visible.json"
REVEAL_PATH = ROOT / "public/data/cases_reveal.json"


@unittest.skipUnless(VISIBLE_PATH.exists() and REVEAL_PATH.exists(), "先运行 scripts/build_cases.py")
class CasesOutput(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.visible_text = VISIBLE_PATH.read_text(encoding="utf-8")
        cls.visible = json.loads(cls.visible_text)
        cls.reveal = json.loads(REVEAL_PATH.read_text(encoding="utf-8"))
        cls.vis = {r["round_id"]: r for r in cls.visible["rounds"]}
        cls.rev = {r["round_id"]: r for r in cls.reveal["rounds"]}

    def test_visible_has_no_dates(self):
        # 揭晓前文件不含任何真实日期（因此也不可能含 T 日之后的日期）
        self.assertIsNone(re.search(r"(?<!\d)(19|20)\d{2}-?(0[1-9]|1[0-2])-?(0[1-9]|[12]\d|3[01])(?!\d)", self.visible_text))

    def test_visible_has_no_identity(self):
        self.assertIsNone(re.search(r"\d{6}\.(SH|SZ|BJ)", self.visible_text))
        for r in self.rev.values():
            self.assertNotIn(r["source"]["name"], self.visible_text)

    def test_window_lengths(self):
        h = self.reveal["header"]["windows"]
        for r in self.vis.values():
            cards = r["cards"]
            self.assertEqual(len(cards["fox"]["asset"]), h["short"] + 1)
            self.assertEqual(len(cards["fox"]["benchmark"]), h["short"] + 1)
            self.assertEqual(len(cards["elephant"]["series"]), h["long"] + 1)
            for k in ("close", "day_return", "volume_ratio"):
                self.assertEqual(len(cards["leopard"][k]), h["volume"] + 1)
        for r in self.rev.values():
            self.assertEqual(len(r["after"]["close"]), h["after"] + 1)

    def test_reveal_after_decision_date(self):
        for r in self.rev.values():
            src = r["source"]
            t = src["decision_date"]
            self.assertGreater(src["windows"]["after"][0], t)
            for name in ("fox", "elephant", "leopard"):
                self.assertEqual(src["windows"][name][1], t)

    def test_numbers_recompute_from_visible(self):
        for r in self.vis.values():
            fox, ele = r["cards"]["fox"], r["cards"]["elephant"]
            self.assertAlmostEqual(period_return(fox["asset"]), fox["asset_return"], places=4)
            self.assertAlmostEqual(period_return(fox["benchmark"]), fox["benchmark_return"], places=4)
            self.assertAlmostEqual(period_return(ele["series"]), ele["cum_return"], places=4)
            self.assertAlmostEqual(max_drawdown(ele["series"]), ele["max_drawdown"], places=4)

    def test_r1_refutes(self):
        fox = self.vis["R1"]["cards"]["fox"]
        self.assertGreaterEqual(fox["asset_return"], 0.10)
        self.assertGreater(fox["benchmark_return"], fox["asset_return"])
        self.assertEqual(self.rev["R1"]["source"]["evidence_verdict"], "refutes")

    def test_r2_supports(self):
        ele = self.vis["R2"]["cards"]["elephant"]
        self.assertGreater(period_return(ele["series"]), 0)
        self.assertLess(max_drawdown(ele["series"]), 0.15)
        self.assertEqual(self.rev["R2"]["source"]["evidence_verdict"], "supports")

    def test_r3_surge_visible(self):
        leo = self.vis["R3"]["cards"]["leopard"]
        last3 = list(zip(leo["volume_ratio"][-3:], leo["day_return"][-3:]))
        self.assertTrue(any(v is not None and v >= 3 and d is not None and d >= 0.05 for v, d in last3))
        self.assertEqual(self.rev["R3"]["source"]["evidence_verdict"], "insufficient")

    def test_symbols_distinct(self):
        syms = [r["source"]["symbol"] for r in self.rev.values()]
        self.assertEqual(len(set(syms)), 3)

    def test_header_fields(self):
        h = self.reveal["header"]
        for k in ("apis", "pool", "benchmark", "adjustment", "dividends", "timing", "filters", "exclusions",
                  "sample", "script_version", "generated_at", "public_scope", "selection"):
            self.assertIn(k, h)


if __name__ == "__main__":
    unittest.main()
