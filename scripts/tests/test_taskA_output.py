"""任务 A 产物检查（YOU-152）：标准答案可由数据重算，D 与 A/B/C 不同。"""
import json
import hashlib
import math
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
        self.assertEqual(sorted(r["source"]["decision_date"] for r in self.cases["rounds"]),
                         self.task["source"]["excluded"]["decision_dates"])

    def test_game_binding_matches_published_artifact(self):
        binding = self.task["header"]["game_cases"]
        self.assertEqual(binding["file"], CASES_PATH.name)
        canonical = json.dumps(self.cases, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        self.assertEqual(binding["sha256"], hashlib.sha256(canonical.encode("utf-8")).hexdigest())
        self.assertEqual(binding["hash_format"], "canonical-json-utf8")
        for key in ("script_version", "rules_version", "data_as_of"):
            self.assertEqual(binding[key], self.cases["header"][key])

    def test_industries_are_known_and_distinct(self):
        source = self.task["source"]
        self.assertTrue(source["sw_l1"])
        self.assertTrue(source["excluded"]["industries"])
        self.assertTrue(all(source["excluded"]["industries"]))
        self.assertNotIn(source["sw_l1"], source["excluded"]["industries"])

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
        for state in ("aligned", "unaligned"):
            for key in ("asset", "benchmark"):
                values = self.task["step1"][state][key]
                self.assertEqual(len(values), w["step1"] + 1)
                self.assertTrue(all(math.isfinite(v) and v > 0 for v in values))
        self.assertEqual(len(self.task["step2"]["series"]), w["step2"] + 1)


if __name__ == "__main__":
    unittest.main()
