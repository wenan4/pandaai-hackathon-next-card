import { describe, expect, it } from "vitest";
import { ENGINE_CONFIG } from "../config/engine";
import { PRESETS } from "../panel/presets";
import { eventsBeforeTask, profileChanges } from "./changes";
import { evaluate } from "./evaluate";
import { eventFactory, eventsFromSpecs, type EventMaker } from "./paths";
import type { GameEvent } from "./types";

describe("任务前后的画像对比（YOU-159）", () => {
  const base = () => eventsFromSpecs(PRESETS.find((p) => p.id === "yi")!.specs, ENGINE_CONFIG.rounds);
  const submit = (ev: EventMaker, answer: string, correct: boolean) => ev("taskB", "in_task", "task_step", { task: "B", step: 3, phase: "submit", answer, correct });
  const guess = (ev: EventMaker, answer: string) => ev("taskB", "in_task", "task_step", { task: "B", step: 1, phase: "guess", answer, correct: null });
  const compare = (events: GameEvent[]) => profileChanges(evaluate(eventsBeforeTask(events, "B"), ENGINE_CONFIG).profile, evaluate(events, ENGINE_CONFIG).profile);

  it("任务前的事件截到任务 B 的第一条局内事件为止；没有任务 B 时原样返回", () => {
    const ev = eventFactory("t", "v0.3", 500);
    const before = base();
    expect(eventsBeforeTask([...before, guess(ev, "higher"), submit(ev, "no_observed_advantage|delta_low", true)], "B")).toEqual(before);
    expect(eventsBeforeTask(before, "B")).toEqual(before);
  });

  it("独立答对：O5 从未开始到独立完成，原因是 O5-t；第一幕四项都不变", () => {
    const ev = eventFactory("t", "v0.3", 500);
    const ch = compare([...base(), submit(ev, "no_observed_advantage|delta_low", true)]);
    expect(ch.O5).toMatchObject({ before: "none", after: "done", added: [{ rule: "O5-t", context: "taskB" }] });
    expect(ch.changed).toEqual([]);
    expect(ch.unchanged).toEqual(["O1", "O2", "O3", "O4"]);
  });

  it("先猜与数据冲突后答对：O4 列为变化，原因是任务 B 里的 O4-a", () => {
    const ev = eventFactory("t", "v0.3", 500);
    const ch = compare([...base(), guess(ev, "higher"), submit(ev, "no_observed_advantage|delta_low", true)]);
    const o4 = ch.changed.find((c) => c.id === "O4");
    expect(o4?.added).toMatchObject([{ rule: "O4-a", context: "taskB" }]);
    expect(ch.unchanged).not.toContain("O4");
  });

  it("答错一次再答对：O5 记为在帮助下完成，两条提交都列为原因", () => {
    const ev = eventFactory("t", "v0.3", 500);
    const ch = compare([...base(), submit(ev, "both_segments|delta_high", false), submit(ev, "no_observed_advantage|delta_low", true)]);
    expect(ch.O5.after).toBe("assisted");
    expect(ch.O5.added.map((i) => i.rule)).toEqual(["O5-r", "O5-t"]);
  });

  it("只有对不上的提交：O5 为未完成", () => {
    const ev = eventFactory("t", "v0.3", 500);
    expect(compare([...base(), submit(ev, "both_segments|delta_high", false)]).O5.after).toBe("recorded");
  });
});
