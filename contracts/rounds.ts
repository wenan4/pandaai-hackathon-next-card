// 关卡配置（PRD v0.3 §3）。命题、关键牌、预期判断、追问、解释文案都是版本化配置，
// 画像规则只读这里，组件里不写死文字。
import { z } from "zod";
import {
  BetFamilySchema,
  CardSchema,
  ExplainKindSchema,
  FollowupAnswerSchema,
  FollowupQuestionSchema,
  RoundIdSchema,
  VerdictSchema,
} from "./common";

/** 说法指向过去（可由已有数据核对）还是未来（尚未发生）。O3 的跨轮规则要用到。 */
export const HorizonSchema = z.enum(["past", "future"]);

/** 追问触发条件（PRD v0.3 §2），按 order 自上而下取第一条命中，最多问一次。 */
export const FollowupTriggerSchema = z.enum([
  "final_insufficient", // 最终判断 = 证据不足
  "key_card_flipped_and_verdict_differs", // 翻过关键牌，且最终判断与关卡证据结论不一致
  "action_wait", // 下一步 = 再等等
]);

export const FollowupConfigSchema = z.strictObject({
  order: z.number().int().min(1),
  question: FollowupQuestionSchema,
  trigger: FollowupTriggerSchema,
  /** 可选语义；界面文案由配置决定，事件只记语义。skipped 始终可选，不必列出。 */
  options: z.array(FollowupAnswerSchema).min(1),
  /** 选中这些语义时，视为“明确表示相关图表没看懂”，对应 Ox-c / O3-c。 */
  understanding_answers: z.array(FollowupAnswerSchema).default([]),
});

export const ExplainConfigSchema = z.strictObject({
  content_id: z.string().min(1),
  /** 解释文案版本；文案改了，版本号必须变。 */
  version: z.string().min(1),
  /** 若某段说明实际给出了关键结论，必须标 directional（PRD v0.3 §2）。 */
  kind: ExplainKindSchema,
});

export const MethodCardSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  /** 第二幕不再发新卡，只复用；null 表示本轮不发。 */
  granted: z.boolean(),
});

export const RoundConfigSchema = z.strictObject({
  round_id: RoundIdSchema,
  /** 所属幕：1 初步发现，2 换个情境再来一次。 */
  act: z.union([z.literal(1), z.literal(2)]),
  /** 匿名标的标签 A–F。 */
  label: z.string().regex(/^[A-F]$/),
  claim: z.string().min(1),
  /** 命题方向：与同能力项的另一幕情境相反，用来避免“记住第一幕选了什么”。 */
  claim_direction: z.enum(["holds", "fails", "unverifiable"]),
  horizon: HorizonSchema,
  /** 当时材料支持的判断，由数据脚本按冻结口径产出。 */
  evidence_verdict: VerdictSchema,
  /** 检验该说法所需的关键牌。 */
  key_card: CardSchema,
  /**
   * 说法直接点名的那张牌；物种统计要排除它的首翻。
   * R3 没有点名牌，为 null，其首翻照常计入。
   */
  named_card: CardSchema.nullable(),
  /** 这一轮选“跟”所押的形态；只用于 habits.backed_families，不进入能力规则。 */
  bet_family: BetFamilySchema,
  /** 各牌内容引用：指向 cases_visible 里的 round_id 与卡片键，不内嵌数据。 */
  cards: z.strictObject({
    fox: z.strictObject({ ref: z.string().min(1), title: z.string().min(1) }),
    elephant: z.strictObject({ ref: z.string().min(1), title: z.string().min(1) }),
    leopard: z.strictObject({ ref: z.string().min(1), title: z.string().min(1) }),
  }),
  explain: z.strictObject({
    fox: ExplainConfigSchema,
    elephant: ExplainConfigSchema,
    leopard: ExplainConfigSchema,
  }),
  followups: z.array(FollowupConfigSchema).min(1),
  method_card: MethodCardSchema,
});

/**
 * 整份关卡配置。除逐轮校验外，检查 PRD v0.3 §3 的结构性约束：
 * round_id 唯一、named_card 与 key_card 的关系、O3 的轮次是未来型或证据边界型。
 */
export const RoundsConfigSchema = z
  .strictObject({
    rules_version: z.string().min(1),
    content_version: z.string().min(1),
    rounds: z.array(RoundConfigSchema).min(1),
    /** 每种押注形态在所有轮次里出现几次；不足两次时“常押”文案要据此限定。 */
    bet_family_coverage: z.record(BetFamilySchema, z.number().int().min(0)),
  })
  .superRefine((cfg, ctx) => {
    const ids = new Set<string>();
    cfg.rounds.forEach((r, i) => {
      if (ids.has(r.round_id)) ctx.addIssue({ code: "custom", path: ["rounds", i, "round_id"], message: `round_id 重复：${r.round_id}` });
      ids.add(r.round_id);
      const expectedAct = Number(r.round_id.slice(1)) <= 3 ? 1 : 2;
      if (r.act !== expectedAct) {
        ctx.addIssue({ code: "custom", path: ["rounds", i, "act"], message: `${r.round_id} 应属于第 ${expectedAct} 幕` });
      }
      if (r.explain[r.key_card].kind === "directional") {
        ctx.addIssue({
          code: "custom",
          path: ["rounds", i, "explain", r.key_card, "kind"],
          message: "关键牌的普通解释不得是方向性提示；若确实给了结论，该轮须另行标注并按“在提示下完成”处理",
        });
      }
    });
    for (const [family, declared] of Object.entries(cfg.bet_family_coverage)) {
      const actual = cfg.rounds.filter((r) => r.bet_family === family).length;
      if (declared !== actual) {
        ctx.addIssue({ code: "custom", path: ["bet_family_coverage", family], message: `覆盖表与轮次不一致：${family} 声明 ${declared} 次，实际 ${actual} 次` });
      }
    }
  });

export type RoundConfig = z.infer<typeof RoundConfigSchema>;
export type RoundsConfig = z.infer<typeof RoundsConfigSchema>;
export type FollowupConfig = z.infer<typeof FollowupConfigSchema>;
