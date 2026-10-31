// 第一幕关卡配置。命题与证据结论来自数据脚本生成的 rounds_act1.json，其余为版本化配置。
import type { Card, RoundConfig } from "../engine/types";
import act1 from "./rounds_act1.json";

const EXPLAIN: Record<Card, string> = {
  fox: "两条线从同一天、同一个起点 100 出发。线越高，表示从起点到那天涨得越多。",
  elephant: "这是近 3 年的走势。累计涨跌看最后一天比第一天高多少；最大回撤是从之前的最高点往下最深跌了多少。",
  leopard: "上面是近 20 个交易日的收盘走势，下面的柱子是量比：当天成交量 ÷ 之前 20 个交易日的平均量，虚线是 1 倍。",
};

function explain(roundId: string): RoundConfig["explain"] {
  const out = {} as RoundConfig["explain"];
  for (const card of ["fox", "elephant", "leopard"] as Card[]) {
    out[card] = { content_id: `${roundId}-${card}-explain-v1`, text: EXPLAIN[card], kind: "neutral" };
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

export const ROUNDS: RoundConfig[] = act1.rounds.map((r) => ({
  round_id: r.round_id,
  act: 1,
  label: r.label,
  claim: r.claim,
  verdict: r.evidence_verdict as RoundConfig["verdict"],
  explain: explain(r.round_id),
  ...EXTRA[r.round_id]!,
}));

export const BENCHMARK_NAME = act1.rounds[0]?.benchmark_name ?? "沪深300";
