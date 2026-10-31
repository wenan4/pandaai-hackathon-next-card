"""第二幕 R4–R6 案例筛选与导出（YOU-164）。

    .venv/bin/python scripts/build_cases_act2.py

与第一幕（scripts/build_cases.py）同一套取数、口径、可见 / 揭晓分离和文件头；说法的真假方向与第一幕翻转：
- R4（复核 O1）：前 60 个交易日 D 确实跑赢沪深300，证据结论 supports，关键牌是同期对照；
- R5（复核 O2）：E 三年总体上涨，但最大回撤超过题设的 15%，证据结论 refutes，关键牌是更长历史；近 60 日大涨作干扰；
- R6（复核 O3）：给出 F 过去一年里同类放量上涨的全部历史样本及其后 20 日表现，样本少、结果参差，证据结论 insufficient。
  它和 R3 不同：R3 是“未来还没发生”，R6 是“已有一小撮可以核对的历史样本，但不够下结论”。

产物：
- public/data/cases_act2_visible.json   揭晓前可见：T 日收盘及以前，相对日期，没有真实日期和代码
- public/data/cases_act2_reveal.json    揭晓后：T+1 … T+20 与 source 块
- public/data/cases_reveal_R4..R6.json  按轮拆分的揭晓文件，前端只请求已锁定的那一轮
- src/config/rounds_act2.json           第二幕命题定稿
- scripts/out/candidates_report_act2.md 所有候选（不入库）
- docs/cases-report-act2.md             选中案例的条件检查（入库）

筛选只用 T 日及以前的数据；同一轮多个候选时按 T 日前 60 日平均成交额最高者自动选取，不参考 T 之后的走势。
第二幕的标的与第一幕三轮、任务 A 都不同；决策日与它们至少相隔 120 个交易日，避免时段重叠。
"""
from __future__ import annotations

import contextlib
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_cases as bc  # noqa: E402
from pd_common import data  # noqa: E402
from pd_common.client import REPO_ROOT  # noqa: E402
from pd_common.metrics import max_drawdown, period_return  # noqa: E402

SCRIPT_VERSION = "cases-act2-0.1.0"

# ---------------------------------------------------------------- 冻结参数（2026-10-31T15:00Z，筛选前固定）
R4 = dict(min_r60=0.10, min_margin_over_bench=0.03)
R5 = dict(min_r3y=0.10, min_mdd3y=0.20, min_r60=0.10)
R6 = dict(vol_mult=3.0, min_day_ret=0.05, lookback=243, horizon=20, min_signals=3, max_signals=6,
          positive_share=(1 / 3, 2 / 3), split_factor=1.1)
MIN_GAP_TRADING_DAYS = 120                     # 与第一幕、任务 A 的决策日至少相隔这么多交易日

CLAIMS = {
    "R4": f"过去这 60 个交易日，D 的涨幅高于这张卡指定的市场基准（{bc.BENCHMARK[1]}）。",
    "R5": "过去三年，E 总体上涨，而且从阶段高点往下最多跌了不到 15%。",
    "R6": "在这类放量上涨出现之后的 20 个交易日，F 的收盘价通常会更高。",
}
VERDICTS = {"R4": "supports", "R5": "refutes", "R6": "insufficient"}
LABELS = {"R4": "D", "R5": "E", "R6": "F"}
ROUND_IDS = ("R4", "R5", "R6")
# 复用第一幕的导出函数：它按轮次编号查标签、命题与证据结论，这里把第二幕的三项登记进去
bc.LABELS.update(LABELS)
bc.CLAIMS.update(CLAIMS)
bc.VERDICTS.update(VERDICTS)

OUT_DIR = REPO_ROOT / "scripts" / "out"
DATA_DIR = REPO_ROOT / "public" / "data"


def act1_and_task_a() -> tuple[set[str], list[str]]:
    """已经用掉的标的与决策日：第一幕三轮 + 任务 A。"""
    reveal = json.loads((DATA_DIR / "cases_reveal.json").read_text(encoding="utf-8"))
    task_a = json.loads((DATA_DIR / "taskA.json").read_text(encoding="utf-8"))
    symbols = {r["source"]["symbol"] for r in reveal["rounds"]} | {task_a["source"]["symbol"]}
    dates = [r["source"]["decision_date"] for r in reveal["rounds"]] + [task_a["source"]["decision_date"]]
    return symbols, dates


