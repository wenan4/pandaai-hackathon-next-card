"""Panda Data 可行性探测（YOU-147）。

逐项验证接口可用性、口径和限制，结果写到 scripts/out/probe_report.json，并在终端打印摘要。
只读环境变量登录，不打印账号、密码或 token。

    .venv/bin/python scripts/pd_probe.py            # 全部探测
    .venv/bin/python scripts/pd_probe.py pool speed # 只跑指定项
"""
from __future__ import annotations

import json
import re
import sys
import time
import traceback
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pd_common.client import REPO_ROOT, login  # noqa: E402

OUT = REPO_ROOT / "scripts" / "out"
JWT = re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*")

pd_ = None  # panda_data 模块，登录后赋值
PROBES: dict[str, callable] = {}


def probe(name):
    def deco(fn):
        PROBES[name] = fn
        return fn
    return deco


def clean(msg: str) -> str:
    return JWT.sub("<redacted>", str(msg))[:400]


def frame_info(df: pd.DataFrame | None, n: int = 3) -> dict:
    if df is None:
        return {"rows": 0}
    if not isinstance(df, pd.DataFrame):
        return {"type": type(df).__name__, "value": clean(repr(df))}
    return {
        "rows": len(df),
        "columns": list(map(str, df.columns)),
        "head": json.loads(df.head(n).to_json(orient="records", force_ascii=False)),
    }


def call(fn_name: str, **kwargs):
    """调用接口，返回 (结果, 错误信息)。"""
    try:
        return getattr(pd_, fn_name)(**kwargs), None
    except Exception as e:  # noqa: BLE001
        return None, clean(f"{type(e).__name__}: {e}")


# ---------------------------------------------------------------- 探测项

@probe("last_date")
def p_last_date():
    d, err = call("get_last_trade_date")
    return {"last_trade_date": d, "error": err}


@probe("daily_units")
def p_daily_units():
    """日线字段与成交量单位：amount / (volume * close) ≈ 1 → 股，≈ 100 → 手。"""
    df, err = call("get_stock_daily", symbol=["600519.SH"], start_date="20250101", end_date="20250131")
    if err:
        return {"error": err}
    ratio = (df["amount"] / (df["volume"] * df["close"])).median()
    return {
        "info": frame_info(df),
        "amount_over_volume_x_close_median": round(float(ratio), 4),
        "trade_status_values": sorted(map(str, df["trade_status"].dropna().unique())) if "trade_status" in df else None,
    }


@probe("pre_adjust")
def p_pre_adjust():
    """前复权锚点：最新一天复权价 == 原始价 → 以最新因子回算；同时比较成交量是否保持原值。"""
    out = {}
    for sym in ["600519.SH", "000001.SZ"]:
        raw, e1 = call("get_stock_daily", symbol=[sym], start_date="20220101", end_date="20261030")
        pre, e2 = call("get_stock_daily_pre", symbol=[sym], start_date="20220101", end_date="20261030")
        if e1 or e2:
            out[sym] = {"error": e1 or e2}
            continue
        m = raw.merge(pre, on="date", suffixes=("_raw", "_pre"))
        last, first = m.iloc[-1], m.iloc[0]
        out[sym] = {
            "rows": len(m),
            "pre_columns": list(map(str, pre.columns)),
            "last_date": str(last["date"]),
            "last_close_raw": float(last["close_raw"]),
            "last_close_pre": float(last["close_pre"]),
            "first_date": str(first["date"]),
            "first_close_raw": float(first["close_raw"]),
            "first_close_pre": float(first["close_pre"]),
            "volume_identical": bool((m["volume_raw"] == m["volume_pre"]).all()) if "volume_pre" in m else None,
        }
    adj, err = call("get_adj_factor", symbol=["600519.SH"], start_date="20220101", end_date="20261030")
    out["adj_factor_600519"] = {"error": err} if err else frame_info(adj)
    return out


@probe("span_limit")
def p_span_limit():
    """单次请求跨度上限，以及分段拼接是否连续。"""
    over, err_over = call("get_stock_daily", symbol=["600519.SH"], start_date="20190101", end_date="20261030")
    a, ea = call("get_stock_daily_pre", symbol=["600519.SH"], start_date="20190101", end_date="20221231")
    b, eb = call("get_stock_daily_pre", symbol=["600519.SH"], start_date="20230101", end_date="20261030")
    joined = None
    if a is not None and b is not None:
        cal, _ = call("get_trade_cal", start_date="20190101", end_date="20261030", is_trading_day=1)
        joined = {
            "rows": len(a) + len(b),
            "trading_days": None if cal is None else len(cal),
            "first": str(a["date"].iloc[0]),
            "last": str(b["date"].iloc[-1]),
        }
    return {
        "over_5y": {"error": err_over} if err_over else {"rows": len(over), "note": "超过 5 年也返回了数据"},
        "segmented": joined or {"error": ea or eb},
    }


@probe("index")
def p_index():
    """宽基指数日线。"""
    out = {}
    for sym in ["000300.SH", "000905.SH", "000852.SH", "000001.SH", "399006.SZ", "399001.SZ"]:
        df, err = call("get_index_daily", symbol=[sym], start_date="20231030", end_date="20261030")
        out[sym] = {"error": err} if err else {
            "rows": len(df), "columns": list(map(str, df.columns)),
            "first": str(df["date"].iloc[0]) if len(df) else None,
            "last": str(df["date"].iloc[-1]) if len(df) else None,
        }
    return out


