// 数据文件（PRD v0.3 §7）：cases_visible / cases_reveal、taskA、taskB_{topic}。
//
// 可见部分与揭晓后部分是两个不同的类型，且可见部分用 strict 校验：
// 里面出现 after、symbol、name、真实日期等任何多余字段都会被拒绝，前端在揭晓前只允许加载可见部分。
// 这只是防止界面误用未来数据的工程边界：静态站点里的任何文件，用户都能在网络面板里读到，
// 所以不能把它说成防作弊。
import { z } from "zod";
import { DATA_SCHEMA_ID, DateStringSchema, RoundIdSchema, TopicSchema, VerdictSchema } from "./common";

/** 现有产物带的是冻结前的临时标记；数据脚本下次生成时必须改写成 DATA_SCHEMA_ID。 */
const SchemaMarker = z.union([z.literal(DATA_SCHEMA_ID), z.string().startsWith("draft")]);
const Price = z.number().positive();
const Series = z.array(Price).min(2);
const Offsets = z.tuple([z.number().int(), z.number().int()]);
const DatePair = z.tuple([DateStringSchema, DateStringSchema]);
const Windows = z.record(z.string(), z.number().int().positive());

// ───────────────────────── 文件头 ─────────────────────────

/** 揭晓前可加载的文件头：刻意只有这几项，不带标的、真实日期、筛选条件。 */
export const VisibleHeaderSchema = z.strictObject({
  schema: SchemaMarker,
  file: z.literal("cases_visible"),
  script_version: z.string().min(1),
  rules_version: z.string().min(1),
  note: z.string().min(1),
});

/**
 * 完整文件头。必填项来自 PRD v0.3 §7 与 YOU-145：接口名、标的 / 基准、股票池、时间范围、复权和分红口径、
 * 采样与排除规则、样本数、脚本和规则版本、生成时间、公开展示范围。脚本自己的补充字段允许存在，但不属于契约。
 */
const FullHeaderShape = {
  schema: SchemaMarker,
  script: z.string().min(1),
  script_version: z.string().min(1),
  rules_version: z.string().min(1),
  /** ISO 8601，UTC。 */
  generated_at: z.iso.datetime(),
  /** 数据截止日 YYYYMMDD。 */
  data_as_of: DateStringSchema,
  source: z.string().min(1),
  /** 实际调用的接口名，不是计划调用的。 */
  apis: z.array(z.string().min(1)).min(1),
  benchmark: z.string().min(1),
  adjustment: z.string().min(1),
  dividends: z.string().min(1),
  normalization: z.string().min(1),
  selection: z.string().min(1),
  /** 派生数据能否公开展示尚未获得明确答复时，按最保守方式处理并在此写明。 */
  public_scope: z.string().min(1),
};

export const CasesRevealHeaderSchema = z.looseObject({
  ...FullHeaderShape,
  /** 整份 cases_reveal，或按轮拆分的 cases_reveal_R1 等（只请求已锁定的那一轮）。 */
  file: z.string().regex(/^cases_reveal(_R[1-6])?$/),
  pool: z.string().min(1),
  volume: z.string().min(1),
  /** 信号 / 执行 / 退出时间：决策日收盘后，T+1 开盘进，T+20 收盘出。 */
  timing: z.strictObject({ decision: z.string().min(1), reveal_entry: z.string().min(1), reveal_exit: z.string().min(1) }),
  windows: Windows,
  /** 筛选条件，按轮次给出具体阈值。 */
  filters: z.record(z.string(), z.unknown()),
  exclusions: z.array(z.string().min(1)).min(1),
  /** 样本数：每轮评估了多少、通过了多少，以及各类排除记录数。 */
  sample: z.record(z.string(), z.unknown()),
});

export const TaskAHeaderSchema = z.looseObject({
  ...FullHeaderShape,
  /**
   * 过渡性例外：现有 scripts/build_taskA.py 尚未写生成时间。脚本补上后改回必填
   * （README 的“已有产物与契约的差异”里登记）。
   */
  generated_at: z.iso.datetime().optional(),
  file: z.literal("taskA"),
  windows: Windows,
  /** 标准答案由哪份脚本、哪个口径算出，不手写。 */
  answers_computed_by: z.string().min(1),
  /** 与第一幕案例绑定：防止任务 A 的标的与局内标的重复或口径漂移。 */
  game_cases: z.looseObject({
    file: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    hash_format: z.string().min(1),
    script_version: z.string().min(1),
    rules_version: z.string().min(1),
    data_as_of: DateStringSchema,
  }),
});

// ───────────────────────── cases：决策时可见部分 ─────────────────────────

