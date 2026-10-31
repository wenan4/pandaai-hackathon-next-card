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
  missing: { question: "你觉得还缺什么？", options: ["更长的历史", "和别的比一比", "之后的走势", "说不清"] },
  basis: { question: "你主要依据什么？", options: ["主图走势", "翻开的牌", "说法本身", "直觉"] },
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

export const SPECIES_COPY: Record<Species, { name: string; method: string; helps: string; watch: string }> = {
  fox: { name: "狐狸", method: "先找参照", helps: "检查说法里的“更多、更好”到底是和谁比。", watch: "参照选错了，结论也会跟着偏。" },
  elephant: { name: "大象", method: "先看长远", helps: "检查一段走势放到更长时间里是不是常态。", watch: "窗口太长会冲淡最近的变化。" },
  leopard: { name: "猎豹", method: "先看信号", helps: "检查最近有没有不寻常的量价变化。", watch: "一次信号不等于之后的走势。" },
  mixed: { name: "混合倾向", method: "查法还在变化", helps: "这几轮你先翻的牌不一样，说明你会换着角度看。", watch: "还看不出固定的查法，多玩几关会更清楚。" },
  unknown: { name: "物种尚未显形", method: "样本还太少", helps: "说法点名的牌不计入，能计入的首翻还不够。", watch: "第二幕会补上更多情境。" },
};

export const ASSIST_COPY: Record<AssistLevel, { label: string; desc: string }> = {
  guide: { label: "带我做", desc: "逐步提示，带着完成" },
  hint: { label: "给我提示", desc: "每步给一句提示" },
  self: { label: "我自己来", desc: "不主动给提示" },
};

export const UNKNOWN_YET = ["能不能自己设计验证方法", "希望得到多少帮助（只看了这几轮）", "长期的交易偏好"];

export const LABELS = {
  real: "真实数据",
  sample: "示例资源",
  simulated: "模拟路径",
  todo: "未实现",
} as const;
export type LabelKind = keyof typeof LABELS;
