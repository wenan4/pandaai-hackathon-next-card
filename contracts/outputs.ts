// 引擎输出（PRD v0.3 §4、§5、§6、§8）。四个函数输入各自独立，输出也分开定义，最后合成一份扁平的结构化结果，
// 供人物卡、评委面板和 PandaAI 接入使用。
//
//   evaluate(events, config) → { profile, progress }          只读能力层事件
//   habits(events, config)   → { action_profile, backed_families, decision_chains, trading_view }
//   recommend(profile, progress, habits, availableTopics) → recommendation
//   settle(decisions, outcomes) → settlement                  独立，不被其他函数引用
import { z } from "zod";
import {
  ActionSchema,
  AggregateSchema,
  AssistLevelSchema,
  BetFamilySchema,
  CardSchema,
  EventIdSchema,
  ObsStatusSchema,
  RoundIdSchema,
  RouteIdSchema,
  RuleIdSchema,
  SafeTextSchema,
  ScenarioIdSchema,
  SpeciesSchema,
  TopicSchema,
  TopicSourceSchema,
  UncertainReasonSchema,
  VerdictSchema,
  FollowupAnswerSchema,
  FollowupQuestionSchema,
  ExplainKindSchema,
} from "./common";

const EventIds = z.array(EventIdSchema);
/** 计数 + 涉及的轮次，便于依据页展开。 */
const Counted = z.strictObject({ count: z.number().int().min(0), rounds: z.array(RoundIdSchema) });

// ───────────────────────── evaluate ─────────────────────────

/** 本局帮助暴露里最强的一种；none 表示独立完成。 */
export const AssistanceSchema = z.enum(["none", "directional_explain", "hint", "demo", "answer_feedback"]);

/** 能力项在一个情境里的状态（情境层）。 */
export const ObservationInstanceSchema = z
  .strictObject({
    /** R1–R6，或任务 A 的新情境（taskA，只用于 S1 / S2，不改写 R1–R6 的聚合结论）。 */
    scenario: ScenarioIdSchema,
    state: ObsStatusSchema,
    rule: RuleIdSchema,
    /** state = uncertain 时必填：不要把所有非 ✅ 都写成“没有看过证据”。 */
    uncertain_reason: UncertainReasonSchema.optional(),
    evidence_event_ids: EventIds,
    assistance: AssistanceSchema,
    /** 仅 O3：跨轮规则是否满足（PRD v0.3 §4.3）。 */
    cross_round_rule: z.enum(["met", "not_met"]).optional(),
  })
  .superRefine((o, ctx) => {
    if (o.state === "uncertain" && !o.uncertain_reason) {
      ctx.addIssue({ code: "custom", path: ["uncertain_reason"], message: "state = uncertain 时必须给出原因" });
    }
    if (o.state !== "uncertain" && o.uncertain_reason) {
      ctx.addIssue({ code: "custom", path: ["uncertain_reason"], message: "只有 uncertain 才有原因" });
    }
    if (o.state === "observed" && o.assistance !== "none") {
      ctx.addIssue({ code: "custom", path: ["assistance"], message: "接触过方向性提示 / 示范 / 答案反馈后只能记 assisted，不能记 observed" });
    }
    if (o.state === "assisted" && o.assistance === "none") {
      ctx.addIssue({ code: "custom", path: ["assistance"], message: "assisted 必须有对应的帮助暴露" });
    }
  });

/** O1–O3：按“能力项 + 情境 ID”各记一条，再跨情境聚合；聚合不平均、不加权，两条原始记录都保留。 */
export const CrossScenarioObservationSchema = z.strictObject({
  id: z.enum(["O1", "O2", "O3"]),
  aggregate: AggregateSchema,
  /** 对用户显示的状态；由聚合结论决定，不覆盖 scenarios。 */
  state: ObsStatusSchema,
  scenarios: z.array(ObservationInstanceSchema).min(1).max(2),
  /** 任务 A 里的新情境证据，只用于 S1 / S2。 */
  task_scenarios: z.array(ObservationInstanceSchema).default([]),
});

