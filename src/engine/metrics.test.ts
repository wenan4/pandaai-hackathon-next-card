import { describe, expect, it } from "vitest";
import { compareToBenchmark, maxDrawdown, normalize, periodReturn } from "./metrics";

describe("periodReturn", () => {
  it("末值 / 首值 - 1", () => {
    expect(periodReturn([100, 105, 110])).toBeCloseTo(0.1);
  });
  it("点数不足或首值非正时返回 null", () => {
    expect(periodReturn([100])).toBeNull();
    expect(periodReturn([0, 1])).toBeNull();
  });
});

describe("maxDrawdown", () => {
  it("取历史最高点之后的最大跌幅", () => {
    // 高点 120 → 低点 90：回撤 25%；之后的 130 → 117 只有 10%
    expect(maxDrawdown([100, 120, 90, 130, 117])).toBeCloseTo(0.25);
  });
  it("单调上涨时回撤为 0", () => {
    expect(maxDrawdown([1, 2, 3])).toBe(0);
  });
});

describe("compareToBenchmark", () => {
  it("区间收益更高才算跑赢", () => {
    expect(compareToBenchmark([100, 112], [50, 58])).toBe("underperform");
    expect(compareToBenchmark([100, 120], [50, 58])).toBe("outperform");
  });
  it("长度不一致视为证据不足", () => {
    expect(compareToBenchmark([1, 2, 3], [1, 2])).toBe("insufficient");
  });
});

describe("normalize", () => {
  it("起点归一化为 100", () => {
    expect(normalize([50, 55, 45])).toEqual([100, 110, 90]);
  });
});
