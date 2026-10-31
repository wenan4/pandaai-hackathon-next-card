// recommend(profile, progress, availableTopics) → plan。纯函数，不读取筹码与交易结果。
import type { PlanView, ProfileView, ProgressView, TopicId, TopicSource } from "./types";
import { RecommendationSchema, type Profile, type Progress } from "../../contracts/outputs";

type RoutingProfile = { observations: Record<"O1" | "O2" | "O3" | "O4", { status: string; aggregation: string }>; help_preference: { level: ProfileView["help_preference"]["level"] }; flags: { o3d: boolean }; style: Pick<ProfileView["style"], "species"> };

const STYLE_TOPIC: Partial<Record<ProfileView["style"]["species"], TopicId>> = {
  fox: "fox",
  elephant: "elephant",
  leopard: "cheetah",
};

export interface RecommendOptions {
  userTopic?: TopicId;
  betTopic?: TopicId;
}

function pickTopic(profile: RoutingProfile, available: TopicId[], opts: RecommendOptions): { topic: TopicId | null; source: TopicSource | null } {
  // 优先级：用户明确选题 > O3-d 定向练习 > 押注形态 > 物种默认 > 选题入口
  const candidates: [TopicId | undefined, TopicSource][] = [
    [opts.userTopic, "user"],
    [profile.flags.o3d ? "cheetah" : undefined, "focus"],
    [opts.betTopic, "bet"],
    [STYLE_TOPIC[profile.style.species], "style"],
  ];
  for (const [topic, source] of candidates) if (topic && available.includes(topic)) return { topic, source };
  if (available.length === 1) return { topic: available[0]!, source: "only_available" };
  return { topic: null, source: null };
}

export function recommendView(profile: RoutingProfile, progress: ProgressView, available: TopicId[], opts: RecommendOptions = {}): PlanView {
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

/** Public recommendation uses the same routing function as the UI projection. */
export function recommend(profile: Profile, progress: Progress, available: TopicId[], opts: RecommendOptions = {}) {
  const observations = Object.fromEntries((["O1", "O2", "O3", "O4"] as const).map(id => {
    const o = profile.observations.find(x => x.id === id);
    return [id, { status: o?.state ?? "not_observed", aggregation: o && "aggregate" in o ? o.aggregate : "none" }];
  })) as RoutingProfile["observations"];
  const focus = profile.observations.some(o => o.id === "O3" && o.scenarios.some(s => s.rule === "O3-d"));
  const p = recommendView({ observations, style: profile.style, help_preference: { level: profile.help_preference.user_selected ?? profile.help_preference.suggested_assist }, flags: { o3d: focus } }, { ...progress, taskA_steps_done: progress.taskA_completed_steps }, available, opts);
  const candidates: [TopicId | undefined, TopicSource][] = [[opts.userTopic, "user"], [focus ? "cheetah" : undefined, "focus"], [opts.betTopic, "bet"], [STYLE_TOPIC[profile.style.species], "style"]];
  const sources = p.task === "B" ? candidates.filter(([topic]) => topic && available.includes(topic)).map(([,source]) => source) : [];
  if (p.topic_source && !sources.includes(p.topic_source)) sources.push(p.topic_source);
  const topicConflict = p.task === "B" && sources.includes("bet") && sources.includes("style") && opts.betTopic !== STYLE_TOPIC[profile.style.species];
  const topicText = { elephant: ["稳步上行", "长期"], fox: ["相对强弱", "同期对照"], cheetah: ["放量异动", "量价"] };
  const reason = p.topic && p.route === "R-B" && p.topic_source === "bet" ? `观察到你用对应证据检验了说法。你这一局反复跟了${topicText[p.topic][0]}的形态，所以先用${topicText[p.topic][1]}题检验这种形态在另一段数据里的表现。可以换题。` : p.reason;
  return RecommendationSchema.parse({ task: p.task, rule: p.route, steps: p.task === "A" ? p.steps : [], topic: p.topic, topic_source: p.topic_source, topic_sources: sources, topic_conflict: topicConflict, assist: p.assist, guess_first: p.guess_first, reason_id: `${p.route}.${p.topic_source ?? "foundation"}`, reason_text: reason,
    resources: [{ name: "QuantSkills skill-quant-research", use: "拟参考研究验证步骤；实际采用条目待核验", status: "planned_reference" }] });
}
