// 契约的公共枚举与常量。字段含义与规则出处见 contracts/README.md。
// 以 PRD v0.3 为准；与 PRD 不一致的地方在 README 的“与 PRD / 已有实现的差异”里列出。
import { z } from "zod";

/** 规则版本：规则表、命题、文案改版时一起升。旧版规则编号含义不可混用（PRD v0.3 §8）。 */
export const RULES_VERSION = "v0.3";
/** 数据文件头的 schema 标识，脚本生成文件时必须写这个值。 */
export const DATA_SCHEMA_ID = "next-card/data@v0.3";
/** 某类押注形态被“跟”至少这么多次，才称为“常押”（PRD v0.3 §4.4）。 */
export const FREQUENT_BET_THRESHOLD = 2;

export const CARDS = ["fox", "elephant", "leopard"] as const;
export const VERDICTS = ["supports", "refutes", "insufficient"] as const;
/** 内部枚举；界面文案“跟 / 不跟 / 再等等”是配置项，不进契约。 */
export const ACTIONS = ["follow", "skip", "wait"] as const;
/** 带我做 / 给我提示 / 我自己来。PRD 只固定了 solo；guide、hint 沿用 PR5 的写法。 */
export const ASSIST_LEVELS = ["guide", "hint", "solo"] as const;
export const EXPLAIN_KINDS = ["neutral", "directional"] as const;
export const BET_FAMILIES = ["relative_strength", "steady_trend", "volume_surge"] as const;
export const TOPICS = ["cheetah", "elephant", "fox"] as const;
export const TOPIC_SOURCES = ["user", "focus", "bet", "style", "only_available"] as const;
export const SPECIES = [...CARDS, "mixed", "unknown"] as const;

export const STAGES = ["pre_reveal", "post_reveal", "in_task"] as const;
export const ROUND_IDS = ["R1", "R2", "R3", "R4", "R5", "R6"] as const;
/** 情境 ID：六个局内情境、两个任务、以及不属于任何情境的会话级事件。 */
export const SCENARIO_IDS = [...ROUND_IDS, "taskA", "taskB", "session"] as const;

export const OBS_IDS = ["O1", "O2", "O3", "O4", "O5"] as const;
export const OBS_STATUSES = ["observed", "assisted", "uncertain", "not_observed"] as const;
export const AGGREGATES = ["partial", "repeated", "mixed", "single", "assisted", "none", "uncertain"] as const;
/** ❔ 的原因（PRD v0.3 §4.2）；state = uncertain 时必填。 */
export const UNCERTAIN_REASONS = [
  "understanding",
  "mismatch",
  "no_conclusion",
  "knows_to_check",
  "evidence_not_shown",
  "no_comparable_round",
] as const;

export const FOLLOWUP_QUESTIONS = ["missing", "basis", "waiting"] as const;
/** 追问选项的统一语义（PRD v0.3 §2）；显示文案由配置决定，事件只记语义。 */
export const FOLLOWUP_ANSWERS = [
  "comparison",
  "longer_history",
  "signal_validation",
  "future_trend",
  "more_opinions",
  "chart_unclear",
  "own_view",
  "main_chart",
  "opened_cards",
  "claim_itself",
  "intuition",
  "other",
  "skipped",
] as const;
export const SELF_NOTES = ["did_not_understand", "was_waiting_for_evidence", "just_trying", "nothing"] as const;

export const CardSchema = z.enum(CARDS);
export const VerdictSchema = z.enum(VERDICTS);
export const ActionSchema = z.enum(ACTIONS);
export const AssistLevelSchema = z.enum(ASSIST_LEVELS);
export const ExplainKindSchema = z.enum(EXPLAIN_KINDS);
export const BetFamilySchema = z.enum(BET_FAMILIES);
export const TopicSchema = z.enum(TOPICS);
export const TopicSourceSchema = z.enum(TOPIC_SOURCES);
export const SpeciesSchema = z.enum(SPECIES);
export const StageSchema = z.enum(STAGES);
export const RoundIdSchema = z.enum(ROUND_IDS);
export const ScenarioIdSchema = z.enum(SCENARIO_IDS);
export const ObsIdSchema = z.enum(OBS_IDS);
export const ObsStatusSchema = z.enum(OBS_STATUSES);
export const AggregateSchema = z.enum(AGGREGATES);
export const UncertainReasonSchema = z.enum(UNCERTAIN_REASONS);
export const FollowupQuestionSchema = z.enum(FOLLOWUP_QUESTIONS);
export const FollowupAnswerSchema = z.enum(FOLLOWUP_ANSWERS);
export const SelfNoteSchema = z.enum(SELF_NOTES);

export type Card = z.infer<typeof CardSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type AssistLevel = z.infer<typeof AssistLevelSchema>;
export type ExplainKind = z.infer<typeof ExplainKindSchema>;
export type BetFamily = z.infer<typeof BetFamilySchema>;
export type Topic = z.infer<typeof TopicSchema>;
export type TopicSource = z.infer<typeof TopicSourceSchema>;
export type Species = z.infer<typeof SpeciesSchema>;
export type Stage = z.infer<typeof StageSchema>;
export type RoundId = z.infer<typeof RoundIdSchema>;
export type ScenarioId = z.infer<typeof ScenarioIdSchema>;
export type ObsId = z.infer<typeof ObsIdSchema>;
export type ObsStatus = z.infer<typeof ObsStatusSchema>;
export type Aggregate = z.infer<typeof AggregateSchema>;
export type UncertainReason = z.infer<typeof UncertainReasonSchema>;
export type FollowupQuestion = z.infer<typeof FollowupQuestionSchema>;
export type FollowupAnswer = z.infer<typeof FollowupAnswerSchema>;
export type SelfNote = z.infer<typeof SelfNoteSchema>;

/** 牌与任务 B 主题的对应：数据文件里的牌叫 leopard，任务 B 文件名里的主题叫 cheetah。 */
export const TOPIC_OF_CARD: Record<Card, Topic> = { fox: "fox", elephant: "elephant", leopard: "cheetah" };
/** “跟”所押形态与任务 B 主题的对应（PRD v0.3 §5.2 第 3 条）。 */
export const TOPIC_OF_BET_FAMILY: Record<BetFamily, Topic> = {
  relative_strength: "fox",
  steady_trend: "elephant",
  volume_surge: "cheetah",
};

/**
 * 面向用户的文案里不得出现的词（PRD v0.3 §2、§4.5、§4.4；YOU-149、YOU-165 验收）。
 * 契约层只能拦住被序列化进输出的文案；模板本身由引擎测试再查一遍。
 */
export const FORBIDDEN_COPY = ["正确", "错误", "高手", "新手", "冒险", "保守", "风险承受", "你出手了"] as const;
export const SafeTextSchema = z.string().min(1).refine((s) => !FORBIDDEN_COPY.some((w) => s.includes(w)), {
  message: `文案不得包含：${FORBIDDEN_COPY.join("、")}`,
});

/** 规则编号：O1-a … O3-g、O4-a … O4-d、O5-*。 */
export const RuleIdSchema = z.string().regex(/^O[1-5]-[a-z]$/);
/** 推荐路由编号（PRD v0.3 §5.2、§5.3）。 */
export const RouteIdSchema = z.enum(["R-A1", "R-A2", "R-B", "R-B-progress"]);
/** 数据文件中的日期：YYYYMMDD。 */
export const DateStringSchema = z.string().regex(/^\d{8}$/);
export const EventIdSchema = z.string().min(1);
