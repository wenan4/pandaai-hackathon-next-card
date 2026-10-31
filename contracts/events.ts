// 事件（PRD v0.3 §4.1）。事件是画像与评委面板改选的唯一来源。
// 能力计算只读取该问题首次揭晓之前的证据；decision 只给 habits / settle 读，不进 evaluate。
import { z } from "zod";
import {
  ActionSchema,
  AssistLevelSchema,
  CardSchema,
  EventIdSchema,
  ExplainKindSchema,
  FollowupAnswerSchema,
  FollowupQuestionSchema,
  ScenarioIdSchema,
  SelfNoteSchema,
  StageSchema,
  TopicSchema,
  TopicSourceSchema,
  VerdictSchema,
} from "./common";

const common = {
  event_id: EventIdSchema,
  session_id: z.string().min(1),
  /** 命题、文案、规则表的内容版本，对应 CONTENT_VERSION。 */
  content_version: z.string().min(1),
  stage: StageSchema,
  /** 情境 ID：R1–R6、taskA、taskB，或会话级的 session（如开局告知）。 */
  round_id: ScenarioIdSchema,
};

const TaskSchema = z.enum(["A", "B"]);
/** 说法的第一判断 / 最终判断共用同一套枚举（PRD v0.3 §2）。 */
const ReactionSchema = VerdictSchema;

/** 第一反应：每轮一次，在翻牌之前。 */
export const InitialReactionEvent = z.strictObject({
  ...common,
  type: z.literal("initial_reaction"),
  payload: z.strictObject({ reaction: ReactionSchema }),
});

/** 翻牌：每轮同一张牌只计一次；揭晓后补全的牌不产生事件。 */
export const CardFlipEvent = z.strictObject({
  ...common,
  type: z.literal("card_flip"),
  payload: z.strictObject({ card: CardSchema }),
});

/**
 * 打开“解释这张图”。同一 content_id 重复打开不增加证据；directional 另记帮助暴露，
 * 其后完成的 ✅ 改记 🤝（PRD v0.3 §4.2）。
 */
export const ExplainOpenEvent = z.strictObject({
  ...common,
  type: z.literal("explain_open"),
  payload: z.strictObject({
    card: CardSchema,
    content_id: z.string().min(1),
    kind: ExplainKindSchema,
  }),
});

/** 最终判断：每轮一次，揭晓前锁定；不得从 decision 反推。 */
export const FinalAssessmentEvent = z.strictObject({
  ...common,
  type: z.literal("final_assessment"),
  payload: z.strictObject({ verdict: VerdictSchema }),
});

/** 你的下一步：只用于松果结算、追问展示与行动习惯，不进入能力规则。 */
export const DecisionEvent = z.strictObject({
  ...common,
  type: z.literal("decision"),
  payload: z.strictObject({ action: ActionSchema }),
});

/** 追问：每轮至多一次，跳过也明确记录（answer = skipped）。自述，不升级能力。 */
export const FollowupAnswerEvent = z.strictObject({
  ...common,
  type: z.literal("followup_answer"),
  payload: z.strictObject({
    question: FollowupQuestionSchema,
    answer: FollowupAnswerSchema,
  }),
});

/** 补一句：揭晓后事件，每轮至多一次，固定选项、不收集自由文字，不改变任何观察状态。 */
export const SelfNoteEvent = z.strictObject({
  ...common,
  type: z.literal("self_note"),
  payload: z.strictObject({ note: SelfNoteSchema }),
});

/** 切换协助档位。只有 by = user 才记为用户明确表达的偏好。 */
export const AssistSwitchEvent = z.strictObject({
  ...common,
  type: z.literal("assist_switch"),
  payload: z.strictObject({
    task: TaskSchema,
    step: z.number().int().min(1).optional(),
    from: AssistLevelSchema,
    to: AssistLevelSchema,
    by: z.enum(["user", "system"]),
  }),
});

/** 实际展示过的提示 / 示范 / 答案反馈。切换档位不能清除历史。 */
export const AssistExposureEvent = z.strictObject({
  ...common,
  type: z.literal("assist_exposure"),
  payload: z.strictObject({
    task: TaskSchema,
    step: z.number().int().min(1),
    content_id: z.string().min(1),
    kind: z.enum(["hint", "demo", "answer_feedback"]),
    /** 同一题的第几次作答批次；重做同一题不清除此前的暴露。 */
    attempt: z.number().int().min(1),
  }),
});

