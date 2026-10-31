// 行动习惯（YOU-165）：只计数、不评高低，不进入能力观察。
// evaluate / recommend 都不导入本模块；押注形态只作为 recommend 的可选输入，影响任务 B 的默认主题。
import { collectRound } from "./rounds";
export { contractHabits as habits } from "./outputs";
import type { Action, Card, GameEvent, Reaction, RoundConfig, TopicId, Verdict } from "./types";

type BetFamily = RoundConfig["bet_family"];

/** 某类押注形态被“跟”至少这么多次才称为“常押”（PRD v0.3 §4.4）。 */
export const FREQUENT_BET_THRESHOLD = 2;
export const TOPIC_OF_BET_FAMILY: Record<BetFamily, TopicId> = { relative_strength: "fox", steady_trend: "elephant", volume_surge: "cheetah" };
const SAME_DIRECTION: Record<Verdict, Action> = { supports: "follow", refutes: "skip", insufficient: "wait" };

export interface DecisionChain {
  round_id: string;
  flips: Card[];
  explained: Card[];
  initial: Reaction | null;
  final: Verdict;
  action: Action;
  followup: string | null;
}
export interface ActionHabits {
  /** 最终判断与“你的下一步”同向（支持→跟、不支持→不跟、证据不足→先看看）的轮次，以及不同向的轮次 */
  aligned: string[];
  diverged: string[];
  /** 判断为“证据不足”时各选了什么 */
  under_insufficient: Record<Action, string[]>;
  backed_families: { family: BetFamily; rounds: string[]; frequent: boolean }[];
  decision_chains: DecisionChain[];
  counts: Record<Action, number>;
}

export function actionHabits(events: readonly GameEvent[], rounds: RoundConfig[]): ActionHabits {
  const out: ActionHabits = {
    aligned: [], diverged: [], under_insufficient: { follow: [], skip: [], wait: [] }, backed_families: [], decision_chains: [],
    counts: { follow: 0, skip: 0, wait: 0 },
  };
  const backed = new Map<BetFamily, string[]>();
  for (const cfg of rounds) {
    const rec = collectRound(events, cfg);
    if (!rec.final || !rec.action) continue;
    out.counts[rec.action] += 1;
    (SAME_DIRECTION[rec.final] === rec.action ? out.aligned : out.diverged).push(cfg.round_id);
    if (rec.final === "insufficient") out.under_insufficient[rec.action].push(cfg.round_id);
    if (rec.action === "follow") backed.set(cfg.bet_family, [...(backed.get(cfg.bet_family) ?? []), cfg.round_id]);
    out.decision_chains.push({
      round_id: cfg.round_id, flips: rec.flips, explained: [...new Set(rec.explains.map((x) => x.card))],
      initial: rec.initial ?? null, final: rec.final, action: rec.action, followup: rec.followup?.answer ?? null,
    });
  }
  out.backed_families = [...backed].map(([family, rs]) => ({ family, rounds: rs, frequent: rs.length >= FREQUENT_BET_THRESHOLD }));
  return out;
}

/** 常押形态对应的任务 B 主题；没有常押形态时不给（只描述，不推荐）。 */
export function betTopic(h: ActionHabits): TopicId | undefined {
  const top = h.backed_families.filter((b) => b.frequent).sort((a, b) => b.rounds.length - a.rounds.length)[0];
  return top ? TOPIC_OF_BET_FAMILY[top.family] : undefined;
}
