"""Panda Data 取数层。

处理三件 SDK 不替你做的事：
- 单次请求跨度不超过 5 年 → 按 4 年一段切开再拼接；
- 返回按日期倒序 → 统一按 (symbol, date) 升序；
- 重复请求很慢 → 结果缓存到 scripts/cache/（已 gitignore），用参数哈希做文件名。删掉缓存文件即可强制重取；
- 每分钟请求次数有上限 → 遇到“每分钟请求次数超限”时等 61 秒重试，最多 3 次。

所有日期都是 YYYYMMDD 字符串。
"""
from __future__ import annotations

import hashlib
import json
import time
from datetime import date, datetime, timedelta
from typing import Callable, Iterable

import pandas as pd

from .client import REPO_ROOT, login

CACHE_DIR = REPO_ROOT / "scripts" / "cache"
MAX_SPAN_DAYS = 4 * 365  # 留余量，接口上限是 5 年
SYMBOL_BATCH = 100

_pd = None


def sdk():
    global _pd
    if _pd is None:
        _pd = login()
    return _pd


def call(fn: str, **kwargs):
    """调用 SDK 接口；遇到每分钟限流时等待后重试。"""
    for attempt in range(4):
        try:
            return getattr(sdk(), fn)(**kwargs)
        except Exception as e:  # noqa: BLE001
            if "请求次数超限" not in str(e) or attempt == 3:
                raise
            time.sleep(61)


def _d(s: str) -> date:
    return datetime.strptime(s, "%Y%m%d").date()


def _s(d: date) -> str:
    return d.strftime("%Y%m%d")


def date_chunks(start: str, end: str, span_days: int = MAX_SPAN_DAYS) -> list[tuple[str, str]]:
    """把 [start, end] 切成首尾相接、互不重叠、每段不超过 span_days 的区间。"""
    a, b = _d(start), _d(end)
    if a > b:
        raise ValueError(f"start {start} 晚于 end {end}")
    out = []
    while a <= b:
        c = min(a + timedelta(days=span_days - 1), b)
        out.append((_s(a), _s(c)))
        a = c + timedelta(days=1)
    return out


def _cached(key: dict, fetch: Callable[[], pd.DataFrame]) -> pd.DataFrame:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha1(json.dumps(key, sort_keys=True).encode()).hexdigest()[:16]
    # 本地缓存用 pickle：pyarrow 新版要求 NumPy 2，而 panda_data 锁定 numpy<2
    path = CACHE_DIR / f"{key['fn']}_{h}.pkl"
    if path.exists():
        return pd.read_pickle(path)
    df = fetch()
    df.to_pickle(path)
    return df


def _batches(items: list[str], n: int) -> Iterable[list[str]]:
    for i in range(0, len(items), n):
        yield items[i : i + n]


def _fetch_ranged(fn: str, symbols: list[str], start: str, end: str, date_col: str = "date", **kw) -> pd.DataFrame:
    def fetch():
        frames = []
        for batch in _batches(sorted(set(symbols)), SYMBOL_BATCH):
            for a, b in date_chunks(start, end):
                df = call(fn, symbol=batch, start_date=a, end_date=b, **kw)
                if df is not None and len(df):
                    frames.append(df)
        if not frames:
            return pd.DataFrame()
        out = pd.concat(frames, ignore_index=True)
        out[date_col] = out[date_col].astype(str)
        return out.drop_duplicates(["symbol", date_col]).sort_values(["symbol", date_col]).reset_index(drop=True)

    key = {"fn": fn, "symbols": sorted(set(symbols)), "start": start, "end": end, **kw}
    return _cached(key, fetch)


def stock_daily(symbols: list[str], start: str, end: str, adjusted: bool = True) -> pd.DataFrame:
    """A 股日线。adjusted=True 用前复权（以最新交易日为锚），False 用原始价。成交量两者一致，单位：股。"""
    return _fetch_ranged("get_stock_daily_pre" if adjusted else "get_stock_daily", symbols, start, end)


def index_daily(symbols: list[str], start: str, end: str) -> pd.DataFrame:
    return _fetch_ranged("get_index_daily", symbols, start, end)


def index_members(index_symbol: str, on: str) -> list[str]:
    """某个交易日的指数成分股（点时）。"""
    def fetch():
        df = call("get_index_weights", index_symbol=index_symbol, start_date=on, end_date=on)
        return df if df is not None else pd.DataFrame(columns=["stock_symbol"])

    df = _cached({"fn": "get_index_weights", "index": index_symbol, "on": on}, fetch)
    return sorted(df["stock_symbol"].unique()) if len(df) else []


def trade_days(start: str, end: str) -> list[str]:
    def fetch():
        frames = [call("get_trade_cal", start_date=a, end_date=b, is_trading_day=1) for a, b in date_chunks(start, end)]
        return pd.concat(frames, ignore_index=True)

    df = _cached({"fn": "get_trade_cal", "start": start, "end": end}, fetch)
    # 日历列：nature_date 是当天，next_trade_date / pretrade_date 是前后交易日
    return sorted(df["nature_date"].astype(str).unique())


def adj_events(symbols: list[str], start: str, end: str) -> pd.DataFrame:
    """除权除息事件（ex_date, ex_factor）。用来识别送转导致的假放量。"""
    return _fetch_ranged("get_adj_factor", symbols, start, end, date_col="ex_date")


def st_flags(symbols: list[str], start: str, end: str) -> pd.DataFrame:
    return _fetch_ranged("get_st_list", symbols, start, end)


def industry_membership(level: str = "L1") -> pd.DataFrame:
    """申万（sws_2021）行业归属全量，含 in_date / out_date，可按日期还原点时归属。"""
    return _cached({"fn": "get_industry_constituents", "level": level}, lambda: call("get_industry_constituents", level=level))


def industry_on(membership: pd.DataFrame, symbol: str, on: str, level: str = "L1") -> str | None:
    """某只股票在某个交易日所属的行业代码。"""
    col = f"{level.lower()}_code"
    m = membership[membership["stock_symbol"] == symbol]
    m = m[(m["in_date"].astype(str) <= on) & (m["out_date"].isna() | (m["out_date"].astype(str) > on))]
    return str(m[col].iloc[0]) if len(m) else None


def last_trade_date() -> str:
    return str(call("get_last_trade_date"))
