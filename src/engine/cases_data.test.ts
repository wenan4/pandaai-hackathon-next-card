import { describe, expect, it } from "vitest";
import visible from "../../public/data/cases_visible.json";
import { compareToBenchmark, maxDrawdown, periodReturn } from "./metrics";

// 前端引擎用同一份 metrics.ts 重算第一幕数据，结论必须与数据脚本导出的证据结论一致
const round = (id: string) => visible.rounds.find((r) => r.round_id === id)!;

describe("第一幕数据与引擎口径一致", () => {
  it("R1：标的没有跑赢指定基准（refutes）", () => {
    const fox = round("R1").cards.fox;
    expect(compareToBenchmark(fox.asset, fox.benchmark)).toBe("underperform");
    expect(periodReturn(fox.asset)!).toBeGreaterThanOrEqual(0.1);
  });

  it("R2：三年总体上涨且最大回撤小于 15%（supports）", () => {
    const series = round("R2").cards.elephant.series;
    expect(periodReturn(series)!).toBeGreaterThan(0);
    expect(maxDrawdown(series)!).toBeLessThan(0.15);
  });

  it("每轮卡片的导出数值可由序列重算", () => {
    for (const r of visible.rounds) {
      expect(periodReturn(r.cards.fox.asset)!).toBeCloseTo(r.cards.fox.asset_return, 4);
      expect(maxDrawdown(r.cards.elephant.series)!).toBeCloseTo(r.cards.elephant.max_drawdown, 4);
    }
  });
});