# ---------------------------------------------------------------- 条件

def check_r4(g, bench_close, t):
    paired = bc.comparison_window(g, bench_close, t)
    if paired is None:
        return None
    s60, b60 = paired
    r60, b_r60 = period_return(s60), period_return(b60)
    c = {
        "r60": r60, "bench_r60": b_r60,
        "pass_r60_ge_10pct": r60 is not None and r60 >= R4["min_r60"],
        "pass_asset_higher_by_3pp": None not in (r60, b_r60) and r60 - b_r60 >= R4["min_margin_over_bench"],
    }
    c["pass"] = c["pass_r60_ge_10pct"] and c["pass_asset_higher_by_3pp"]
    return c


def check_r5(g, t):
    s60 = bc.series_window(g["close"], t, bc.WIN_SHORT)
    s3y = bc.series_window(g["close"], t, bc.WIN_LONG)
    if not (s60 and s3y):
        return None
    r60, r3y, mdd = period_return(s60), period_return(s3y), max_drawdown(s3y)
    c = {
        "r60": r60, "r3y": r3y, "mdd3y": mdd,
        "pass_r3y_ge_10pct": r3y is not None and r3y >= R5["min_r3y"],
        "pass_mdd_ge_20pct": mdd is not None and mdd >= R5["min_mdd3y"],
        "pass_r60_ge_10pct": r60 is not None and r60 >= R5["min_r60"],
    }
    c["pass"] = c["pass_r3y_ge_10pct"] and c["pass_mdd_ge_20pct"] and c["pass_r60_ge_10pct"]
    return c


def surge_table(g: pd.DataFrame, split_dates: set[str]) -> list[dict]:
    """一只股票全部历史上的放量上涨日（与 R3 同一定义），以及每次之后 20 个交易日的收盘涨跌。

    量比 = 当日量 ÷ 之前 20 个非停牌日均量（不含当日）；回看窗口内有送转除权的不算。
    相邻信号去重：保留最早一次，下一次必须出现在上一次的 20 日观察窗口结束之后。
    """
    idx = g.index
    trading = ((g["trade_status"] == 0) & (g["volume"] > 0) & np.isfinite(g["volume"])).to_numpy()
    vol = g["volume"].to_numpy(dtype=float)
    close = g["close"].to_numpy(dtype=float)
    tpos = np.flatnonzero(trading)
    csum = np.concatenate([[0.0], np.cumsum(vol[tpos])])
    rank = np.full(len(idx), -1)
    rank[tpos] = np.arange(len(tpos))
    splits = np.asarray(sorted(split_dates))
    out, last = [], -10**9
    for j in tpos:
        k = rank[j]
        if k < 20 or j == 0 or j + R6["horizon"] >= len(idx):
            continue
        ref = (csum[k] - csum[k - 20]) / 20
        ret = close[j] / close[j - 1] - 1
        if not (np.isfinite(ret) and ref > 0 and vol[j] >= R6["vol_mult"] * ref and ret >= R6["min_day_ret"]):
            continue
        lb_from = idx[tpos[k - 20]]
        if len(splits) and np.any((splits >= lb_from) & (splits <= idx[j])):
            continue
        fwd = close[j + R6["horizon"]] / close[j] - 1
        if not np.isfinite(fwd) or j <= last + R6["horizon"]:
            continue
        out.append({"pos": int(j), "date": idx[j], "vol_ratio": float(vol[j] / ref), "day_ret": float(ret), "fwd20": float(fwd)})
        last = j
    return out


def check_r6(g, t, table: list[dict]):
    """T 之前 243 个交易日内、20 日观察窗口在 T 日收盘前已经结束的信号。"""
    i = g.index.get_loc(t)
    hits = [x for x in table if i - R6["lookback"] <= x["pos"] and x["pos"] + R6["horizon"] <= i]
    n = len(hits)
    pos = sum(x["fwd20"] > 0 for x in hits)
    lo, hi = R6["positive_share"]
    c = {
        "n_signals": n, "n_positive": pos,
        "signals": [{"date": x["date"], "offset": x["pos"] - i, "vol_ratio": x["vol_ratio"], "day_ret": x["day_ret"], "fwd20": x["fwd20"]} for x in hits],
        "pass_count_3_to_6": R6["min_signals"] <= n <= R6["max_signals"],
        "pass_mixed": n > 0 and 0 < pos < n and lo <= pos / n <= hi,
    }
    c["pass"] = c["pass_count_3_to_6"] and c["pass_mixed"]
    return c


