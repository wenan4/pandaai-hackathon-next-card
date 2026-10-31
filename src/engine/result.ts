import { StructuredResultSchema, type Provenance as ContractProvenance, type TradingViewItem } from "../../contracts/outputs";
import { evaluate, type EngineConfig } from "./evaluate";
import { habits } from "./habits";
import { recommend } from "./recommend";
import { TOPIC_OF_BET_FAMILY } from "../../contracts/common";
import type { GameEvent, TopicId } from "./types";

export type Provenance = Omit<ContractProvenance, "session_id">;
export function structuredResult(events: readonly GameEvent[], cfg: EngineConfig, topics: TopicId[], provenance: Omit<Provenance, "event_count">, unknowns: string[]) {
  const { profile, progress } = evaluate(events, cfg);
  const action = habits(events, cfg.rounds);
  const frequent = action.backed_families.frequent.slice().sort((a,b) => action.backed_families.by_family[b].count - action.backed_families.by_family[a].count);
  const trading: TradingViewItem[] = [];
  const o1 = profile.observations.find(o => o.id === "O1");
  if (o1?.id === "O1" && o1.aggregate === "repeated") trading.push({ refers_to: "O1", template_id: "tv.o1.relative_vs_absolute", scope_rounds: o1.scenarios.flatMap(s => s.scenario.startsWith("R") ? [s.scenario] : []) as TradingViewItem["scope_rounds"], reads_as: "这两轮里，你用同期对照区分了绝对涨幅与相对市场的表现。" });
  const split = action.decision_chains.find(c => !c.aligned);
  if (split) trading.push({ refers_to: "action_profile", template_id: "tv.action.verdict_vs_step_split", scope_rounds: [split.round_id], reads_as: `第 ${split.round_id.slice(1)} 轮你判断“${split.verdict === "refutes" ? split.pattern_family === "relative_strength" ? "没跑赢" : "不支持" : split.verdict === "supports" ? "支持" : "证据不足"}”，下一步仍选了${({follow:"跟",skip:"不跟",wait:"先看看"})[split.action]}；判断与下一步在这里是分开记录的。` });
  const family = frequent[0];
  if (family) {
    const ids = action.backed_families.by_family[family].rounds;
    const familyName = { relative_strength: "相对强弱", steady_trend: "稳步上行", volume_surge: "放量异动" }[family];
    trading.push({ refers_to: "backed_families", template_id: "tv.bet.repeated_family", scope_rounds: ids, reads_as: `本局你${ids.length === 2 ? "两次" : `${ids.length} 次`}跟了同一类${familyName}的形态（第 ${ids.map(r => r.slice(1)).join("、")} 轮）。这只描述这一局的选择。` });
  }
  return StructuredResultSchema.parse({ rules_version: cfg.rules_version, provenance: { ...provenance, session_id: events[0]?.session_id ?? "empty-session", event_count: events.length },
    style: profile.style, observations: profile.observations, help_preference: profile.help_preference, progress, unknowns, ...action, trading_view: trading,
    recommendation: recommend(profile, progress, topics, { betTopic: family ? TOPIC_OF_BET_FAMILY[family] : undefined, userTopic: events.filter(e => e.type === "topic_select" && e.payload.source === "user").map(e => e.type === "topic_select" ? e.payload.topic : undefined).at(-1) }),
  });
}
export type StructuredResult = ReturnType<typeof structuredResult>;
