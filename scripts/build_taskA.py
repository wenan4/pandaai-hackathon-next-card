"""任务 A「同一起点，再比一次」的标的 D 数据（YOU-152）。

    .venv/bin/python scripts/build_taskA.py   # 先运行过 build_cases.py

产物 public/data/taskA.json：
- step1（对应 O1）：D 与沪深300 同一 60 日窗口。unaligned 是两条起点不同的线（各自从 3 年归一化序列中截取），
  aligned 是两条线都以窗口首日 = 100 对齐后的结果；答案由共用口径 compare_to_benchmark 计算。
- step2（对应 O2）：D 约 3 年序列；命题“总体上涨，且最大回撤不到 15%”是否成立由 period_return / max_drawdown 计算。

任务本身允许看到全部区间，所以不拆可见 / 揭晓两部分；不过 source 块（真实代码与日期）仍建议任务结束后再展示。
选 D 只用 T 日及以前的数据，并避开 A/B/C 的代码、申万一级行业，决策日与它们相隔至少 120 个交易日。
"""
from __future__ import annotations

import contextlib
from datetime import datetime, timezone
import hashlib
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_cases as bc  # noqa: E402
from pd_common import data  # noqa: E402
from pd_common.client import REPO_ROOT  # noqa: E402
from pd_common.metrics import compare_to_benchmark, max_drawdown, normalize, period_return  # noqa: E402

SCRIPT_VERSION = "taskA-0.1.3"
STEP2_CLAIM = "过去三年，D 总体上涨，而且从阶段高点往下最多跌了不到 15%。"
STEP2_MAX_MDD = 0.15
MIN_GAP_DAYS = 120  # D 的决策日与 A/B/C 至少相隔的交易日数，避免基准走势与第一幕重合到能凭记忆作答


def step2_answer(series: list[float]) -> str:
    r, mdd = period_return(series), max_drawdown(series)
    if r is None or mdd is None:
        return "insufficient"
    return "supports" if r > 0 and mdd < STEP2_MAX_MDD else "refutes"


