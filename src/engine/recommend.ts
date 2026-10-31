// recommend(profile, progress, availableTopics) → plan。纯函数，不读取筹码与交易结果。
import type { Plan, Profile, Progress, TopicId, TopicSource } from "./types";

const STYLE_TOPIC: Partial<Record<Profile["style"]["species"], TopicId>> = {
  fox: "fox",
  elephant: "elephant",
  leopard: "cheetah",
};

export interface RecommendOptions {
  userTopic?: TopicId;
  betTopic?: TopicId;
}

function pickTopic(profile: Profile, available: TopicId[], opts: RecommendOptions): { topic: TopicId | null; source: TopicSource | null } {
  // 优先级：用户明确选题 > O3-d 定向练习 > 押注形态 > 物种默认 > 选题入口
  const candidates: [TopicId | undefined, TopicSource][] = [
    [opts.userTopic, "user"],
    [profile.flags.o3d ? "cheetah" : undefined, "o3d"],
    [opts.betTopic, "bet"],
    [STYLE_TOPIC[profile.style.species], "style_default"],
  ];
  for (const [topic, source] of candidates) if (topic && available.includes(topic)) return { topic, source };
  if (available.length === 1) return { topic: available[0]!, source: "only_available" };
  return { topic: null, source: available.length ? "chooser" : null };
}

export function recommend(profile: Profile, progress: Progress, available: TopicId[], opts: RecommendOptions = {}): Plan {
  const O = profile.observations;
  const assist = profile.help_preference.level;
  const guess_first = O.O4.status !== "observed";

  if (progress.ready_for_B) {
    const { topic, source } = pickTopic(profile, available, opts);
    const why = profile.flags.o3d
      ? "第 3 轮你根据近期量价对 20 天后的价格下了判断，这关用很多只股票检验这类信号。"
      : "两个基础步骤都已确认，这关换一段数据检验一个规律。";
    return { route: progress.K === 2 ? "R-B" : "R-B-progress", task: "B", steps: [1, 2, 3], topic, topic_source: source, assist, guess_first, reason: why };
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
    if (o.status === "observed") parts.push(`${name}只见过一次，换一只股票再练一次`);
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
    assist,
    guess_first,
    reason: parts.join("；") + "。",
  };
}
