// 引擎的输入输出类型。YOU-145 契约冻结前为暂定格式，字段名冻结后统一对齐。

export type Card = "fox" | "elephant" | "leopard";
export type Verdict = "supports" | "refutes" | "insufficient";
export type Reaction = "supports" | "refutes" | "unsure";
export type Action = "follow" | "pass" | "wait";
export type Stage = "pre_reveal" | "post_reveal" | "in_task";
export type AssistLevel = "guide" | "hint" | "self";
export type ExplainKind = "neutral" | "directional";
export type FollowupId = "missing" | "basis" | "waiting";
export type TopicId = "cheetah" | "elephant" | "fox";

interface EventBase {
  event_id: string;
  session_id: string;
  content_version: string;
  stage: Stage;
  round_id: string;
}

export type GameEvent = EventBase &
  (
    | { type: "initial_reaction"; payload: { reaction: Reaction } }
    | { type: "card_flip"; payload: { card: Card } }
    | { type: "explain_open"; payload: { card: Card; content_id: string; kind: ExplainKind } }
    | { type: "final_assessment"; payload: { verdict: Verdict } }
    | { type: "decision"; payload: { action: Action } }
    | { type: "followup_answer"; payload: { question: FollowupId; answer: string | null } }
    | { type: "self_note"; payload: { text: string } }
    | { type: "assist_switch"; payload: { task: "A" | "B"; level: AssistLevel } }
    | { type: "assist_exposure"; payload: { task: "A" | "B"; step: number; content_id: string; kind: "hint" | "demo" | "feedback" } }
    | { type: "task_step"; payload: { task: "A" | "B"; step: number; phase: "guess" | "submit"; answer: string; correct: boolean | null; aligned?: boolean; window_extended?: boolean } }
    | { type: "topic_select"; payload: { topic: TopicId; source: TopicSource } }
    | { type: "notice_ack"; payload: { notice_version: string } }
  );

export type EventType = GameEvent["type"];

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
export type ObsStatus = "observed" | "assisted" | "uncertain" | "not_observed";
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

export type Species = Card | "mixed" | "unknown";

export interface Profile {
  rules_version: string;
  observations: Record<ObsId, Observation>;
  task_observations: Record<"O1" | "O2", ObsInstance[]>;
  style: { species: Species; first_flips: { round_id: string; card: Card; counted: boolean }[]; counts: Record<Card, number> };
  help_preference: { level: AssistLevel; source: "user" | "understanding" | "explain_count"; explain_count: number };
  flags: { o3d: boolean };
}

export interface Progress {
  K: number;
  S1: boolean;
  S2: boolean;
  rounds_completed: number;
  taskA_steps_done: number[];
  taskB_done: boolean;
  ready_for_B: boolean;
}

export type TopicSource = "user" | "o3d" | "bet" | "style_default" | "chooser" | "only_available";

export interface Plan {
  route: "R-A2" | "R-A1" | "R-B" | "R-B-progress";
  task: "A" | "B";
  steps: number[];
  topic: TopicId | null;
  topic_source: TopicSource | null;
  assist: AssistLevel;
  guess_first: boolean;
  reason: string;
}
