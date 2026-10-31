// Public events and enums come from the frozen contract. The *View types below
// are UI evidence projections, not serialized engine outputs.
import type { Card, Verdict, AssistLevel, ExplainKind, ObsStatus, Species, TopicSource } from "../../contracts/common";
export type { Card, Verdict, Action, Stage, AssistLevel, ExplainKind, ObsStatus, Species, TopicSource, FollowupAnswer, SelfNote, RoundId, ScenarioId } from "../../contracts/common";
export type { GameEvent, EventType } from "../../contracts/events";
export type { Verdict as Reaction, FollowupQuestion as FollowupId, Topic as TopicId } from "../../contracts/common";
import type { Topic as TopicId } from "../../contracts/common";

export interface RoundConfig {
  round_id: string;
  act: 1 | 2;
  label: string;
  claim: string;
  verdict: Verdict;
  /** 检验说法或证据边界所需的关键牌 */
  key_card: Card | null;
  /** 说法直接点名的那张牌，物种统计时排除它的首翻 */
  named_card: Card | null;
  horizon: "past" | "future";
  bet_family: "relative_strength" | "steady_trend" | "volume_surge";
  method_card: { id: string; name: string; line: string };
  explain: Record<Card, { content_id: string; text: string; kind: ExplainKind }>;
}

export type ObsId = "O1" | "O2" | "O3" | "O4";
export type Outcome = "consistent" | "conflict" | "unchecked" | "recorded" | "uncertain";

export interface ObsInstance {
  context: string;
  rule: string;
  outcome: Outcome;
  assisted: boolean;
  event_ids: string[];
}

export interface Observation {
  id: ObsId;
  status: ObsStatus;
  aggregation: "partial" | "repeated" | "mixed" | "single" | "assisted" | "none" | "uncertain";
  /** 只见一次 / 两次一致 / 有冲突 / 有一次不一致 / 未观察到 / 只选了证据不足 */
  summary: string;
  instances: ObsInstance[];
  understanding_unclear: boolean;
}


export interface ProfileView {
  rules_version: string;
  observations: Record<ObsId, Observation>;
  /** 任务中的新情境单独记录：O1/O2 来自任务 A，O5（在给定规则下比较两段样本）来自任务 B。 */
  task_observations: Record<"O1" | "O2" | "O5", ObsInstance[]>;
  style: { species: Species; first_flips: { round_id: string; card: Card; counted: boolean }[]; counts: Record<Card, number> };
  help_preference: { level: AssistLevel; source: "user" | "understanding" | "explain_count"; explain_count: number };
  flags: { o3d: boolean };
}

export interface ProgressView {
  K: number;
  S1: boolean;
  S2: boolean;
  rounds_completed: number;
  taskA_steps_done: number[];
  taskB_done: boolean;
  ready_for_B: boolean;
}


export interface PlanView {
  route: "R-A2" | "R-A1" | "R-B" | "R-B-progress";
  task: "A" | "B";
  steps: number[];
  topic: TopicId | null;
  topic_source: TopicSource | null;
  assist: AssistLevel;
  guess_first: boolean;
  reason: string;
}