/** 可见窗口必须以 T 日收盘结束（终点 = 0），起点在 T 日之前。 */
const VisibleOffsets = Offsets.refine(([start, end]) => end === 0 && start < 0, {
  message: "可见窗口必须终止于 T 日（offsets[1] = 0），且起点在 T 日之前",
});

const expectedLength = (offsets: readonly [number, number]) => offsets[1] - offsets[0] + 1;
const nullableNumber = z.number().nullable();

export const VisibleFoxCardSchema = z.strictObject({
  title: z.string().min(1),
  offsets: VisibleOffsets,
  asset: Series,
  benchmark: Series,
  benchmark_name: z.string().min(1),
  asset_return: z.number(),
  benchmark_return: z.number(),
});

export const VisibleElephantCardSchema = z.strictObject({
  title: z.string().min(1),
  offsets: VisibleOffsets,
  series: Series,
  cum_return: z.number(),
  max_drawdown: z.number().min(0).max(1),
});

export const VisibleLeopardCardSchema = z.strictObject({
  title: z.string().min(1),
  offsets: VisibleOffsets,
  close: Series,
  /** 第一天没有前收，为 null。 */
  day_return: z.array(nullableNumber),
  volume_ratio: z.array(nullableNumber),
});

export const VisibleRoundSchema = z
  .strictObject({
    round_id: RoundIdSchema,
    act: z.union([z.literal(1), z.literal(2)]),
    label: z.string().regex(/^[A-F]$/),
    claim: z.string().min(1),
    cards: z.strictObject({
      fox: VisibleFoxCardSchema,
      elephant: VisibleElephantCardSchema,
      leopard: VisibleLeopardCardSchema,
    }),
  })
  .superRefine((r, ctx) => {
    const { fox, elephant, leopard } = r.cards;
    const check = (path: (string | number)[], actual: number, offsets: readonly [number, number]) => {
      if (actual !== expectedLength(offsets)) {
        ctx.addIssue({ code: "custom", path, message: `长度应为 ${expectedLength(offsets)}（含 T 日），实际 ${actual}` });
      }
    };
    check(["cards", "fox", "asset"], fox.asset.length, fox.offsets);
    check(["cards", "fox", "benchmark"], fox.benchmark.length, fox.offsets);
    check(["cards", "elephant", "series"], elephant.series.length, elephant.offsets);
    check(["cards", "leopard", "close"], leopard.close.length, leopard.offsets);
    check(["cards", "leopard", "day_return"], leopard.day_return.length, leopard.offsets);
    check(["cards", "leopard", "volume_ratio"], leopard.volume_ratio.length, leopard.offsets);
    const starts: [string[], number | undefined][] = [
      [["cards", "fox", "asset"], fox.asset[0]],
      [["cards", "fox", "benchmark"], fox.benchmark[0]],
      [["cards", "elephant", "series"], elephant.series[0]],
      [["cards", "leopard", "close"], leopard.close[0]],
    ];
    for (const [path, v] of starts) {
      if (v !== 100) ctx.addIssue({ code: "custom", path, message: `每张卡以窗口首日 = 100 归一化，实际首值 ${v}` });
    }
  });

export const CasesVisibleSchema = z.strictObject({
  header: VisibleHeaderSchema,
  rounds: z.array(VisibleRoundSchema).min(1),
});

// ───────────────────────── cases：揭晓后部分 ─────────────────────────

export const RevealAfterSchema = z
  .strictObject({
    /** T 日 = 0；后续 20 个交易日。 */
    offsets: Offsets.refine(([start, end]) => start === 0 && end > 0, { message: "揭晓窗口必须从 T 日（0）起向后" }),
    /** 以 T 日收盘 = 100 归一化。 */
    close: Series,
    open_t1: Price,
    close_t20: Price,
    return_close_t_to_close_t20: z.number(),
    /** 松果结算口径：C[T+20] / O[T+1] - 1。 */
    return_open_t1_to_close_t20: z.number(),
    t1_open_at_limit_up: z.boolean(),
  })
  .superRefine((a, ctx) => {
    if (a.close.length !== expectedLength(a.offsets)) {
      ctx.addIssue({ code: "custom", path: ["close"], message: `长度应为 ${expectedLength(a.offsets)}，实际 ${a.close.length}` });
    }
    if (a.close[0] !== 100) ctx.addIssue({ code: "custom", path: ["close"], message: "揭晓走势以 T 日收盘 = 100" });
    const last = a.close[a.close.length - 1];
    if (last !== undefined && Math.abs(last - a.close_t20) > 1e-3) {
      ctx.addIssue({ code: "custom", path: ["close_t20"], message: "close_t20 必须等于 close 的最后一个值" });
    }
  });