/** O4 根据新证据修正判断（六轮合计）。 */
export const O4ObservationSchema = z
  .strictObject({
    id: z.literal("O4"),
    state: ObsStatusSchema,
    rule: z.enum(["O4-a", "O4-b", "O4-c", "O4-d"]),
    /** 可比较的冲突轮 N。 */
    opportunities: z.number().int().min(0),
    /** 发生调整的轮次 M = independent + assisted。 */
    revisions: z.number().int().min(0),
    independent_revisions: z.number().int().min(0),
    assisted_revisions: z.number().int().min(0),
    evidence_event_ids: EventIds,
  })
  .superRefine((o, ctx) => {
    if (o.revisions > o.opportunities) ctx.addIssue({ code: "custom", path: ["revisions"], message: "调整次数不能超过可比较的机会数" });
    if (o.independent_revisions + o.assisted_revisions !== o.revisions) {
      ctx.addIssue({ code: "custom", path: ["revisions"], message: "revisions 必须等于独立调整与有帮助调整之和" });
    }
    const expected =
      o.opportunities === 0 ? "O4-d" : o.revisions === 0 ? "O4-c" : o.revisions === o.opportunities ? "O4-a" : "O4-b";
    if (o.rule !== expected) ctx.addIssue({ code: "custom", path: ["rule"], message: `N=${o.opportunities}、M=${o.revisions} 应命中 ${expected}` });
    if (o.rule === "O4-b" && o.opportunities < 2) ctx.addIssue({ code: "custom", path: ["rule"], message: "O4-b 要求 N ≥ 2" });
    const expectedState = o.rule === "O4-d" ? "uncertain" : o.rule === "O4-c" ? "not_observed" : o.independent_revisions > 0 ? "observed" : "assisted";
    if (o.state !== expectedState) ctx.addIssue({ code: "custom", path: ["state"], message: `规则 ${o.rule} 应得 ${expectedState}` });
  });

/** O5 在给定规则下比较两段样本（任务 B 完成后新增；不写“会独立设计回测”）。 */
export const O5ObservationSchema = z.strictObject({
  id: z.literal("O5"),
  state: ObsStatusSchema,
  rule: RuleIdSchema,
  evidence_event_ids: EventIds,
  assistance: AssistanceSchema,
});

export const ObservationSchema = z.discriminatedUnion("id", [CrossScenarioObservationSchema, O4ObservationSchema, O5ObservationSchema]);

/** 物种：只统计“说法没有直接点名”的牌的首翻。 */
export const StyleSchema = z.strictObject({
  species: SpeciesSchema,
  /** 计入物种的首翻。 */
  counted_first_flips: z.array(z.strictObject({ round_id: RoundIdSchema, card: CardSchema })),
  /** 首翻等于该轮点名的牌，不计入物种，只作证据层事件保留。 */
  excluded_named_flips: z.array(z.strictObject({ round_id: RoundIdSchema, card: CardSchema })),
  counts: z.strictObject({ fox: z.number().int().min(0), elephant: z.number().int().min(0), leopard: z.number().int().min(0) }),
  /** 卡面限定语，必须写“本局倾向”之类，不得写成稳定人格。 */
  scope: SafeTextSchema,
});

/** 帮助偏好。按 PRD v0.3 §4.4 的五条顺序规则确定；只有用户主动选择才是明确表达。 */
export const HelpPreferenceSchema = z.strictObject({
  suggested_assist: AssistLevelSchema,
  user_selected: AssistLevelSchema.nullable(),
  /** 零次解释不证明不需要帮助，所以没有主动选择时通常是 uncertain。 */
  state: ObsStatusSchema,
  rule: z.enum(["user_selected", "understanding", "explain_3plus", "explain_1_2", "solo_ok", "default"]),
  explain_count: z.number().int().min(0),
  basis_id: z.string().min(1),
});

