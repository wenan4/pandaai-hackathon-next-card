// Answers are derived from validated data, never accepted from a submitted `correct` flag.
import type { TaskAData, TaskBData } from "../../contracts/data";
import { compareToBenchmark, maxDrawdown, periodReturn } from "./metrics";
import { answerKey } from "./taskB";
import type { GameEvent } from "./types";

export interface TaskRule { content_id: string; answer: string; actions: string[] }
export type TaskRules = Partial<Record<`${"A" | "B"}:${number}`, TaskRule>>;
export const TASK_B_REASONS = { both_segments: "delta_high", only_display: "delta_one", only_test: "delta_one", no_observed_advantage: "delta_low", insufficient_evidence: "samples" } as const;

// Non-security content identity: changing a question's data cannot reinterpret an old submission.
function contentIdentity(value: unknown): string {
  let hash = 2166136261;
  for (const char of JSON.stringify(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}

export function taskARules(d: TaskAData): TaskRules {
  const ret = periodReturn(d.step2.series), dd = maxDrawdown(d.step2.series);
  return {
    "A:1": { content_id: `taskA-${d.header.script_version}-1-${contentIdentity(d.step1)}`, answer: compareToBenchmark(d.step1.aligned.asset, d.step1.aligned.benchmark), actions: ["aligned"] },
    "A:2": { content_id: `taskA-${d.header.script_version}-2-${contentIdentity(d.step2)}`, answer: ret === null || dd === null ? "insufficient" : ret > 0 && dd < .15 ? "supports" : "refutes", actions: ["window_extended"] },
  };
}
export function taskBRules(d: TaskBData): TaskRules {
  const answer = answerKey(d.verdict);
  const id = `taskB-${d.header.topic}-${d.header.script_version}-${contentIdentity([d.header.signal, d.header.thresholds, d.display, d.test])}`;
  return {
    "B:1": { content_id: `${id}-1`, answer: "rules_locked", actions: ["rules_locked", "display_viewed"] },
    "B:2": { content_id: `${id}-2`, answer: "test_opened", actions: ["test_viewed"] },
    "B:3": { content_id: `${id}-3`, answer: `${answer}|${TASK_B_REASONS[answer]}`, actions: ["rules_locked", "display_viewed", "test_viewed"] },
  };
}
export function taskCorrect(e: Extract<GameEvent, { type: "task_step" }>, rules: TaskRules, preceding: readonly GameEvent[]): boolean {
  const p = e.payload, r = rules[`${p.task}:${p.step}`];
  if (!r || p.phase !== "submit" || p.content_id !== r.content_id || p.answer !== r.answer || !r.actions.every(a => p.actions.includes(a))) return false;
  if (p.task === "B" && p.step === 3) {
    const lock = preceding.findIndex(x => x.stage === "in_task" && x.type === "task_step" && x.payload.task === "B" && x.payload.step === 1 && taskCorrect(x, rules, []));
    return lock >= 0 && preceding.slice(lock + 1).some(x => x.stage === "in_task" && x.type === "task_step" && x.payload.task === "B" && x.payload.step === 2 && taskCorrect(x, rules, []));
  }
  return true;
}

/** Resuming a question preserves its attempts and prior exposure. */
export function nextAttempt(events: readonly GameEvent[], task: "A" | "B", step: number): number {
  return 1 + events.filter(e => e.stage === "in_task" && e.type === "task_step" && e.payload.task === task && e.payload.step === step && e.payload.phase === "submit").length;
}
