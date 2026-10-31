import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AVAILABLE_TOPICS, ENGINE_CONFIG } from "../config/engine";
import { PRESETS } from "../panel/presets";
import { evaluate, roundJudgement } from "./evaluate";
import { eventFactory, eventsFromSpecs, type RoundSpec } from "./paths";
import { actionHabits, betTopic } from "./habits";
import { recommend } from "./recommend";
import { followupFor } from "./rounds";
import { flipOutcomes, settle, settleRound, START_TOKENS } from "./settle";
import type { GameEvent } from "./types";

const ROUNDS = ENGINE_CONFIG.rounds;
const R = (id: string) => ROUNDS.find((r) => r.round_id === id)!;
const preset = (id: string) => PRESETS.find((p) => p.id === id)!.specs;
const run = (specs: RoundSpec[], extra: GameEvent[] = []) => evaluate([...eventsFromSpecs(specs, ROUNDS), ...extra], ENGINE_CONFIG);
const edit = (specs: RoundSpec[], round: string, patch: Partial<RoundSpec>) => specs.map((s) => (s.round_id === round ? { ...s, ...patch } : s));

const ACT1 = new Set(["R1", "R2", "R3"]);
const act1 = (specs: RoundSpec[]) => specs.filter((s) => ACT1.has(s.round_id));
const plan = (specs: RoundSpec[]) => {
  const events = eventsFromSpecs(specs, ROUNDS);
  const { profile, progress } = evaluate(events, ENGINE_CONFIG);
  return recommend(profile, progress, AVAILABLE_TOPICS, { betTopic: betTopic(actionHabits(events, ROUNDS)) });
};