export const ProfileSchema = z.strictObject({
  rules_version: z.string().min(1),
  observations: z.array(ObservationSchema).min(1),
  style: StyleSchema,
  help_preference: HelpPreferenceSchema,
  /** 本局还不知道的事，模板 ID 或固定文案。 */
  unknowns: z.array(SafeTextSchema),
});

export const ProgressSchema = z
  .strictObject({
    /** O1、O2 中 ✅ 的个数。K 只决定基础步骤如何安排，不是解锁 B 的唯一条件。 */
    K: z.number().int().min(0).max(2),
    S1: z.boolean(),
    S2: z.boolean(),
    rounds_completed: z.number().int().min(0).max(6),
    taskA_completed_steps: z.array(z.number().int().min(1)),
    taskB_done: z.boolean(),
    /** S1 且 S2；“完成”包含独立或有帮助地完成，不是仅点了“下一步”。 */
    ready_for_B: z.boolean(),
  })
  .superRefine((p, ctx) => {
    if (p.ready_for_B !== (p.S1 && p.S2)) ctx.addIssue({ code: "custom", path: ["ready_for_B"], message: "ready_for_B 必须等于 S1 && S2" });
  });

export const EvaluateOutputSchema = z.strictObject({ profile: ProfileSchema, progress: ProgressSchema });

// ───────────────────────── habits ─────────────────────────

const ByAction = z.strictObject({ follow: Counted, skip: Counted, wait: Counted });

/** 行动习惯：只计数，不评高低，不进入能力、物种或路线规则；不推断风险偏好。 */
export const ActionProfileSchema = z
  .strictObject({
    /** 下一步与最终判断同向：supports→follow，refutes→skip，insufficient→wait。 */
    aligned: z.strictObject({ count: z.number().int().min(0), of: z.number().int().min(0), rounds: z.array(RoundIdSchema) }),
    diverged: z.strictObject({ count: z.number().int().min(0), rounds: z.array(RoundIdSchema) }),
    by_verdict: z.strictObject({ supports: ByAction, refutes: ByAction, insufficient: ByAction }),
    follow_total: Counted,
    scope: SafeTextSchema,
  })
  .superRefine((a, ctx) => {
    if (a.aligned.count > a.aligned.of) ctx.addIssue({ code: "custom", path: ["aligned", "count"], message: "同向次数不能超过轮数" });
    if (a.aligned.count + a.diverged.count !== a.aligned.of) {
      ctx.addIssue({ code: "custom", path: ["diverged", "count"], message: "同向与不同向之和必须等于已完成轮数" });
    }
  });

/** 玩家选“跟”的轮次所押的形态。只允许 recommend 用于任务 B 的默认主题（§5.2 第 3 条）。 */
export const BackedFamiliesSchema = z.strictObject({
  by_family: z.strictObject({
    relative_strength: Counted,
    steady_trend: Counted,
    volume_surge: Counted,
  }),
  /** 被跟 ≥ 2 次的形态，才可称为“本局反复押的形态”。 */
  frequent: z.array(BetFamilySchema),
  /** 配置里该形态是否在两幕各出现过；覆盖不足时文案要据此限定。 */
  coverage_limited: z.array(BetFamilySchema),
});

/** 决策链：看了什么 → 怎么判断 → 做了什么。原样来自事件，不加推断。不含任何结算数字。 */
export const DecisionChainSchema = z.strictObject({
  round_id: RoundIdSchema,
  looked_at: z.array(CardSchema).max(2),
  explains: z.array(z.strictObject({ card: CardSchema, kind: ExplainKindSchema })),
  initial_reaction: VerdictSchema.nullable(),
  verdict: VerdictSchema,
  action: ActionSchema,
  followup: z.strictObject({ question: FollowupQuestionSchema, answer: FollowupAnswerSchema }).nullable(),
  aligned: z.boolean(),
  pattern_family: BetFamilySchema,
});

