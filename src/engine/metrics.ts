// 共用计算口径：区间收益、最大回撤、跑赢判断。
// scripts/pd_common/metrics.py 必须与这里保持同一份公式（见 YOU-152 的一致性测试）。
// 纯函数，不依赖 DOM。

export type Comparison = "outperform" | "underperform" | "insufficient";

/** 区间收益：末值 / 首值 - 1。序列少于 2 个点或首值非正时返回 null。 */
export function periodReturn(series: readonly number[]): number | null {
  if (series.length < 2) return null;
  const first = series[0]!;
  const last = series[series.length - 1]!;
  if (!(first > 0) || !Number.isFinite(last)) return null;
  return last / first - 1;
}

/** 最大回撤：从此前最高点往下跌的最大比例，返回非负小数（0.12 表示 12%）。 */
export function maxDrawdown(series: readonly number[]): number | null {
  if (series.length < 2) return null;
  let peak = -Infinity;
  let mdd = 0;
  for (const v of series) {
    if (!Number.isFinite(v) || v <= 0) return null;
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > mdd) mdd = dd;
  }
  return mdd;
}

/** 同一区间内标的是否跑赢基准。两条序列长度必须一致，否则视为证据不足。 */
export function compareToBenchmark(
  asset: readonly number[],
  benchmark: readonly number[],
): Comparison {
  if (asset.length !== benchmark.length) return "insufficient";
  const a = periodReturn(asset);
  const b = periodReturn(benchmark);
  if (a === null || b === null) return "insufficient";
  return a > b ? "outperform" : "underperform";
}

/** 归一化为起点 = base（默认 100），用于“对齐两条线”和减少原始行情暴露。 */
export function normalize(series: readonly number[], base = 100): number[] {
  const first = series[0];
  if (first === undefined || !(first > 0)) return [];
  return series.map((v) => (v * base) / first);
}