/** 任务步骤提交。是否独立由事件序列派生，不相信提交时的档位字段。 */
export const TaskStepEvent = z.strictObject({
  ...common,
  type: z.literal("task_step"),
  payload: z.strictObject({
    task: TaskSchema,
    step: z.number().int().min(1),
    content_id: z.string().min(1),
    attempt: z.number().int().min(1),
    /** guess = 先猜后验的初判；submit = 正式提交。 */
    phase: z.enum(["guess", "submit"]),
    answer: z.string().min(1),
    /** 实际操作记录，如任务 A 步骤 1 是否完成对齐、步骤 2 是否拉长窗口。 */
    actions: z.array(z.string()).default([]),
  }),
});

/** 选题。source 说明题目由谁给出，用户可覆盖默认题目，不改变能力观察。 */
export const TopicSelectEvent = z.strictObject({
  ...common,
  type: z.literal("topic_select"),
  payload: z.strictObject({
    topic: TopicSchema,
    source: TopicSourceSchema,
  }),
});

/** 开局告知已确认。会话级事件，round_id = session。不参与画像。 */
export const NoticeAckEvent = z.strictObject({
  ...common,
  type: z.literal("notice_ack"),
  payload: z.strictObject({ notice_version: z.string().min(1) }),
});

export const GameEventSchema = z.discriminatedUnion("type", [
  InitialReactionEvent,
  CardFlipEvent,
  ExplainOpenEvent,
  FinalAssessmentEvent,
  DecisionEvent,
  FollowupAnswerEvent,
  SelfNoteEvent,
  AssistSwitchEvent,
  AssistExposureEvent,
  TaskStepEvent,
  TopicSelectEvent,
  NoticeAckEvent,
]);

export const EVENT_TYPES = [
  "initial_reaction",
  "card_flip",
  "explain_open",
  "final_assessment",
  "decision",
  "followup_answer",
  "self_note",
  "assist_switch",
  "assist_exposure",
  "task_step",
  "topic_select",
  "notice_ack",
] as const satisfies readonly GameEvent["type"][];

/**
 * 每种事件允许出现的阶段。校验器据此拒绝“揭晓后的 final_assessment”之类的事件，
 * 避免揭晓后的补全被当成主动查证。
 */
export const ALLOWED_STAGES: Record<GameEvent["type"], readonly z.infer<typeof StageSchema>[]> = {
  initial_reaction: ["pre_reveal"],
  card_flip: ["pre_reveal"],
  explain_open: ["pre_reveal", "in_task"],
  final_assessment: ["pre_reveal"],
  decision: ["pre_reveal"],
  followup_answer: ["pre_reveal"],
  self_note: ["post_reveal"],
  assist_switch: ["in_task"],
  assist_exposure: ["in_task"],
  task_step: ["in_task"],
  topic_select: ["in_task"],
  notice_ack: ["pre_reveal"],
};

/** 事件序列：在逐条校验之外，检查 event_id 唯一、阶段合法、会话一致。 */
export const EventLogSchema = z.array(GameEventSchema).superRefine((events, ctx) => {
  const seen = new Set<string>();
  const sessions = new Set<string>();
  events.forEach((e, i) => {
    if (seen.has(e.event_id)) {
      ctx.addIssue({ code: "custom", path: [i, "event_id"], message: `event_id 重复：${e.event_id}` });
    }
    seen.add(e.event_id);
    sessions.add(e.session_id);
    if (!ALLOWED_STAGES[e.type].includes(e.stage)) {
      ctx.addIssue({
        code: "custom",
        path: [i, "stage"],
        message: `${e.type} 不允许出现在 ${e.stage} 阶段，只能是 ${ALLOWED_STAGES[e.type].join(" / ")}`,
      });
    }
  });
  if (sessions.size > 1) {
    ctx.addIssue({ code: "custom", message: `一份事件序列只能属于一个会话，发现 ${sessions.size} 个` });
  }
});

export type GameEvent = z.infer<typeof GameEventSchema>;
export type EventType = GameEvent["type"];
export type EventOf<T extends EventType> = Extract<GameEvent, { type: T }>;
export type EventLog = z.infer<typeof EventLogSchema>;