def game_fingerprint(published):
    """对 JSON 内容而非平台换行符取校验值，Windows/Linux 检出保持一致。"""
    canonical = json.dumps(published, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def load_published_cases():
    """绑定实际已发布的第一幕，不从本次候选重新挑选 A/B/C。"""
    path = REPO_ROOT / "public" / "data" / "cases_reveal.json"
    raw = path.read_bytes()
    published = json.loads(raw.decode("utf-8"))
    if published["header"]["rules_version"] != bc.RULES_VERSION:
        raise ValueError("已发布第一幕的规则版本与任务 A 不一致")
    rounds = published["rounds"]
    if len(rounds) != 3 or {r["round_id"] for r in rounds} != {"R1", "R2", "R3"}:
        raise ValueError("已发布第一幕必须包含完整且不重复的 R1/R2/R3")
    chosen = {}
    for r in rounds:
        src = r["source"]
        chosen[r["round_id"]] = bc.Candidate(
            r["round_id"], src["symbol"], src["name"], src["decision_date"], 0.0)
    if len({c.symbol for c in chosen.values()}) != 3:
        raise ValueError("已发布第一幕的三个标的必须互不相同")
    binding = {"file": "cases_reveal.json", "sha256": game_fingerprint(published),
               "hash_format": "canonical-json-utf8",
               "script_version": published["header"]["script_version"],
               "rules_version": published["header"]["rules_version"],
               "data_as_of": published["header"]["data_as_of"]}
    return chosen, binding


def task_windows(g, bench_close, t):
    """任务的两条长序列必须在同一完整窗口内，才能生成两种对齐状态。"""
    if g is None:
        return None
    s3y = bc.series_window(g["close"], t, bc.WIN_LONG)
    b3y = bc.series_window(bench_close, t, bc.WIN_LONG)
    if s3y is None or b3y is None:
        return None
    i, j = g.index.get_loc(t), bench_close.index.get_loc(t)
    if not g.index[i - bc.WIN_LONG:i + 1].equals(bench_close.index[j - bc.WIN_LONG:j + 1]):
        return None
    return s3y, b3y


def industry_code(membership, symbol, on):
    code = data.industry_on(membership, symbol, on)
    if code is None or str(code).strip().lower() in {"", "nan", "none", "null", "<na>"}:
        return None
    return str(code).strip()


def pick_d(cands, chosen, membership, calendar, groups, bench_close):
    """从 R1 / R2 类候选中选 D：避开 A/B/C 的代码、行业，决策日相隔至少 MIN_GAP_DAYS 个交易日，按 T 日前 60 日平均成交额取最高者。"""
    pos = {d: k for k, d in enumerate(calendar)}
    used_syms = {c.symbol for c in chosen.values()}
    used_inds = {industry_code(membership, c.symbol, c.t) for c in chosen.values()}
    if any(not ind for ind in used_inds):
        raise ValueError("无法确认已发布 A/B/C 的行业，不能证明 D 与它们不同行业")
    if any(c.t not in pos for c in chosen.values()):
        raise ValueError("已发布 A/B/C 的决策日不在本次交易日历内")
    used_pos = [pos[c.t] for c in chosen.values()]
    pool = [c for rid in ("R1", "R2") for c in cands[rid]]
    # 从高到低找第一个有效候选，缺行业／缺数据的高成交额候选不能遮住后面的有效案例。
    for c in sorted(pool, key=lambda c: -c.liquidity):
        if c.symbol in used_syms or c.t not in pos:
            continue
        if not all(abs(pos[c.t] - p) >= MIN_GAP_DAYS for p in used_pos):
            continue
        industry = industry_code(membership, c.symbol, c.t)
        if not industry or industry in used_inds:
            continue
        if task_windows(groups.get(c.symbol), bench_close, c.t) is None:
            continue
        return c
    return None


def build():
    chosen, game_binding = load_published_cases()
    with contextlib.redirect_stdout(io.StringIO()):
        cands, stats, groups, bench_close, t_days, _ = bc.scan(include_r3=False)
        membership = data.industry_membership("L1")
        as_of = data.last_trade_date()
    d = pick_d(cands, chosen, membership, list(bench_close.index), groups, bench_close)
    if d is None:
        raise SystemExit("没有满足条件的标的 D")

    g = groups[d.symbol]
    i = g.index.get_loc(d.t)
    dates = g.index
    s3y, b3y = task_windows(g, bench_close, d.t)
    s60 = s3y[-(bc.WIN_SHORT + 1):]
    b60 = b3y[-(bc.WIN_SHORT + 1):]
    n3y_s, n3y_b = normalize(s3y), normalize(b3y)

    task = {
        "header": {
            "schema": bc.DATA_SCHEMA_ID,
            "file": "taskA",
            "script": "scripts/build_taskA.py",
            "script_version": SCRIPT_VERSION,
            "rules_version": bc.RULES_VERSION,
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "game_cases": game_binding,
            "data_as_of": as_of,
            "source": "Panda Data（panda_data 1.0.5）",
            "apis": ["get_stock_daily_pre", "get_index_daily", "get_index_weights", "get_industry_constituents"],
            "benchmark": f"{bc.BENCHMARK[0]} {bc.BENCHMARK[1]}（与第一幕 R1 相同）",
            "adjustment": "前复权，以数据截止日为锚回算；区间收益不受锚点影响",
            "dividends": "前复权价已包含分红送转的影响",
            "normalization": "step1.unaligned 各自以 3 年窗口首日 = 100；step1.aligned 与 step2 以各自窗口首日 = 100",
            "windows": {"step1": bc.WIN_SHORT, "step2": bc.WIN_LONG},
            "answers_computed_by": "scripts/pd_common/metrics.py（与 src/engine/metrics.ts 同一口径）",
            "selection": "从 R1 / R2 条件的候选中，排除已发布 cases_reveal.json 中 A/B/C 的代码、申万一级行业，且决策日与它们相隔至少 120 个交易日；行业未知或任务窗口不完整的候选不采用；按 T 日前 60 日平均成交额最高者自动选取，不按后续收益选案",
            "public_scope": "尚未获得 PandaAI 公开展示许可的明确答复，暂按最保守方式处理：只发布归一化曲线与派生统计",
        },
        "label": "G",  # 局内六轮用 A–F，任务 A 的新标的记为 G（PRD v0.3 §5.1）
        "step1": {
            "observation": "O1",
            "offsets": [-bc.WIN_SHORT, 0],
            "benchmark_name": bc.BENCHMARK[1],
            "unaligned": {"asset": bc.r4(n3y_s[-(bc.WIN_SHORT + 1):]), "benchmark": bc.r4(n3y_b[-(bc.WIN_SHORT + 1):])},
            "aligned": {"asset": bc.r4(normalize(s60)), "benchmark": bc.r4(normalize(b60))},
            "asset_return": round(period_return(s60), 6),
            "benchmark_return": round(period_return(b60), 6),
            "answer": compare_to_benchmark(s60, b60),
        },
        "step2": {
            "observation": "O2",
            "offsets": [-bc.WIN_LONG, 0],
            "claim": STEP2_CLAIM,
            "series": bc.r4(n3y_s),
            "cum_return": round(period_return(s3y), 6),
            "max_drawdown": round(max_drawdown(s3y), 6),
            "answer": step2_answer(s3y),
        },
        "source": {
            "symbol": d.symbol,
            "name": d.name,
            "decision_date": d.t,
            "condition_family": d.round_id,
            "sw_l1": industry_code(membership, d.symbol, d.t),
            "windows": {"step1": [dates[i - bc.WIN_SHORT], d.t], "step2": [dates[i - bc.WIN_LONG], d.t]},
            "excluded": {
                "symbols": sorted(c.symbol for c in chosen.values()),
                "industries": sorted({industry_code(membership, c.symbol, c.t) for c in chosen.values()}),
                "decision_dates": sorted(c.t for c in chosen.values()),
                "min_gap_trading_days": MIN_GAP_DAYS,
            },
            "hindsight_disclosure": "选取只用 T 日及以前的数据，未参考 T 之后的走势。",
        },
    }
    out = REPO_ROOT / "public" / "data" / "taskA.json"
    current_game = (out.parent / game_binding["file"]).read_bytes()
    if game_fingerprint(json.loads(current_game)) != game_binding["sha256"]:
        raise ValueError("生成期间已发布第一幕发生变化，请重新生成任务 A")
    serialized = json.dumps(task, ensure_ascii=False, indent=1, default=bc._np, allow_nan=False)
    out.write_text(serialized, encoding="utf-8")
    print(d.symbol, d.name, d.t, d.round_id, "step1:", task["step1"]["answer"], "step2:", task["step2"]["answer"],
          f"r60={task['step1']['asset_return']:.4f} bench={task['step1']['benchmark_return']:.4f}",
          f"r3y={task['step2']['cum_return']:.4f} mdd={task['step2']['max_drawdown']:.4f}")
    print(f"已写入 {out.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    build()
