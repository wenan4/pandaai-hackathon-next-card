// 结构化结果导出（YOU-169）：把同一次 evaluate / recommend / 行动习惯的输出合成一份 JSON，
// 供 PandaAI 侧读取。只含选择事件派生的结果，不含姓名、设备等个人信息。
import type { EngineConfig } from "./evaluate";
import { evaluate } from "./evaluate";
import { actionHabits, betTopic } from "./habits";
import { recommend, selectedTopic } from "./recommend";
import type { GameEvent, TopicId } from "./types";

export const RESULT_FORMAT = "next-card/result@v0.3-native";

export interface Provenance {
  /** user_session：本机真实体验；simulated_path：评委面板或文档里的模拟路径；judge_fork：评委在某条基线上改过字段的反事实 */
  kind: "user_session" | "simulated_path" | "judge_fork";
  path_id?: string;
  /** judge_fork 的基线，不冒充玩家新增表现 */
  fork_of?: string;
  event_count: number;
}

export function structuredResult(events: readonly GameEvent[], cfg: EngineConfig, topics: TopicId[], provenance: Omit<Provenance, "event_count">, unknowns: string[]) {
  const { profile, progress } = evaluate(events, cfg);
  const habits = actionHabits(events, cfg.rounds);
  return {
    format: RESULT_FORMAT,
    rules_version: cfg.rules_version,
    provenance: { ...provenance, event_count: events.length },
    profile,
    progress,
    /** 行动习惯：只计数，不进入能力观察；常押形态只影响任务 B 的默认主题 */
    habits,
    recommendation: recommend(profile, progress, topics, { betTopic: betTopic(habits), userTopic: selectedTopic(events) }),
    unknowns,
  };
}
export type StructuredResult = ReturnType<typeof structuredResult>;
