import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AVAILABLE_TOPICS, ENGINE_CONFIG } from "../config/engine";
import { PRESETS } from "../panel/presets";
import { evaluate, roundJudgement } from "./evaluate";
import { eventFactory, eventsFromSpecs, type RoundSpec } from "./paths";
import { recommend } from "./recommend";
import { followupFor } from "./rounds";
import { flipOutcomes, settle, settleRound, START_TOKENS } from "./settle";
import type { GameEvent } from "./types";

const ROUNDS = ENGINE_CONFIG.rounds;
const R = (id: string) => ROUNDS.find((r) => r.round_id === id)!;
const preset = (id: string) => PRESETS.find((p) => p.id === id)!.specs;
const run = (specs: RoundSpec[], extra: GameEvent[] = []) => evaluate([...eventsFromSpecs(specs, ROUNDS), ...extra], ENGINE_CONFIG);
const edit = (specs: RoundSpec[], round: string, patch: Partial<RoundSpec>) => specs.map((s) => (s.round_id === round ? { ...s, ...patch } : s));

describe("路径乙", () => {
  const { profile, progress } = run(preset("yi"));

  it("画像", () => {
    expect(profile.observations.O1).toMatchObject({ status: "observed", aggregation: "partial" });
    expect(profile.observations.O2).toMatchObject({ status: "observed", aggregation: "partial" });
    expect(profile.observations.O3.status).toBe("not_observed");
    expect(profile.observations.O4).toMatchObject({ status: "observed", summary: "本局 2 次可比较情境中调整 2 次（独立 2，有帮助 0）" });
    expect(profile.style.species).toBe("elephant");
    expect(progress).toMatchObject({ K: 0, S1: false, S2: false, ready_for_B: false, rounds_completed: 3 });
  });

  it("第一幕每项只见一次，仍推荐 A 的两个新情境", () => {
    expect(recommend(profile, progress, AVAILABLE_TOPICS)).toMatchObject({ route: "R-A2", task: "A", steps: [1, 2] });
  });

  it("R1 最终判断改成支持：O1 变 O1-b，第一幕仍需 A 两步，并触发“主要依据什么”，O4 保留 R2 证据", () => {
    const specs = edit(preset("yi"), "R1", { final: "supports" });
    const after = run(specs);
    expect(after.profile.observations.O1.status).toBe("uncertain");
    expect(after.profile.observations.O1.instances[0]!.rule).toBe("O1-b");
    expect(after.progress.K).toBe(0);
    expect(recommend(after.profile, after.progress, AVAILABLE_TOPICS)).toMatchObject({ route: "R-A2", task: "A", steps: [1, 2] });
    expect(followupFor({ final: "supports", flips: ["elephant", "fox"], action: "pass" }, R("R1"))).toBe("basis");
    expect(after.profile.observations.O4.instances.some((i) => i.context === "R2" && i.outcome === "consistent")).toBe(true);
  });

  it("R3 追问改成“图没看懂”：O3 理解待确认，建议带我做，仍进 A，O4 不变", () => {
    const after = run(edit(preset("yi"), "R3", { followupAnswer: "图没看懂" }));
    expect(after.profile.observations.O3).toMatchObject({ status: "uncertain", understanding_unclear: true });
    expect(after.profile.help_preference.level).toBe("guide");
    expect(recommend(after.profile, after.progress, AVAILABLE_TOPICS).task).toBe("A");
    expect(after.profile.observations.O4).toEqual(profile.observations.O4);
  });

  it("R1 不看对照、改翻历史和量价，结论仍对：O1 未观察到，第一幕仍推荐 A 两步", () => {
    const after = run(edit(preset("yi"), "R1", { flips: ["elephant", "leopard"] }));
    expect(after.profile.observations.O1.status).toBe("not_observed");
    expect(recommend(after.profile, after.progress, AVAILABLE_TOPICS)).toMatchObject({ task: "A", steps: [1, 2] });
  });
});

