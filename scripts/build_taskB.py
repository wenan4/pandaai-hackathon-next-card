"""任务 B 三个主题的数据（猎豹题 YOU-153，大象题、狐狸题 YOU-166）。

    .venv/bin/python scripts/build_taskB.py --topic cheetah|elephant|fox

产物（{topic} 为主题）：
- public/data/taskB_{topic}.json          两段统计与结论（契约 contracts/data.ts 的 TaskBDataSchema）
- scripts/out/taskB_{topic}_records.json  逐条样本与交易日历（不入库），scripts/check_taskB.py 用它复核口径
- docs/taskB-{topic}.md                   样本处理与已知局限（入库）
- public/data/taskB_topics.json           已发布且通过检查的主题清单（scripts/check_taskB.py --write-manifest 写入）

三个主题共用股票池、分段、不重叠规则、基准组规则和判定函数；信号、持有期和主指标各自冻结，写在下面。
要改参数就升 SCRIPT_VERSION 并重新说明验证含义，不要看着检验段调。
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pd_common import data  # noqa: E402
from pd_common.client import REPO_ROOT  # noqa: E402
from pd_common.metrics import max_drawdown  # noqa: E402
from pd_common.taskb import comparison, verdict  # noqa: E402

SCRIPT_VERSION = "taskB-0.2.0"
RULES_VERSION = "v0.3"
DATA_SCHEMA_ID = "next-card/data@v0.3"

# ---------------------------------------------------------------- 三题共用的冻结参数
POOLS = ["000300.SH", "000905.SH"]             # 沪深300 + 中证500 = 中证800，展示段首个交易日的点时成分
DISPLAY = ("20210101", "20221231")
TEST = ("20230101", "20241231")
CACHED_FROM = "20200901"                       # 猎豹题已缓存的日线起点；更早的回看只补取这之前的一段
EXCLUDE_KEYS = ("window_crosses_segment", "entry_unavailable", "exit_unavailable", "overlap")

# ---------------------------------------------------------------- 猎豹题（YOU-153，2026-10-31T11:40Z 冻结）
TOPIC = "cheetah"
LOOKBACK_FROM = "20200901"                     # 信号回看可以早于分段起点
SIGNAL = dict(vol_mult=2.0, vol_window=20, min_day_ret=0.05, split_factor=1.1)
HORIZON = 20                                   # T+1 开盘进，T+20 收盘出
THRESHOLDS = dict(min_samples=30, advantage_margin=0.05, frozen_at="2026-10-31T11:40:00Z")
QUESTION = "放量上涨之后的 20 个交易日，收益为正的比例比同期一般情况更高吗？"
COVERAGE_KEYS = ("no_volume_reference", "prev_close_missing", "split_in_lookback")

# ---------------------------------------------------------------- 大象题、狐狸题（YOU-166，2026-10-31T14:45Z 取数前冻结）
ELEPHANT = dict(lookback_days=250, min_return=0.0, max_drawdown=0.15, candidate_dates="month_end")
ELEPHANT_HORIZON = 250                         # T+1 开盘进，T+250 收盘出
FOX_BENCHMARK = ("000300.SH", "沪深300")
FOX = dict(benchmark=FOX_BENCHMARK[0], candidate_dates="month_end")
NEW_THRESHOLDS = dict(min_samples=30, advantage_margin=0.05, frozen_at="2026-10-31T14:45:00Z")

TOPICS = {
    "cheetah": dict(lookback_from=LOOKBACK_FROM, horizon=HORIZON, signal=SIGNAL, thresholds=THRESHOLDS, question=QUESTION,
                    coverage_keys=COVERAGE_KEYS),
    "elephant": dict(lookback_from="20191101", horizon=ELEPHANT_HORIZON, signal=ELEPHANT, thresholds=NEW_THRESHOLDS,
                     question="过去约一年累计上涨、且最大回撤小于 15% 的股票，之后约一年收益为正的比例比同期一般情况更高吗？",
                     coverage_keys=("history_incomplete",)),
    "fox": dict(lookback_from="20201101", horizon="next_month", signal=FOX, thresholds=NEW_THRESHOLDS,
                question=f"上个自然月跑赢{FOX_BENCHMARK[1]}的股票，下个自然月仍跑赢的比例比同期一般情况更高吗？",
                coverage_keys=("prior_month_close_missing",)),
}

OUT_DIR = REPO_ROOT / "scripts" / "out"
DATA_DIR = REPO_ROOT / "public" / "data"
DOCS_DIR = REPO_ROOT / "docs"


# ---------------------------------------------------------------- 逐只股票

def prepare(g: pd.DataFrame, calendar: list[str]) -> pd.DataFrame:
    """按交易日历对齐，缺失交易日保留为空值；trade_status 为空时有成交量视为正常交易。"""
    g = g.set_index("date").sort_index()
    g = g[~g.index.duplicated()].reindex(calendar)
    status = g["trade_status"].astype(float)
    status = status.fillna((~(g["volume"] > 0)).astype(float))
    g["trading"] = (status == 0) & (g["volume"] > 0) & np.isfinite(g["close"]) & (g["close"] > 0)
    return g


def month_ends(calendar: list[str]) -> list[int]:
    """每个自然月最后一个交易日在日历里的位置。日历最后一天只有在它确实是月末时才算（下一交易日未知时按月份判断）。"""
    out = [i for i in range(len(calendar) - 1) if calendar[i][:6] != calendar[i + 1][:6]]
    return out + [len(calendar) - 1]


def execution(row: dict, cal, trading, open_, close, limit_up, j_in: int, j_out: int, seg_end: str) -> None:
    """T+1 开盘进、j_out 收盘出；越过分段或端点不可用时只标排除原因，不前向填充。"""
    if j_out >= len(cal) or cal[j_out] > seg_end:
        row["excluded"] = "window_crosses_segment"
    elif not (trading[j_in] and np.isfinite(open_[j_in]) and open_[j_in] > 0):
        row["excluded"] = "entry_unavailable"
    elif not trading[j_out]:
        row["excluded"] = "exit_unavailable"
    else:
        row.update({
            "entry": cal[j_in], "exit": cal[j_out],
            "entry_open": float(open_[j_in]), "exit_close": float(close[j_out]),
            "ret": round(float(close[j_out] / open_[j_in] - 1), 6),
            "t1_open_limit_up": bool(np.isfinite(limit_up[j_in]) and open_[j_in] >= limit_up[j_in]),
        })


def arrays(g: pd.DataFrame, n: int):
    limit_up = g["limit_up"].to_numpy(dtype=float) if "limit_up" in g else np.full(n, np.nan)
    return (g["trading"].to_numpy(), g["volume"].to_numpy(dtype=float), g["close"].to_numpy(dtype=float),
            g["open"].to_numpy(dtype=float), limit_up)


def candidates(g: pd.DataFrame, calendar: list[str], split_dates: set[str], segment: tuple[str, str]):
    """猎豹题：一只股票在一个分段里的候选日。

    候选日 = 分段内该股有成交的交易日。返回 (rows, coverage)：
    rows 是能计算信号的候选日（含是否为信号、结果窗口是否可用）；coverage 统计不能计算信号的候选日及原因。
    信号只用 T 日及以前的数据：T 日成交量、此前 20 个有成交日的均量（不含 T 日）、T 日与前一交易日收盘。
    """
    cal = np.asarray(calendar)
    n, w = len(cal), SIGNAL["vol_window"]
    trading, vol, close, open_, limit_up = arrays(g, n)

    tpos = np.flatnonzero(trading)
    csum = np.concatenate([[0.0], np.cumsum(vol[tpos])])
    rank = np.full(n, -1)
    rank[tpos] = np.arange(len(tpos))
    splits = np.asarray(sorted(split_dates))

    coverage = dict.fromkeys(COVERAGE_KEYS, 0)
    rows = []
    lo, hi = np.searchsorted(cal, segment[0]), np.searchsorted(cal, segment[1], side="right")
    for i in range(lo, hi):
        if not trading[i]:
            continue
        k = rank[i]
        if k < w:
            coverage["no_volume_reference"] += 1
            continue
        if i == 0 or not trading[i - 1]:
            coverage["prev_close_missing"] += 1
            continue
        lb_from = cal[tpos[k - w]]
        if len(splits) and np.any((splits >= lb_from) & (splits <= cal[i])):
            coverage["split_in_lookback"] += 1
            continue
        ref = (csum[k] - csum[k - w]) / w
        vol_ratio = vol[i] / ref
        day_ret = close[i] / close[i - 1] - 1
        row = {
            "t": cal[i], "lookback_from": lb_from, "inputs_through": cal[i],
            "vol_ratio": round(float(vol_ratio), 4), "day_ret": round(float(day_ret), 6),
            "signal": bool(vol_ratio >= SIGNAL["vol_mult"] and day_ret >= SIGNAL["min_day_ret"]),
        }
        execution(row, cal, trading, open_, close, limit_up, i + 1, i + HORIZON, segment[1])
        rows.append(row)
    return rows, coverage


def candidates_elephant(g: pd.DataFrame, calendar: list[str], segment: tuple[str, str]):
    """大象题：候选日 = 分段内该股有成交的月末交易日。

    信号只用 T 日及以前的收盘：T-250 到 T 共 251 个收盘全部有效，累计收益 > 0 且最大回撤 < 15%。
    这 251 天里任何一天没有有效收盘（未上市、数据缺失）都不计算信号，两组都不用（history_incomplete）。
    """
    cal = np.asarray(calendar)
    n, L = len(cal), ELEPHANT["lookback_days"]
    trading, _, close, open_, limit_up = arrays(g, n)
    coverage = {"history_incomplete": 0}
    rows = []
    for i in month_ends(calendar):
        if not (segment[0] <= cal[i] <= segment[1]) or not trading[i]:
            continue
        win = close[i - L:i + 1] if i >= L else np.array([])
        if len(win) != L + 1 or not (np.isfinite(win).all() and (win > 0).all()):
            coverage["history_incomplete"] += 1
            continue
        lb_return = round(float(win[-1] / win[0] - 1), 6)
        lb_mdd = round(float(max_drawdown(win.tolist())), 6)
        row = {
            "t": cal[i], "lookback_from": cal[i - L], "inputs_through": cal[i],
            "lb_return": lb_return, "lb_mdd": lb_mdd,
            "signal": bool(lb_return > ELEPHANT["min_return"] and lb_mdd < ELEPHANT["max_drawdown"]),
        }
        execution(row, cal, trading, open_, close, limit_up, i + 1, i + ELEPHANT_HORIZON, segment[1])
        rows.append(row)
    return rows, coverage


def candidates_fox(g: pd.DataFrame, calendar: list[str], bench: pd.DataFrame, segment: tuple[str, str]):
    """狐狸题：信号日 T = 每个自然月最后一个交易日，持有月 = 下一个自然月，持有月必须在分段内。

    信号只用 T 日及以前的收盘：当月收益（上月末收盘到 T 收盘）高于沪深300同期收益。
    结果是超额收益：个股（次月首个交易日开盘 → 次月最后一个交易日收盘）减去沪深300同起止点的收益。
    T 日没有成交的不作候选；上月末没有有效收盘时不能计算信号，两组都不用（prior_month_close_missing）。
    """
    cal = np.asarray(calendar)
    n = len(cal)
    trading, _, close, open_, limit_up = arrays(g, n)
    b_open, b_close = bench["open"].to_numpy(dtype=float), bench["close"].to_numpy(dtype=float)
    ends = month_ends(calendar)
    coverage = {"prior_month_close_missing": 0}
    rows = []
    for prev, t, last in zip(ends, ends[1:], ends[2:]):
        j_in = t + 1
        if not (segment[0] <= cal[j_in] <= segment[1]) or not trading[t]:
            continue
        if not (np.isfinite(close[prev]) and close[prev] > 0):
            coverage["prior_month_close_missing"] += 1
            continue
        month_return = round(float(close[t] / close[prev] - 1), 6)
        bench_month_return = round(float(b_close[t] / b_close[prev] - 1), 6)
        row = {
            "t": cal[t], "lookback_from": cal[prev], "inputs_through": cal[t],
            "month_return": month_return, "bench_month_return": bench_month_return,
            "signal": bool(month_return > bench_month_return),
        }
        execution(row, cal, trading, open_, close, limit_up, j_in, last, segment[1])
        if "ret" in row:
            asset_ret = row["ret"]
            bench_ret = round(float(b_close[last] / b_open[j_in] - 1), 6)
            row.update({"asset_ret": asset_ret, "bench_entry_open": float(b_open[j_in]), "bench_exit_close": float(b_close[last]),
                        "bench_ret": bench_ret, "ret": round(float(close[last] / open_[j_in] - 1 - (b_close[last] / b_open[j_in] - 1)), 6)})
        rows.append(row)
    return rows, coverage


def keep_non_overlapping(rows: list[dict]) -> tuple[list[dict], int]:
    """按日期排序，保留最早有效记录；之后只保留执行日严格晚于上一条保留记录退出日的记录。"""
    kept, dropped, last_exit = [], 0, None
    for r in sorted(rows, key=lambda r: r["t"]):
        if last_exit is not None and r["entry"] <= last_exit:
            dropped += 1
            continue
        kept.append(r)
        last_exit = r["exit"]
    return kept, dropped


def select(rows: list[dict], group: str) -> tuple[list[dict], dict]:
    """信号组只取信号日，基准组取全部候选日；两组用同一套排除规则与不重叠规则。"""
    chosen = [r for r in rows if r["signal"]] if group == "signal_group" else list(rows)
    excluded = dict.fromkeys(EXCLUDE_KEYS, 0)
    valid = []
    for r in chosen:
        if "excluded" in r:
            excluded[r["excluded"]] += 1
        else:
            valid.append(r)
    kept, excluded["overlap"] = keep_non_overlapping(valid)
    return kept, excluded


# ---------------------------------------------------------------- 统计

def group_stats(records: list[dict], excluded: dict) -> dict:
    """主指标 = ret > 0 的比例，mean_return = ret 的均值。狐狸题的 ret 是超额收益。"""
    if not records:
        return {"n_records": 0, "n_symbols": 0, "primary_metric": None, "mean_return": None, "covered": None,
                "excluded": excluded}
    rets = np.array([r["ret"] for r in records])
    return {
        "n_records": len(records),
        "n_symbols": len({r["symbol"] for r in records}),
        "primary_metric": round(float((rets > 0).mean()), 6),
        "mean_return": round(float(rets.mean()), 6),
        "covered": [min(r["t"] for r in records), max(r["exit"] for r in records)],
        "excluded": excluded,
    }


def segment_stats(name: str, seg: tuple[str, str], records: list[dict], excluded: dict, margin: float) -> dict:
    out = {"range": {"from": seg[0], "to": seg[1]}}
    for grp in ("signal_group", "baseline_group"):
        out[grp] = group_stats([r for r in records if r["segment"] == name and r["group"] == grp], excluded[(name, grp)])
    out["delta"], out["meets_threshold"] = comparison(
        out["signal_group"]["primary_metric"], out["baseline_group"]["primary_metric"], margin)
    return out


def build(px: pd.DataFrame, adj: pd.DataFrame, calendar: list[str], pool: list[str], topic: str = TOPIC,
          bench: pd.DataFrame | None = None):
    spec = TOPICS[topic]
    split_dates = {
        s: set(g.loc[g["ex_factor"] >= SIGNAL["split_factor"], "ex_date"].astype(str)) for s, g in adj.groupby("symbol")
    } if len(adj) else {}
    groups = {s: prepare(g, calendar) for s, g in px.groupby("symbol")}
    records, excluded = [], {}
    coverage = {name: {"candidate_days": 0, **dict.fromkeys(spec["coverage_keys"], 0)} for name in ("display", "test")}
    diagnostics = {}
    for name, seg in (("display", DISPLAY), ("test", TEST)):
        for grp in ("signal_group", "baseline_group"):
            excluded[(name, grp)] = dict.fromkeys(EXCLUDE_KEYS, 0)
        for s in pool:
            g = groups.get(s)
            if g is None:
                continue
            if topic == "cheetah":
                rows, cov = candidates(g, calendar, split_dates.get(s, set()), seg)
            elif topic == "elephant":
                rows, cov = candidates_elephant(g, calendar, seg)
            else:
                rows, cov = candidates_fox(g, calendar, bench, seg)
            coverage[name]["candidate_days"] += len(rows) + sum(cov.values())
            for k, v in cov.items():
                coverage[name][k] += v
            for grp in ("signal_group", "baseline_group"):
                kept, ex = select(rows, grp)
                for k, v in ex.items():
                    excluded[(name, grp)][k] += v
                records.extend({**r, "symbol": s, "segment": name, "group": grp} for r in kept)
        for grp in ("signal_group", "baseline_group"):
            sel = [r for r in records if r["segment"] == name and r["group"] == grp]
            diagnostics[f"{name}.{grp}.t1_open_limit_up"] = sum(r["t1_open_limit_up"] for r in sel)
    margin = spec["thresholds"]["advantage_margin"]
    out = {name: segment_stats(name, seg, records, excluded, margin) for name, seg in (("display", DISPLAY), ("test", TEST))}
    return records, out, coverage, diagnostics


# ---------------------------------------------------------------- 输出

COMMON_LIMITATIONS = [
    "股票池按快照日冻结，存在选择偏差；中证800 只代表大中盘",
    "不重叠只保证同一只股票的持有期不重叠，不同股票同一时段的样本高度相关，不等于独立样本",
    "min_samples 和 advantage_margin 只是这道练习的描述标准，不是统计显著性门槛",
    "未计手续费、滑点、冲击成本和容量；T+1 开盘涨停时实际可能买不到，这类样本保留并在 diagnostics 里计数",
    "结论只描述这两段样本，不回答这条规则以后是否有效",
]
WINDOW_EXCLUSIONS = [
    "结果窗口越过分段终点的记录剔除（window_crosses_segment）",
    "进场日没有成交或开盘价缺失（entry_unavailable）、退出日没有成交（exit_unavailable）的记录剔除；不前向填充",
    "不重叠规则去掉的记录计入 overlap",
]


def topic_header(topic: str) -> dict:
    """各主题自己的题目、信号、执行口径、主指标与说明。"""
    if topic == "cheetah":
        return {
            "apis": ["get_stock_daily_pre", "get_index_weights", "get_adj_factor", "get_trade_cal"],
            "benchmark": "基准组：同股票池、同分段、同持有窗口的全部候选日（不是指数）",
            "normalization": "不发布价格序列；每条样本只记 C[T+20] / O[T+1] - 1",
            "selection": "股票池内全部股票、两段内全部交易日按同一规则逐日判定，没有人工挑选样本",
            "signal": {"definition": "T 日成交量 ≥ 此前 20 个有成交交易日均量（不含 T 日）的 2 倍，且 T 日收盘涨幅 ≥ 5%",
                       "params": {**SIGNAL}},
            "primary_metric": {"id": "share_positive_return", "label": "T+1 开盘到 T+20 收盘收益为正的比例"},
            "execution": {"entry": "T+1 开盘", "exit": "T+20 收盘", "horizon_days": HORIZON},
            "exclusions": [
                "候选日 = 分段内该股有成交的交易日；trade_status 为空时有成交量视为正常交易",
                "此前不足 20 个有成交交易日、前一交易日没有成交，或量比回看窗口内有送转除权（ex_factor ≥ 1.1）的候选日不能计算信号，两组都不用（见 coverage）",
                *WINDOW_EXCLUSIONS,
            ],
            "limitations": COMMON_LIMITATIONS,
        }
    if topic == "elephant":
        return {
            "apis": ["get_stock_daily_pre", "get_index_weights", "get_trade_cal"],
            "benchmark": "基准组：同股票池、同分段、同持有窗口的全部月末候选日（不是指数）",
            "normalization": "不发布价格序列；每条样本只记 C[T+250] / O[T+1] - 1",
            "selection": "股票池内全部股票、两段内全部月末交易日按同一规则判定，没有人工挑选样本",
            "signal": {"definition": "月末交易日 T：T-250 到 T 的收盘累计收益 > 0，且这 251 个收盘的最大回撤 < 15%",
                       "params": {**ELEPHANT}},
            "primary_metric": {"id": "share_positive_return", "label": "T+1 开盘到 T+250 收盘收益为正的比例"},
            "execution": {"entry": "T+1 开盘", "exit": "T+250 收盘", "horizon_days": ELEPHANT_HORIZON},
            "exclusions": [
                "候选日 = 分段内该股有成交的月末交易日（按月生成候选，之后另做不重叠过滤）",
                "T-250 到 T 任何一天没有有效收盘（未上市、数据缺失）的候选日不能计算信号，两组都不用（history_incomplete）",
                *WINDOW_EXCLUSIONS,
            ],
            "limitations": [
                "持有约一年，两年的分段里每只股票每组最多留下一条记录；按月生成候选本身不消除重叠，靠不重叠规则过滤",
                "基准组几乎都在分段的第一个月末进场，信号组的进场月份分散，两组经历的市场环境不完全相同",
                *COMMON_LIMITATIONS,
            ],
        }
    return {
        "apis": ["get_stock_daily_pre", "get_index_daily", "get_index_weights", "get_trade_cal"],
        "benchmark": f"基准组：同股票池、同月、不按“上月跑赢”筛选的全部记录；超额收益都相对{FOX_BENCHMARK[1]}（{FOX_BENCHMARK[0]}）、用相同起止点计算",
        "normalization": f"不发布价格序列；每条样本记个股（次月首日开盘 → 次月末收盘）收益减去{FOX_BENCHMARK[1]}同起止点收益",
        "selection": "股票池内全部股票、两段内全部持有月按同一规则判定，没有人工挑选样本",
        "signal": {"definition": f"月末交易日 T：当月收益（上月末收盘 → T 收盘）高于{FOX_BENCHMARK[1]}同期收益",
                   "params": {**FOX}},
        "primary_metric": {"id": "share_positive_excess_return",
                           "label": f"次月超额收益（个股收益 − {FOX_BENCHMARK[1]}收益，同一起止点）为正的比例"},
        "execution": {"entry": "T 之后第一个交易日（次月首个交易日）开盘", "exit": "次月最后一个交易日收盘", "horizon_days": None},
        "exclusions": [
            "候选 = 持有月落在分段内、信号日 T 当天有成交的股票月；信号月可以早于分段起点（回看），持有月必须完整在分段内",
            "上月末没有有效收盘的候选不能计算信号，两组都不用（prior_month_close_missing）",
            *WINDOW_EXCLUSIONS,
        ],
        "limitations": [
            "比较的是超额收益（相对沪深300），不是普通上涨；沪深300 不等于这 800 只股票的等权平均",
            "按自然月持有，持有天数随月份在 16–23 个交易日之间变化",
            *COMMON_LIMITATIONS,
        ],
    }


def header(as_of: str, snapshot: str, pool: list[str], missing: list[str], coverage: dict, diagnostics: dict,
           topic: str = TOPIC) -> dict:
    spec = TOPICS[topic]
    t = topic_header(topic)
    return {
        "schema": DATA_SCHEMA_ID,
        "file": "taskB",
        "topic": topic,
        "script": "scripts/build_taskB.py",
        "script_version": SCRIPT_VERSION,
        "rules_version": RULES_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "data_as_of": as_of,
        "source": "Panda Data（panda_data 1.0.5）",
        "apis": t["apis"],
        "benchmark": t["benchmark"],
        "adjustment": "前复权日线；收益只用同一复权序列内的比值，不受锚点影响",
        "dividends": "前复权价已包含分红送转的影响（相当于分红再投资）" + ("；沪深300 是价格指数，不含分红" if topic == "fox" else ""),
        "normalization": t["normalization"],
        "selection": t["selection"],
        "public_scope": "尚未获得 PandaAI 公开展示许可的明确答复，暂按最保守方式处理：只发布汇总统计，逐条样本不入库",
        "question": spec["question"],
        "signal": t["signal"],
        "primary_metric": t["primary_metric"],
        "execution": t["execution"],
        "pool": {
            "description": f"{' + '.join(POOLS)}（中证800）在 {snapshot} 的成分股，两段共用",
            "size": len(pool),
            "snapshot_date": snapshot,
            "bias_note": "快照日之后调入的股票不在池内；之后调出或退市的股票仍保留，缺数据的样本按排除规则计数。"
                         "中证800 只覆盖大中盘，结论不能推到小盘股",
        },
        "segments": {"lookback_from": spec["lookback_from"], "display": {"from": DISPLAY[0], "to": DISPLAY[1]},
                     "test": {"from": TEST[0], "to": TEST[1]}},
        "thresholds": spec["thresholds"],
        "baseline_rule": "同股票池、同一分段、同持有窗口与同样的数据完整性规则，枚举全部候选，不按信号（也不按信号的反面）筛选",
        "non_overlap_rule": "信号组与基准组分别按标的、分段排序；保留最早有效记录，之后只保留执行日严格晚于上一条保留记录退出日的记录",
        "exclusions": t["exclusions"],
        "limitations": t["limitations"],
        "pool_symbols_without_data": len(missing),
        "coverage": coverage,
        "diagnostics": diagnostics,
    }


VERDICT_TEXT = {
    "insufficient_evidence": "数据不足，暂不判断",
    "both_segments": "两段都观察到信号组的优势达到阈值",
    "segment_difference": "只有{seg}观察到优势达到阈值",
    "no_observed_advantage": "两段都没有观察到达到阈值的优势",
}
TOPIC_TITLE = {"cheetah": "猎豹题", "elephant": "大象题", "fox": "狐狸题"}
COVERAGE_TEXT = {
    "no_volume_reference": "此前不足 20 个有成交日", "prev_close_missing": "前一交易日没有成交",
    "split_in_lookback": "回看窗口内有送转除权", "history_incomplete": "回看 250 日内有缺失收盘",
    "prior_month_close_missing": "上月末没有有效收盘",
}


def write_docs(doc: dict) -> None:
    h = doc["header"]
    v = doc["verdict"]
    topic = h["topic"]
    excess = h["primary_metric"]["id"] == "share_positive_excess_return"
    seg_name = {"display": "展示段", "test": "检验段"}
    pm_label, mean_label = ("超额收益为正比例", "平均超额收益") if excess else ("收益为正比例", "平均收益")
    lines = [
        f"# 任务 B {TOPIC_TITLE[topic]}：样本处理与已知局限（自动生成）", "",
        f"`scripts/build_taskB.py` {h['script_version']} · 数据截至 {h['data_as_of']} · 规则 {h['rules_version']}", "",
        f"研究题目：{h['question']}", "",
        f"- 信号：{h['signal']['definition']}",
        f"- 执行：{h['execution']['entry']}进，{h['execution']['exit']}出；不计费用和滑点",
        f"- 主指标：{h['primary_metric']['label']}；另列{mean_label}",
        f"- 股票池：{h['pool']['description']}，共 {h['pool']['size']} 只，其中 {h['pool_symbols_without_data']} 只没有取到数据",
        f"- 分段：展示段 {DISPLAY[0]}–{DISPLAY[1]}，检验段 {TEST[0]}–{TEST[1]}；信号回看最早用到 {h['segments']['lookback_from']}",
        f"- 阈值：每组至少 {h['thresholds']['min_samples']} 条；信号组比基准组高出至少 {h['thresholds']['advantage_margin'] * 100:.0f} 个百分点（{h['thresholds']['frozen_at']} 取数前冻结）",
        "", "## 结果", "",
        f"| 分段 | 组 | 样本数 | 标的数 | {pm_label} | {mean_label} | 剔除（越界 / 进场不可用 / 退出不可用 / 重叠） |",
        "|---|---|---:|---:|---:|---:|---|",
    ]
    for seg in ("display", "test"):
        s = doc[seg]
        for grp, label in (("signal_group", "信号组"), ("baseline_group", "基准组")):
            g = s[grp]
            pm = "—" if g["primary_metric"] is None else f"{g['primary_metric']:.1%}"
            mr = "—" if g["mean_return"] is None else f"{g['mean_return']:.2%}"
            ex = " / ".join(str(g["excluded"][k]) for k in EXCLUDE_KEYS)
            lines.append(f"| {seg_name[seg]} | {label} | {g['n_records']} | {g['n_symbols']} | {pm} | {mr} | {ex} |")
        d = "—" if s["delta"] is None else f"{s['delta'] * 100:+.1f} 个百分点"
        lines.append(f"| {seg_name[seg]} | 差值 | | | {d} | | 达到阈值：{s['meets_threshold']} |")
    text = VERDICT_TEXT[v["result"]].format(seg=seg_name.get(v.get("only_segment", ""), ""))
    lines += ["", f"结论：**{text}**（`{v['result']}`）。只描述这两段样本，不回答这条规则以后是否有效。", ""]
    for seg in ("display", "test"):
        s = doc[seg]
        if s["delta"] is None:
            continue
        mean_diff = s["signal_group"]["mean_return"] - s["baseline_group"]["mean_return"]
        if s["delta"] * mean_diff < 0:  # 只有方向严格相反才提示，任一为 0 不算
            lines.append(f"- {seg_name[seg]}：信号组{pm_label[:-2]}的比例{'低' if s['delta'] < 0 else '高'}于基准组，"
                         f"{mean_label}却{'高' if mean_diff > 0 else '低'}于基准组。比例和均值回答的是不同问题，不能互相替代。")
    lines += ["", "## 样本处理", ""]
    lines += [f"- {x}" for x in h["exclusions"]]
    lines += [f"- 基准组：{h['baseline_rule']}", f"- 不重叠：{h['non_overlap_rule']}", "",
              "不能计算信号的候选（两组都不用）：", ""]
    for seg in ("display", "test"):
        c = h["coverage"][seg]
        parts = "，".join(f"{COVERAGE_TEXT[k]} {c[k]}" for k in c if k != "candidate_days")
        lines.append(f"- {seg_name[seg]}：候选 {c['candidate_days']}，{parts}")
    lines += ["", "T+1 开盘涨停（实际可能买不到，样本保留）：", ""]
    lines += [f"- {k}：{v}" for k, v in h["diagnostics"].items()]
    lines += ["", "## 已知局限", ""] + [f"- {x}" for x in h["limitations"]]
    lines += ["", f"复核：`.venv/bin/python scripts/check_taskB.py --topic {topic}` 逐条检查结果窗口不越过分段、各组内不重叠、"
              "两组执行口径一致、信号只用 T 日及以前的数据，并从逐条样本重算汇总与结论。", ""]
    (DOCS_DIR / f"taskB-{topic}.md").write_text("\n".join(lines), encoding="utf-8")


def stock_daily(pool: list[str], start: str, end: str) -> pd.DataFrame:
    """更早的回看只补取 CACHED_FROM 之前的一段，与已缓存的区间拼接；两段同一天取数，前复权锚点相同。"""
    if start >= CACHED_FROM:
        return data.stock_daily(pool, start, end, adjusted=True)
    before = data.stock_daily(pool, start, data.trade_days(start, CACHED_FROM)[-2], adjusted=True)
    after = data.stock_daily(pool, CACHED_FROM, end, adjusted=True)
    return pd.concat([before, after], ignore_index=True).drop_duplicates(["symbol", "date"]).sort_values(["symbol", "date"])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--topic", default=TOPIC, choices=list(TOPICS))
    topic = ap.parse_args().topic
    spec = TOPICS[topic]

    calendar = data.trade_days(spec["lookback_from"], TEST[1])
    snapshot = next(d for d in calendar if d >= DISPLAY[0])
    pool = sorted({s for p in POOLS for s in data.index_members(p, snapshot)})
    if not pool:
        raise SystemExit(f"{snapshot} 没有取到成分股")
    px = stock_daily(pool, spec["lookback_from"], TEST[1])
    adj = data.adj_events(pool, LOOKBACK_FROM, TEST[1]) if topic == "cheetah" else pd.DataFrame()
    bench = None
    if topic == "fox":
        b = data.index_daily([FOX_BENCHMARK[0]], spec["lookback_from"], TEST[1])
        bench = b.set_index("date").sort_index().reindex(calendar)
        if not (np.isfinite(bench["open"]).all() and np.isfinite(bench["close"]).all()):
            raise SystemExit(f"{FOX_BENCHMARK[0]} 在交易日历上有缺失，不能计算超额收益")
    as_of = data.last_trade_date()
    missing = sorted(set(pool) - set(px["symbol"].unique()))

    records, segs, coverage, diagnostics = build(px, adj, calendar, pool, topic, bench)
    doc = {"header": header(as_of, snapshot, pool, missing, coverage, diagnostics, topic), **segs}
    doc["verdict"] = verdict(doc, spec["thresholds"])

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / f"taskB_{topic}.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    signal = SIGNAL if topic == "cheetah" else spec["signal"]
    (OUT_DIR / f"taskB_{topic}_records.json").write_text(json.dumps({
        "script_version": SCRIPT_VERSION, "topic": topic, "horizon": spec["horizon"], "signal": signal,
        "segments": {"display": list(DISPLAY), "test": list(TEST)}, "thresholds": spec["thresholds"],
        "calendar": calendar, "records": records,
    }, ensure_ascii=False), encoding="utf-8")
    write_docs(doc)
    for seg in ("display", "test"):
        s = doc[seg]
        print(seg, {g: (s[g]["n_records"], s[g]["primary_metric"], s[g]["mean_return"]) for g in ("signal_group", "baseline_group")},
              "delta", s["delta"], "meets", s["meets_threshold"])
    print("verdict", doc["verdict"])


if __name__ == "__main__":
    main()
