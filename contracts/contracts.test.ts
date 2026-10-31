import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import casesReveal from "../public/data/cases_reveal.json";
import casesRevealR1 from "../public/data/cases_reveal_R1.json";
import casesVisible from "../public/data/cases_visible.json";
import taskA from "../public/data/taskA.json";
import pathYiPrime from "./examples/path-yi-prime.events.json";
import pathYi from "./examples/path-yi.events.json";
import result from "./examples/result.path-yi.json";
import roundsExample from "./examples/rounds.example.json";
import taskBElephant from "./examples/taskB_elephant.example.json";
import { JSON_SCHEMA_TARGETS, renderJsonSchema } from "./json-schema";
import {
  CasesRevealSchema,
  CasesVisibleSchema,
  EventLogSchema,
  FORBIDDEN_COPY,
  GameEventSchema,
  RoundsConfigSchema,
  StructuredResultSchema,
  TaskADataSchema,
  TaskBDataSchema,
  type GameEvent,
  type TaskBData,
} from "./index";

const clone = <T>(x: T): T => structuredClone(x);
const issues = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.error?.issues ?? []).map((i) => i.message);

describe("事件夹具", () => {
  it("路径乙通过事件序列校验", () => {
    expect(EventLogSchema.safeParse(pathYi).success).toBe(true);
  });

  it("路径乙′通过校验，且与乙只差 R3 的追问答案", () => {
    expect(EventLogSchema.safeParse(pathYiPrime).success).toBe(true);
    const diff = pathYi.filter((e, i) => JSON.stringify(e.payload) !== JSON.stringify(pathYiPrime[i]!.payload));
    expect(diff.map((e) => e.event_id)).toEqual(["R3:followup"]);
  });

  it("每轮最多翻两张牌，且同一张牌只翻一次", () => {
    for (const round of ["R1", "R2", "R3", "R4", "R5", "R6"]) {
      const flips = (pathYi as GameEvent[]).filter((e) => e.round_id === round && e.type === "card_flip").map((e) => (e as Extract<GameEvent, { type: "card_flip" }>).payload.card);
      expect(flips.length).toBeLessThanOrEqual(2);
      expect(new Set(flips).size).toBe(flips.length);
    }
  });
});

describe("事件校验的拒绝路径", () => {
  const base = () => clone(pathYi) as unknown as Record<string, unknown>[];

  it("拒绝重复的 event_id", () => {
    const events = base();
    events[2]!.event_id = events[1]!.event_id;
    expect(issues(EventLogSchema.safeParse(events)).some((m) => m.includes("event_id 重复"))).toBe(true);
  });

  it("拒绝揭晓后的 final_assessment（揭晓后补全不能当成主动查证）", () => {
    const events = base();
    const final = events.find((e) => e.event_id === "R1:final")!;
    final.stage = "post_reveal";
    expect(issues(EventLogSchema.safeParse(events)).some((m) => m.includes("final_assessment 不允许出现在 post_reveal"))).toBe(true);
  });

  it("拒绝混入第二个会话", () => {
    const events = base();
    events[3]!.session_id = "other";
    expect(issues(EventLogSchema.safeParse(events)).some((m) => m.includes("只能属于一个会话"))).toBe(true);
  });

  it("拒绝未知事件类型和多余字段（含自由文字）", () => {
    expect(GameEventSchema.safeParse({ ...(pathYi[1] as object), type: "mouse_move" }).success).toBe(false);
    const noted = { ...(pathYi[1] as object), type: "self_note", stage: "post_reveal", payload: { note: "nothing", text: "自由文字" } };
    expect(GameEventSchema.safeParse(noted).success).toBe(false);
  });

  it("decision 只接受 follow / skip / wait", () => {
    const e = clone(pathYi[4]) as unknown as { payload: { action: string } };
    e.payload.action = "pass";
    expect(GameEventSchema.safeParse(e).success).toBe(false);
  });
});