describe("隔离与确定性", () => {
  it("只改交易行动或跳过追问：evaluate 输出逐字节不变", () => {
    const base = JSON.stringify(run(preset("yi")));
    expect(JSON.stringify(run(edit(preset("yi"), "R1", { action: "follow" })))).toBe(base);
    expect(JSON.stringify(run(edit(preset("yi"), "R2", { action: "wait", followupAnswer: null })))).toBe(base);
  });

  it("替换事后走势：筹码变，画像与推荐不变", () => {
    const specs = preset("yi");
    const outcomes = { R1: -0.0913, R2: -0.0085, R3: 0.146 };
    const decisions = specs.map((s) => ({ round_id: s.round_id, action: s.action }));
    expect(settle(decisions, outcomes).balance).not.toBe(settle(decisions, flipOutcomes(outcomes, ["R1", "R2", "R3"])).balance);
    // evaluate 的输入里根本没有收益字段，替换走势不会改变它的输入
    const a = run(specs);
    expect(recommend(a.profile, a.progress, AVAILABLE_TOPICS)).toEqual(recommend(run(specs).profile, run(specs).progress, AVAILABLE_TOPICS));
  });

  it("evaluate / recommend 不导入 settle", () => {
    for (const f of ["evaluate.ts", "recommend.ts", "rounds.ts"]) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
      expect(src).not.toMatch(/from\s+["']\.\/settle["']/);
    }
  });

  it("evaluate / recommend 的整条导入链里没有 settle 和揭晓数据（反例检查 1 依赖这一条）", () => {
    // 沿相对导入逐个模块走一遍；import type 不进入运行时，跳过
    const seen = new Set<string>();
    const walk = (url: URL) => {
      if (seen.has(url.href)) return;
      seen.add(url.href);
      if (!url.pathname.endsWith(".ts")) return;
      const src = readFileSync(url, "utf8");
      for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["'](\.{1,2}\/[^"']+)["']/gm)) {
        const spec = m[1]!;
        walk(new URL(/\.(ts|json)$/.test(spec) ? spec : `${spec}.ts`, url));
      }
    };
    walk(new URL("./evaluate.ts", import.meta.url));
    walk(new URL("./recommend.ts", import.meta.url));
    const reached = [...seen].map((u) => decodeURIComponent(new URL(u).pathname));
    expect(reached.some((p) => p.endsWith("/engine/evaluate.ts"))).toBe(true);
    for (const p of reached) {
      expect(p).not.toMatch(/\/engine\/settle\.ts$|\/data\/cases\.ts$|cases_reveal|\/public\/data\//);
    }
  });

  it("同一输入跑 100 次输出相同，且不访问 Date.now / Math.random", () => {
    const first = JSON.stringify(run(preset("yi")));
    for (let i = 0; i < 100; i++) expect(JSON.stringify(run(preset("yi")))).toBe(first);
    for (const f of ["evaluate.ts", "recommend.ts", "rounds.ts", "paths.ts"]) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
      expect(src).not.toMatch(/Date\.now|Math\.random/);
    }
  });
});

describe("事件预处理", () => {
  const ev = eventFactory("s", "v0.3");
  it("重复翻牌只计一次；最终判断之后和揭晓后的翻牌不算主动查证", () => {
    const events = [
      ev("R1", "pre_reveal", "card_flip", { card: "elephant" }),
      ev("R1", "pre_reveal", "card_flip", { card: "elephant" }),
      ev("R1", "pre_reveal", "final_assessment", { verdict: "refutes" }),
      ev("R1", "pre_reveal", "card_flip", { card: "fox" }),
      ev("R1", "post_reveal", "card_flip", { card: "fox" }),
    ];
    const { profile } = evaluate(events, ENGINE_CONFIG);
    expect(profile.observations.O1.instances[0]!.outcome).toBe("unchecked");
    expect(profile.style.first_flips).toEqual([{ round_id: "R1", card: "elephant", counted: true }]);
  });

  it("机械策略不能同时让 O1、O2 都是“观察到”", () => {
    const strategies: Record<string, (id: string) => RoundSpec> = {
      恒支持: (id) => ({ round_id: id, flips: ["fox", "elephant"], final: "supports", action: "follow" }),
      恒否定: (id) => ({ round_id: id, flips: ["fox", "elephant"], final: "refutes", action: "pass" }),
      恒证据不足: (id) => ({ round_id: id, flips: ["fox", "elephant"], final: "insufficient", action: "wait" }),
      从不翻关键牌: (id) => ({ round_id: id, flips: ["leopard"], final: id === "R1" ? "refutes" : "supports", action: "pass" }),
    };
    for (const [name, make] of Object.entries(strategies)) {
      const { progress } = run(["R1", "R2", "R3"].map(make));
      expect(progress.K, name).toBeLessThan(2);
    }
  });

  it("物种：说法点名的牌不计入；平局给混合；样本太少给尚未显形", () => {
    const spec = (id: string, flips: RoundSpec["flips"]): RoundSpec => ({ round_id: id, flips, final: "insufficient", action: "pass" });
    // 甲的首翻：R1 大象、R2 狐狸、R3 狐狸，都不是点名牌 → 狐狸 2 次
    expect(run(preset("jia")).profile.style.species).toBe("fox");
    // R1 首翻狐狸（R1 点名狐狸，不计）、R2 首翻大象（R2 点名大象，不计）、R3 猎豹 → 只计 1 次
    expect(run([spec("R1", ["fox"]), spec("R2", ["elephant"]), spec("R3", ["leopard"])]).profile.style.species).toBe("unknown");
    // 1:1 → 混合，不按“第三轮优先”打破平局
    expect(run([spec("R1", ["elephant"]), spec("R2", ["fox"]), spec("R3", [])]).profile.style.species).toBe("mixed");
  });
});

