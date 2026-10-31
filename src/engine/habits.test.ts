import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BET_FAMILY_COPY, TRADING_VIEW } from "../config/copy";
import { AVAILABLE_TOPICS, ENGINE_CONFIG } from "../config/engine";
import { ROUNDS } from "../config/rounds";
import { PRESETS } from "../panel/presets";
import { evaluate } from "./evaluate";
import { actionHabits, betTopic } from "./habits";
import { eventsFromSpecs, type RoundSpec } from "./paths";
import { recommend } from "./recommend";

const specs = (id: string) => PRESETS.find((p) => p.id === id)!.specs;

describe("行动习惯（YOU-165）：只计数，不进入能力观察", () => {
  it("路径乙（六轮）：3 轮同向、3 轮不同向；稳步上行跟了 2 次（R2、R5），算常押并指向大象题", () => {
    const h = actionHabits(eventsFromSpecs(specs("yi"), ROUNDS), ROUNDS);
    expect(h.aligned).toEqual(["R2", "R3", "R6"]);
    expect(h.diverged).toEqual(["R1", "R4", "R5"]);
    expect(h.backed_families).toEqual([
      { family: "relative_strength", rounds: ["R1"], frequent: false },
      { family: "steady_trend", rounds: ["R2", "R5"], frequent: true },
    ]);
    expect(betTopic(h)).toBe("elephant");
    expect(h.decision_chains.map((c) => [c.round_id, c.flips, c.final, c.action])).toEqual([
      ["R1", ["fox"], "refutes", "follow"],
      ["R2", ["elephant"], "supports", "follow"],
      ["R3", ["elephant", "leopard"], "insufficient", "wait"],
      ["R4", ["fox"], "supports", "pass"],
      ["R5", ["elephant"], "refutes", "follow"],
      ["R6", ["elephant", "leopard"], "insufficient", "wait"],
    ]);
  });

  it("只玩第一幕时每种形态最多一次，押注推题不会触发", () => {
    const h = actionHabits(eventsFromSpecs(specs("yi").filter((s) => ["R1", "R2", "R3"].includes(s.round_id)), ROUNDS), ROUNDS);
    expect(h.backed_families.every((b) => !b.frequent)).toBe(true);
    expect(betTopic(h)).toBeUndefined();
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
    const core = (p: typeof pa) => ({ route: p.route, task: p.task, steps: p.steps, assist: p.assist, guess_first: p.guess_first });
    expect(core(pb)).toEqual(core(pa));
  });

  it("evaluate / recommend 不导入行动习惯；文案不出现风险偏好用词", () => {
    for (const f of ["evaluate.ts", "recommend.ts", "rounds.ts"]) {
      expect(readFileSync(new URL(`./${f}`, import.meta.url), "utf8")).not.toMatch(/from\s+["']\.\/habits["']/);
    }
    const text = JSON.stringify([TRADING_VIEW, BET_FAMILY_COPY]);
    for (const w of ["冒险", "保守", "风险承受", "买入", "卖出", "正确", "错误"]) expect(text).not.toContain(w);
  });
});
