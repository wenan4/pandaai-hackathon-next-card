"""Offline PR #4 reproductions. Never calls the live SDK."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

import numpy as np
import pandas as pd

root = Path(__file__).resolve().parent / "pr4"
sys.path.insert(0, str(root / "scripts"))
import build_taskA as ta
bc = ta.bc

days = pd.bdate_range("20200101", periods=800).strftime("%Y%m%d").tolist()
chosen = {rid: bc.Candidate(rid, symbol, symbol, days[i], 2000) for rid, symbol, i in
          [("R1", "600002.SH", 100), ("R2", "600003.SH", 101), ("R3", "600004.SH", 102)]}
unknown = bc.Candidate("R2", "600005.SH", "unknown", days[760], 1000)
known = bc.Candidate("R2", "600006.SH", "known", days[760], 900)
industries = {"600002.SH": "I1", "600003.SH": "I2", "600004.SH": "I3", "600006.SH": "I4"}
with patch.object(ta.data, "industry_on", side_effect=lambda m, s, t: industries.get(s)):
    selected = ta.pick_d({"R1": [], "R2": [unknown, known]}, chosen, pd.DataFrame(), days)
assert selected is unknown
print(json.dumps({"case": "unknown_industry_accepted_as_distinct", "selected": selected.symbol,
                  "industry": industries.get(selected.symbol)}))


def run_build(missing_benchmark_start=False):
    d = bc.Candidate("R2", "600001.SH", "fixture D", days[760], 1000)
    cands = {"R1": [chosen["R1"]], "R2": [chosen["R2"], d], "R3": [chosen["R3"]]}
    g = pd.DataFrame({"close": np.linspace(100, 160, 800)}, index=days)
    benchmark = pd.Series(np.linspace(100, 120, 800), index=days)
    if missing_benchmark_start:
        benchmark.loc[days[760 - bc.WIN_LONG]] = np.nan
    industry = {**industries, d.symbol: "I4"}
    with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as tmp:
        dest = Path(tmp)
        (dest / "public/data").mkdir(parents=True)
        # This is the game already published on disk; a later scan now picks different ABC.
        actual_game = ["600001.SH", "600007.SH", "600008.SH"]
        (dest / "public/data/cases_reveal.json").write_text(json.dumps({
            "rounds": [{"source": {"symbol": s}} for s in actual_game]}), encoding="utf-8")
        with patch.object(ta, "REPO_ROOT", dest), \
             patch.object(bc, "scan", return_value=(cands, {}, {d.symbol: g}, benchmark, [], {})), \
             patch.object(ta.data, "industry_membership", return_value=pd.DataFrame()), \
             patch.object(ta.data, "industry_on", side_effect=lambda m, s, t: industry.get(s)), \
             patch.object(ta.data, "last_trade_date", return_value=days[-1]), \
             contextlib.redirect_stdout(io.StringIO()):
            ta.build()
        return json.loads((dest / "public/data/taskA.json").read_text(encoding="utf-8")), actual_game

task, actual_game = run_build()
assert task["source"]["symbol"] in actual_game
assert task["source"]["excluded"]["symbols"] != sorted(actual_game)
print(json.dumps({"case": "new_scan_ignores_frozen_game", "task_symbol": task["source"]["symbol"],
                  "already_in_game": True, "excluded_in_metadata": task["source"]["excluded"]["symbols"]}))

task, _ = run_build(missing_benchmark_start=True)
assert len(task["step1"]["unaligned"]["benchmark"]) == 0
assert len(task["step1"]["aligned"]["benchmark"]) == 61
assert task["step1"]["answer"] == "outperform"
print(json.dumps({"case": "missing_long_benchmark_anchor_exports_empty_chart", "unaligned_benchmark_points": 0,
                  "aligned_benchmark_points": 61, "answer": task["step1"]["answer"]}))