# ---------------------------------------------------------------- 主流程

def scan():
    days, t_days, pools, px, bench, _sectors, adj = bc.load()
    groups = bc.by_symbol(px, days)
    bench_close = bench.set_index("date")["close"].reindex(days)
    split_dates = {s: set(g.loc[g["ex_factor"] >= R6["split_factor"], "ex_date"].astype(str)) for s, g in adj.groupby("symbol")}
    used_symbols, used_dates = act1_and_task_a()
    pos = {d: k for k, d in enumerate(days)}
    far = lambda t: all(abs(pos[t] - pos[d]) >= MIN_GAP_TRADING_DAYS for d in used_dates if d in pos)  # noqa: E731

    tables: dict[str, list[dict]] = {}
    cands: dict[str, list[bc.Candidate]] = {r: [] for r in ROUND_IDS}
    stats = {r: {"evaluated": 0, "passed": 0} for r in ROUND_IDS}
    stats["excluded_records"] = {}
    stats["excluded_symbols"] = sorted(used_symbols)
    for t in t_days:
        if not far(t):
            stats["excluded_records"]["near_used_decision_date"] = stats["excluded_records"].get("near_used_decision_date", 0) + 1
            continue
        for s in pools[t]:
            g = groups.get(s)
            if s in used_symbols or g is None or t not in g.index or g.loc[t, "trade_status"] != 0:
                continue
            error = bc.case_data_error(g, bench_close, t)
            if error:
                stats["excluded_records"][error] = stats["excluded_records"].get(error, 0) + 1
                continue
            i = g.index.get_loc(t)
            liq = float(g["amount"].iloc[max(0, i - bc.WIN_SHORT + 1): i + 1].mean())
            name = str(g["name"].iloc[i])
            if s not in tables:
                tables[s] = surge_table(g, split_dates.get(s, set()))
            for rid, fn in (("R4", lambda: check_r4(g, bench_close, t)), ("R5", lambda: check_r5(g, t)),
                            ("R6", lambda: check_r6(g, t, tables[s]))):
                c = fn()
                if c is None:
                    continue
                stats[rid]["evaluated"] += 1
                if c["pass"]:
                    stats[rid]["passed"] += 1
                    cands[rid].append(bc.Candidate(rid, s, name, t, liq, c))
    return cands, stats, groups, bench_close, t_days


def pick(cands):
    """每轮取 T 日前 60 日平均成交额最高的候选；三轮标的互不相同。候选最少的先选。"""
    chosen, used = {}, set()
    for rid in sorted(ROUND_IDS, key=lambda r: len(cands[r])):
        pool = sorted(cands[rid], key=lambda c: -c.liquidity)
        chosen[rid] = next((c for c in pool if c.symbol not in used), None)
        if chosen[rid]:
            used.add(chosen[rid].symbol)
    return chosen


def write_report(cands, stats, chosen, t_days):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    lines = [f"# 第二幕候选报告（{SCRIPT_VERSION}）", "",
             f"候选决策日 {len(t_days)} 个（{t_days[0]} – {t_days[-1]}，每 {bc.T_STEP} 个交易日一个），与第一幕同一套点时股票池。", ""]
    for rid in ROUND_IDS:
        lines += [f"## {rid}  评估 {stats[rid]['evaluated']}，通过 {stats[rid]['passed']}", ""]
        lines += ["| 代码 | 名称 | T | 60日均成交额(亿) | 关键数值 |", "|---|---|---|---|---|"]
        for c in sorted(cands[rid], key=lambda c: -c.liquidity)[:200]:
            keys = {k: v for k, v in c.checks.items() if not k.startswith("pass") and k != "signals"}
            lines.append(f"| {c.symbol} | {c.name} | {c.t} | {c.liquidity / 1e8:.2f} | {bc.fmt(keys)} |")
        ch = chosen.get(rid)
        lines += ["", f"**选中**：{ch.symbol} {ch.name} T={ch.t}" if ch else "**无候选**", ""]
    (OUT_DIR / "candidates_report_act2.md").write_text("\n".join(lines), encoding="utf-8")