describe("路径乙（PRD v0.3 §9，两幕六轮）", () => {
  const { profile, progress } = run(preset("yi"));

  it("画像：O1–O3 两个情境都观察到，O4 两次可比较机会都调整了，物种大象", () => {
    for (const id of ["O1", "O2", "O3"] as const) expect(profile.observations[id], id).toMatchObject({ status: "observed", aggregation: "repeated", summary: "两次一致" });
    expect(profile.observations.O1.instances.map((i) => [i.context, i.rule])).toEqual([["R1", "O1-a"], ["R4", "O1-a"]]);
    expect(profile.observations.O3.instances.map((i) => [i.context, i.rule])).toEqual([["R3", "O3-a"], ["R6", "O3-a"]]);
    expect(profile.observations.O4).toMatchObject({ status: "observed", summary: "本局 2 次可比较情境中调整 2 次（独立 2，有帮助 0）" });
    expect(profile.observations.O4.instances.map((i) => i.context)).toEqual(["R2", "R5"]);
    expect(profile.style).toMatchObject({ species: "elephant", counts: { fox: 0, elephant: 2, leopard: 0 } });
    expect(progress).toMatchObject({ K: 2, S1: true, S2: true, ready_for_B: true, rounds_completed: 6 });
  });

  it("推荐：直接任务 B 大象题，来源是常押形态和物种，建议“我自己来”，不先猜", () => {
    expect(plan(preset("yi"))).toMatchObject({ route: "R-B", task: "B", topic: "elephant", topic_source: "bet", topic_sources: ["bet", "style_default"], topic_conflict: false, assist: "self", guess_first: false });
  });

  it("只玩第一幕：每项只见一次（partial），仍推荐 A 的两个新情境", () => {
    const first = run(act1(preset("yi")));
    for (const id of ["O1", "O2", "O3"] as const) expect(first.profile.observations[id].aggregation, id).toBe("partial");
    expect(first.progress).toMatchObject({ K: 0, S1: false, S2: false, rounds_completed: 3 });
    expect(plan(act1(preset("yi")))).toMatchObject({ route: "R-A2", task: "A", steps: [1, 2] });
  });

  it("现场用例：R1 保留对照卡、最终判断改成支持 → O1-b，O1 由两次一致变成表现不同，改推任务 A 步骤 1；O4 的 R2、R5 证据保留", () => {
    const specs = edit(preset("yi"), "R1", { final: "supports" });
    const after = run(specs);
    expect(after.profile.observations.O1).toMatchObject({ status: "uncertain", aggregation: "mixed" });
    expect(after.profile.observations.O1.instances[0]!.rule).toBe("O1-b");
    expect(after.progress.S1).toBe(false);
    const p = plan(specs);
    expect(p).toMatchObject({ route: "R-A1", task: "A", steps: [1] });
    expect(p.reason).toContain("两个情境里表现不同，先在新情境里试一次");
    expect(followupFor({ final: "supports", flips: ["fox"], action: "follow" }, R("R1"))).toBe("basis");
    expect(after.profile.observations.O4.instances.filter((i) => i.outcome === "consistent").map((i) => i.context)).toEqual(["R2", "R5"]);
  });

  it("乙′：R3 追问改成“图没看懂” → O3 只见一次（R6 仍观察到），建议“带我做”，仍是任务 B 大象题，O4 不变", () => {
    const after = run(preset("yi1"));
    expect(after.profile.observations.O3).toMatchObject({ status: "observed", aggregation: "single", understanding_unclear: true });
    expect(after.profile.help_preference.level).toBe("guide");
    expect(plan(preset("yi1"))).toMatchObject({ task: "B", topic: "elephant", assist: "guide" });
    expect(after.profile.observations.O4).toEqual(profile.observations.O4);
  });

  it("乙″：R1 不看对照、改翻历史和量价，结论仍对 → O1-g，O1 只见一次，S1 不成立，任务 A 步骤 1，建议“给我提示”", () => {
    const after = run(preset("yi2"));
    expect(after.profile.observations.O1.instances[0]!.rule).toBe("O1-g");
    expect(after.profile.observations.O1.aggregation).toBe("single");
    expect(after.progress.S1).toBe(false);
    expect(plan(preset("yi2"))).toMatchObject({ route: "R-A1", task: "A", steps: [1], assist: "hint" });
  });

  it("现场用例：只把 R2 的下一步从跟改成先不跟 → 稳步上行只跟 1 次，默认主题仍是大象题，但来源从常押形态变成物种", () => {
    const specs = edit(preset("yi"), "R2", { action: "pass" });
    expect(run(specs).profile).toEqual(profile);
    expect(plan(specs)).toMatchObject({ route: "R-B", topic: "elephant", topic_source: "style_default", topic_sources: ["style_default"] });
  });

  it("丙：R3 两张牌只互换首翻顺序 → 物种变混合（1∶1 不强行分类），主题仍是大象题，来源只剩常押形态；能力不变", () => {
    const after = run(preset("bing"));
    expect(after.profile.style.species).toBe("mixed");
    // 事件编号的先后随翻牌顺序变化，比较规则命中与状态
    const abilities = (o: typeof profile.observations) => Object.values(o).map((x) => [x.status, x.aggregation, x.instances.map((i) => [i.context, i.rule, i.outcome, i.assisted])]);
    expect(abilities(after.profile.observations)).toEqual(abilities(profile.observations));
    expect(plan(preset("bing"))).toMatchObject({ task: "B", topic: "elephant", topic_source: "bet", topic_sources: ["bet"], topic_conflict: false });
  });

  it("甲（只玩第一幕）：先翻量价 3 次 → 猎豹；O1、O2 未观察到，O3 理解待确认，O4 没有可比较机会；A 两步，带我做，先猜后验", () => {
    const { profile: p } = run(preset("jia"));
    expect(p.style.species).toBe("leopard");
    expect(p.observations.O1).toMatchObject({ status: "not_observed", aggregation: "partial" });
    expect(p.observations.O2).toMatchObject({ status: "not_observed", aggregation: "partial" });
    expect(p.observations.O3).toMatchObject({ status: "uncertain", understanding_unclear: true });
    expect(p.observations.O4).toMatchObject({ status: "uncertain", summary: "这局没有可比较的改判机会" });
    expect(plan(preset("jia"))).toMatchObject({ route: "R-A2", steps: [1, 2], assist: "guide", guess_first: true });
  });

  it("恒答“不支持”的机械策略在第二幕暴露：第一幕 O1 看起来观察到，第二幕后变成两个情境表现不同", () => {
    const always = (ids: string[]) => ids.map((id): RoundSpec => ({ round_id: id, flips: [R(id).key_card!], final: "refutes", action: "pass", followupAnswer: null }));
    const first = run(always(["R1", "R2", "R3"]));
    const both = run(always(ROUNDS.map((r) => r.round_id)));
    expect(first.profile.observations.O1).toMatchObject({ status: "observed", aggregation: "partial" });
    expect(both.profile.observations.O1).toMatchObject({ status: "uncertain", aggregation: "mixed" });
    expect(both.progress.K).toBeLessThan(2);
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
    // 甲的首翻：R1、R2、R3 都先翻量价，都不是点名牌 → 猎豹 3 次
    expect(run(preset("jia")).profile.style.species).toBe("leopard");
    // R6 点名放量上涨：首翻量价不计
    expect(run([spec("R3", ["leopard"]), spec("R6", ["leopard"])]).profile.style).toMatchObject({ species: "unknown", counts: { leopard: 1 } });
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
  it("R1 依据与结论一致；R3 保留对未来的结论；R6 样本太少时保留结论", () => {
    expect(roundJudgement(events, R("R1"), ENGINE_CONFIG)).toBe("consistent");
    expect(roundJudgement(events, R("R3"), ENGINE_CONFIG)).toBe("future_reserved");
    expect(roundJudgement(events, R("R6"), ENGINE_CONFIG)).toBe("sample_reserved");
  });
  it("没翻关键牌：未查看本轮关键证据", () => {
    expect(roundJudgement(eventsFromSpecs(preset("yi2"), ROUNDS), R("R1"), ENGINE_CONFIG)).toBe("unchecked");
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
