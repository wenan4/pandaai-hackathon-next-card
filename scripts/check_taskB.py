"""任务 B 口径检查（YOU-153）。

    .venv/bin/python scripts/check_taskB.py [--topic cheetah]

读 scripts/out/taskB_{topic}_records.json（逐条样本）与 public/data/taskB_{topic}.json（发布的汇总），逐项检查：
1. 结果窗口（T+1 至 T+20）完整落在所属分段内；
2. 执行口径：进场是 T 的下一个交易日，退出是 T 之后第 20 个交易日，信号组与基准组相同；
3. 信号只用 T 日及以前的数据，信号组每条都满足冻结的信号条件；
4. 每个标的、每个分段、每个组内不重叠：执行日严格晚于上一条退出日；
5. 从逐条样本重算样本数、标的数、主指标、平均收益、差值与结论，与发布文件一致；阈值与冻结值一致。
任何一项不通过就非零退出，不输出正面结论。
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pd_common.client import REPO_ROOT  # noqa: E402
from pd_common.taskb import comparison, verdict  # noqa: E402

GROUPS = ("signal_group", "baseline_group")


def run_checks(rec_doc: dict, published: dict) -> list[str]:
    problems: list[str] = []
    cal = rec_doc["calendar"]
    pos = {d: i for i, d in enumerate(cal)}
    horizon = rec_doc["horizon"]
    sig = rec_doc["signal"]
    segs = rec_doc["segments"]

    def bad(r: dict, msg: str) -> None:
        if len(problems) < 50:
            problems.append(f"{r.get('symbol')} {r.get('segment')} {r.get('group')} T={r.get('t')}: {msg}")

    by_key: dict[tuple, list[dict]] = defaultdict(list)
    for r in rec_doc["records"]:
        lo, hi = segs[r["segment"]]
        if not (lo <= r["t"] and r["entry"] >= lo and r["exit"] <= hi):
            bad(r, f"结果窗口 {r['entry']}–{r['exit']} 越过分段 {lo}–{hi}")
        if r["t"] not in pos or r["entry"] not in pos or r["exit"] not in pos:
            bad(r, "日期不在交易日历里")
            continue
        if pos[r["entry"]] - pos[r["t"]] != 1 or pos[r["exit"]] - pos[r["t"]] != horizon:
            bad(r, f"执行口径不是 T+1 进、T+{horizon} 出")
        if r["inputs_through"] != r["t"] or not r["lookback_from"] < r["t"]:
            bad(r, "信号用到了 T 日之后的数据，或回看窗口不在 T 日之前")
        if r["group"] == "signal_group" and not (r["vol_ratio"] >= sig["vol_mult"] and r["day_ret"] >= sig["min_day_ret"]):
            bad(r, "信号组记录不满足信号条件")
        if not math.isclose(r["ret"], r["exit_close"] / r["entry_open"] - 1, abs_tol=1e-6):
            bad(r, "收益不是 C[T+20] / O[T+1] - 1")
        by_key[(r["symbol"], r["segment"], r["group"])].append(r)

    for rows in by_key.values():
        rows.sort(key=lambda r: r["t"])
        for prev, cur in zip(rows, rows[1:]):
            if cur["entry"] <= prev["exit"]:
                bad(cur, f"与上一条（退出 {prev['exit']}）重叠")

    h = published["header"]
    if h["thresholds"] != rec_doc["thresholds"]:
        problems.append("发布文件的阈值与冻结值不一致")
    if h["execution"]["horizon_days"] != horizon:
        problems.append("发布文件的持有天数与样本不一致")
    for seg in ("display", "test"):
        if [h["segments"][seg]["from"], h["segments"][seg]["to"]] != segs[seg]:
            problems.append(f"{seg} 分段边界与样本不一致")
        metrics = {}
        for grp in GROUPS:
            rows = [r for r in rec_doc["records"] if r["segment"] == seg and r["group"] == grp]
            g = published[seg][grp]
            pm = round(sum(r["ret"] > 0 for r in rows) / len(rows), 6) if rows else None
            mr = round(sum(r["ret"] for r in rows) / len(rows), 6) if rows else None
            expected = {"n_records": len(rows), "n_symbols": len({r["symbol"] for r in rows}), "primary_metric": pm, "mean_return": mr}
            for k, v in expected.items():
                if g[k] != v:
                    problems.append(f"{seg}.{grp}.{k}：发布 {g[k]}，重算 {v}")
            metrics[grp] = pm
        delta, meets = comparison(metrics["signal_group"], metrics["baseline_group"], h["thresholds"]["advantage_margin"])
        if (published[seg]["delta"], published[seg]["meets_threshold"]) != (delta, meets):
            problems.append(f"{seg} 差值或是否达到阈值与重算不一致")
    if published["verdict"] != verdict(published, h["thresholds"]):
        problems.append("结论与共用判定函数的结果不一致")
    return problems


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--topic", default="cheetah")
    topic = ap.parse_args().topic
    rec_path = REPO_ROOT / "scripts" / "out" / f"taskB_{topic}_records.json"
    pub_path = REPO_ROOT / "public" / "data" / f"taskB_{topic}.json"
    if not rec_path.exists():
        raise SystemExit(f"缺少 {rec_path.relative_to(REPO_ROOT)}，先运行 scripts/build_taskB.py")
    rec_doc = json.loads(rec_path.read_text(encoding="utf-8"))
    published = json.loads(pub_path.read_text(encoding="utf-8"))
    problems = run_checks(rec_doc, published)
    if problems:
        print("check_taskB: 不通过", *problems, sep="\n  ")
        sys.exit(1)
    print(f"check_taskB: {len(rec_doc['records'])} 条样本全部通过（{topic}，{published['verdict']['result']}）")


if __name__ == "__main__":
    main()
