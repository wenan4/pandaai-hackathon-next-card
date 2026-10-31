import { describe, expect, it } from "vitest";
import visible from "../../public/data/cases_visible.json";
import visible2 from "../../public/data/cases_act2_visible.json";
import reveal2 from "../../public/data/cases_act2_reveal.json";
import reveal1 from "../../public/data/cases_reveal.json";
import taskA from "../../public/data/taskA.json";
import { ACT2_ROUNDS, FAMILY_COVERAGE, ROUNDS } from "../config/rounds";
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

const round2 = (id: string) => visible2.rounds.find((r) => r.round_id === id)!;

describe("第二幕数据与引擎口径一致（说法方向与第一幕翻转）", () => {
  it("R4：标的确实跑赢指定基准（supports），前 60 日涨幅 ≥ 10%", () => {
    const fox = round2("R4").cards.fox;
    expect(compareToBenchmark(fox.asset, fox.benchmark)).toBe("outperform");
    expect(periodReturn(fox.asset)!).toBeGreaterThanOrEqual(0.1);
  });

  it("R5：三年总体上涨，但最大回撤超过 15%（refutes）", () => {
    const series = round2("R5").cards.elephant.series;
    expect(periodReturn(series)!).toBeGreaterThan(0);
    expect(maxDrawdown(series)!).toBeGreaterThanOrEqual(0.15);
  });

  it("R6：过去一年 3–6 次同类信号，之后 20 日有涨有跌；每次观察窗口都在 T 日之前结束", () => {
    const sig = round2("R6").cards.leopard.signals!;
    expect(sig.items.length).toBeGreaterThanOrEqual(3);
    expect(sig.items.length).toBeLessThanOrEqual(6);
    const up = sig.items.filter((x) => x.forward_return > 0).length;
    expect(up).toBeGreaterThan(0);
    expect(up).toBeLessThan(sig.items.length);
    for (const x of sig.items) expect(x.offset + sig.horizon).toBeLessThanOrEqual(0);
  });

  it("卡片数值可由序列重算；关卡配置的命题与证据结论与数据脚本一致", () => {
    for (const r of visible2.rounds) {
      expect(periodReturn(r.cards.fox.asset)!).toBeCloseTo(r.cards.fox.asset_return, 4);
      expect(maxDrawdown(r.cards.elephant.series)!).toBeCloseTo(r.cards.elephant.max_drawdown, 4);
    }
    for (const cfg of ACT2_ROUNDS) {
      const src = reveal2.rounds.find((r) => r.round_id === cfg.round_id)!.source;
      expect([cfg.claim, cfg.verdict]).toEqual([src.claim, src.evidence_verdict]);
      expect(round2(cfg.round_id).claim).toBe(cfg.claim);
    }
  });

  it("六轮与任务 A 的标的互不重复", () => {
    const symbols = [...reveal1.rounds, ...reveal2.rounds].map((r) => r.source.symbol).concat(taskA.source.symbol);
    expect(new Set(symbols).size).toBe(7);
  });

  it("三种押注形态在两幕里各出现两次，才谈得上常押", () => {
    expect(FAMILY_COVERAGE).toEqual({ relative_strength: 2, steady_trend: 2, volume_surge: 2 });
    expect(ROUNDS.map((r) => r.round_id)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6"]);
  });
});
