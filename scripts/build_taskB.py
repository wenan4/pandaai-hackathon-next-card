"""任务 B 猎豹题数据（YOU-153）。

    .venv/bin/python scripts/build_taskB.py --topic cheetah

产物：
- public/data/taskB_cheetah.json          两段统计与结论（契约 contracts/data.ts 的 TaskBDataSchema）
- scripts/out/taskB_cheetah_records.json  逐条样本与交易日历（不入库），scripts/check_taskB.py 用它复核口径
- docs/taskB-cheetah.md                   样本处理与已知局限（入库）

研究题目、信号、执行口径、股票池、分段和阈值都写在下面的冻结参数里，取数前固定。
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
from pd_common.taskb import comparison, verdict  # noqa: E402

SCRIPT_VERSION = "taskB-0.1.0"
RULES_VERSION = "v0.3"
DATA_SCHEMA_ID = "next-card/data@v0.3"

# ---------------------------------------------------------------- 冻结参数（取数前固定）
TOPIC = "cheetah"
POOLS = ["000300.SH", "000905.SH"]             # 沪深300 + 中证500 = 中证800，展示段首个交易日的点时成分
LOOKBACK_FROM = "20200901"                     # 信号回看可以早于分段起点
DISPLAY = ("20210101", "20221231")
TEST = ("20230101", "20241231")
SIGNAL = dict(vol_mult=2.0, vol_window=20, min_day_ret=0.05, split_factor=1.1)
HORIZON = 20                                   # T+1 开盘进，T+20 收盘出
THRESHOLDS = dict(min_samples=30, advantage_margin=0.05, frozen_at="2026-10-31T11:40:00Z")

QUESTION = "放量上涨之后的 20 个交易日，收益为正的比例比同期一般情况更高吗？"
EXCLUDE_KEYS = ("window_crosses_segment", "entry_unavailable", "exit_unavailable", "overlap")
COVERAGE_KEYS = ("no_volume_reference", "prev_close_missing", "split_in_lookback")

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


def candidates(g: pd.DataFrame, calendar: list[str], split_dates: set[str], segment: tuple[str, str]):
    """一只股票在一个分段里的候选日。

    候选日 = 分段内该股有成交的交易日。返回 (rows, coverage)：
    rows 是能计算信号的候选日（含是否为信号、结果窗口是否可用）；coverage 统计不能计算信号的候选日及原因。
    信号只用 T 日及以前的数据：T 日成交量、此前 20 个有成交日的均量（不含 T 日）、T 日与前一交易日收盘。
    """
    cal = np.asarray(calendar)
    trading = g["trading"].to_numpy()
    vol = g["volume"].to_numpy(dtype=float)
    close = g["close"].to_numpy(dtype=float)
    open_ = g["open"].to_numpy(dtype=float)
    limit_up = g["limit_up"].to_numpy(dtype=float) if "limit_up" in g else np.full(len(cal), np.nan)
    n, w = len(cal), SIGNAL["vol_window"]

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
        j_in, j_out = i + 1, i + HORIZON
        if j_out >= n or cal[j_out] > segment[1]:
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


def segment_stats(name: str, seg: tuple[str, str], records: list[dict], excluded: dict) -> dict:
    out = {"range": {"from": seg[0], "to": seg[1]}}
    for grp in ("signal_group", "baseline_group"):
        out[grp] = group_stats([r for r in records if r["segment"] == name and r["group"] == grp], excluded[(name, grp)])
    out["delta"], out["meets_threshold"] = comparison(
        out["signal_group"]["primary_metric"], out["baseline_group"]["primary_metric"], THRESHOLDS["advantage_margin"])
    return out


def build(px: pd.DataFrame, adj: pd.DataFrame, calendar: list[str], pool: list[str]):
    split_dates = {
        s: set(g.loc[g["ex_factor"] >= SIGNAL["split_factor"], "ex_date"].astype(str)) for s, g in adj.groupby("symbol")
    } if len(adj) else {}
    groups = {s: prepare(g, calendar) for s, g in px.groupby("symbol")}
    records, excluded = [], {}
    coverage = {name: {"candidate_days": 0, **dict.fromkeys(COVERAGE_KEYS, 0)} for name in ("display", "test")}
    diagnostics = {}
    for name, seg in (("display", DISPLAY), ("test", TEST)):
        for grp in ("signal_group", "baseline_group"):
            excluded[(name, grp)] = dict.fromkeys(EXCLUDE_KEYS, 0)
        for s in pool:
            g = groups.get(s)
            if g is None:
                continue
            rows, cov = candidates(g, calendar, split_dates.get(s, set()), seg)
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
    out = {name: segment_stats(name, seg, records, excluded) for name, seg in (("display", DISPLAY), ("test", TEST))}
    return records, out, coverage, diagnostics


# ---------------------------------------------------------------- 输出

def header(as_of: str, snapshot: str, pool: list[str], missing: list[str], coverage: dict, diagnostics: dict) -> dict:
    return {
        "schema": DATA_SCHEMA_ID,
        "file": "taskB",
        "topic": TOPIC,
        "script": "scripts/build_taskB.py",
        "script_version": SCRIPT_VERSION,
        "rules_version": RULES_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "data_as_of": as_of,
        "source": "Panda Data（panda_data 1.0.5）",
        "apis": ["get_stock_daily_pre", "get_index_weights", "get_adj_factor", "get_trade_cal"],
        "benchmark": "基准组：同股票池、同分段、同持有窗口的全部候选日（不是指数）",
        "adjustment": "前复权日线；收益只用同一复权序列内的比值，不受锚点影响",
        "dividends": "前复权价已包含分红送转的影响（相当于分红再投资）",
        "normalization": "不发布价格序列；每条样本只记 C[T+20] / O[T+1] - 1",
        "selection": "股票池内全部股票、两段内全部交易日按同一规则逐日判定，没有人工挑选样本",
        "public_scope": "尚未获得 PandaAI 公开展示许可的明确答复，暂按最保守方式处理：只发布汇总统计，逐条样本不入库",
        "question": QUESTION,
        "signal": {
            "definition": "T 日成交量 ≥ 此前 20 个有成交交易日均量（不含 T 日）的 2 倍，且 T 日收盘涨幅 ≥ 5%",
            "params": {**SIGNAL},
        },
        "primary_metric": {"id": "share_positive_return", "label": "T+1 开盘到 T+20 收盘收益为正的比例"},
        "execution": {"entry": "T+1 开盘", "exit": "T+20 收盘", "horizon_days": HORIZON},
        "pool": {
            "description": f"{' + '.join(POOLS)}（中证800）在 {snapshot} 的成分股，两段共用",
            "size": len(pool),
            "snapshot_date": snapshot,
            "bias_note": "快照日之后调入的股票不在池内；之后调出或退市的股票仍保留，缺数据的样本按排除规则计数。"
                         "中证800 只覆盖大中盘，结论不能推到小盘股",
        },
        "segments": {"lookback_from": LOOKBACK_FROM, "display": {"from": DISPLAY[0], "to": DISPLAY[1]},
                     "test": {"from": TEST[0], "to": TEST[1]}},
        "thresholds": THRESHOLDS,
        "baseline_rule": "同股票池、同一分段、同持有窗口与同样的数据完整性规则，枚举全部候选日，不按信号（也不按信号的反面）筛选",
        "non_overlap_rule": "信号组与基准组分别按标的、分段排序；保留最早有效记录，之后只保留执行日严格晚于上一条保留记录退出日的记录",
        "exclusions": [
            "候选日 = 分段内该股有成交的交易日；trade_status 为空时有成交量视为正常交易",
            "此前不足 20 个有成交交易日、前一交易日没有成交，或量比回看窗口内有送转除权（ex_factor ≥ 1.1）的候选日不能计算信号，两组都不用（见 coverage）",
            "结果窗口（T+1 至 T+20）越过分段终点的记录剔除（window_crosses_segment）",
            "T+1 没有成交或开盘价缺失（entry_unavailable）、T+20 没有成交（exit_unavailable）的记录剔除",
            "不重叠规则去掉的记录计入 overlap",
        ],
        "limitations": [
            "股票池按快照日冻结，存在选择偏差；中证800 只代表大中盘",
            "不重叠只保证同一只股票的持有期不重叠，不同股票同一时段的样本高度相关，不等于独立样本",
            "min_samples 和 advantage_margin 只是这道练习的描述标准，不是统计显著性门槛",
            "未计手续费、滑点、冲击成本和容量；T+1 开盘涨停时实际可能买不到，这类样本保留并在 diagnostics 里计数",
            "结论只描述这两段样本，不回答这条规则以后是否有效",
        ],
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


def write_docs(doc: dict) -> None:
    h = doc["header"]
    v = doc["verdict"]
    seg_name = {"display": "展示段", "test": "检验段"}
    lines = [
        "# 任务 B 猎豹题：样本处理与已知局限（自动生成）", "",
        f"`scripts/build_taskB.py` {h['script_version']} · 数据截至 {h['data_as_of']} · 规则 {h['rules_version']}", "",
        f"研究题目：{h['question']}", "",
        f"- 信号：{h['signal']['definition']}",
        f"- 执行：{h['execution']['entry']}进，{h['execution']['exit']}出；不计费用和滑点",
        f"- 主指标：{h['primary_metric']['label']}；另列平均收益",
        f"- 股票池：{h['pool']['description']}，共 {h['pool']['size']} 只，其中 {h['pool_symbols_without_data']} 只没有取到数据",
        f"- 分段：展示段 {DISPLAY[0]}–{DISPLAY[1]}，检验段 {TEST[0]}–{TEST[1]}；信号回看最早用到 {LOOKBACK_FROM}",
        f"- 阈值：每组至少 {THRESHOLDS['min_samples']} 条；信号组比基准组高出至少 {THRESHOLDS['advantage_margin'] * 100:.0f} 个百分点（{THRESHOLDS['frozen_at']} 取数前冻结）",
        "", "## 结果", "",
        "| 分段 | 组 | 样本数 | 标的数 | 收益为正比例 | 平均收益 | 剔除（越界 / 进场不可用 / 退出不可用 / 重叠） |",
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
            lines.append(f"- {seg_name[seg]}：信号组收益为正的比例{'低' if s['delta'] < 0 else '高'}于基准组，"
                         f"平均收益却{'高' if mean_diff > 0 else '低'}于基准组。比例和均值回答的是不同问题，不能互相替代。")
    lines += ["", "## 样本处理", ""]
    lines += [f"- {x}" for x in h["exclusions"]]
    lines += [f"- 基准组：{h['baseline_rule']}", f"- 不重叠：{h['non_overlap_rule']}", "",
              "不能计算信号的候选日（两组都不用）：", ""]
    for seg in ("display", "test"):
        c = h["coverage"][seg]
        lines.append(f"- {seg_name[seg]}：候选日 {c['candidate_days']}，此前不足 20 个有成交日 {c['no_volume_reference']}，"
                     f"前一交易日没有成交 {c['prev_close_missing']}，回看窗口内有送转除权 {c['split_in_lookback']}")
    lines += ["", "T+1 开盘涨停（实际可能买不到，样本保留）：", ""]
    lines += [f"- {k}：{v}" for k, v in h["diagnostics"].items()]
    lines += ["", "## 已知局限", ""] + [f"- {x}" for x in h["limitations"]]
    lines += ["", "复核：`.venv/bin/python scripts/check_taskB.py` 逐条检查结果窗口不越过分段、各组内不重叠、两组执行口径一致、"
              "信号只用 T 日及以前的数据，并从逐条样本重算汇总与结论。", ""]
    (DOCS_DIR / f"taskB-{TOPIC}.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--topic", default=TOPIC, choices=[TOPIC], help="M1 只做猎豹题")
    ap.parse_args()

    calendar = data.trade_days(LOOKBACK_FROM, TEST[1])
    snapshot = next(d for d in calendar if d >= DISPLAY[0])
    pool = sorted({s for p in POOLS for s in data.index_members(p, snapshot)})
    if not pool:
        raise SystemExit(f"{snapshot} 没有取到成分股")
    px = data.stock_daily(pool, LOOKBACK_FROM, TEST[1], adjusted=True)
    adj = data.adj_events(pool, LOOKBACK_FROM, TEST[1])
    as_of = data.last_trade_date()
    missing = sorted(set(pool) - set(px["symbol"].unique()))

    records, segs, coverage, diagnostics = build(px, adj, calendar, pool)
    doc = {"header": header(as_of, snapshot, pool, missing, coverage, diagnostics), **segs}
    doc["verdict"] = verdict(doc, THRESHOLDS)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / f"taskB_{TOPIC}.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / f"taskB_{TOPIC}_records.json").write_text(json.dumps({
        "script_version": SCRIPT_VERSION, "topic": TOPIC, "horizon": HORIZON, "signal": SIGNAL,
        "segments": {"display": list(DISPLAY), "test": list(TEST)}, "thresholds": THRESHOLDS,
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
