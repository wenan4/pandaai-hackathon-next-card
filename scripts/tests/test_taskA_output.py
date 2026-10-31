"""任务 A 产物检查（YOU-152）：标准答案可由数据重算，D 与 A/B/C 不同。"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from pd_common.metrics import compare_to_benchmark, max_drawdown, period_return  # noqa: E402

TASK_PATH = ROOT / "public/data/taskA.json"
CASES_PATH = ROOT / "public/data/cases_reveal.json"


@unittest.skipUnless(TASK_PATH.exists() and CASES_PATH.exists(), "先运行 build_cases.py 和 build_taskA.py")
class TaskAOutput(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.task = json.loads(TASK_PATH.read_text(encoding="utf-8"))
        cls.cases = json.loads(CASES_PATH.read_text(encoding="utf-8"))

    def test_d_differs_from_act1(self):
        abc = {r["source"]["symbol"] for r in self.cases["rounds"]}
        self.assertNotIn(self.task["source"]["symbol"], abc)
        self.assertEqual(sorted(abc), self.task["source"]["excluded"]["symbols"])

    def test_step1_answer_recomputes(self):
        s1 = self.task["step1"]
        self.assertEqual(compare_to_benchmark(s1["aligned"]["asset"], s1["aligned"]["benchmark"]), s1["answer"])
        # 未对齐的两条线按区间收益比较，结论必须与对齐后相同（对齐只改变起点，不改变涨幅）
        self.assertEqual(compare_to_benchmark(s1["unaligned"]["asset"], s1["unaligned"]["benchmark"]), s1["answer"])
        self.assertNotAlmostEqual(s1["unaligned"]["asset"][0], s1["unaligned"]["benchmark"][0], places=1)

    def test_step2_answer_recomputes(self):
        s2 = self.task["step2"]
        r, mdd = period_return(s2["series"]), max_drawdown(s2["series"])
        self.assertAlmostEqual(r, s2["cum_return"], places=4)
        self.assertAlmostEqual(mdd, s2["max_drawdown"], places=4)
        expected = "supports" if r > 0 and mdd < 0.15 else "refutes"
        self.assertEqual(s2["answer"], expected)

    def test_window_lengths(self):
        w = self.task["header"]["windows"]
        self.assertEqual(len(self.task["step1"]["aligned"]["asset"]), w["step1"] + 1)
        self.assertEqual(len(self.task["step2"]["series"]), w["step2"] + 1)


if __name__ == "__main__":
    unittest.main()