@probe("weights")
def p_weights():
    out = {}
    df, err = call("get_index_weights", index_symbol="000300.SH", start_date="20241231", end_date="20241231")
    out["get_index_weights_000300"] = {"error": err} if err else frame_info(df)
    df, err = call("get_index_weights_day", index_symbol="000300.SH", start_date="20241231", end_date="20241231")
    out["get_index_weights_day_000300"] = {"error": err} if err else frame_info(df)
    return out


@probe("pool")
def p_pool():
    """get_stock_daily 的 indicator 股票池：是否点时成分（不同日期成员不同）。"""
    out = {}
    members = {}
    for d in ["20211231", "20241231", "20261030"]:
        df, err = call("get_stock_daily", start_date=d, end_date=d, indicator="000300", fields=["symbol", "date", "close"])
        if err:
            out[d] = {"error": err}
            continue
        members[d] = set(df["symbol"])
        out[d] = {"rows": len(df)}
    if len(members) >= 2:
        ds = sorted(members)
        out["overlap_first_last"] = len(members[ds[0]] & members[ds[-1]])
        out["only_in_first"] = len(members[ds[0]] - members[ds[-1]])
        out["sample_only_in_first"] = sorted(members[ds[0]] - members[ds[-1]])[:10]
    for ind in ["000905", "000852"]:
        df, err = call("get_stock_daily", start_date="20241231", end_date="20241231", indicator=ind, fields=["symbol"])
        out[f"indicator_{ind}"] = {"error": err} if err else {"rows": len(df)}
    return out


@probe("industry")
def p_industry():
    out = {}
    det, err = call("get_industry_detail", level="L1")
    out["industry_detail_L1"] = {"error": err} if err else frame_info(det, n=40)
    cons, err = call("get_industry_constituents", industry_code="801780", level="L1")
    out["constituents_801780"] = {"error": err} if err else frame_info(cons)
    # 申万行业指数在 get_index_daily 里能否取到：逐个试交易所后缀
    for sym in ["801780.SI", "801780.SH", "801780.SZ", "801780.CSI", "801780"]:
        df, err = call("get_index_daily", symbol=[sym], start_date="20260901", end_date="20261030")
        out[f"index_daily_{sym}"] = {"error": err} if err else {"rows": len(df)}
    # 指数清单里有没有行业类指数（中证行业指数等）
    idx, err = call("get_index_detail", status=1)
    if err:
        out["index_detail"] = {"error": err}
    else:
        out["index_detail"] = {"rows": len(idx), "columns": list(map(str, idx.columns))}
        name_col = next((c for c in idx.columns if "name" in str(c).lower()), None)
        if name_col:
            hit = idx[idx[name_col].astype(str).str.contains("申万|SW|行业|银行|医药|消费|全指", regex=True)]
            out["index_detail_industry_like"] = frame_info(hit, n=30)
    return out


@probe("status")
def p_status():
    """ST、停牌、涨跌停相关接口与字段。"""
    out = {}
    for fn, kw in [
        ("get_st_list", {"start_date": "20240101", "end_date": "20241231"}),
        ("get_suspended_list", {"start_date": "20240101", "end_date": "20240131"}),
        ("get_stock_status_change", {"start_date": "20240101", "end_date": "20241231"}),
        ("get_stock_detail", {"status": 0}),
    ]:
        df, err = call(fn, **kw)
        out[fn] = {"error": err} if err else frame_info(df)
    # 一字涨停示例：open == limit_up 时 T+1 开盘买不进
    df, err = call("get_stock_daily", start_date="20241008", end_date="20241008", indicator="000300",
                   fields=["symbol", "open", "close", "limit_up", "limit_down", "trade_status"])
    if not err and len(df):
        out["limit_up_at_open_20241008"] = int((df["open"] >= df["limit_up"]).sum())
        out["trade_status_values_20241008"] = sorted(map(str, df["trade_status"].unique()))
    return out


@probe("speed")
def p_speed():
    """批量拉 50 只股票 5 年前复权日线的耗时。"""
    pool, err = call("get_stock_daily", start_date="20241231", end_date="20241231", indicator="000300", fields=["symbol"])
    if err:
        return {"error": err}
    syms = sorted(pool["symbol"])[:50]
    t0 = time.time()
    batch, err = call("get_stock_daily_pre", symbol=syms, start_date="20211101", end_date="20261030")
    t_batch = time.time() - t0
    res = {"batch_50x5y": {"error": err} if err else {"rows": len(batch), "seconds": round(t_batch, 1)}}
    t0 = time.time()
    n_ok = 0
    for s in syms[:5]:
        df, err = call("get_stock_daily_pre", symbol=[s], start_date="20211101", end_date="20261030")
        n_ok += err is None
    res["single_5x5y"] = {"ok": n_ok, "seconds": round(time.time() - t0, 1)}
    return res


# ---------------------------------------------------------------- 入口

def main(selected: list[str]) -> int:
    global pd_
    pd_ = login()
    names = selected or list(PROBES)
    report = {}
    for name in names:
        t0 = time.time()
        try:
            result = PROBES[name]()
        except Exception:  # noqa: BLE001
            result = {"crash": clean(traceback.format_exc(limit=3))}
        result["_seconds"] = round(time.time() - t0, 1)
        report[name] = result
        print(f"== {name} ({result['_seconds']}s)")
        print(json.dumps(result, ensure_ascii=False, indent=1, default=str)[:3000])
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "probe_report.json"
    old = json.loads(path.read_text()) if path.exists() else {}
    old.update(report)
    path.write_text(json.dumps(old, ensure_ascii=False, indent=1, default=str))
    print(f"\n已写入 {path.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
