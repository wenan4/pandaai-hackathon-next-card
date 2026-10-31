// Explicit synthetic answer key for engine tests; never loaded by the game.
import { ENGINE_CONFIG } from "../../config/engine";
import type { EventMaker } from "../paths";
import type { TaskRules } from "../taskRules";
export const SAMPLE_TASK_RULES: TaskRules = {
  "A:1": { content_id: "sample-A1", answer: "outperform", actions: ["aligned"] },
  "A:2": { content_id: "sample-A2", answer: "supports", actions: ["window_extended"] },
  "B:1": { content_id: "sample-B1", answer: "rules_locked", actions: ["rules_locked", "display_viewed"] },
  "B:2": { content_id: "sample-B2", answer: "test_opened", actions: ["test_viewed"] },
  "B:3": { content_id: "sample-B3", answer: "no_observed_advantage|delta_low", actions: ["rules_locked", "display_viewed", "test_viewed"] },
};
export const TEST_CONFIG = { ...ENGINE_CONFIG, tasks: SAMPLE_TASK_RULES };
export const beginTaskB = (ev: EventMaker) => [1, 2].map(step => {
  const r = SAMPLE_TASK_RULES[`B:${step}`]!;
  return ev("taskB", "in_task", "task_step", { task: "B", step, content_id: r.content_id, answer: r.answer, actions: r.actions, phase: "submit", attempt: 1 });
});