/** 换成交易语言来看：每条必须指回一个观察或习惯字段并带限定条件，不得凭空生成。 */
export const TradingViewItemSchema = z.strictObject({
  refers_to: z.enum(["O1", "O2", "O3", "O4", "O5", "action_profile", "backed_families"]),
  template_id: z.string().min(1),
  /** 限定条件涉及的轮次：只写“这一轮 / 本局”。 */
  scope_rounds: z.array(RoundIdSchema).min(1),
  /** 渲染后的文案；引擎只需输出 template_id，导出结构化结果时再填。 */
  reads_as: SafeTextSchema.optional(),
});

export const HabitsSchema = z.strictObject({
  action_profile: ActionProfileSchema,
  backed_families: BackedFamiliesSchema,
  decision_chains: z.array(DecisionChainSchema),
  trading_view: z.array(TradingViewItemSchema),
});

// ───────────────────────── recommend ─────────────────────────

export const ResourceSchema = z.strictObject({
  name: z.string().min(1),
  use: SafeTextSchema,
  /** 真实资源 / 示例资源 / 拟参考（未核验、未接入）/ 未实现；不得把拟参考标成真实。 */
  status: z.enum(["real", "sample", "planned_reference", "not_implemented"]),
  url: z.url().optional(),
});

export const RecommendationSchema = z
  .strictObject({
    task: z.enum(["A", "B"]),
    /** 规则编号：R-A2、R-A1、R-B、R-B-progress。基础步骤只由能力层与任务进度决定。 */
    rule: RouteIdSchema,
    /** 任务 A 需要做的步骤；任务 B 为空。 */
    steps: z.array(z.number().int().min(1)),
    /** 任务 B 的默认主题；进入选题入口且无来源时为 null。 */
    topic: TopicSchema.nullable(),
    topic_source: TopicSourceSchema.nullable(),
    /** 命中的全部来源；bet 与 style 指向不同主题时两个都列出。 */
    topic_sources: z.array(TopicSourceSchema),
    topic_conflict: z.boolean(),
    assist: AssistLevelSchema,
    /** 先猜后验：O4 不是 ✅ 时加入。 */
    guess_first: z.boolean(),
    reason_id: z.string().min(1),
    reason_text: SafeTextSchema.optional(),
    resources: z.array(ResourceSchema),
  })
  .superRefine((r, ctx) => {
    if (r.task === "A" && r.steps.length === 0) ctx.addIssue({ code: "custom", path: ["steps"], message: "任务 A 至少一个步骤" });
    if (r.task === "B" && r.steps.length > 0) ctx.addIssue({ code: "custom", path: ["steps"], message: "任务 B 不带任务 A 的步骤" });
    if (r.rule.startsWith("R-A") !== (r.task === "A")) ctx.addIssue({ code: "custom", path: ["rule"], message: "规则编号与任务不一致" });
    if (r.topic_conflict && r.topic_sources.length < 2) ctx.addIssue({ code: "custom", path: ["topic_sources"], message: "有分歧时必须同时给出两个来源" });
    if (r.topic_source && !r.topic_sources.includes(r.topic_source)) ctx.addIssue({ code: "custom", path: ["topic_source"], message: "topic_source 必须出现在 topic_sources 里" });
    if (r.topic === null && r.topic_source !== null) ctx.addIssue({ code: "custom", path: ["topic_source"], message: "没有默认主题时不应有来源" });
  });

// ───────────────────────── settle ─────────────────────────