describe("关卡配置", () => {
  it("示例配置通过校验", () => {
    expect(issues(RoundsConfigSchema.safeParse(roundsExample))).toEqual([]);
  });

  it("六轮分两幕，每种押注形态各出现两次", () => {
    const parsed = RoundsConfigSchema.parse(roundsExample);
    expect(parsed.rounds.map((r) => r.act)).toEqual([1, 1, 1, 2, 2, 2]);
    expect(parsed.bet_family_coverage).toEqual({ relative_strength: 2, steady_trend: 2, volume_surge: 2 });
  });

  it("R3 没有点名牌；其余轮的点名牌就是关键牌", () => {
    const parsed = RoundsConfigSchema.parse(roundsExample);
    expect(parsed.rounds.find((r) => r.round_id === "R3")!.named_card).toBeNull();
    for (const r of parsed.rounds.filter((x) => x.round_id !== "R3")) expect(r.named_card).toBe(r.key_card);
  });

  it("关键牌的普通解释不得是方向性提示", () => {
    const cfg = clone(roundsExample) as typeof roundsExample;
    cfg.rounds[0]!.explain.fox.kind = "directional" as never;
    expect(issues(RoundsConfigSchema.safeParse(cfg)).some((m) => m.includes("方向性提示"))).toBe(true);
  });

  it("覆盖表必须与轮次一致，round_id 不得重复", () => {
    const cfg = clone(roundsExample) as typeof roundsExample;
    cfg.bet_family_coverage.steady_trend = 3;
    expect(issues(RoundsConfigSchema.safeParse(cfg)).some((m) => m.includes("覆盖表与轮次不一致"))).toBe(true);
    const dup = clone(roundsExample) as typeof roundsExample;
    dup.rounds[1]!.round_id = "R1";
    expect(issues(RoundsConfigSchema.safeParse(dup)).some((m) => m.includes("round_id 重复"))).toBe(true);
  });

  it("幕号必须与轮号对应", () => {
    const cfg = clone(roundsExample) as typeof roundsExample;
    (cfg.rounds[3] as { act: number }).act = 1;
    expect(issues(RoundsConfigSchema.safeParse(cfg)).some((m) => m.includes("应属于第 2 幕"))).toBe(true);
  });
});

describe("结构化输出", () => {
  it("路径乙的输出示例通过校验", () => {
    expect(issues(StructuredResultSchema.safeParse(result))).toEqual([]);
  });

  it("输出示例与事件夹具一致：同向轮数、跟的次数、押注形态都能从事件重算", () => {
    const byRound = (type: GameEvent["type"]) =>
      new Map((pathYi as GameEvent[]).filter((e) => e.type === type).map((e) => [e.round_id, e] as const));
    const finals = byRound("final_assessment");
    const decisions = byRound("decision");
    const expectedAction = { supports: "follow", refutes: "skip", insufficient: "wait" } as const;
    const rounds = ["R1", "R2", "R3", "R4", "R5", "R6"] as const;
    const aligned = rounds.filter((r) => {
      const verdict = (finals.get(r) as Extract<GameEvent, { type: "final_assessment" }>).payload.verdict;
      const action = (decisions.get(r) as Extract<GameEvent, { type: "decision" }>).payload.action;
      return expectedAction[verdict] === action;
    });
    const followed = rounds.filter((r) => (decisions.get(r) as Extract<GameEvent, { type: "decision" }>).payload.action === "follow");
    expect(result.action_profile.aligned.rounds).toEqual(aligned);
    expect(result.action_profile.follow_total.rounds).toEqual(followed);
    const config = RoundsConfigSchema.parse(roundsExample);
    const backed = (family: string) => followed.filter((r) => config.rounds.find((c) => c.round_id === r)!.bet_family === family);
    expect(result.backed_families.by_family.steady_trend.rounds).toEqual(backed("steady_trend"));
    expect(result.backed_families.by_family.relative_strength.rounds).toEqual(backed("relative_strength"));
    expect(result.backed_families.by_family.volume_surge.rounds).toEqual(backed("volume_surge"));
  });

  it("物种只统计未被点名的首翻，且这些首翻能在事件里找到", () => {
    const config = RoundsConfigSchema.parse(roundsExample);
    const firstFlip = new Map<string, string>();
    for (const e of pathYi as GameEvent[]) {
      if (e.type === "card_flip" && !firstFlip.has(e.round_id)) firstFlip.set(e.round_id, e.payload.card);
    }
    const counted = [...firstFlip].filter(([r, card]) => config.rounds.find((c) => c.round_id === r)!.named_card !== card);
    expect(result.style.counted_first_flips.map((f) => [f.round_id, f.card])).toEqual(counted);
  });

  it("决策链里的“同向”与行动习惯的同向轮次一致", () => {
    const aligned = result.decision_chains.filter((c) => c.aligned).map((c) => c.round_id);
    expect(aligned).toEqual(result.action_profile.aligned.rounds);
  });

  it("松果和收益数字不进入决策链与行动习惯", () => {
    const text = JSON.stringify([result.decision_chains, result.action_profile, result.backed_families]);
    expect(text).not.toMatch(/chips|hypothetical|return|收益|盈亏/);
  });

  it("拒绝不一致的 O4（N、M 与规则编号对不上）", () => {
    const bad = clone(result) as typeof result;
    (bad.observations[3] as { rule: string }).rule = "O4-b";
    expect(StructuredResultSchema.safeParse(bad).success).toBe(false);
  });

  it("拒绝 ready_for_B 与 S1 && S2 不一致", () => {
    const bad = clone(result);
    bad.progress.S2 = false;
    expect(issues(StructuredResultSchema.safeParse(bad)).some((m) => m.includes("ready_for_B 必须等于 S1 && S2"))).toBe(true);
  });

  it("拒绝已接触方向性提示却记为 observed", () => {
    const bad = clone(result);
    (bad.observations[0] as { scenarios: { assistance: string }[] }).scenarios[0]!.assistance = "directional_explain";
    expect(issues(StructuredResultSchema.safeParse(bad)).some((m) => m.includes("只能记 assisted"))).toBe(true);
  });

  it.each(["directional_explain", "hint", "demo", "answer_feedback"])("O5 看过 %s 后只能记为有帮助完成", (assistance) => {
    const o5 = { id: "O5", state: "observed", rule: "O5-a", evidence_event_ids: ["taskB:submit"], assistance };
    const output = { ...clone(result), observations: [...clone(result.observations), o5] };
    output.progress.taskB_done = true;
    expect(issues(StructuredResultSchema.safeParse(output)).some((m) => m.includes("只能记 assisted"))).toBe(true);
    o5.state = "assisted";
    expect(issues(StructuredResultSchema.safeParse(output))).toEqual([]);
  });

  it("O5 没有帮助暴露时可独立完成，但不能声称在帮助下完成", () => {
    const o5 = { id: "O5", state: "observed", rule: "O5-a", evidence_event_ids: ["taskB:submit"], assistance: "none" };
    const output = { ...clone(result), observations: [...clone(result.observations), o5] };
    output.progress.taskB_done = true;
    expect(issues(StructuredResultSchema.safeParse(output))).toEqual([]);
    o5.state = "assisted";
    expect(issues(StructuredResultSchema.safeParse(output)).some((m) => m.includes("assisted 必须有对应的帮助暴露"))).toBe(true);
  });

  it("拒绝 uncertain 缺少原因", () => {
    const bad = clone(result);
    const o1 = bad.observations[0] as { scenarios: { state: string }[] };
    o1.scenarios[0]!.state = "uncertain";
    expect(issues(StructuredResultSchema.safeParse(bad)).some((m) => m.includes("必须给出原因"))).toBe(true);
  });

  it("面向用户的文案不得出现禁用词", () => {
    for (const word of FORBIDDEN_COPY) {
      const bad = clone(result);
      bad.style.scope = `本局倾向，${word}`;
      expect(StructuredResultSchema.safeParse(bad).success, word).toBe(false);
    }
  });

  it("推荐：有分歧时必须同时列出两个来源；任务 B 不带任务 A 的步骤", () => {
    const conflict = clone(result);
    conflict.recommendation.topic_conflict = true;
    conflict.recommendation.topic_sources = ["bet"];
    expect(issues(StructuredResultSchema.safeParse(conflict)).some((m) => m.includes("两个来源"))).toBe(true);
    const steps = clone(result) as unknown as { recommendation: { steps: number[] } };
    steps.recommendation.steps = [1];
    expect(issues(StructuredResultSchema.safeParse(steps)).some((m) => m.includes("任务 B 不带任务 A 的步骤"))).toBe(true);
  });

  it("拒绝多余字段（风险偏好之类的推断字段不能混进来）", () => {
    const bad = { ...clone(result), risk_appetite: "high" };
    expect(StructuredResultSchema.safeParse(bad).success).toBe(false);
  });
});

