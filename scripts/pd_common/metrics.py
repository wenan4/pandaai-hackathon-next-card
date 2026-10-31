"""共用计算口径：区间收益、最大回撤、跑赢判断、归一化。

必须与 src/engine/metrics.ts 保持同一份公式；两边共用 src/engine/fixtures/metrics_cases.json 做一致性测试。
"""
from __future__ import annotations

import math
from typing import Literal, Sequence

Comparison = Literal["outperform", "underperform", "insufficient"]


def _finite(v: float) -> bool:
    return isinstance(v, (int, float)) and math.isfinite(v)


def period_return(series: Sequence[float]) -> float | None:
    """区间收益：末值 / 首值 - 1。少于 2 个点或首值非正时返回 None。"""
    if len(series) < 2:
        return None
    first, last = series[0], series[-1]
    if not (_finite(first) and first > 0) or not _finite(last):
        return None
    return last / first - 1


def max_drawdown(series: Sequence[float]) -> float | None:
    """最大回撤：从此前最高点往下跌的最大比例，返回非负小数。"""
    if len(series) < 2:
        return None
    peak = -math.inf
    mdd = 0.0
    for v in series:
        if not _finite(v) or v <= 0:
            return None
        if v > peak:
            peak = v
        dd = (peak - v) / peak
        if dd > mdd:
            mdd = dd
    return mdd


def compare_to_benchmark(asset: Sequence[float], benchmark: Sequence[float]) -> Comparison:
    """同一区间内标的是否跑赢基准；收益相同不算跑赢；长度不一致视为证据不足。"""
    if len(asset) != len(benchmark):
        return "insufficient"
    a, b = period_return(asset), period_return(benchmark)
    if a is None or b is None:
        return "insufficient"
    return "outperform" if a > b else "underperform"


def normalize(series: Sequence[float], base: float = 100) -> list[float]:
    """归一化为起点 = base。"""
    if not series or not (_finite(series[0]) and series[0] > 0):
        return []
    first = series[0]
    return [(v * base) / first for v in series]
