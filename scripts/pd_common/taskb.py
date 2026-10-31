"""任务 B 的结论判定。

必须与 src/engine/taskB.ts 保持同一份规则；两边共用 src/engine/fixtures/taskB_verdict_cases.json。
先检查数据，再检查阈值：任一段任一组样本少于 min_samples 或缺主指标 → insufficient_evidence；
否则信号组主指标比基准组高出至少 advantage_margin（刚好等于也算）的分段算“达到”。
"""
from __future__ import annotations

from typing import Mapping

# 主指标保留 6 位小数，差值比较留一点余量，避免 0.6 - 0.55 这类浮点误差把“刚好等于”判成未达到
EPS = 1e-9
SEGMENTS = ("display", "test")
GROUPS = ("signal_group", "baseline_group")


def comparison(signal_metric: float | None, baseline_metric: float | None, margin: float) -> tuple[float | None, bool | None]:
    """一个分段内的 delta 与 meets_threshold；任一组缺指标时两者都为 None。"""
    if signal_metric is None or baseline_metric is None:
        return None, None
    delta = round(signal_metric - baseline_metric, 6)
    return delta, delta >= margin - EPS


def verdict(data: Mapping, thresholds: Mapping) -> dict:
    """data 形如 {display: {signal_group: {n_records, primary_metric}, baseline_group: {...}}, test: {...}}。"""
    for seg in SEGMENTS:
        for grp in GROUPS:
            g = data[seg][grp]
            if g.get("primary_metric") is None or g.get("n_records", 0) < thresholds["min_samples"]:
                return {"result": "insufficient_evidence"}
    meets = {}
    for seg in SEGMENTS:
        _, ok = comparison(data[seg]["signal_group"]["primary_metric"], data[seg]["baseline_group"]["primary_metric"],
                           thresholds["advantage_margin"])
        meets[seg] = bool(ok)
    if meets["display"] and meets["test"]:
        return {"result": "both_segments"}
    if meets["display"] or meets["test"]:
        return {"result": "segment_difference", "only_segment": "display" if meets["display"] else "test"}
    return {"result": "no_observed_advantage"}