def export_round(c, g, bench_close):
    visible, reveal = bc.export_round(c, g, bench_close)
    visible["act"] = 2
    visible["label"] = LABELS[c.round_id]
    visible["claim"] = CLAIMS[c.round_id]
    src = reveal["source"]
    src["claim"] = CLAIMS[c.round_id]
    src["evidence_verdict"] = VERDICTS[c.round_id]
    src["selection"] = ("在通过全部条件的候选中，按 T 日前 60 个交易日平均成交额最高者自动选取；"
                        "第二幕三轮标的互不相同，也不同于第一幕和任务 A，决策日与它们至少相隔 120 个交易日。")
    checks = {k: (round(v, 6) if isinstance(v, float) else v) for k, v in c.checks.items() if k != "signals"}
    if c.round_id == "R6":
        sig = c.checks["signals"]
        checks["signals"] = [{"date": x["date"], "offset": x["offset"], "vol_ratio": round(x["vol_ratio"], 4),
                              "day_ret": round(x["day_ret"], 6), "fwd20": round(x["fwd20"], 6)} for x in sig]
        # 揭晓前可见：只有相对日期；每次信号后的 20 日观察窗口都在 T 日收盘前结束
        visible["cards"]["leopard"]["signals"] = {
            "lookback": R6["lookback"], "horizon": R6["horizon"],
            "definition": f"当日成交量 ≥ 之前 20 个交易日均量（不含当日）的 {R6['vol_mult']:g} 倍，且当日涨幅 ≥ {R6['min_day_ret']:.0%}",
            "items": [{"offset": x["offset"], "vol_ratio": round(x["vol_ratio"], 4), "day_return": round(x["day_ret"], 6),
                       "forward_return": round(x["fwd20"], 6)} for x in sig],
        }
    src["checks"] = checks
    return visible, reveal