describe("数据文件：可见部分与揭晓后部分分开", () => {
  it("仓库里已有的 cases_visible 符合契约", () => {
    expect(issues(CasesVisibleSchema.safeParse(casesVisible))).toEqual([]);
  });

  it("仓库里已有的 cases_reveal（整份与按轮拆分）符合契约", () => {
    expect(issues(CasesRevealSchema.safeParse(casesReveal))).toEqual([]);
    expect(issues(CasesRevealSchema.safeParse(casesRevealR1))).toEqual([]);
  });

  it("仓库里已有的 taskA 符合契约", () => {
    expect(issues(TaskADataSchema.safeParse(taskA))).toEqual([]);
  });

  it("可见部分没有 after、标的、名称、真实日期", () => {
    const text = JSON.stringify(casesVisible);
    for (const key of ['"after"', '"symbol"', '"name"', '"decision_date"', '"open_t1"']) expect(text).not.toContain(key);
  });

  it("可见部分拒绝任何多余字段，包括混入揭晓后数据", () => {
    const withAfter = clone(casesVisible) as unknown as { rounds: Record<string, unknown>[] };
    withAfter.rounds[0]!.after = { close: [100, 101] };
    expect(CasesVisibleSchema.safeParse(withAfter).success).toBe(false);
    const withSymbol = clone(casesVisible) as unknown as { rounds: { cards: { fox: Record<string, unknown> } }[] };
    withSymbol.rounds[0]!.cards.fox.symbol = "000001.SZ";
    expect(CasesVisibleSchema.safeParse(withSymbol).success).toBe(false);
  });

  it("可见窗口必须止于 T 日；把揭晓后的数据放进可见卡会被拒绝", () => {
    const bad = clone(casesVisible) as unknown as { rounds: { cards: { fox: { offsets: number[] } } }[] };
    bad.rounds[0]!.cards.fox.offsets = [-59, 5];
    expect(CasesVisibleSchema.safeParse(bad).success).toBe(false);
  });

  it("可见部分与揭晓后部分的整份结构互不通用", () => {
    expect(CasesVisibleSchema.safeParse(casesReveal).success).toBe(false);
    expect(CasesRevealSchema.safeParse(casesVisible).success).toBe(false);
  });

  it("可见部分的文件头没有标的、日期、筛选条件", () => {
    expect(Object.keys(casesVisible.header).sort()).toEqual(["file", "note", "rules_version", "schema", "script_version"]);
  });

  it("揭晓走势以 T 日收盘 = 100 起算，且 close_t20 等于最后一个点", () => {
    const bad = clone(casesReveal) as unknown as { rounds: { after: { close: number[]; close_t20: number } }[] };
    bad.rounds[0]!.after.close_t20 = bad.rounds[0]!.after.close_t20 + 5;
    expect(issues(CasesRevealSchema.safeParse(bad)).some((m) => m.includes("close_t20"))).toBe(true);
  });
});