export const RevealSourceSchema = z.looseObject({
  symbol: z.string().min(1),
  name: z.string().min(1),
  decision_date: DateStringSchema,
  windows: z.strictObject({ fox: DatePair, elephant: DatePair, leopard: DatePair, after: DatePair }),
  benchmark: z.string().min(1),
  claim: z.string().min(1),
  /** 当时材料支持的判断，由脚本按冻结口径产出，与关卡配置的 evidence_verdict 必须一致。 */
  evidence_verdict: VerdictSchema,
  /** 筛选条件的逐项核对结果。 */
  checks: z.record(z.string(), z.unknown()),
  selection: z.string().min(1),
  /** 是否参考过后续结果选案，必须披露。 */
  hindsight_disclosure: z.string().min(1),
});

export const RevealRoundSchema = z.strictObject({
  round_id: RoundIdSchema,
  after: RevealAfterSchema,
  source: RevealSourceSchema,
});

/** 允许一个文件装全部轮次，也允许按轮拆成 cases_reveal_R1.json 等（只请求已锁定的那一轮）。 */
export const CasesRevealSchema = z.strictObject({
  header: CasesRevealHeaderSchema,
  rounds: z.array(RevealRoundSchema).min(1),
});

// ───────────────────────── taskA ─────────────────────────

const Comparison = z.enum(["outperform", "underperform", "insufficient"]);

export const TaskADataSchema = z.strictObject({
  header: TaskAHeaderSchema,
  label: z.string().regex(/^[A-Z]$/),
  step1: z.strictObject({
    observation: z.literal("O1"),
    offsets: Offsets,
    benchmark_name: z.string().min(1),
    /** 对齐前：两条线各自以更长窗口的首日 = 100。 */
    unaligned: z.strictObject({ asset: Series, benchmark: Series }),
    /** 对齐后：同一起点 = 100。 */
    aligned: z.strictObject({ asset: Series, benchmark: Series }),
    asset_return: z.number(),
    benchmark_return: z.number(),
    answer: Comparison,
  }),
  step2: z.strictObject({
    observation: z.literal("O2"),
    offsets: Offsets,
    claim: z.string().min(1),
    series: Series,
    cum_return: z.number(),
    max_drawdown: z.number().min(0).max(1),
    answer: VerdictSchema,
  }),
  source: z.looseObject({
    symbol: z.string().min(1),
    name: z.string().min(1),
    decision_date: DateStringSchema,
    windows: z.record(z.string(), DatePair),
    hindsight_disclosure: z.string().min(1),
  }),
});

// ───────────────────────── taskB_{topic} ─────────────────────────

const Pct = z.number().min(0).max(1);
const Range = z.strictObject({ from: DateStringSchema, to: DateStringSchema });

export const TaskBHeaderSchema = z.looseObject({
  ...FullHeaderShape,
  file: z.literal("taskB"),
  topic: TopicSchema,
  /** 锁定的研究题目，原文。 */
  question: z.string().min(1),
  /** 信号定义与参数，如量比倍数、单日涨幅阈值；均量不含触发当日。 */
  signal: z.strictObject({ definition: z.string().min(1), params: z.record(z.string(), z.union([z.number(), z.string()])) }),
  /** 主指标不可与“上涨比例 / 跑赢比例”混用。 */
  primary_metric: z.strictObject({ id: z.enum(["share_positive_return", "share_positive_excess_return"]), label: z.string().min(1) }),
  execution: z.strictObject({ entry: z.string().min(1), exit: z.string().min(1), horizon_days: z.number().int().positive() }),
  /** 股票池冻结：规模、来源、快照日期、已知偏差。 */
  pool: z.strictObject({
    description: z.string().min(1),
    size: z.number().int().positive(),
    snapshot_date: DateStringSchema,
    bias_note: z.string().min(1),
  }),
  /** 展示段 / 检验段边界，在看检验段之前冻结。信号可用更早历史作回看；执行与退出必须完整落在各自分段内。 */
  segments: z.strictObject({ lookback_from: DateStringSchema, display: Range, test: Range }),
  /** 阈值只是本练习的描述标准，不是统计显著性门槛。 */
  thresholds: z.strictObject({
    min_samples: z.number().int().positive(),
    advantage_margin: Pct,
    frozen_at: z.iso.datetime(),
  }),
  /** 同股票池、同分段、同窗口与完整性规则，但不按信号（包括其反面）筛选。 */
  baseline_rule: z.string().min(1),
  /** 信号组与基准组分别应用相同的不重叠规则。 */
  non_overlap_rule: z.string().min(1),
  exclusions: z.array(z.string().min(1)).min(1),
  limitations: z.array(z.string().min(1)).min(1),
});

