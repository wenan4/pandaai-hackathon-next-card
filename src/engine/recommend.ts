// recommend(profile, progress, availableTopics) → plan。纯函数，不读取筹码与交易结果。
import type { GameEvent, Plan, Profile, Progress, TopicId, TopicSource } from "./types";

export const STYLE_TOPIC: Partial<Record<Profile["style"]["species"], TopicId>> = {
  fox: "fox",
  elephant: "elephant",
  leopard: "cheetah",
};
const TOPIC_LABEL: Record<TopicId, string> = { cheetah: "猎豹题", elephant: "大象题", fox: "狐狸题" };
const BET_LABEL: Record<TopicId, string> = { cheetah: "放量异动", elephant: "稳步上行", fox: "相对强弱" };

export interface RecommendOptions {
  userTopic?: TopicId;
  betTopic?: TopicId;
}

/** 用户最近一次明确选的题目（topic_select 且来源为 user）。默认主题的来源记录不算用户选择。 */
export function selectedTopic(events: readonly GameEvent[]): TopicId | undefined {
  let topic: TopicId | undefined;
  for (const e of events) if (e.type === "topic_select" && e.payload.source === "user") topic = e.payload.topic;
  return topic;
}

type TopicPick = Pick<Plan, "topic" | "topic_source" | "topic_sources" | "topic_conflict">;

function pickTopic(profile: Profile, available: TopicId[], opts: RecommendOptions): TopicPick {
  // 优先级：用户明确选题 > O3-d 定向练习 > 押注形态 > 物种默认 > 选题入口（PRD v0.3 §5.2）
  const candidates: [TopicId | undefined, TopicSource][] = [
    [opts.userTopic, "user"],
    [profile.flags.o3d ? "cheetah" : undefined, "o3d"],
    [opts.betTopic, "bet"],
    [STYLE_TOPIC[profile.style.species], "style_default"],
  ];
  const usable = candidates.filter((c): c is [TopicId, TopicSource] => !!c[0] && available.includes(c[0]));
  if (usable.length) {
    const [topic, source] = usable[0]!;
    const topic_sources = usable.filter(([t]) => t === topic).map(([, s]) => s);
    // 押注与物种指向不同主题：进入选题入口，默认高亮押注的主题，两个来源同时给出，不替用户消解分歧
    const style = usable.find(([, s]) => s === "style_default");
    const topic_conflict = source === "bet" && !!style && style[0] !== topic;
    if (topic_conflict) topic_sources.push("style_default");
    return { topic, topic_source: source, topic_sources, topic_conflict };
  }
  if (available.length === 1) return { topic: available[0]!, topic_source: "only_available", topic_sources: ["only_available"], topic_conflict: false };
  return { topic: null, topic_source: null, topic_sources: [], topic_conflict: false };
}

function topicReason(t: TopicPick, profile: Profile): string {
  if (!t.topic) return "可以在三个主题里自己选一个。";
  const name = TOPIC_LABEL[t.topic];
  switch (t.topic_source) {
    case "user":
      return `题目是你自己选的：${name}。`;
    case "bet": {
      const style = STYLE_TOPIC[profile.style.species];
      const base = `你这一局反复跟了${BET_LABEL[t.topic]}的形态，所以先用${name}检验这种形态在另一段数据里的表现。`;
      return t.topic_conflict && style ? `${base}你先翻的牌指向${TOPIC_LABEL[style]}，两个来源不一致，可以换题。` : base;
    }
    case "style_default":
      return `你这一局先翻的牌指向${name}，可以换题。`;
    default:
      return "";
  }
}

export function recommend(profile: Profile, progress: Progress, available: TopicId[], opts: RecommendOptions = {}): Plan {
  const O = profile.observations;
  const assist = profile.help_preference.level;
  const guess_first = O.O4.status !== "observed";

  if (progress.ready_for_B) {
    const t = pickTopic(profile, available, opts);
    const why = profile.flags.o3d
      ? "第 3 轮你根据近期量价对 20 天后的价格下了判断，这关用很多只股票检验这类信号。"
      : "两个基础步骤都已确认，这关换一段数据检验一个规律。";
    const extra = profile.flags.o3d && t.topic_source === "o3d" ? "" : topicReason(t, profile);
    return { route: progress.K === 2 ? "R-B" : "R-B-progress", task: "B", steps: [1, 2, 3], ...t, assist, guess_first, reason: why + extra };
  }

  const need: number[] = [];
  if (!progress.S1) need.push(1);
  if (!progress.S2) need.push(2);
  const steps = need.length ? need : [1, 2].filter((s) => !progress.taskA_steps_done.includes(s));

  const parts: string[] = [];
  for (const [step, id] of [[1, "O1"], [2, "O2"]] as const) {
    if (!steps.includes(step)) continue;
    const o = O[id];
    const name = id === "O1" ? "用同期对照判断" : "拉长窗口判断";
    if (o.aggregation === "mixed") parts.push(`${name}在两个情境里表现不同，先在新情境里试一次`);
    else if (o.status === "observed") parts.push(`${name}只见过一次，换一只股票再练一次`);
    else if (o.status === "assisted") parts.push(`${name}是在提示下完成的，这次试试少用提示`);
    else if (o.status === "uncertain") parts.push(`${name}的结论和看到的证据还没对上，再比一次`);
    else parts.push(`这几轮还没看到你${name}，这关专门练这一步`);
  }
  return {
    route: !progress.S1 && !progress.S2 ? "R-A2" : "R-A1",
    task: "A",
    steps,
    topic: null,
    topic_source: null,
    topic_sources: [],
    topic_conflict: false,
    assist,
    guess_first,
    reason: parts.join("；") + "。",
  };
}