describe("任务 B 数据文件", () => {
  it("示例通过校验", () => {
    expect(issues(TaskBDataSchema.safeParse(taskBElephant))).toEqual([]);
  });

  it("0 条记录时指标必须是 null，不能用 0% 冒充", () => {
    const bad = clone(taskBElephant);
    bad.test.signal_group.n_records = 0;
    bad.test.signal_group.n_symbols = 0;
    expect(TaskBDataSchema.safeParse(bad).success).toBe(false);
    const ok: TaskBData = TaskBDataSchema.parse(clone(taskBElephant));
    Object.assign(ok.test.signal_group, { n_records: 0, n_symbols: 0, primary_metric: null, mean_return: null, covered: null });
    ok.test.delta = null;
    ok.test.meets_threshold = null;
    ok.verdict = { result: "insufficient_evidence" };
    expect(issues(TaskBDataSchema.safeParse(ok))).toEqual([]);
  });

  it.each([
    ["display", "signal_group"],
    ["display", "baseline_group"],
    ["test", "signal_group"],
    ["test", "baseline_group"],
  ] as const)("%s 的 %s 有样本但缺主指标时必须降级为证据不足", (segment, group) => {
    const data: TaskBData = TaskBDataSchema.parse(clone(taskBElephant));
    data[segment][group].primary_metric = null;
    data[segment][group].mean_return = null;
    data[segment].delta = null;
    data[segment].meets_threshold = null;
    data.verdict = { result: "insufficient_evidence" };
    expect(data[segment][group].n_records).toBeGreaterThan(0);
    expect(issues(TaskBDataSchema.safeParse(data))).toEqual([]);

    // 缺指标不等于差值为零，也不能先作出“达到／未达到”的结论。
    for (const verdict of [
      { result: "both_segments" },
      { result: "segment_difference", only_segment: "display" },
      { result: "no_observed_advantage" },
    ] as const) {
      expect(issues(TaskBDataSchema.safeParse({ ...data, verdict })).some((m) => m.includes("insufficient_evidence"))).toBe(true);
    }
    const withDelta = clone(data);
    withDelta[segment].delta = 0;
    expect(TaskBDataSchema.safeParse(withDelta).success).toBe(false);
    const withThreshold = clone(data);
    withThreshold[segment].meets_threshold = false;
    expect(TaskBDataSchema.safeParse(withThreshold).success).toBe(false);
  });

  it("segment_difference 必须注明是哪一段", () => {
    const bad = clone(taskBElephant) as unknown as { verdict: Record<string, unknown> };
    delete bad.verdict.only_segment;
    expect(issues(TaskBDataSchema.safeParse(bad)).some((m) => m.includes("展示段还是仅检验段"))).toBe(true);
  });

  it("主指标只能是“上涨比例”或“跑赢比例”两种之一", () => {
    const bad = clone(taskBElephant) as unknown as { header: { primary_metric: { id: string } } };
    bad.header.primary_metric.id = "win_rate";
    expect(TaskBDataSchema.safeParse(bad).success).toBe(false);
  });
});

describe("导出的 JSON Schema", () => {
  it.each(JSON_SCHEMA_TARGETS.map((t) => [t.file, t] as const))("%s 没有落后于 TypeScript 定义", (file, target) => {
    const onDisk = readFileSync(new URL(`./schema/${file}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");
    expect(onDisk, "运行 node scripts/export-json-schema.mjs 重新生成").toBe(renderJsonSchema(target));
  });
});
