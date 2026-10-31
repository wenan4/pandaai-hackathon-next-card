"""Python 口径与 TS 口径一致性测试：读取与 src/engine/metrics.test.ts 相同的用例。"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from pd_common.metrics import compare_to_benchmark, max_drawdown, normalize, period_return  # noqa: E402

CASES = json.loads((ROOT / "src/engine/fixtures/metrics_cases.json").read_text())["cases"]


class SharedMetricsCases(unittest.TestCase):
    def test_cases(self):
        for c in CASES:
            with self.subTest(c["name"]):
                fn = c["fn"]
                if fn in ("periodReturn", "maxDrawdown"):
                    got = (period_return if fn == "periodReturn" else max_drawdown)(c["series"])
                    if c["expected"] is None:
                        self.assertIsNone(got)
                    else:
                        self.assertAlmostEqual(got, c["expected"], places=9)
                elif fn == "normalize":
                    got = normalize(c["series"])
                    self.assertEqual(len(got), len(c["expected"]))
                    for g, e in zip(got, c["expected"]):
                        self.assertAlmostEqual(g, e, places=9)
                elif fn == "compareToBenchmark":
                    self.assertEqual(compare_to_benchmark(c["asset"], c["benchmark"]), c["expected"])
                else:
                    self.fail(f"未知 fn: {fn}")


if __name__ == "__main__":
    unittest.main()
