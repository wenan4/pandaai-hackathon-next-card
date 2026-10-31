// 两幕六轮的关卡配置。命题与证据结论来自数据脚本生成的 rounds_act1.json / rounds_act2.json，其余为版本化配置。
// 第二幕是固定的第二套情境，说法的真假方向与第一幕翻转；不因用户表现调整题目。
import type { Card, RoundConfig } from "../engine/types";
import act1 from "./rounds_act1.json";
import act2 from "./rounds_act2.json";

const EXPLAIN: Record<Card, string> = {
  fox: "两条线从同一天、同一个起点 100 出发。线越高，表示从起点到那天涨得越多。",
  elephant: "这是近 3 年的走势。累计涨跌看最后一天比第一天高多少；最大回撤是从之前的最高点往下最深跌了多少。",
  leopard: "上面是近 20 个交易日的收盘走势，下面的柱子是量比：当天成交量 ÷ 之前 20 个交易日的平均量，虚线是 1 倍。",
};

/** R6 的近期量价牌多了一张历史样本表，解释也只讲读法，不提示该选哪个答案。 */
const EXPLAIN_R6_LEOPARD =
  "上面是近 20 个交易日的收盘与量比。下面列出过去一年里每次同类放量上涨出现的位置，以及之后 20 个交易日收盘比当天高还是低；每次的观察窗口都在今天之前结束。";

function explain(roundId: string): RoundConfig["explain"] {
  const out = {} as RoundConfig["explain"];
  for (const card of ["fox", "elephant", "leopard"] as Card[]) {
    const text = roundId === "R6" && card === "leopard" ? EXPLAIN_R6_LEOPARD : EXPLAIN[card];
    out[card] = { content_id: `${roundId}-${card}-explain-v1`, text, kind: "neutral" };
  }
  return out;
}

const EXTRA: Record<string, Omit<RoundConfig, "round_id" | "act" | "label" | "claim" | "verdict" | "explain">> = {
  R1: {
    key_card: "fox",
    named_card: "fox",
    horizon: "past",
    bet_family: "relative_strength",
    method_card: { id: "ruler", name: "对照尺", line: "听到“涨得多”，先问：和谁比？比的是同一段时间吗？" },
  },
  R2: {
    key_card: "elephant",
    named_card: "elephant",
    horizon: "past",
    bet_family: "steady_trend",
    method_card: { id: "long_lens", name: "长镜头", line: "说“稳”之前，把窗口拉长，看累计涨跌和最大回撤。" },
  },
  R3: {
    key_card: "leopard",
    named_card: null,
    horizon: "future",
    bet_family: "volume_surge",
    method_card: { id: "another_segment", name: "换一段", line: "一次放量说明不了 20 天后的价格；换一段数据，看看还成立吗。" },
  },
};

// 第二幕不发新方法卡，复用第一幕同类的那张（PRD v0.3 §2）
const ACT2_EXTRA: typeof EXTRA = {
  R4: { ...EXTRA.R1!, key_card: "fox", named_card: "fox", horizon: "past" },
  R5: { ...EXTRA.R2!, key_card: "elephant", named_card: "elephant", horizon: "past" },
  // R6 是“已有一小撮历史样本，但不够下结论”：说法点名了放量上涨，关键牌是近期量价里的历史样本
  R6: { ...EXTRA.R3!, key_card: "leopard", named_card: "leopard", horizon: "sample" },
};

const toConfig = (act: 1 | 2, extra: typeof EXTRA) => (r: (typeof act1.rounds)[number]): RoundConfig => ({
  round_id: r.round_id,
  act,
  label: r.label,
  claim: r.claim,
  verdict: r.evidence_verdict as RoundConfig["verdict"],
  explain: explain(r.round_id),
  ...extra[r.round_id]!,
});

export const ROUNDS: RoundConfig[] = [...act1.rounds.map(toConfig(1, EXTRA)), ...act2.rounds.map(toConfig(2, ACT2_EXTRA))];
export const ACT1_ROUNDS = ROUNDS.filter((r) => r.act === 1);
export const ACT2_ROUNDS = ROUNDS.filter((r) => r.act === 2);

/**
 * 押注形态覆盖表：每种形态在两幕里各出现几次。至少 2 次才谈得上“常押”（habits.FREQUENT_BET_THRESHOLD），
 * 只玩第一幕时每种形态最多一次，押注推题不会触发。
 */
export const FAMILY_COVERAGE = ROUNDS.reduce(
  (acc, r) => ((acc[r.bet_family] = (acc[r.bet_family] ?? 0) + 1), acc),
  {} as Record<RoundConfig["bet_family"], number>,
);

export const BENCHMARK_NAME = act1.rounds[0]?.benchmark_name ?? "沪深300";
