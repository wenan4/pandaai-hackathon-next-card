import { describe, expect, it } from "vitest";
import taskA from "../../public/data/taskA.json";
import { compareToBenchmark, maxDrawdown, periodReturn } from "./metrics";

// 任务 A 的标准答案必须能由前端同一份 metrics.ts 从数据重算出来，不手写
describe("任务 A 标准答案与引擎口径一致", () => {
  it("对齐前后的标的和基准曲线都有完整的有限数值", () => {
    for (const state of ["aligned", "unaligned"] as const) {
      for (const key of ["asset", "benchmark"] as const) {
        const series = taskA.step1[state][key];
        expect(series).toHaveLength(taskA.header.windows.step1 + 1);
        expect(series.every((v) => Number.isFinite(v) && v > 0)).toBe(true);
      }
    }
  });

  it("步骤 1：对齐前后跑赢判断一致", () => {
    const { aligned, unaligned, answer } = taskA.step1;
    expect(compareToBenchmark(aligned.asset, aligned.benchmark)).toBe(answer);
    expect(compareToBenchmark(unaligned.asset, unaligned.benchmark)).toBe(answer);
  });

  it("步骤 2：三年总体上涨且最大回撤小于 15% 的判断", () => {
    const { series, answer } = taskA.step2;
    const ok = periodReturn(series)! > 0 && maxDrawdown(series)! < 0.15;
    expect(ok ? "supports" : "refutes").toBe(answer);
  });
});
