import { describe, expect, it } from "vitest";
import { TEST_CONFIG as ENGINE_CONFIG } from "./fixtures/taskRules";
import { changeOnlyActions, forkEvents } from "../panel/replay";
import { evaluateView as evaluate, roundJudgement } from "./evaluate";
import { eventFactory, eventsFromSpecs, type RoundSpec } from "./paths";
import { recommendView as recommend } from "./recommend";

const rounds = ENGINE_CONFIG.rounds;
const ev = eventFactory("regression", "v0.3", 1000);
const specs: RoundSpec[] = [
  { round_id: "R1", initial: "supports", flips: ["fox"], final: "refutes", action: "skip" },
  { round_id: "R2", initial: "refutes", flips: ["elephant"], final: "supports", action: "follow" },
  { round_id: "R3", initial: "supports", flips: ["leopard"], final: "insufficient", action: "wait" },
];
const run = (s: RoundSpec[]) => evaluate(eventsFromSpecs(s, rounds), ENGINE_CONFIG);
const edit = (i: number, patch: Partial<RoundSpec>) => specs.map((s, n) => n === i ? { ...s, ...patch } : s);
const step = (n: number, answer = n === 1 ? "outperform" : "supports") => ev("taskA", "in_task", "task_step", { task: "A", step: n, phase: "submit", answer, content_id: `sample-A${n}`, attempt: 1, actions: ["aligned", "window_extended"] });

