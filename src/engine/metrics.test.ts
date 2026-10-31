import { describe, expect, it } from "vitest";
import fixture from "./fixtures/metrics_cases.json";
import { compareToBenchmark, maxDrawdown, normalize, periodReturn } from "./metrics";

type Case =
  | { name: string; fn: "periodReturn" | "maxDrawdown"; series: number[]; expected: number | null }
  | { name: string; fn: "normalize"; series: number[]; expected: number[] }
  | { name: string; fn: "compareToBenchmark"; asset: number[]; benchmark: number[]; expected: string };

// 与 scripts/tests/test_metrics.py 共用同一份用例，保证两边口径一致
describe("共用口径用例", () => {
  for (const c of fixture.cases as Case[]) {
    it(c.name, () => {
      switch (c.fn) {
        case "periodReturn":
        case "maxDrawdown": {
          const got = c.fn === "periodReturn" ? periodReturn(c.series) : maxDrawdown(c.series);
          if (c.expected === null) expect(got).toBeNull();
          else expect(got).toBeCloseTo(c.expected, 9);
          break;
        }
        case "normalize": {
          const got = normalize(c.series);
          expect(got).toHaveLength(c.expected.length);
          got.forEach((v, i) => expect(v).toBeCloseTo(c.expected[i]!, 9));
          break;
        }
        case "compareToBenchmark":
          expect(compareToBenchmark(c.asset, c.benchmark)).toBe(c.expected);
          break;
      }
    });
  }
});
