import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BET_FAMILY_COPY, TRADING_VIEW } from "../config/copy";
import { AVAILABLE_TOPICS, ENGINE_CONFIG } from "../config/engine";
import { ROUNDS } from "../config/rounds";
import { PRESETS } from "../panel/presets";
import { evaluateView as evaluate } from "./evaluate";
import { actionHabits, betTopic } from "./habits";
import { eventsFromSpecs, type RoundSpec } from "./paths";
import { recommendView as recommend } from "./recommend";

const specs = (id: string) => PRESETS.find((p) => p.id === id)!.specs;

describe("行动习惯（YOU-165）：只计数，不进入能力观察", () => {
  it("路径乙：R1、R2 判断与下一步同向，R3 支持但先看看；只在 R2 跟过，不算常押", () => {
    const h = actionHabits(eventsFromSpecs(specs("yi"), ROUNDS), ROUNDS);
    expect(h.aligned).toEqual(["R1", "R2"]);
    expect(h.diverged).toEqual(["R3"]);
    expect(h.backed_families).toEqual([{ family: "steady_trend", rounds: ["R2"], frequent: false }]);
    expect(betTopic(h)).toBeUndefined();
    expect(h.decision_chains.map((c) => [c.round_id, c.flips, c.final, c.action])).toEqual([
      ["R1", ["elephant", "fox"], "refutes", "skip"],
      ["R2", ["elephant"], "supports", "follow"],
      ["R3", ["elephant", "fox"], "supports", "wait"],
    ]);
  });

  it("同一形态跟满 2 次才算常押，并映射到对应主题", () => {
    const rounds = ROUNDS.map((r) => ({ ...r, bet_family: "volume_surge" as const }));
    const all: RoundSpec[] = specs("yi").map((s) => ({ ...s, action: "follow" }));
    const h = actionHabits(eventsFromSpecs(all, rounds), rounds);
    expect(h.backed_families[0]).toMatchObject({ family: "volume_surge", frequent: true });
    expect(betTopic(h)).toBe("cheetah");
  });

  it("只改行动：习惯变化，能力观察、进度与任务类型不变；押注主题只影响主题字段", () => {
    const base = eventsFromSpecs(specs("yi"), ROUNDS);
    const changed = eventsFromSpecs(specs("yi").map((s) => ({ ...s, action: "follow" as const })), ROUNDS);
    expect(actionHabits(changed, ROUNDS)).not.toEqual(actionHabits(base, ROUNDS));
    const a = evaluate(base, ENGINE_CONFIG);
    const b = evaluate(changed, ENGINE_CONFIG);
    expect(b.profile).toEqual(a.profile);
    const pa = recommend(a.profile, a.progress, AVAILABLE_TOPICS);
    const pb = recommend(b.profile, b.progress, AVAILABLE_TOPICS, { betTopic: "cheetah" });
    expect({ ...pb, topic: null, topic_source: null }).toEqual({ ...pa, topic: null, topic_source: null });
  });

  it("evaluate / recommend 不导入行动习惯；文案不出现风险偏好用词", () => {
    for (const f of ["evaluate.ts", "recommend.ts", "rounds.ts"]) {
      expect(readFileSync(new URL(`./${f}`, import.meta.url), "utf8")).not.toMatch(/from\s+["']\.\/habits["']/);
    }
    const text = JSON.stringify([TRADING_VIEW, BET_FAMILY_COPY]);
    for (const w of ["冒险", "保守", "风险承受", "买入", "卖出", "正确", "错误"]) expect(text).not.toContain(w);
  });
});