/** 松果结算。独立于画像：evaluate / habits / recommend 不得导入、不得读取。 */
export const SettlementSchema = z.strictObject({
  start: z.number(),
  balance: z.number(),
  rounds: z.array(
    z.strictObject({
      round_id: RoundIdSchema,
      action: ActionSchema,
      /** 选“跟”时的实际变化；其他为 0。浮点统一保留两位。 */
      chips_delta: z.number(),
      /** “假如跟了”：只显示松果数，不显示收益率。 */
      hypothetical_delta: z.number(),
      /** 缺开盘价、停牌、涨跌停等按声明的降级口径处理时给出说明。 */
      settlement_note: z.string().optional(),
    }),
  ),
  /** 模拟替换后续走势（评委面板的模拟反例）时为 true。 */
  counterfactual: z.boolean(),
}).superRefine((s, ctx) => {
  // 本金在本轮结算后返还，所以余额 = 起始 + 各轮变化之和。
  const sum = s.rounds.reduce((acc, r) => acc + r.chips_delta, 0);
  if (Math.abs(s.start + sum - s.balance) > 0.011) {
    ctx.addIssue({ code: "custom", path: ["balance"], message: `余额应为起始 + 各轮变化之和 = ${(s.start + sum).toFixed(2)}` });
  }
  s.rounds.forEach((r, i) => {
    if (r.action !== "follow" && r.chips_delta !== 0) {
      ctx.addIssue({ code: "custom", path: ["rounds", i, "chips_delta"], message: "只有选“跟”的轮次才有实际松果变化" });
    }
    if (r.action === "follow" && r.hypothetical_delta !== r.chips_delta) {
      ctx.addIssue({ code: "custom", path: ["rounds", i, "hypothetical_delta"], message: "选“跟”的轮次，“假如跟了”就是实际变化" });
    }
  });
});

// ───────────────────────── 合成的结构化结果 ─────────────────────────

/** 来源标注：真实试玩与模拟路径必须区分（赛题提交要求 5、PRD v0.3 §12）。 */
export const ProvenanceSchema = z.strictObject({
  kind: z.enum(["real_session", "simulated_path", "judge_fork"]),
  /** 预设路径编号：甲 / 乙 / 乙′ / 乙″ / 丙 等。 */
  path_id: z.string().optional(),
  session_id: z.string().min(1),
  event_count: z.number().int().min(0),
  /** judge_fork 必须说明是在哪个基线上的反事实，不冒充玩家新增表现。 */
  fork_of: z.string().optional(),
});

/** 给 PandaAI 的结构化结果：画像维度、行为依据、尚不确定的部分、推荐资源及理由、下一步任务。 */
export const StructuredResultSchema = z.strictObject({
  rules_version: z.string().min(1),
  provenance: ProvenanceSchema,
  style: StyleSchema,
  observations: z.array(ObservationSchema).min(1),
  help_preference: HelpPreferenceSchema,
  progress: ProgressSchema,
  unknowns: z.array(SafeTextSchema),
  action_profile: ActionProfileSchema,
  backed_families: BackedFamiliesSchema,
  decision_chains: z.array(DecisionChainSchema),
  trading_view: z.array(TradingViewItemSchema),
  recommendation: RecommendationSchema,
  /** 松果结算属于游戏记录，不参与上面任何字段的计算。 */
  settlement: SettlementSchema.optional(),
});

export type Assistance = z.infer<typeof AssistanceSchema>;
export type ObservationInstance = z.infer<typeof ObservationInstanceSchema>;
export type CrossScenarioObservation = z.infer<typeof CrossScenarioObservationSchema>;
export type O4Observation = z.infer<typeof O4ObservationSchema>;
export type O5Observation = z.infer<typeof O5ObservationSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type Style = z.infer<typeof StyleSchema>;
export type HelpPreference = z.infer<typeof HelpPreferenceSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Progress = z.infer<typeof ProgressSchema>;
export type EvaluateOutput = z.infer<typeof EvaluateOutputSchema>;
export type ActionProfile = z.infer<typeof ActionProfileSchema>;
export type BackedFamilies = z.infer<typeof BackedFamiliesSchema>;
export type DecisionChain = z.infer<typeof DecisionChainSchema>;
export type TradingViewItem = z.infer<typeof TradingViewItemSchema>;
export type Habits = z.infer<typeof HabitsSchema>;
export type Resource = z.infer<typeof ResourceSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type Settlement = z.infer<typeof SettlementSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type StructuredResult = z.infer<typeof StructuredResultSchema>;
