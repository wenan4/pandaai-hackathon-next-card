"""第一幕 R1–R3 案例筛选与导出（YOU-151）。

    .venv/bin/python scripts/build_cases.py

产物：
- public/data/cases_visible.json  揭晓前可见：T 日收盘及以前，只有相对日期（T-60 … T），没有真实日期和代码
- public/data/cases_reveal.json   揭晓后：T+1 … T+20 的走势，以及 source 块（真实代码、日期、条件检查）
- scripts/out/candidates_report.md 所有候选及条件数值（不入库）
- docs/cases-report.md            选中案例的条件检查摘要（入库）

筛选只用 T 日及以前的数据；同一轮多个候选时按 T 日前 60 日平均成交额最高者自动选取，不参考 T 之后的走势。
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pd_common import data  # noqa: E402
from pd_common.client import REPO_ROOT  # noqa: E402
from pd_common.metrics import max_drawdown, normalize, period_return  # noqa: E402

SCRIPT_VERSION = "cases-0.1.2"
RULES_VERSION = "v0.3"
DATA_SCHEMA_ID = "next-card/data@v0.3"  # contracts/common.ts

# ---------------------------------------------------------------- 冻结参数（筛选前固定）
BENCHMARK = ("000300.SH", "沪深300")          # R1 指定基准，命题里写明
POOLS = ["000300.SH", "000905.SH"]             # 点时股票池：沪深300 + 中证500
T_START, T_END = "20231101", "20260930"        # 候选决策日范围（T+20 需落在数据内）
T_STEP = 5                                     # 每 5 个交易日取一个候选决策日
WIN_SHORT = 60                                 # “前 60 个交易日”
WIN_LONG = 729                                 # “前约 3 年” ≈ 3 × 243 个交易日
WIN_VOL = 20                                   # 量价卡：近 20 日
WIN_AFTER = 20                                 # 揭晓：T+1 … T+20
HISTORY_START = "20200101"                     # 为 3 年回看留足历史

R1 = dict(min_r60=0.10, require_bench_higher=True, min_r3y=0.0)
R2 = dict(r60_range=(0.0, 0.05), min_r3y=0.0, max_mdd3y=0.15)
R3 = dict(vol_mult=3.0, min_day_ret=0.05, trigger_within=3, max_abs_r3y=0.15,
          max_bench_day_ret=0.02, max_sector_day_ret=0.02, split_factor=1.1)

# 申万一级 → 中证全指一级行业指数（申万行业指数行情取不到，见 docs/data-feasibility.md）
SW_TO_CSI = {
    "801010": "000990.SH", "801030": "000987.SH", "801040": "000987.SH", "801050": "000987.SH",
    "801080": "000993.SH", "801110": "000989.SH", "801120": "000990.SH", "801130": "000989.SH",
    "801140": "000989.SH", "801150": "000991.SH", "801160": "000995.SH", "801170": "000988.SH",
    "801180": "000992.SH", "801200": "000989.SH", "801210": "000989.SH", "801230": "000988.SH",
    "801710": "000987.SH", "801720": "000988.SH", "801730": "000988.SH", "801740": "000988.SH",
    "801750": "000993.SH", "801760": "000994.SH", "801770": "000994.SH", "801780": "000992.SH",
    "801790": "000992.SH", "801880": "000989.SH", "801890": "000988.SH", "801950": "000986.SH",
    "801960": "000986.SH", "801970": "000988.SH", "801980": "000990.SH",
}
CSI_NAMES = {
    "000986.SH": "全指能源", "000987.SH": "全指材料", "000988.SH": "全指工业", "000989.SH": "全指可选",
    "000990.SH": "全指消费", "000991.SH": "全指医药", "000992.SH": "金融地产", "000993.SH": "全指信息",
    "000994.SH": "全指通信", "000995.SH": "全指公用",
}

CLAIMS = {
    "R1": f"过去这 60 个交易日，A 的涨幅高于这张卡指定的市场基准（{BENCHMARK[1]}）。",
    "R2": "过去三年，B 总体上涨，而且从阶段高点往下最多跌了不到 15%。",
    "R3": "20 个交易日后，C 的收盘价会高于今天。",
}
VERDICTS = {"R1": "refutes", "R2": "supports", "R3": "insufficient"}
LABELS = {"R1": "A", "R2": "B", "R3": "C"}

OUT_DIR = REPO_ROOT / "scripts" / "out"
DATA_DIR = REPO_ROOT / "public" / "data"


@dataclass
class Candidate:
    round_id: str
    symbol: str
    name: str
    t: str
    liquidity: float
    checks: dict = field(default_factory=dict)


# ---------------------------------------------------------------- 取数

def load():
    days = data.trade_days(HISTORY_START, data.last_trade_date())
    t_days = [d for d in days if T_START <= d <= T_END][::T_STEP]
    pools = {t: sorted({s for p in POOLS for s in data.index_members(p, t)}) for t in t_days}
    universe = sorted({s for members in pools.values() for s in members})
    end = days[-1]
    px = data.stock_daily(universe, HISTORY_START, end, adjusted=True)
    bench = data.index_daily([BENCHMARK[0]], HISTORY_START, end)
    sectors = data.index_daily(list(CSI_NAMES), HISTORY_START, end)
    adj = data.adj_events(universe, HISTORY_START, end)
    return days, t_days, pools, px, bench, sectors, adj


def by_symbol(px: pd.DataFrame, calendar=None) -> dict[str, pd.DataFrame]:
    px = px.copy()
    # 约 1.2% 的行 trade_status 为空：有成交量视为正常交易（0），否则视为停牌（1）
    px["trade_status"] = px["trade_status"].fillna((~(px["volume"] > 0)).astype(int)).astype(int)
    groups = {s: g.set_index("date").sort_index() for s, g in px.groupby("symbol")}
    # 保留缺失交易日为空值，不向前填充或把下一条记录当作下一交易日。
    return {s: g.reindex(calendar) if calendar is not None else g for s, g in groups.items()}


def series_window(close: pd.Series, t: str, back: int) -> list[float] | None:
    """以 t 为终点、往前 back 个交易日的收盘序列（共 back+1 个点）。不足时返回 None。"""
    if t not in close.index:
        return None
    i = close.index.get_loc(t)
    if i < back:
        return None
    values = close.iloc[i - back : i + 1]
    if not np.isfinite(values).all() or not (values > 0).all():
        return None
    return values.tolist()


def comparison_window(g, bench_close, t):
    """筛选和导出共用完全相同的日期与价格窗口。"""
    asset = series_window(g["close"], t, WIN_SHORT)
    benchmark = series_window(bench_close, t, WIN_SHORT)
    if asset is None or benchmark is None:
        return None
    i, j = g.index.get_loc(t), bench_close.index.get_loc(t)
    if not g.index[i - WIN_SHORT:i + 1].equals(bench_close.index[j - WIN_SHORT:j + 1]):
        return None
    return asset, benchmark


def case_data_error(g, bench_close, t):
    """完整交易日窗口及执行日检查；返回可记录的排除原因。"""
    if comparison_window(g, bench_close, t) is None:
        return "incomplete_comparison_window"
    i, j = g.index.get_loc(t), bench_close.index.get_loc(t)
    if series_window(g["close"], t, WIN_LONG) is None or j < WIN_LONG:
        return "incomplete_history"
    if not g.index[i - WIN_LONG:i + 1].equals(bench_close.index[j - WIN_LONG:j + 1]):
        return "incomplete_history"
    if i + WIN_AFTER >= len(g) or j + WIN_AFTER >= len(bench_close):
        return "incomplete_reveal_window"
    if not g.index[i:i + WIN_AFTER + 1].equals(bench_close.index[j:j + WIN_AFTER + 1]):
        return "incomplete_reveal_window"
    after = g["close"].iloc[i:i + WIN_AFTER + 1]
    if not np.isfinite(after).all() or not (after > 0).all():
        return "incomplete_reveal_window"
    entry = g.iloc[i + 1]
    if entry["trade_status"] != 0 or not entry["volume"] > 0:
        return "entry_suspended_or_missing"
    if not np.isfinite(entry["open"]) or entry["open"] <= 0:
        return "invalid_entry_price"
    return None


def volume_reference(g, j):
    """触发日前最近 20 个非停牌日；不足或数值缺失时不生成量比。"""
    if j < 0 or j >= len(g):
        return None
    row = g.iloc[j]
    if row["trade_status"] != 0 or not np.isfinite(row["volume"]) or row["volume"] <= 0:
        return None
    previous = g.iloc[:j]
    volumes = previous.loc[previous["trade_status"] == 0, "volume"].tail(WIN_VOL)
    if len(volumes) != WIN_VOL or not np.isfinite(volumes).all() or not (volumes > 0).all():
        return None
    return volumes


# ---------------------------------------------------------------- 条件

def check_r1(g, bench_close, t):
    paired = comparison_window(g, bench_close, t)
    s3y = series_window(g["close"], t, WIN_LONG)
    if paired is None or s3y is None:
        return None
    s60, b60 = paired
    r60, b_r60, r3y = period_return(s60), period_return(b60), period_return(s3y)
    c = {
        "r60": r60, "bench_r60": b_r60, "r3y": r3y,
        "pass_r60_ge_10pct": r60 is not None and r60 >= R1["min_r60"],
        "pass_bench_higher": None not in (r60, b_r60) and b_r60 > r60,
        "pass_r3y_up": r3y is not None and r3y > R1["min_r3y"],
    }
    c["pass"] = c["pass_r60_ge_10pct"] and c["pass_bench_higher"] and c["pass_r3y_up"]
    return c


def check_r2(g, t):
    s60 = series_window(g["close"], t, WIN_SHORT)
    s3y = series_window(g["close"], t, WIN_LONG)
    if not (s60 and s3y):
        return None
    r60, r3y, mdd = period_return(s60), period_return(s3y), max_drawdown(s3y)
    lo, hi = R2["r60_range"]
    c = {
        "r60": r60, "r3y": r3y, "mdd3y": mdd,
        "pass_r60_in_0_5pct": r60 is not None and lo <= r60 <= hi,
        "pass_r3y_up": r3y is not None and r3y > R2["min_r3y"],
        "pass_mdd_lt_15pct": mdd is not None and mdd < R2["max_mdd3y"],
    }
    c["pass"] = c["pass_r60_in_0_5pct"] and c["pass_r3y_up"] and c["pass_mdd_lt_15pct"]
    return c


def surge_days(g: pd.DataFrame, t: str, adj_dates: set[str]):
    """T 及之前 trigger_within 个交易日内的放量上涨日。均量只用触发日之前、非停牌的 20 日。"""
    idx = g.index
    if t not in idx:
        return []
    i = idx.get_loc(t)
    out = []
    for j in range(i - R3["trigger_within"] + 1, i + 1):
        prev_vol = volume_reference(g, j)
        if prev_vol is None:
            continue
        row = g.iloc[j]
        # 停牌可能扩大回看跨度，除权检查也必须覆盖扩展后的整个区间。
        window_dates = set(idx[(idx >= prev_vol.index[0]) & (idx <= idx[j])])
        if window_dates & adj_dates:  # 回看窗口内有送转除权，量比不可信
            continue
        avg = prev_vol.mean()
        ret = row["close"] / g.iloc[j - 1]["close"] - 1
        if avg > 0 and row["volume"] >= R3["vol_mult"] * avg and ret >= R3["min_day_ret"]:
            out.append({"date": idx[j], "vol_ratio": row["volume"] / avg, "day_ret": ret})
    return out


def check_r3_basic(g, t, adj_dates):
    s3y = series_window(g["close"], t, WIN_LONG)
    if not s3y:
        return None
    surges = surge_days(g, t, adj_dates)
    r3y = period_return(s3y)
    c = {
        "r3y": r3y,
        "surges": surges,
        "pass_surge": bool(surges),
        "pass_range_bound": r3y is not None and abs(r3y) <= R3["max_abs_r3y"],
    }
    c["pass_basic"] = c["pass_surge"] and c["pass_range_bound"]
    return c


def day_ret(close: pd.Series, d: str) -> float | None:
    if d not in close.index:
        return None
    i = close.index.get_loc(d)
    return None if i == 0 else close.iloc[i] / close.iloc[i - 1] - 1


# ---------------------------------------------------------------- 主流程

def scan(*, include_r3: bool = True):
    days, t_days, pools, px, bench, sectors, adj = load()
    groups = by_symbol(px, days)
    bench_close = bench.set_index("date")["close"].reindex(days)
    sector_close = {s: g.set_index("date")["close"].reindex(days) for s, g in sectors.groupby("symbol")}
    split_dates = {
        s: set(g.loc[g["ex_factor"] >= R3["split_factor"], "ex_date"].astype(str))
        for s, g in adj.groupby("symbol")
    }

    cands: dict[str, list[Candidate]] = {"R1": [], "R2": [], "R3": []}
    stats = {r: {"evaluated": 0, "passed": 0} for r in cands}
    stats["excluded_records"] = {}
    for t in t_days:
        for s in pools[t]:
            g = groups.get(s)
            if g is None or t not in g.index or g.loc[t, "trade_status"] != 0:
                continue
            i = g.index.get_loc(t)
            error = case_data_error(g, bench_close, t)
            if error:
                stats["excluded_records"][error] = stats["excluded_records"].get(error, 0) + 1
                continue
            liq = float(g["amount"].iloc[max(0, i - WIN_SHORT + 1) : i + 1].mean())
            name = str(g["name"].iloc[i])
            for rid, fn in (("R1", lambda: check_r1(g, bench_close, t)), ("R2", lambda: check_r2(g, t))):
                c = fn()
                if c is None:
                    continue
                stats[rid]["evaluated"] += 1
                if c["pass"]:
                    stats[rid]["passed"] += 1
                    cands[rid].append(Candidate(rid, s, name, t, liq, c))
            if include_r3:
                c = check_r3_basic(g, t, split_dates.get(s, set()))
                if c is not None:
                    stats["R3"]["evaluated"] += 1
                    if c["pass_basic"]:
                        cands["R3"].append(Candidate("R3", s, name, t, liq, c))

    # R3 的行业 / 基准条件：申万一级归属用当前分类（接口不提供历史归属，见 docs/data-feasibility.md）
    membership = data.industry_membership("L1") if include_r3 else None
    r3 = []
    for cand in cands["R3"]:
        trig = cand.checks["surges"][-1]["date"]
        l1 = data.industry_on(membership, cand.symbol, cand.t)
        sec = SW_TO_CSI.get(l1 or "")
        b = day_ret(bench_close, trig)
        sr = day_ret(sector_close[sec], trig) if sec in sector_close else None
        cand.checks.update({
            "trigger_date": trig, "sw_l1": l1, "sector_index": sec, "bench_day_ret": b, "sector_day_ret": sr,
            "pass_bench_quiet": b is not None and b < R3["max_bench_day_ret"],
            "pass_sector_quiet": sr is not None and sr < R3["max_sector_day_ret"],
        })
        cand.checks["pass"] = cand.checks["pass_bench_quiet"] and cand.checks["pass_sector_quiet"]
        if cand.checks["pass"]:
            r3.append(cand)
    stats["R3"]["passed_basic"] = len(cands["R3"])
    stats["R3"]["passed"] = len(r3)
    cands["R3"] = r3
    return cands, stats, groups, bench_close, t_days, pools


def pick(cands: dict[str, list[Candidate]]) -> dict[str, Candidate | None]:
    """每轮取 T 日前 60 日平均成交额最高的候选；三轮标的互不相同。"""
    chosen, used = {}, set()
    for rid in ("R3", "R2", "R1"):  # 候选最少的先选
        pool = sorted(cands[rid], key=lambda c: -c.liquidity)
        chosen[rid] = next((c for c in pool if c.symbol not in used), None)
        if chosen[rid]:
            used.add(chosen[rid].symbol)
    return chosen


def write_report(cands, stats, chosen, t_days):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    lines = [f"# 第一幕候选报告（{SCRIPT_VERSION}）", "",
             f"候选决策日 {len(t_days)} 个（{t_days[0]} – {t_days[-1]}，每 {T_STEP} 个交易日一个），股票池：{' + '.join(POOLS)} 点时成分。", ""]
    for rid in ("R1", "R2", "R3"):
        lines += [f"## {rid}  评估 {stats[rid]['evaluated']}，通过 {stats[rid]['passed']}", ""]
        rows = sorted(cands[rid], key=lambda c: -c.liquidity)
        lines += ["| 代码 | 名称 | T | 60日均成交额(亿) | 关键数值 |", "|---|---|---|---|---|"]
        for c in rows[:200]:
            keys = {k: v for k, v in c.checks.items() if not k.startswith("pass") and k != "surges"}
            lines.append(f"| {c.symbol} | {c.name} | {c.t} | {c.liquidity / 1e8:.2f} | {fmt(keys)} |")
        ch = chosen.get(rid)
        lines += ["", f"**选中**：{ch.symbol} {ch.name} T={ch.t}" if ch else "**无候选**", ""]
    (OUT_DIR / "candidates_report.md").write_text("\n".join(lines), encoding="utf-8")


def fmt(d: dict) -> str:
    return ", ".join(f"{k}={v:.4f}" if isinstance(v, float) else f"{k}={v}" for k, v in d.items())


# ---------------------------------------------------------------- 导出

def _np(o):
    """json 序列化 numpy 标量。"""
    if isinstance(o, np.generic):
        return o.item()
    raise TypeError(f"无法序列化 {type(o).__name__}")


def r4(xs):
    return [round(float(x), 4) for x in xs]


def volume_ratios(g: pd.DataFrame, i: int, n: int) -> list[float | None]:
    """最近 n 个交易日每天的量比：当日量 ÷ 之前 20 个非停牌日的均量（不含当日）。停牌日为 None。"""
    out = []
    for j in range(i - n + 1, i + 1):
        previous = volume_reference(g, j)
        out.append(None if previous is None else round(float(g.iloc[j]["volume"] / previous.mean()), 4))
    return out


def export_round(c: Candidate, g: pd.DataFrame, bench_close: pd.Series) -> tuple[dict, dict]:
    error = case_data_error(g, bench_close, c.t)
    if error:
        raise ValueError(f"不能导出 {c.round_id} {c.symbol} {c.t}: {error}")
    i = g.index.get_loc(c.t)
    close = g["close"]
    s60, b60 = comparison_window(g, bench_close, c.t)
    s3y = close.iloc[i - WIN_LONG : i + 1].tolist()
    s20 = close.iloc[i - WIN_VOL : i + 1].tolist()
    after = close.iloc[i : i + WIN_AFTER + 1].tolist()  # T 收盘 … T+20 收盘
    day_rets = [None] + [b / a - 1 for a, b in zip(s20[:-1], s20[1:])]
    t1 = g.iloc[i + 1]

    visible = {
        "round_id": c.round_id,
        "act": 1,
        "label": LABELS[c.round_id],
        "claim": CLAIMS[c.round_id],
        "cards": {
            "fox": {
                "title": "同期对照",
                "offsets": [-WIN_SHORT, 0],
                "asset": r4(normalize(s60)),
                "benchmark": r4(normalize(b60)),
                "benchmark_name": BENCHMARK[1],
                "asset_return": round(period_return(s60), 6),
                "benchmark_return": round(period_return(b60), 6),
            },
            "elephant": {
                "title": "更长历史",
                "offsets": [-WIN_LONG, 0],
                "series": r4(normalize(s3y)),
                "cum_return": round(period_return(s3y), 6),
                "max_drawdown": round(max_drawdown(s3y), 6),
            },
            "leopard": {
                "title": "近期量价",
                "offsets": [-WIN_VOL, 0],
                "close": r4(normalize(s20)),
                "day_return": [None if r is None else round(r, 6) for r in day_rets],
                "volume_ratio": volume_ratios(g, i, WIN_VOL + 1),
            },
        },
    }
    checks = {k: (round(v, 6) if isinstance(v, float) else v) for k, v in c.checks.items() if k != "surges"}
    if "surges" in c.checks:
        checks["surges"] = [{"date": x["date"], "vol_ratio": round(x["vol_ratio"], 4), "day_ret": round(x["day_ret"], 6)}
                            for x in c.checks["surges"]]
    reveal = {
        "round_id": c.round_id,
        "after": {
            "offsets": [0, WIN_AFTER],
            "close": r4(normalize(after)),
            "open_t1": round(float(t1["open"] / after[0] * 100), 4),
            "close_t20": round(float(after[-1] / after[0] * 100), 4),
            "return_close_t_to_close_t20": round(after[-1] / after[0] - 1, 6),
            "return_open_t1_to_close_t20": round(after[-1] / t1["open"] - 1, 6),
            "t1_open_at_limit_up": bool(t1["open"] >= t1["limit_up"]),
        },
        "source": {
            "symbol": c.symbol,
            "name": c.name,
            "decision_date": c.t,
            "windows": {
                "fox": [g.index[i - WIN_SHORT], c.t],
                "elephant": [g.index[i - WIN_LONG], c.t],
                "leopard": [g.index[i - WIN_VOL], c.t],
                "after": [g.index[i + 1], g.index[i + WIN_AFTER]],
            },
            "benchmark": f"{BENCHMARK[0]} {BENCHMARK[1]}",
            "claim": CLAIMS[c.round_id],
            "evidence_verdict": VERDICTS[c.round_id],
            "checks": checks,
            "selection": "在通过全部条件的候选中，按 T 日前 60 个交易日平均成交额最高者自动选取；三轮标的互不相同。",
            "hindsight_disclosure": "选取只用 T 日及以前的数据，未参考 T 之后的走势。",
        },
    }
    if c.round_id == "R3":
        reveal["source"]["sector_index"] = f"{c.checks['sector_index']} {CSI_NAMES.get(c.checks['sector_index'], '')}"
    return visible, reveal


def full_header(stats, t_days, as_of):
    return {
        "schema": DATA_SCHEMA_ID,
        "script": "scripts/build_cases.py",
        "script_version": SCRIPT_VERSION,
        "rules_version": RULES_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "data_as_of": as_of,
        "source": "Panda Data（panda_data 1.0.5）",
        "apis": ["get_stock_daily_pre", "get_index_daily", "get_index_weights", "get_adj_factor",
                 "get_industry_constituents", "get_trade_cal"],
        "pool": f"{' + '.join(POOLS)} 在决策日 T 的点时成分",
        "benchmark": f"{BENCHMARK[0]} {BENCHMARK[1]}（筛选前固定）",
        "adjustment": "前复权，以数据截止日为锚回算；区间收益不受锚点影响，但绝对价位不是当时的成交价",
        "dividends": "前复权价已包含分红送转的影响（相当于分红再投资）",
        "volume": "原始成交量（股），未复权；量比 = 当日量 ÷ 之前 20 个非停牌交易日均量（不含当日）",
        "normalization": "每张卡的价格序列以窗口首日 = 100 归一化；揭晓走势以 T 日收盘 = 100",
        "timing": {"decision": "T 日收盘后", "reveal_entry": "T+1 开盘", "reveal_exit": "T+20 收盘"},
        "windows": {"short": WIN_SHORT, "long": WIN_LONG, "volume": WIN_VOL, "after": WIN_AFTER},
        "candidate_decision_days": {"from": t_days[0], "to": t_days[-1], "every_n_trading_days": T_STEP, "count": len(t_days)},
        "filters": {"R1": R1, "R2": {**R2, "r60_range": list(R2["r60_range"])}, "R3": R3},
        "exclusions": [
            "决策日停牌（trade_status ≠ 0）",
            "按交易日历对齐；历史不足 729 日、标的或基准窗口缺失，或揭晓窗口不足 20 日",
            "T+1 停牌、无成交量，或开盘价缺失／非正；排除数量见 sample.excluded_records",
            "R3：量比回看窗口内有送转除权（ex_factor ≥ 1.1）",
            "trade_status 为空时：有成交量视为正常交易，否则视为停牌",
        ],
        "sample": stats,
        "selection": "每轮在通过条件的候选中按 T 日前 60 日平均成交额最高者自动选取；未参考 T 之后数据",
        "industry_note": "申万一级归属取当前分类（接口不提供历史归属），映射到中证全指一级行业指数作为行业基准",
        "public_scope": "尚未获得 PandaAI 公开展示许可的明确答复，暂按最保守方式处理：只发布归一化曲线与派生统计，不发布原始行情",
    }


def export(chosen, groups, bench_close, stats, t_days, as_of):
    missing = [r for r, c in chosen.items() if c is None]
    if missing:
        raise SystemExit(f"以下轮次没有候选，需要放宽条件并重新冻结：{missing}")
    vis_rounds, rev_rounds = [], []
    for rid in ("R1", "R2", "R3"):
        v, r = export_round(chosen[rid], groups[chosen[rid].symbol], bench_close)
        vis_rounds.append(v)
        rev_rounds.append(r)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    visible = {
        "header": {
            "schema": DATA_SCHEMA_ID,
            "file": "cases_visible",
            "script_version": SCRIPT_VERSION,
            "rules_version": RULES_VERSION,
            "note": "揭晓前可加载。只含 T 日收盘及以前的数据，使用相对日期，不含真实日期、代码或名称；完整文件头在 cases_reveal.json",
        },
        "rounds": vis_rounds,
    }
    reveal = {"header": {**full_header(stats, t_days, as_of), "file": "cases_reveal"}, "rounds": rev_rounds}
    (DATA_DIR / "cases_visible.json").write_text(json.dumps(visible, ensure_ascii=False, separators=(",", ":"), default=_np), encoding="utf-8")
    (DATA_DIR / "cases_reveal.json").write_text(json.dumps(reveal, ensure_ascii=False, indent=1, default=_np), encoding="utf-8")
    # 每轮单独一个揭晓文件：前端揭晓第 n 轮时只加载这一轮，其他轮的后续走势不会提前进入内存
    for r in rev_rounds:
        one = {"header": {**reveal["header"], "file": f"cases_reveal_{r['round_id']}"}, "rounds": [r]}
        (DATA_DIR / f"cases_reveal_{r['round_id']}.json").write_text(json.dumps(one, ensure_ascii=False, indent=1, default=_np), encoding="utf-8")
    (REPO_ROOT / "src" / "config" / "rounds_act1.json").write_text(json.dumps({
        "_comment": "第一幕命题定稿，由 scripts/build_cases.py 生成，与 public/data/cases_*.json 对齐",
        "rules_version": RULES_VERSION,
        "rounds": [{"round_id": r, "act": 1, "label": LABELS[r], "claim": CLAIMS[r], "evidence_verdict": VERDICTS[r],
                    "benchmark_name": BENCHMARK[1]} for r in ("R1", "R2", "R3")],
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_docs(reveal)


def write_docs(reveal):
    h = reveal["header"]
    lines = ["# 第一幕案例检查（自动生成）", "",
             f"`scripts/build_cases.py` {h['script_version']} · 数据截至 {h['data_as_of']} · 规则 {h['rules_version']}", "",
             f"股票池：{h['pool']}；基准：{h['benchmark']}；候选决策日 {h['candidate_decision_days']['count']} 个"
             f"（{h['candidate_decision_days']['from']} – {h['candidate_decision_days']['to']}）。", "",
             "| 轮次 | 评估 | 通过 |", "|---|---|---|"]
    for rid in ("R1", "R2", "R3"):
        st = h["sample"][rid]
        lines.append(f"| {rid} | {st['evaluated']} | {st['passed']} |")
    for r in reveal["rounds"]:
        src = r["source"]
        lines += ["", f"## {r['round_id']} · {src['symbol']} {src['name']} · T = {src['decision_date']}", "",
                  f"命题：{src['claim']}（证据结论：`{src['evidence_verdict']}`）", "", "| 条件 / 数值 | 结果 |", "|---|---|"]
        for k, v in src["checks"].items():
            if k == "surges":
                v = "; ".join(f"{x['date']} 量比 {x['vol_ratio']:.2f} 涨幅 {x['day_ret']:.2%}" for x in v)
            lines.append(f"| {k} | {v} |")
        a = r["after"]
        lines += ["", f"揭晓（T+1 开盘 → T+20 收盘）：{a['return_open_t1_to_close_t20']:.2%}；"
                      f"T 收盘 → T+20 收盘：{a['return_close_t_to_close_t20']:.2%}；T+1 开盘涨停：{a['t1_open_at_limit_up']}"]
    lines += ["", "选取规则：" + h["selection"] + "。", "", "公开展示：" + h["public_scope"] + "。", ""]
    (REPO_ROOT / "docs" / "cases-report.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    import contextlib
    import io

    with contextlib.redirect_stdout(io.StringIO()):
        cands, stats, groups, bench_close, t_days, pools = scan()
        as_of = data.last_trade_date()
    chosen = pick(cands)
    write_report(cands, stats, chosen, t_days)
    export(chosen, groups, bench_close, stats, t_days, as_of)
    print(json.dumps(stats, ensure_ascii=False))
    for rid, c in chosen.items():
        print(rid, c.symbol, c.name, c.t)
    print("已写入 public/data/cases_visible.json、public/data/cases_reveal.json、src/config/rounds_act1.json、docs/cases-report.md")