describe("PRD v0.3 规则回归", () => {
  it("明确没看懂优先于猜中；不产生修正证据", () => {
    const result = run(edit(0, { action: "wait", followupAnswer: "chart_unclear" }));
    expect(result.profile.observations.O1).toMatchObject({ status: "uncertain", understanding_unclear: true });
    expect(result.profile.observations.O4.instances.map((i) => i.context)).not.toContain("R1");
    expect(result.profile.help_preference.level).toBe("guide");
  });
  it("没看量价、全程说不准、历史方向错误都不能确认 O3", () => {
    expect(run(edit(2, { flips: [] })).profile.observations.O3.status).toBe("uncertain");
    expect(run(specs.map((s) => ({ ...s, final: "insufficient" }))).profile.observations.O3.status).toBe("uncertain");
    expect(run(specs.map((s, i) => i === 0 ? { ...s, final: "supports" } : i === 1 ? { ...s, final: "refutes" } : s)).profile.observations.O3.status).toBe("uncertain");
    expect(run(specs).profile.observations.O3.status).toBe("observed");
  });
  it("O3 的方向性帮助和理解冲突不能忽略", () => {
    const helped = edit(2, { explains: [{ card: "leopard", kind: "directional" }] });
    expect(run(helped).profile.observations.O3.status).toBe("assisted");
    expect(roundJudgement(eventsFromSpecs(helped, rounds), rounds[2]!, ENGINE_CONFIG)).toBe("assisted");
    expect(run(edit(2, { final: "supports", followupAnswer: "chart_unclear" })).profile.flags.o3d).toBe(false);
  });
  it("未翻关键牌的猜中不算改判；部分修正仍按实际次数记录", () => {
    const missed = run(edit(0, { flips: ["elephant"] }));
    expect(missed.profile.observations.O4.instances.map((i) => i.context)).not.toContain("R1");
    const partial = run(edit(0, { final: "supports" })).profile.observations.O4;
    expect(partial.status).toBe("observed");
    expect(partial.summary).toContain("3 次可比较情境中调整 2 次");
    expect(run(specs.map((s) => ({ ...s, initial: "insufficient" }))).profile.observations.O4.status).toBe("uncertain");
  });
  it("零解释不代表偏好独立；1–2 次给提示，3 次带做，用户选择优先", () => {
    expect(run(specs).profile.help_preference.level).toBe("hint");
    for (const count of [1, 2, 3]) {
      const result = run(specs.map((s, i) => ({ ...s, explains: i < count ? [{ card: s.flips[0]!, kind: "neutral" }] : [] })));
      expect(result.profile.help_preference.level).toBe(count === 3 ? "guide" : "hint");
    }
    const result = evaluate([...eventsFromSpecs(edit(0, { action: "wait", followupAnswer: "chart_unclear" }), rounds), ev("taskA", "in_task", "assist_switch", { task: "A", from: "hint", to: "solo", by: "user" })], ENGINE_CONFIG);
    expect(result.profile.help_preference).toMatchObject({ level: "solo", source: "user" });
  });
  it("两情境均独立完成才可跳过基础步骤，任务证据不改写局内聚合", () => {
    const config = { ...ENGINE_CONFIG, rounds: [...rounds, { ...rounds[0]!, round_id: "R4", act: 2 as const, verdict: "supports" as const }, { ...rounds[1]!, round_id: "R5", act: 2 as const, verdict: "refutes" as const }] };
    const more: RoundSpec[] = [...specs, { ...specs[0]!, round_id: "R4", final: "supports" }, { ...specs[1]!, round_id: "R5", final: "refutes" }];
    const result = evaluate(eventsFromSpecs(more, config.rounds), config);
    expect(result.progress).toMatchObject({ K: 2, S1: true, S2: true, ready_for_B: true });
    expect(result.profile.help_preference.level).toBe("solo");
    const before = run(specs);
    const after = evaluate([...eventsFromSpecs(specs, rounds), step(1)], ENGINE_CONFIG);
    expect(after.profile.observations.O1).toEqual(before.profile.observations.O1);
    expect(recommend(after.profile, after.progress, ["cheetah"])).toMatchObject({ route: "R-A1", steps: [2] });
  });
  it("错误作答不解锁；重试和重开保留帮助，正确完成两步后才解锁 B", () => {
    const events = [...eventsFromSpecs(specs, rounds), step(1, "underperform"), step(2, "refutes")];
    const failed = evaluate(events, ENGINE_CONFIG);
    expect(failed.progress.taskA_steps_done).toEqual([]);
    expect(failed.progress.ready_for_B).toBe(false);
    const done = evaluate([...events, step(1), step(2), step(1)], ENGINE_CONFIG);
    expect(done.progress).toMatchObject({ taskA_steps_done: [1, 2], ready_for_B: true });
    expect(done.profile.task_observations.O1.filter((i) => i.outcome === "consistent")).toHaveLength(1);
    expect(done.profile.task_observations.O1.at(-1)?.assisted).toBe(true);
    expect(done.profile.observations.O1.aggregation).toBe("partial");
  });
  it("任务先猜后验的改判进入 O4；没打开长窗口不算完成", () => {
    const guess = ev("taskA", "in_task", "task_step", { task: "A", step: 2, phase: "guess", answer: "refutes", content_id: "sample-A2", attempt: 1, actions: [] });
    const incomplete = ev("taskA", "in_task", "task_step", { task: "A", step: 2, phase: "submit", answer: "supports", content_id: "sample-A2", attempt: 1, actions: [] });
    expect(evaluate([guess, incomplete], ENGINE_CONFIG).progress.taskA_steps_done).toEqual([]);
    const result = evaluate([guess, step(2)], ENGINE_CONFIG);
    expect(result.profile.observations.O4).toMatchObject({ status: "observed" });
    expect(result.profile.observations.O4.instances[0]?.context).toBe("taskA-2");
  });
  it("无数据的 B 提交不算完成，非任务阶段的提交不算任务证据", () => {
    const b = ev("taskB", "in_task", "task_step", { task: "B", step: 3, phase: "submit", answer: "both_segments", content_id: "sample-B3", attempt: 1, actions: [] });
    expect(evaluate([b, { ...step(1), stage: "post_reveal" }], ENGINE_CONFIG).progress).toMatchObject({ taskB_done: false, taskA_steps_done: [] });
  });
});

describe("评委当前体验重算", () => {
  it("重放保留真实任务和帮助历史，单改行动不清除追问", () => {
    const selected = edit(2, { followupAnswer: "chart_unclear" });
    const events = [...eventsFromSpecs(selected, rounds), ev("taskA", "in_task", "assist_exposure", { task: "A", step: 1, content_id: "hint", kind: "hint", attempt: 1 }), step(1), step(2)];
    const before = evaluate(events, ENGINE_CONFIG);
    expect(evaluate(forkEvents(events, selected, rounds), ENGINE_CONFIG)).toEqual(before);
    expect(evaluate(changeOnlyActions(events), ENGINE_CONFIG)).toEqual(before);
    const fork = forkEvents(events, selected.map((s, i) => i === 0 ? { ...s, final: "supports" } : s), rounds);
    const after = evaluate(fork, ENGINE_CONFIG);
    expect(after.profile.observations.O1.status).toBe("uncertain");
    expect(after.progress.taskA_steps_done).toEqual([1, 2]);
    expect(after.profile.task_observations).toEqual(before.profile.task_observations);
  });
});
