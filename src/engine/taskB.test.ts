import { beginTaskB } from "./fixtures/taskRules";
import { describe, expect, it } from "vitest";
import { TaskBDataSchema } from "../../contracts";
import taskB from "../../public/data/taskB_cheetah.json";
import cases from "./fixtures/taskB_verdict_cases.json";
import { TEST_CONFIG as ENGINE_CONFIG } from "./fixtures/taskRules";
import { PRESETS } from "../panel/presets";
import { evaluateView as evaluate } from "./evaluate";
import { eventFactory, eventsFromSpecs, type EventMaker } from "./paths";
import { answerKey, comparison, verdict, type SegmentsLike } from "./taskB";

// [n_records, primary_metric]；少写一项表示字段不存在，用来对齐 Python 的 g.get(...)
type Pair = [number?, (number | null)?];
const group = (p: Pair) => ({ ...(p.length > 0 ? { n_records: p[0] } : {}), ...(p.length > 1 ? { primary_metric: p[1] } : {}) });
const asData = (c: { display: Record<string, Pair>; test: Record<string, Pair> }): SegmentsLike => {
  const seg = (s: Record<string, Pair>) => ({ signal_group: group(s.signal!), baseline_group: group(s.baseline!) }) as SegmentsLike["display"];
  return { display: seg(c.display), test: seg(c.test) };
};

describe("任务 B 判定与 Python 共用用例", () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      expect(verdict(asData(c as never), cases.thresholds)).toEqual(c.expected);
    });
  }

  it("刚好等于阈值算达到；缺指标时差值与是否达到都为空", () => {
    expect(comparison(0.6, 0.55, 0.05)).toEqual({ delta: 0.05, meets: true });
    expect(comparison(null, 0.5, 0.05)).toEqual({ delta: null, meets: null });
  });

  it("五个作答分支各对应一个结论", () => {
    expect(new Set(cases.cases.map((c) => answerKey(c.expected as never)))).toEqual(
      new Set(["insufficient_evidence", "both_segments", "only_display", "only_test", "no_observed_advantage"]),
    );
  });
});

describe("taskB_cheetah.json", () => {
  it("通过契约校验", () => {
    const parsed = TaskBDataSchema.safeParse(taskB);
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
  });

  it("差值、是否达到和结论都能由前端同一份判定函数重算", () => {
    for (const seg of ["display", "test"] as const) {
      const s = taskB[seg];
      const { delta, meets } = comparison(s.signal_group.primary_metric, s.baseline_group.primary_metric, taskB.header.thresholds.advantage_margin);
      expect([delta, meets]).toEqual([s.delta, s.meets_threshold]);
    }
    expect(verdict(taskB as unknown as SegmentsLike, taskB.header.thresholds)).toEqual(taskB.verdict);
  });
});

describe("任务 B 的提交只产生 O5，且独立与否由事件推导", () => {
  const base = () => eventsFromSpecs(PRESETS.find((p) => p.id === "yi")!.specs, ENGINE_CONFIG.rounds);
  const submit = (ev: EventMaker, answer: string) => ev("taskB", "in_task", "task_step", { task: "B", step: 3, phase: "submit", answer, content_id: "sample-B3", attempt: 1, actions: ["rules_locked", "display_viewed", "test_viewed"] });

  it("一次提交与数据一致：独立完成，taskB_done 为真，O1–O4 不变", () => {
    const ev = eventFactory("t", "v0.3", 500);
    const before = evaluate(base(), ENGINE_CONFIG);
    const after = evaluate([...base(), ...beginTaskB(ev), submit(ev, "no_observed_advantage|delta_low")], ENGINE_CONFIG);
    expect(after.profile.task_observations.O5).toMatchObject([{ rule: "O5-t", outcome: "consistent", assisted: false }]);
    expect(after.progress.taskB_done).toBe(true);
    expect(after.profile.observations).toEqual(before.profile.observations);
  });

  it("看过提示，或先交了一次对不上的答案再改：记为有帮助", () => {
    const ev = eventFactory("t", "v0.3", 500);
    const hinted = evaluate([...base(), ev("taskB", "in_task", "assist_exposure", { task: "B", step: 3, content_id: "B3-hint", kind: "hint", attempt: 1 }), ...beginTaskB(ev), submit(ev, "no_observed_advantage|delta_low")], ENGINE_CONFIG);
    expect(hinted.profile.task_observations.O5[0]!.assisted).toBe(true);
    const retried = evaluate([...base(), ...beginTaskB(ev), submit(ev, "both_segments|delta_high"), ...beginTaskB(ev), submit(ev, "no_observed_advantage|delta_low")], ENGINE_CONFIG);
    expect(retried.profile.task_observations.O5.map((i) => [i.rule, i.assisted])).toEqual([["O5-r", false], ["O5-t", true]]);
  });

  it("先猜后验：先猜“会高出”、数据两段都没达到、之后答对，O4 增加一次修正；猜对或说不准不算", () => {
    const run = (guessAnswer: string) => {
      const ev = eventFactory("t", "v0.3", 500);
      const guess = ev("taskB", "in_task", "task_step", { task: "B", step: 1, phase: "guess", answer: guessAnswer, content_id: "sample-B1", attempt: 1, actions: [] });
      return evaluate([...base(), guess, ...beginTaskB(ev), submit(ev, "no_observed_advantage|delta_low")], ENGINE_CONFIG);
    };
    const taskB = (out: ReturnType<typeof run>) => out.profile.observations.O4.instances.filter((i) => i.context === "taskB");
    expect(taskB(run("higher"))).toMatchObject([{ rule: "O4-a", outcome: "consistent", assisted: false }]);
    expect(taskB(run("higher"))[0]!.event_ids).toHaveLength(2);
    expect(taskB(run("not_higher"))).toEqual([]);
    expect(taskB(run("insufficient"))).toEqual([]);
  });

  it("重复提交同一答案不增加记录；只有对不上的提交时任务未完成", () => {
    const ev = eventFactory("t", "v0.3", 500);
    const out = evaluate([...base(), ...beginTaskB(ev), submit(ev, "both_segments|delta_high"), ...beginTaskB(ev), submit(ev, "both_segments|delta_high")], ENGINE_CONFIG);
    expect(out.profile.task_observations.O5).toHaveLength(1);
    expect(out.progress.taskB_done).toBe(false);
  });
});
