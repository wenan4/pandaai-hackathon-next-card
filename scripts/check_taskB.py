"""任务 B 口径检查（猎豹题 YOU-153，大象题、狐狸题 YOU-166）。

    .venv/bin/python scripts/check_taskB.py [--topic cheetah|elephant|fox]
    .venv/bin/python scripts/check_taskB.py --write-manifest   # 检查全部主题，只把通过的写进 src/config/taskB_topics.json

读 scripts/out/taskB_{topic}_records.json（逐条样本）与 public/data/taskB_{topic}.json（发布的汇总），逐项检查：
1. 结果窗口（进场到退出）完整落在所属分段内；
2. 执行口径：进场是 T 的下一个交易日；退出是 T+20（猎豹）、T+250（大象）或持有月最后一个交易日（狐狸），信号组与基准组相同；
3. 信号只用 T 日及以前的数据，信号组每条都满足冻结的信号条件；月度主题的候选日都是月末交易日；
4. 每个标的、每个分段、每个组内不重叠：执行日严格晚于上一条退出日；
5. 收益口径：C[退出] / O[进场] - 1；狐狸题再减去沪深300 同起止点的收益（超额收益）；
6. 从逐条样本重算样本数、标的数、主指标、平均收益、差值与结论，与发布文件一致；阈值与冻结值一致。
任何一项不通过就非零退出，不输出正面结论；该主题也不会进入已发布主题清单。
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
TOPICS = ("cheetah", "elephant", "fox")
MANIFEST = REPO_ROOT / "src" / "config" / "taskB_topics.json"


def _month_end(cal: list[str], i: int) -> bool:
    return i + 1 >= len(cal) or cal[i + 1][:6] != cal[i][:6]


def _execution_problem(r: dict, topic: str, cal: list[str], pos: dict, horizon) -> str | None:
    t, e, x = pos[r["t"]], pos[r["entry"]], pos[r["exit"]]
    if e - t != 1:
        return "进场不是 T 的下一个交易日"
    if topic == "fox":
        if not _month_end(cal, t):
            return "信号日不是当月最后一个交易日"
        if cal[x][:6] != cal[e][:6] or not _month_end(cal, x):
            return "退出日不是持有月最后一个交易日"
        return None
    if topic == "elephant" and not _month_end(cal, t):
        return "候选日不是月末交易日"
    if x - t != horizon:
        return f"执行口径不是 T+1 进、T+{horizon} 出"
    return None


def _signal_ok(r: dict, topic: str, sig: dict, pos: dict) -> bool:
    if topic == "cheetah":
        return r["vol_ratio"] >= sig["vol_mult"] and r["day_ret"] >= sig["min_day_ret"]
    if topic == "elephant":
        return (pos[r["t"]] - pos[r["lookback_from"]] == sig["lookback_days"]
                and r["lb_return"] > sig["min_return"] and r["lb_mdd"] < sig["max_drawdown"])
    return r["month_return"] > r["bench_month_return"]


def _expected_ret(r: dict, topic: str) -> float:
    ret = r["exit_close"] / r["entry_open"] - 1
    return ret - (r["bench_exit_close"] / r["bench_entry_open"] - 1) if topic == "fox" else ret


def run_checks(rec_doc: dict, published: dict) -> list[str]:
    problems: list[str] = []
    topic = rec_doc.get("topic", "cheetah")
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
        # 信号可以用更早的历史回看（狐狸题的信号月可以早于分段），进场和退出必须完整落在分段内
        if not (r["entry"] >= lo and r["exit"] <= hi and r["t"] < r["entry"] and (topic == "fox" or r["t"] >= lo)):
            bad(r, f"结果窗口 {r['entry']}–{r['exit']} 越过分段 {lo}–{hi}")
        if r["t"] not in pos or r["entry"] not in pos or r["exit"] not in pos or r["lookback_from"] not in pos:
            bad(r, "日期不在交易日历里")
            continue
        problem = _execution_problem(r, topic, cal, pos, horizon)
        if problem:
            bad(r, problem)
        if r["inputs_through"] != r["t"] or not r["lookback_from"] < r["t"]:
            bad(r, "信号用到了 T 日之后的数据，或回看窗口不在 T 日之前")
        if r["group"] == "signal_group" and not _signal_ok(r, topic, sig, pos):
            bad(r, "信号组记录不满足信号条件")
        if not math.isclose(r["ret"], _expected_ret(r, topic), abs_tol=1e-6):
            bad(r, "收益不是冻结的计算口径" + ("（超额收益）" if topic == "fox" else ""))
        by_key[(r["symbol"], r["segment"], r["group"])].append(r)

    for rows in by_key.values():
        rows.sort(key=lambda r: r["t"])
        for prev, cur in zip(rows, rows[1:]):
            if cur["entry"] <= prev["exit"]:
                bad(cur, f"与上一条（退出 {prev['exit']}）重叠")

    h = published["header"]
    if h.get("topic", "cheetah") != topic:
        problems.append(f"发布文件的主题 {h.get('topic')} 与样本 {topic} 不一致")
    if h["thresholds"] != rec_doc["thresholds"]:
        problems.append("发布文件的阈值与冻结值不一致")
    if h["execution"]["horizon_days"] != (None if horizon == "next_month" else horizon):
        problems.append("发布文件的持有天数与样本不一致")
    if (h["primary_metric"]["id"] == "share_positive_excess_return") != (topic == "fox"):
        problems.append("主指标口径与主题不符：狐狸题比较超额收益，其余比较收益")
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


def check_topic(topic: str) -> tuple[list[str], dict | None, int]:
    """返回 (问题列表, 发布文件, 样本条数)。缺文件也算一个问题，不抛异常。"""
    rec_path = REPO_ROOT / "scripts" / "out" / f"taskB_{topic}_records.json"
    pub_path = REPO_ROOT / "public" / "data" / f"taskB_{topic}.json"
    missing = [p.relative_to(REPO_ROOT).as_posix() for p in (rec_path, pub_path) if not p.exists()]
    if missing:
        return [f"缺少 {', '.join(missing)}，先运行 scripts/build_taskB.py --topic {topic}"], None, 0
    rec_doc = json.loads(rec_path.read_text(encoding="utf-8"))
    published = json.loads(pub_path.read_text(encoding="utf-8"))
    return run_checks(rec_doc, published), published, len(rec_doc["records"])


def write_manifest() -> list[str]:
    topics, checked = [], {}
    for topic in TOPICS:
        problems, published, n = check_topic(topic)
        if problems:
            print(f"check_taskB: {topic} 不通过，不进入清单", *problems[:5], sep="\n  ")
            continue
        topics.append(topic)
        checked[topic] = {"records": n, "result": published["verdict"]["result"],
                          "script_version": published["header"]["script_version"], "data_as_of": published["header"]["data_as_of"]}
    MANIFEST.write_text(json.dumps({
        "_comment": "已发布且通过 scripts/check_taskB.py 的任务 B 主题；由 check_taskB.py --write-manifest 生成，不手写",
        "topics": topics, "checked": checked,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return topics


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--topic", default="cheetah", choices=TOPICS)
    ap.add_argument("--write-manifest", action="store_true")
    args = ap.parse_args()
    if args.write_manifest:
        print("check_taskB: 已发布主题", write_manifest())
        return
    problems, published, n = check_topic(args.topic)
    if problems:
        print("check_taskB: 不通过", *problems, sep="\n  ")
        sys.exit(1)
    print(f"check_taskB: {n} 条样本全部通过（{args.topic}，{published['verdict']['result']}）")


if __name__ == "__main__":
    main()
