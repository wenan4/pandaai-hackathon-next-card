"""Task A must stay independent of the published game and export complete charts."""
import contextlib
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import build_taskA as ta  # noqa: E402


class TaskABuilderTests(unittest.TestCase):
    def setUp(self):
        temp_root = ROOT / "scripts" / "out"
        temp_root.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=temp_root)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "public/data").mkdir(parents=True)
        self.days = pd.bdate_range("20200101", periods=1200).strftime("%Y%m%d").tolist()
        self.chosen = {rid: ta.bc.Candidate(rid, symbol, symbol, self.days[i], 9999)
                       for rid, symbol, i in [("R1", "600001.SH", 100),
                                              ("R2", "600002.SH", 101),
                                              ("R3", "600003.SH", 102)]}
        self.d = ta.bc.Candidate("R2", "600004.SH", "D", self.days[760], 100)
        self.e = ta.bc.Candidate("R2", "600005.SH", "E", self.days[761], 90)
        self.industries = {"600001.SH": "801010", "600002.SH": "801020", "600003.SH": "801030",
                           self.d.symbol: "801040", self.e.symbol: "801050"}
        self.groups = {s: pd.DataFrame({"close": np.linspace(100, 160, 1200)}, index=self.days)
                       for s in [*self.industries]}
        self.benchmark = pd.Series(np.linspace(100, 120, 1200), index=self.days)
        self.cands = {"R1": [self.chosen["R1"]], "R2": [self.d, self.e], "R3": []}
        self.published = {
            "header": {"rules_version": ta.bc.RULES_VERSION, "script_version": "cases-fixture",
                       "data_as_of": self.days[-1]},
            "rounds": [{"round_id": rid, "source": {"symbol": c.symbol, "name": c.name, "decision_date": c.t}}
                       for rid, c in self.chosen.items()],
        }
        self.game_path = self.root / "public/data/cases_reveal.json"
        self.task_path = self.root / "public/data/taskA.json"
        self.save_game()
        self.task_path.write_text("previous valid artifact", encoding="utf-8")

    def save_game(self):
        self.game_path.write_text(json.dumps(self.published), encoding="utf-8")

    def industry(self, _membership, symbol, _date):
        return self.industries.get(symbol)

    def pick(self):
        with patch.object(ta.data, "industry_on", side_effect=self.industry):
            return ta.pick_d(self.cands, self.chosen, pd.DataFrame(), self.days, self.groups, self.benchmark)

    def build(self, scan_hook=None):
        result = (self.cands, {}, self.groups, self.benchmark, [], {})
        def scan(**kwargs):
            self.assertEqual(kwargs, {"include_r3": False})
            if scan_hook:
                scan_hook()
            return result
        with patch.object(ta, "REPO_ROOT", self.root), \
             patch.object(ta.bc, "scan", side_effect=scan), \
             patch.object(ta.bc, "pick", side_effect=AssertionError("Must not repick the published game")), \
             patch.object(ta.data, "industry_membership", return_value=pd.DataFrame()), \
             patch.object(ta.data, "industry_on", side_effect=self.industry), \
             patch.object(ta.data, "last_trade_date", return_value=self.days[-1]), \
             contextlib.redirect_stdout(io.StringIO()):
            ta.build()
        return json.loads(self.task_path.read_text(encoding="utf-8"))

    def test_build_binds_the_published_game_not_new_candidates(self):
        # An old game symbol becomes the highest-liquidity otherwise eligible candidate.
        old_symbol = ta.bc.Candidate("R1", "600001.SH", "A", self.days[760], 10000)
        self.cands["R1"] = [old_symbol]
        task = self.build()
        self.assertEqual(task["source"]["symbol"], self.d.symbol)
        self.assertEqual(task["source"]["excluded"]["symbols"], sorted(c.symbol for c in self.chosen.values()))
        binding = task["header"]["game_cases"]
        canonical = json.dumps(self.published, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        self.assertEqual(binding["sha256"], hashlib.sha256(canonical.encode("utf-8")).hexdigest())
        self.assertEqual(binding["hash_format"], "canonical-json-utf8")
        self.assertEqual(binding["script_version"], "cases-fixture")

    def test_unknown_candidate_industry_is_skipped(self):
        for missing in (None, "", "nan", "<NA>"):
            with self.subTest(missing=missing):
                self.industries[self.d.symbol] = missing
                self.assertIs(self.pick(), self.e)

    def test_all_unknown_candidates_give_no_match(self):
        self.industries[self.d.symbol] = None
        self.industries[self.e.symbol] = None
        self.assertIsNone(self.pick())

    def test_unknown_published_industry_stops_generation(self):
        self.industries["600001.SH"] = None
        with self.assertRaises(ValueError):
            self.build()
        self.assertEqual(self.task_path.read_text(), "previous valid artifact")

    def test_missing_long_benchmark_anchor_falls_back_to_valid_candidate(self):
        self.benchmark.loc[self.days[760 - ta.bc.WIN_LONG]] = np.nan
        task = self.build()
        self.assertEqual(task["source"]["symbol"], self.e.symbol)
        for state in ("aligned", "unaligned"):
            for key in ("asset", "benchmark"):
                values = task["step1"][state][key]
                self.assertEqual(len(values), ta.bc.WIN_SHORT + 1)
                self.assertTrue(np.isfinite(values).all())

    def test_incomplete_benchmark_cannot_overwrite_the_previous_artifact(self):
        self.benchmark.loc[self.days[500]] = np.nan
        with self.assertRaises(SystemExit):
            self.build()
        self.assertEqual(self.task_path.read_text(), "previous valid artifact")

    def test_non_positive_long_benchmark_is_rejected(self):
        for invalid in (0.0, -1.0, np.inf):
            with self.subTest(invalid=invalid):
                self.benchmark.loc[self.days[500]] = invalid
                self.assertIsNone(self.pick())

    def test_calendar_mismatch_is_rejected(self):
        self.groups[self.d.symbol] = self.groups[self.d.symbol].drop(self.days[500])
        self.assertIs(self.pick(), self.e)

    def test_missing_published_file_does_not_start_a_scan(self):
        self.game_path.unlink()
        with patch.object(ta, "REPO_ROOT", self.root), patch.object(ta.bc, "scan") as scan:
            with self.assertRaises(FileNotFoundError):
                ta.build()
            scan.assert_not_called()

    def test_rules_version_mismatch_is_rejected(self):
        self.published["header"]["rules_version"] = "different-rules"
        self.save_game()
        with patch.object(ta, "REPO_ROOT", self.root), self.assertRaises(ValueError):
            ta.load_published_cases()

    def test_duplicate_published_rounds_are_rejected(self):
        self.published["rounds"][2] = self.published["rounds"][1]
        self.save_game()
        with patch.object(ta, "REPO_ROOT", self.root), self.assertRaises(ValueError):
            ta.load_published_cases()

    def test_changed_published_file_during_scan_preserves_old_artifact(self):
        def change_file():
            self.published["header"]["data_as_of"] = "changed"
            self.save_game()
        with self.assertRaises(ValueError):
            self.build(scan_hook=change_file)
        self.assertEqual(self.task_path.read_text(), "previous valid artifact")

    def test_game_fingerprint_ignores_formatting_and_platform_newlines(self):
        def reformat():
            text = json.dumps(self.published, indent=2).replace("\n", "\r\n")
            self.game_path.write_bytes(text.encode("utf-8"))
        task = self.build(scan_hook=reformat)
        self.assertEqual(task["header"]["game_cases"]["sha256"], ta.game_fingerprint(self.published))

    def test_120_day_gap_is_checked_against_published_dates(self):
        for c, position in zip(self.chosen.values(), (900, 901, 902)):
            c.t = self.days[position]
        self.d.t = self.days[1021]  # 119 days from the nearest published case.
        self.e.t = self.days[1022]  # Exactly 120 days.
        self.assertIs(self.pick(), self.e)


if __name__ == "__main__":
    unittest.main()
