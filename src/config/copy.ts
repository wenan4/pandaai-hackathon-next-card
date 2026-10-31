// 界面文案模板。组件只按 ID 取文案，不在组件里拼对错判断。
import type { JudgementId } from "../engine/evaluate";
import type { Action, AssistLevel, Card, FollowupId, ObsId, ObsStatus, Reaction, Species, Verdict } from "../engine/types";

export const CARD_COPY: Record<Card, { animal: string; title: string }> = {
  fox: { animal: "狐狸", title: "同期对照" },
  elephant: { animal: "大象", title: "更长历史" },
  leopard: { animal: "猎豹", title: "近期量价" },
};

export const REACTION_COPY: Record<Reaction, string> = {
  supports: "支持",
  refutes: "不支持",
  unsure: "说不准",
};

export const VERDICT_COPY: Record<Verdict, { label: string; desc: string }> = {
  supports: { label: "支持", desc: "现有证据支持这句话" },
  refutes: { label: "不支持", desc: "现有证据与这句话相反" },
  insufficient: { label: "证据不足", desc: "目前既不能支持，也不能否定" },
};

export const ACTION_COPY: Record<Action, string> = {
  follow: "跟",
  pass: "不跟",
  wait: "先看看",
};

export const FOLLOWUP_COPY: Record<FollowupId, { question: string; options: string[] }> = {
  missing: { question: "你觉得还缺什么？", options: ["更长的历史", "和别的比一比", "之后的走势", "图没看懂", "说不清"] },
  basis: { question: "你主要依据什么？", options: ["主图走势", "翻开的牌", "说法本身", "直觉", "图没看懂"] },
  waiting: { question: "你在等什么？", options: ["等更多信号", "等未来走势", "图没看懂", "说不清"] },
};

/** 追问里表示“理解有困难”的答案，引擎据此标记“还需要确认理解” */
export const UNDERSTANDING_ANSWERS = ["图没看懂"];

export const JUDGEMENT_COPY: Record<JudgementId, string> = {
  consistent: "依据与结论一致",
  unchecked: "未查看本轮关键证据",
  mismatch: "结论与已见证据尚未对应",
  future_reserved: "保留了对未来的结论",
  assisted: "在提示下完成",
  understanding: "还需要确认理解",
};

export const OBS_COPY: Record<ObsId, string> = {
  O1: "用参照检验",
  O2: "用长窗口检验",
  O3: "识别证据边界",
  O4: "根据新证据修正判断",
};

export const STATUS_COPY: Record<ObsStatus, string> = {
  observed: "观察到",
  assisted: "在帮助下",
  uncertain: "尚不确定",
  not_observed: "未观察到",
};

/** 任务记录的状态（engine/changes.ts 的 TaskStatus） */
export const TASK_STATUS_COPY = { none: "未开始", recorded: "未完成", done: "独立完成", assisted: "在帮助下完成" } as const;

/** 任务后画像变化的原因，按“规则@情境”取；没有对应文案时只显示规则编号。 */
export const CHANGE_REASON: Record<string, string> = {
  "O5-t@taskB": "按锁定的规则读完两段样本，结论和依据都和数据一致",
  "O5-r@taskB": "有一次作答和数据对不上：只记录，不扣分",
  "O4-a@taskB": "先猜的答案和数据冲突，看完两段后改成了和数据一致的结论",
};

export const SPECIES_COPY: Record<Species,{ name: string; method: string; helps: string; watch: string }> = {
  fox: { name: "狐狸", method: "先找参照", helps: "检查说法里的“更多、更好”到底是和谁比。", watch: "参照选错了，结论也会跟着偏。" },
  elephant: { name: "大象", method: "先看长远", helps: "检查一段走势放到更长时间里是不是常态。", watch: "窗口太长会冲淡最近的变化。" },
  leopard: { name: "猎豹", method: "先看信号", helps: "检查最近有没有不寻常的量价变化。", watch: "一次信号不等于之后的走势。" },
  mixed: { name: "混合倾向", method: "查法还在变化", helps: "这几轮你先翻的牌不一样，说明你会换着角度看。", watch: "还看不出固定的查法，多玩几关会更清楚。" },
  unknown: { name: "物种尚未显形", method: "样本还太少", helps: "说法点名的牌不计入，能计入的首翻还不够。", watch: "这一局能计入的首翻太少，还看不出固定查法。" },
};

export const ASSIST_COPY: Record<AssistLevel, { label: string; desc: string }> = {
  guide: { label: "带我做", desc: "逐步提示，带着完成" },
  hint: { label: "给我提示", desc: "每步给一句提示" },
  self: { label: "我自己来", desc: "不主动给提示" },
};

/** “换成交易语言来看”：把能力观察改写成交易里对应的问题，保持“本局”限定，不做买卖建议。 */
export const TRADING_VIEW: Record<"O1" | "O2" | "O3" | "O4", string> = {
  O1: "会不会把绝对涨幅当成超额收益：看到“涨得多”，先问和谁比、同一段时间比",
  O2: "看不看长期趋势和回撤：一段走势放到更长时间里是不是常态，中途最深跌过多少",
  O3: "知不知道一次信号需要验证才有意义：放量上涨之后会怎样，要拿很多次样本去看",
  O4: "看到相反证据时会不会调整：第一判断和证据冲突时，最后有没有跟着证据走",
};
export const BET_FAMILY_COPY: Record<"relative_strength" | "steady_trend" | "volume_surge", string> = {
  relative_strength: "相对强弱",
  steady_trend: "稳健趋势",
  volume_surge: "放量异动",
};

export const UNKNOWN_YET = ["能不能自己设计验证方法", "希望得到多少帮助（只看了这几轮）", "长期的交易偏好"];

export const LABELS = {
  real: "真实数据",
  sample: "示例资源",
  simulated: "模拟路径",
  todo: "未实现",
} as const;
export type LabelKind = keyof typeof LABELS;
