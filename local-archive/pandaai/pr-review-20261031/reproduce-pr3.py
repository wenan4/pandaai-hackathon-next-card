"""Offline reproductions against PR #3; no credentials or live data calls."""
from pathlib import Path
import json
import sys
from unittest.mock import patch

import pandas as pd

ROOT = Path(__file__).resolve().parent / "pr3"
sys.path.insert(0, str(ROOT / "scripts"))
import build_cases as bc


def frames(missing_date=False, suspended_entry=False):
    days = pd.bdate_range("20200101", periods=800).strftime("%Y%m%d").tolist()
    t = days[760]
    g = pd.DataFrame({
        "symbol": "600001.SH", "name": "fixture", "date": days,
        "close": 90.0, "open": 90.0, "volume": 100.0,
        "amount": 10000.0, "trade_status": 0, "limit_up": 999.0,
    }).set_index("date")
    start = 699 if missing_date else 700
    g.loc[days[start]:days[760], "close"] = [100 + 12 * i / (760 - start) for i in range(761 - start)]
    g.loc[days[761]:, "close"] = 126.0
    g.loc[days[761]:, "open"] = 112.0
    benchmark = pd.Series(110.0, index=days, name="close")
    benchmark.loc[days[700]] = 100.0
    benchmark.loc[days[760]] = 120.0
    if missing_date:
        g = g.drop(days[750])
        benchmark.loc[days[699]] = 200.0
    if suspended_entry:
        g.loc[days[761], ["trade_status", "volume", "close"]] = [1, 0, 112.0]
    return days, t, g, benchmark


days, t, g, benchmark = frames(missing_date=True)
checks = bc.check_r1(g, benchmark, t)
candidate = bc.Candidate("R1", "600001.SH", "fixture", t, 10000.0, checks)
visible, reveal = bc.export_round(candidate, g, benchmark)
fox = visible["cards"]["fox"]
assert checks["pass"] and fox["asset_return"] > fox["benchmark_return"]
print(json.dumps({"case": "missing_date_reverses_verdict", "screen_benchmark_return": checks["bench_r60"],
                  "export_benchmark_return": fox["benchmark_return"], "asset_return": fox["asset_return"],
                  "export_verdict": reveal["source"]["evidence_verdict"]}))

idx = pd.bdate_range("20260101", periods=26).strftime("%Y%m%d").tolist()
g = pd.DataFrame({"close": 100.0, "volume": 100.0, "trade_status": 0}, index=idx)
g.loc[idx[:5], "volume"] = 1000.0
g.loc[idx[5:10], ["trade_status", "volume"]] = [1, 0.0]
g.loc[idx[25], ["close", "volume"]] = [106.0, 400.0]
actual = bc.surge_days(g, idx[25], set())
expected_avg = g.iloc[:25].loc[lambda x: x["trade_status"] == 0, "volume"].tail(20).mean()
assert actual[-1]["vol_ratio"] >= 3 and 400 / expected_avg < 3
print(json.dumps({"case": "suspensions_change_volume_denominator", "reported_ratio": actual[-1]["vol_ratio"],
                  "ratio_using_20_non_suspended_days": 400 / expected_avg,
                  "exported_ratio": bc.volume_ratios(g, 25, 1)[-1]}))

days, t, g, benchmark = frames(suspended_entry=True)
px = g.reset_index()
bench = benchmark.rename_axis("date").reset_index()
sectors = pd.DataFrame(columns=["symbol", "date", "close"])
adj = pd.DataFrame(columns=["symbol", "ex_factor", "ex_date"])
with patch.object(bc, "load", return_value=(days, [t], {t: ["600001.SH"]}, px, bench, sectors, adj)), \
     patch.object(bc.data, "industry_membership", return_value=pd.DataFrame()):
    candidates, *_ = bc.scan()
assert len(candidates["R1"]) == 1
_, reveal = bc.export_round(candidates["R1"][0], g, benchmark)
assert reveal["after"]["return_open_t1_to_close_t20"] > 0
print(json.dumps({"case": "suspended_entry_is_selected_and_settled", "entry_trade_status": int(g.iloc[g.index.get_loc(t) + 1]["trade_status"]),
                  "selected": True, "reported_trade_return": reveal["after"]["return_open_t1_to_close_t20"]}))