/** 一组在一个分段里的统计。无样本或指标缺失时用 null 保留未知，不用 0% 冒充。 */
export const GroupStatsSchema = z
  .strictObject({
    n_records: z.number().int().min(0),
    n_symbols: z.number().int().min(0),
    primary_metric: Pct.nullable(),
    mean_return: z.number().nullable(),
    covered: DatePair.nullable(),
    excluded: z.record(z.string(), z.number().int().min(0)),
  })
  .superRefine((g, ctx) => {
    if (g.n_records === 0 && (g.primary_metric !== null || g.mean_return !== null)) {
      ctx.addIssue({ code: "custom", path: ["primary_metric"], message: "0 条记录时指标必须为 null" });
    }
    if (g.n_symbols > g.n_records) ctx.addIssue({ code: "custom", path: ["n_symbols"], message: "标的数不能超过记录数" });
  });

export const SegmentStatsSchema = z
  .strictObject({
    range: Range,
    signal_group: GroupStatsSchema,
    baseline_group: GroupStatsSchema,
    /** 信号组主指标 − 基准组主指标；任一组缺指标时为 null。 */
    delta: z.number().nullable(),
    meets_threshold: z.boolean().nullable(),
  })
  .superRefine((s, ctx) => {
    const missing = s.signal_group.primary_metric === null || s.baseline_group.primary_metric === null;
    if (missing && (s.delta !== null || s.meets_threshold !== null)) {
      ctx.addIssue({ code: "custom", path: ["delta"], message: "任一组缺主指标时 delta 与 meets_threshold 必须为 null" });
    }
    if (!missing && (s.delta === null || s.meets_threshold === null)) {
      ctx.addIssue({ code: "custom", path: ["delta"], message: "两组都有主指标时必须给出 delta 与 meets_threshold" });
    }
  });

export const TaskBVerdictSchema = z
  .strictObject({
    result: z.enum(["insufficient_evidence", "both_segments", "segment_difference", "no_observed_advantage"]),
    /** result = segment_difference 时必须注明是哪一段达到。 */
    only_segment: z.enum(["display", "test"]).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.result === "segment_difference" && !v.only_segment) {
      ctx.addIssue({ code: "custom", path: ["only_segment"], message: "segment_difference 必须注明仅展示段还是仅检验段" });
    }
    if (v.result !== "segment_difference" && v.only_segment) {
      ctx.addIssue({ code: "custom", path: ["only_segment"], message: "只有 segment_difference 才有 only_segment" });
    }
  });

/** 缺指标必须降级；数据充分时的阈值判定由 YOU-153 实现并配 check_taskB.py。 */
export const TaskBDataSchema = z.strictObject({
  header: TaskBHeaderSchema,
  display: SegmentStatsSchema,
  test: SegmentStatsSchema,
  verdict: TaskBVerdictSchema,
}).superRefine((data, ctx) => {
  const missing = [data.display, data.test].some(
    (segment) => segment.signal_group.primary_metric === null || segment.baseline_group.primary_metric === null,
  );
  if (missing && data.verdict.result !== "insufficient_evidence") {
    ctx.addIssue({ code: "custom", path: ["verdict", "result"], message: "任一组缺主指标时结论必须为 insufficient_evidence" });
  }
});

// ───────────────────────── 前端装载边界 ─────────────────────────

/** 揭晓前前端唯一允许持有的数据对象。 */
export const PreRevealDataSchema = CasesVisibleSchema;
/** 只有对应轮次锁定后才允许加载。 */
export const PostRevealDataSchema = CasesRevealSchema;

export type VisibleHeader = z.infer<typeof VisibleHeaderSchema>;
export type VisibleRound = z.infer<typeof VisibleRoundSchema>;
export type CasesVisible = z.infer<typeof CasesVisibleSchema>;
export type CasesRevealHeader = z.infer<typeof CasesRevealHeaderSchema>;
export type RevealRound = z.infer<typeof RevealRoundSchema>;
export type CasesReveal = z.infer<typeof CasesRevealSchema>;
export type TaskAData = z.infer<typeof TaskADataSchema>;
export type TaskBHeader = z.infer<typeof TaskBHeaderSchema>;
export type GroupStats = z.infer<typeof GroupStatsSchema>;
export type SegmentStats = z.infer<typeof SegmentStatsSchema>;
export type TaskBVerdict = z.infer<typeof TaskBVerdictSchema>;
export type TaskBData = z.infer<typeof TaskBDataSchema>;