def export(chosen, groups, bench_close, stats, t_days, as_of):
    missing = [r for r, c in chosen.items() if c is None]
    if missing:
        raise SystemExit(f"以下轮次没有候选，需要调整条件并重新冻结：{missing}")
    vis_rounds, rev_rounds = [], []
    for rid in ROUND_IDS:
        v, r = export_round(chosen[rid], groups[chosen[rid].symbol], bench_close)
        vis_rounds.append(v)
        rev_rounds.append(r)
    visible = {
        "header": {
            "schema": bc.DATA_SCHEMA_ID,
            "file": "cases_act2_visible",
            "script_version": SCRIPT_VERSION,
            "rules_version": bc.RULES_VERSION,
            "note": "第二幕揭晓前可加载。只含 T 日收盘及以前的数据，使用相对日期，不含真实日期、代码或名称；完整文件头在 cases_act2_reveal.json",
        },
        "rounds": vis_rounds,
    }
    head = bc.full_header(stats, t_days, as_of)
    head.update({
        "script": "scripts/build_cases_act2.py",
        "script_version": SCRIPT_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "apis": ["get_stock_daily_pre", "get_index_daily", "get_index_weights", "get_adj_factor", "get_trade_cal"],
        "filters": {"R4": R4, "R5": R5, "R6": {**R6, "positive_share": [round(x, 6) for x in R6["positive_share"]]},
                    "min_gap_trading_days": MIN_GAP_TRADING_DAYS},
        "exclusions": [
            "决策日停牌（trade_status ≠ 0）",
            "按交易日历对齐；历史不足 729 日、标的或基准窗口缺失，或揭晓窗口不足 20 日",
            "T+1 停牌、无成交量，或开盘价缺失／非正；排除数量见 sample.excluded_records",
            "第一幕三轮与任务 A 用过的标的；与它们的决策日相隔不足 120 个交易日的候选决策日",
            "R6：量比回看窗口内有送转除权（ex_factor ≥ 1.1）的信号不计；相邻信号的 20 日观察窗口不重叠",
        ],
        "selection": "每轮在通过条件的候选中按 T 日前 60 日平均成交额最高者自动选取；未参考 T 之后数据",
        "act": 2,
    })
    head.pop("industry_note", None)
    reveal = {"header": {**head, "file": "cases_act2_reveal"}, "rounds": rev_rounds}
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "cases_act2_visible.json").write_text(json.dumps(visible, ensure_ascii=False, separators=(",", ":"), default=bc._np), encoding="utf-8")
    (DATA_DIR / "cases_act2_reveal.json").write_text(json.dumps(reveal, ensure_ascii=False, indent=1, default=bc._np), encoding="utf-8")
    for r in rev_rounds:
        one = {"header": {**reveal["header"], "file": f"cases_reveal_{r['round_id']}"}, "rounds": [r]}
        (DATA_DIR / f"cases_reveal_{r['round_id']}.json").write_text(json.dumps(one, ensure_ascii=False, indent=1, default=bc._np), encoding="utf-8")
    (REPO_ROOT / "src" / "config" / "rounds_act2.json").write_text(json.dumps({
        "_comment": "第二幕命题定稿，由 scripts/build_cases_act2.py 生成，与 public/data/cases_act2_*.json 对齐",
        "rules_version": bc.RULES_VERSION,
        "rounds": [{"round_id": r, "act": 2, "label": LABELS[r], "claim": CLAIMS[r], "evidence_verdict": VERDICTS[r],
                    "benchmark_name": bc.BENCHMARK[1]} for r in ROUND_IDS],
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_docs(reveal)


def write_docs(reveal):
    h = reveal["header"]
    lines = ["# 第二幕案例检查（自动生成）", "",
             f"`scripts/build_cases_act2.py` {h['script_version']} · 数据截至 {h['data_as_of']} · 规则 {h['rules_version']}", "",
             f"股票池：{h['pool']}；基准：{h['benchmark']}；候选决策日 {h['candidate_decision_days']['count']} 个"
             f"（{h['candidate_decision_days']['from']} – {h['candidate_decision_days']['to']}）。"
             f"排除第一幕与任务 A 的标的 {', '.join(h['sample']['excluded_symbols'])}，以及与它们的决策日相隔不足 {MIN_GAP_TRADING_DAYS} 个交易日的候选决策日。", "",
             "说法的真假方向与第一幕翻转：R4 跑赢（supports）、R5 回撤超过题设（refutes）、R6 历史样本少且参差（insufficient）。", "",
             "| 轮次 | 评估 | 通过 |", "|---|---|---|"]
    for rid in ROUND_IDS:
        st = h["sample"][rid]
        lines.append(f"| {rid} | {st['evaluated']} | {st['passed']} |")
    for r in reveal["rounds"]:
        src = r["source"]
        lines += ["", f"## {r['round_id']} · {src['symbol']} {src['name']} · T = {src['decision_date']}", "",
                  f"命题：{src['claim']}（证据结论：`{src['evidence_verdict']}`）", "", "| 条件 / 数值 | 结果 |", "|---|---|"]
        for k, v in src["checks"].items():
            if k == "signals":
                v = "; ".join(f"{x['date']} 量比 {x['vol_ratio']:.2f} 当日 {x['day_ret']:.2%} 之后20日 {x['fwd20']:+.2%}" for x in v)
            lines.append(f"| {k} | {v} |")
        a = r["after"]
        lines += ["", f"揭晓（T+1 开盘 → T+20 收盘）：{a['return_open_t1_to_close_t20']:.2%}；"
                      f"T 收盘 → T+20 收盘：{a['return_close_t_to_close_t20']:.2%}；T+1 开盘涨停：{a['t1_open_at_limit_up']}"]
    lines += ["", "选取规则：" + h["selection"] + "。", "", "公开展示：" + h["public_scope"] + "。", ""]
    (REPO_ROOT / "docs" / "cases-report-act2.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    with contextlib.redirect_stdout(io.StringIO()):
        cands, stats, groups, bench_close, t_days = scan()
        as_of = data.last_trade_date()
    chosen = pick(cands)
    write_report(cands, stats, chosen, t_days)
    export(chosen, groups, bench_close, stats, t_days, as_of)
    print(json.dumps({k: v for k, v in stats.items() if k != "excluded_symbols"}, ensure_ascii=False))
    for rid, c in chosen.items():
        print(rid, c.symbol, c.name, c.t, {k: v for k, v in c.checks.items() if not k.startswith("pass") and k != "signals"})
    print("已写入 public/data/cases_act2_*.json、cases_reveal_R4..R6.json、src/config/rounds_act2.json、docs/cases-report-act2.md")
