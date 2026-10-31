"""Build v0.4 derived, stage-separated snapshots from the existing Panda Data cache.

No credentials, raw OHLCV, or account identifiers are written. The cache is a
trusted local input: never unpickle files downloaded from an untrusted source.
Run with the repository's pandas-enabled Python and --cache-dir pointing at the
original repo/scripts/cache. See docs/adventure-data.md for provenance and limits.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SCALE = 1_000_000
CASES = [
    ("lantern-a", "R1", "300059.SZ", "东方财富", "20251103"),
    ("lantern-b", "R2", "600900.SH", "长江电力", "20251103"),
    ("lantern-c", "R3", "000063.SZ", "中兴通讯", "20241218"),
    ("lantern-d", "D", "000063.SZ", "中兴通讯", "20250207"),
]
STEPS = {
    "entry": (1, "open"),
    "exit-after-entry": (2, "open"),
    "t1": (20, "close"),
    "t1-exec": (21, "open"),
    "exit-after-t1-exec": (22, "open"),
    "t2": (40, "close"),
    "t2-exec": (41, "open"),
    "exit-after-t2-exec": (42, "open"),
    "t3": (60, "close"),
    "final-exec": (61, "open"),
}


def write_bytes(path: Path, content: bytes, *, frozen: bool = False) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and frozen:
        if path.read_bytes() != content:
            raise ValueError(f"Refusing to replace frozen data: {path.name}")
    else:
        path.write_bytes(content)
    return hashlib.sha256(content).hexdigest()


def dump(path: Path, data: object, *, frozen: bool = False) -> str:
    content = (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    return write_bytes(path, content, frozen=frozen)


def norm(value: float, base: float) -> int:
    return round(float(value) / float(base) * SCALE)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", required=True, type=Path)
    parser.add_argument("--out", default=ROOT / "public" / "data" / "adventure", type=Path)
    parser.add_argument("--legacy-dir", default=ROOT / "public" / "data" / "adventure", type=Path,
                        help="directory containing the frozen v1 manifest and integrity file")
    args = parser.parse_args()
    cache = args.cache_dir
    stock = pd.read_pickle(cache / "get_stock_daily_pre_02e833a86d7db295.pkl")
    index = pd.read_pickle(cache / "get_index_daily_fc1b7a02aa4373cb.pkl")
    cal = pd.read_pickle(cache / "get_trade_cal_dcbc1ea6d1a405ad.pkl")
    days = sorted(cal["nature_date"].astype(str).unique())
    bench = index[index.symbol == "000300.SH"].set_index("date").sort_index()
    legacy_manifest_bytes = (args.legacy_dir / "manifest.json").read_bytes()
    legacy_integrity_bytes = (args.legacy_dir / "integrity.json").read_bytes()
    legacy_manifest = json.loads(legacy_manifest_bytes)
    legacy_cases = {case["caseId"]: case for case in legacy_manifest["cases"]}
    existing_v2 = args.out / "manifest.v2.json"
    generated = (json.loads(existing_v2.read_text(encoding="utf-8"))["generatedAt"]
                 if existing_v2.exists() else datetime.now(timezone.utc).isoformat(timespec="seconds"))
    initial_cases = []
    hashes = {
        "manifest.json": write_bytes(args.out / "manifest.json", legacy_manifest_bytes, frozen=True),
        "integrity.json": write_bytes(args.out / "integrity.json", legacy_integrity_bytes, frozen=True),
    }
    for case_id, original, symbol, name, t0 in CASES:
        asset = stock[stock.symbol == symbol].set_index("date").sort_index()
        t = days.index(t0)
        selected_days = days[t - 60 : t + 62]
        if len(selected_days) != 122:
            raise ValueError(f"{case_id}: insufficient calendar history or follow-up")
        a = asset.reindex(selected_days)
        b = bench.reindex(selected_days)
        if a.index.has_duplicates or b.index.has_duplicates:
            raise ValueError(f"{case_id}: duplicate trading date")
        if a[["open", "close", "volume"]].isna().any().any() or b[["open", "close"]].isna().any().any():
            raise ValueError(f"{case_id}: missing observation")
        if (a[["open", "close", "volume"]] <= 0).any().any() or (b[["open", "close"]] <= 0).any().any():
            raise ValueError(f"{case_id}: nonpositive price or volume")
        active = (a.trade_status == 0) | (a.trade_status.isna() & (a.volume > 0))
        if not active.all():
            raise ValueError(f"{case_id}: suspended session")
        # Limit-up or limit-down openings are excluded for BOTH buying and selling.
        # Limit prices must exist on execution dates; no assumption of fill at a limit.
        for offset, field in STEPS.values():
            if field != "open":
                continue
            row = a.iloc[60 + offset]
            if pd.isna(row.limit_up) or pd.isna(row.limit_down):
                raise ValueError(f"{case_id}: missing execution limits at {offset}")
            if row.open >= row.limit_up or row.open <= row.limit_down:
                raise ValueError(f"{case_id}: opening at limit at {offset}")
        base_a, base_b = a.iloc[60].close, b.iloc[60].close
        asset_close = [norm(v, base_a) for v in a.close]
        benchmark_close = [norm(v, base_b) for v in b.close]
        initial = {
            "caseId": case_id, "title": f"历史片段 {original}", "symbol": symbol, "name": name,
            "decisionDate": t0, "benchmark": "000300.SH 沪深300",
            "history": {"dates": selected_days[:61], "asset": asset_close[:61], "benchmark": benchmark_close[:61]},
            "priceScale": SCALE, "t0Close": SCALE,
        }
        if case_id in legacy_cases and initial != legacy_cases[case_id]:
            raise ValueError(f"{case_id}: generated initial history differs from frozen v1 manifest")
        relative = f"initial/{case_id}.json"
        hashes[relative] = dump(args.out / relative, initial, frozen=True)
        # The shared directory only contains metadata; otherwise D's initial
        # history exposes C's future prices before a player selects a case.
        initial_cases.append({key: value for key, value in initial.items() if key != "history"})
        execution = []
        for step, (offset, field) in STEPS.items():
            i = 60 + offset
            quote = {"caseId": case_id, "step": step, "date": selected_days[i], "price": norm(a.iloc[i][field], base_a)}
            if field == "close":
                start = i - 20
                quote["segment"] = {"dates": selected_days[start : i + 1], "asset": asset_close[start : i + 1], "benchmark": benchmark_close[start : i + 1]}
            relative = f"stages/{case_id}/{step}.json"
            hashes[relative] = dump(args.out / relative, quote, frozen=True)
            if step in {"entry", "t1-exec", "t2-exec", "final-exec"}:
                execution.append({"step": step, "date": selected_days[i], "price": quote["price"], "benchmarkPrice": norm(b.iloc[i].open, base_b)})
        research = {
            "caseId": case_id, "title": f"历史片段 {original}", "decisionDate": t0,
            "benchmarkName": "沪深300", "priceScale": SCALE,
            "dates": selected_days[60:121], "assetClose": asset_close[60:121],
            "benchmarkClose": benchmark_close[60:121], "execution": execution,
        }
        relative = f"research/{case_id}.json"
        hashes[relative] = dump(args.out / relative, research, frozen=True)
    manifest = {
        "schema": "adventure-market-v2", "generatedAt": generated, "dataAsOf": "20261030",
        "source": "Panda Data（panda_data 1.0.5）；已发布案例及本地缓存的历史派生数据",
        "apis": ["get_stock_daily_pre", "get_index_daily", "get_trade_cal"],
        "adjustment": "资产为截至数据日锚定的前复权价格，基准为指数价格；各自以 T0 收盘归一到 1000000。",
        "limitations": ["历史比例不构成未来预测；前复权非严格点时价格或可成交收益。", "不模拟费用、滑点、冲击、税费及完整成交限制。", "仅发布归一化派生数据；数据公开展示许可仍待明确。", "原案例有历史条件筛选；新增片段和端点完整性使用事后资料，样本非随机。"],
        "selection": "原案例沿用既有筛选，新增片段经过事后观察及端点完整性过滤；案例池有选择偏差，不是市场随机样本。",
        "cases": initial_cases,
    }
    hashes["manifest.v2.json"] = dump(args.out / "manifest.v2.json", manifest)
    dump(args.out / "integrity.v2.json", {"algorithm": "sha256", "files": hashes})
    print(f"Generated {len(initial_cases)} derived cases and {len(hashes)} hashed files.")


if __name__ == "__main__":
    main()