describe("追问触发", () => {
  const cases: [string, Parameters<typeof followupFor>[0], string, string | null][] = [
    ["证据不足优先", { final: "insufficient", flips: ["fox"], action: "wait" }, "R1", "missing"],
    ["翻过关键牌且结论不一致", { final: "supports", flips: ["fox"], action: "pass" }, "R1", "basis"],
    ["没翻关键牌、结论不一致：不追问依据", { final: "supports", flips: ["leopard"], action: "pass" }, "R1", null],
    ["先看看", { final: "refutes", flips: ["fox"], action: "wait" }, "R1", "waiting"],
    ["行动与判断不同不追问", { final: "refutes", flips: ["fox"], action: "follow" }, "R1", null],
    ["未来型查看量价后作明确判断也应追问", { final: "supports", flips: ["leopard"], action: "follow" }, "R3", "basis"],
    ["未来型轮次先看看", { final: "supports", flips: [], action: "wait" }, "R3", "waiting"],
  ];
  for (const [name, rec, round, expected] of cases) it(name, () => expect(followupFor(rec, R(round))).toBe(expected));
});

describe("判断线", () => {
  const events = eventsFromSpecs(preset("yi"), ROUNDS);
  it("R1 依据与结论一致，R3 未查看关键牌", () => {
    expect(roundJudgement(events, R("R1"), ENGINE_CONFIG)).toBe("consistent");
    expect(roundJudgement(events, R("R3"), ENGINE_CONFIG)).toBe("unchecked");
  });
  it("没翻关键牌：未查看本轮关键证据", () => {
    expect(roundJudgement(eventsFromSpecs(preset("bing"), ROUNDS), R("R1"), ENGINE_CONFIG)).toBe("unchecked");
  });
});

describe("任务 A 与进度", () => {
  const ev = eventFactory("s", "v0.3", 100);
  const step = (n: number, answer: string, correct: boolean, aligned = true) =>
    ev("taskA", "in_task", "task_step", { task: "A", step: n, phase: "submit", answer, correct, aligned, window_extended: n === 2 });

  it("甲：K=0，提示下完成 A 两步后 K 仍为 0，但 B 开放，不循环回 A", () => {
    const before = run(preset("jia"));
    expect(before.progress.K).toBe(0);
    expect(recommend(before.profile, before.progress, AVAILABLE_TOPICS)).toMatchObject({ route: "R-A2", steps: [1, 2] });
    const extra = [
      ev("taskA", "in_task", "assist_exposure", { task: "A", step: 1, content_id: "A1-hint", kind: "hint" }),
      step(1, "outperform", true),
      ev("taskA", "in_task", "assist_exposure", { task: "A", step: 2, content_id: "A2-hint", kind: "hint" }),
      step(2, "supports", true),
    ];
    const after = run(preset("jia"), extra);
    expect(after.progress.K).toBe(0);
    expect(after.profile.observations.O1).toEqual(before.profile.observations.O1);
    expect(after.profile.task_observations.O1[0]).toMatchObject({ outcome: "consistent", assisted: true });
    expect(after.progress.ready_for_B).toBe(true);
    expect(recommend(after.profile, after.progress, AVAILABLE_TOPICS).task).toBe("B");
  });

  it("看过提示再切到“我自己来”，同题不算独立", () => {
    const extra = [
      ev("taskA", "in_task", "assist_exposure", { task: "A", step: 1, content_id: "A1-hint", kind: "hint" }),
      ev("taskA", "in_task", "assist_switch", { task: "A", level: "self" }),
      step(1, "outperform", true),
    ];
    expect(run(preset("jia"), extra).profile.task_observations.O1[0]).toMatchObject({ outcome: "consistent", assisted: true });
  });

  it("没对齐就提交不算完成；重复提交同一答案不增加证据", () => {
    const result = run(preset("jia"), [step(1, "outperform", true, false), step(1, "outperform", true, false)]);
    expect(result.profile.task_observations.O1).toHaveLength(1);
    expect(result.progress.taskA_steps_done).toEqual([]);
    expect(result.profile.observations.O1.status).toBe("not_observed");
  });
});

describe("筹码结算", () => {
  it("跟 / 不跟 / 先看看 × 涨 / 跌 / 持平", () => {
    for (const ret of [0.1, -0.1, 0]) {
      expect(settleRound("R1", "follow", ret).delta).toBeCloseTo(30 * ret, 2);
      expect(settleRound("R1", "pass", ret)).toMatchObject({ delta: 0, hypothetical: Math.round(30 * ret * 100) / 100 });
      expect(settleRound("R1", "wait", ret).delta).toBe(0);
    }
  });
  it("缺收益时不结算，余额从 100 起", () => {
    expect(settle([{ round_id: "R1", action: "follow" }], { R1: null })).toEqual({
      rounds: [{ round_id: "R1", action: "follow", delta: 0, hypothetical: 0, ret: null }],
      balance: START_TOKENS,
    });
  });
});
