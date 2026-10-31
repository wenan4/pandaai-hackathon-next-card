// Serialization of the evidence model to the frozen public engine contract.
// UI projections retain presentation summaries; exported JSON contains only contract fields.
import { EvaluateOutputSchema, HabitsSchema, type Assistance, type CrossScenarioObservation, type ObservationInstance, type O4Observation } from "../../contracts/outputs";
import type { RoundId, ScenarioId } from "../../contracts/common";
import type { EngineConfig } from "./evaluate";
import { collectRound } from "./rounds";
import type { GameEvent, ObsInstance, ProfileView, ProgressView, RoundConfig } from "./types";

export const DEFAULT_UNKNOWNS = ["能否独立设计验证方法", "希望获得多少帮助", "长期交易偏好"];
const unique = <T>(xs: T[]) => [...new Set(xs)];

function assistance(i: ObsInstance, events: readonly GameEvent[]): Assistance {
  if (!i.assisted) return "none";
  if (!i.context.startsWith("task")) return "directional_explain";
  const at = events.findIndex(e => e.event_id === i.event_ids.at(-1));
  const task = i.context.startsWith("taskA") ? "A" : "B";
  const prior = events.slice(0, at).filter(e => e.stage === "in_task" && e.type === "assist_exposure" && e.payload.task === task && (task === "B" || e.payload.step === Number(i.context.slice(-1))));
  const e = prior.at(-1);
  return e?.type === "assist_exposure" ? e.payload.kind : "answer_feedback";
}

function observationInstance(i: ObsInstance, events: readonly GameEvent[], cfg: EngineConfig): ObservationInstance {
  const state = i.outcome === "consistent" ? i.assisted ? "assisted" : "observed" : i.outcome === "unchecked" ? "not_observed" : "uncertain";
  const round = cfg.rounds.find(r => r.round_id === i.context);
  const ids = round ? i.event_ids.filter(id => {
    const e = events.find(e => e.event_id === id);
    return e?.type !== "card_flip" || e.payload.card === round.key_card;
  }) : i.event_ids;
  const reason = i.rule.endsWith("-c") ? "understanding" : i.rule.endsWith("-f") ? "knows_to_check" : i.rule === "O3-a" ? "no_comparable_round" : i.rule === "O3-b" ? "evidence_not_shown" : i.rule.endsWith("-e") ? "no_conclusion" : "mismatch";
  return {
    scenario: (i.context.startsWith("taskA") ? "taskA" : i.context) as ScenarioId,
    state, rule: i.rule, evidence_event_ids: ids, assistance: assistance(i, events),
    ...(state === "uncertain" ? { uncertain_reason: reason } : {}),
    ...(i.rule === "O3-a" ? { cross_round_rule: i.outcome === "consistent" ? "met" as const : "not_met" as const } : {}),
  };
}

export function contractEvaluation(view: { profile: ProfileView; progress: ProgressView }, events: readonly GameEvent[], cfg: EngineConfig) {
  const { profile: p, progress: g } = view;
  const observations: CrossScenarioObservation[] = [];
  for (const id of ["O1", "O2", "O3"] as const) {
    const o = p.observations[id];
    // Unplayed scenarios are absent, never fabricated as completed evidence.
    if (!o.instances.length) continue;
    observations.push({ id, state: o.status, aggregate: o.aggregation, scenarios: o.instances.map(i => observationInstance(i, events, cfg)), task_scenarios: id === "O3" ? [] : p.task_observations[id].map(i => observationInstance(i, events, cfg)) });
  }
  const revisions = p.observations.O4.instances.filter(i => i.outcome === "consistent");
  const n = p.observations.O4.instances.length, m = revisions.length;
  const independent = revisions.filter(i => !i.assisted).length;
  const o4: O4Observation = { id: "O4", state: p.observations.O4.status, rule: !n ? "O4-d" : !m ? "O4-c" : n === m ? "O4-a" : "O4-b", opportunities: n, revisions: m, independent_revisions: independent, assisted_revisions: m - independent,
    evidence_event_ids: unique(p.observations.O4.instances.flatMap(i => i.event_ids.filter(id => events.find(e => e.event_id === id)?.type !== "card_flip"))) };
  const done = p.task_observations.O5.find(i => i.outcome === "consistent") ?? p.task_observations.O5.at(-1);
  const selected = events.filter(e => e.stage === "in_task" && e.type === "assist_switch" && e.payload.by === "user").at(-1);
  const userSelected = selected?.type === "assist_switch" ? selected.payload.to : null;
  const count = p.help_preference.explain_count;
  const rule = userSelected ? "user_selected" : p.help_preference.source === "understanding" ? "understanding" : count >= 3 ? "explain_3plus" : count ? "explain_1_2" : p.help_preference.level === "solo" ? "solo_ok" : "default";
  return EvaluateOutputSchema.parse({
    profile: {
      rules_version: cfg.rules_version,
      observations: [...observations, o4, ...(done ? [{ id: "O5", state: done.outcome === "consistent" ? done.assisted ? "assisted" : "observed" : "uncertain", rule: done.rule, evidence_event_ids: done.event_ids, assistance: assistance(done, events) }] : [])],
      style: { species: p.style.species, counted_first_flips: p.style.first_flips.filter(f => f.counted).map(({ round_id, card }) => ({ round_id, card })), excluded_named_flips: p.style.first_flips.filter(f => !f.counted).map(({ round_id, card }) => ({ round_id, card })), counts: p.style.counts, scope: "本局倾向：只统计说法没有直接点名的牌的首翻，不代表稳定特点。" },
      help_preference: { suggested_assist: p.help_preference.level, user_selected: userSelected, state: userSelected ? "observed" : "uncertain", rule, explain_count: count, basis_id: rule === "solo_ok" ? "solo_ok.o1_o2_repeated" : `help.${rule}` },
      unknowns: DEFAULT_UNKNOWNS,
    },
    progress: { K: g.K, S1: g.S1, S2: g.S2, rounds_completed: g.rounds_completed, taskA_completed_steps: g.taskA_steps_done, taskB_done: g.taskB_done, ready_for_B: g.ready_for_B },
  });
}

export function contractHabits(events: readonly GameEvent[], rounds: RoundConfig[]) {
  const chains = rounds.flatMap(cfg => {
    const r = collectRound(events, cfg);
    if (!r.final || !r.action) return [];
    const aligned = r.action === ({ supports: "follow", refutes: "skip", insufficient: "wait" } as const)[r.final];
    return [{ round_id: cfg.round_id as RoundId, looked_at: r.flips, explains: r.explains.map(({card,kind}) => ({card,kind})), initial_reaction: r.initial ?? null, verdict: r.final, action: r.action, followup: r.followup ?? null, aligned, pattern_family: cfg.bet_family }];
  });
  const counted = (ids: string[]) => ({ count: ids.length, rounds: ids });
  const by_verdict = Object.fromEntries((["supports", "refutes", "insufficient"] as const).map(v => [v, Object.fromEntries((["follow", "skip", "wait"] as const).map(a => [a, counted(chains.filter(c => c.verdict === v && c.action === a).map(c => c.round_id))]))]));
  const families = ["relative_strength", "steady_trend", "volume_surge"] as const;
  const by_family = Object.fromEntries(families.map(f => [f, counted(chains.filter(c => c.action === "follow" && c.pattern_family === f).map(c => c.round_id))]));
  return HabitsSchema.parse({
    action_profile: { aligned: { ...counted(chains.filter(c => c.aligned).map(c => c.round_id)), of: chains.length }, diverged: counted(chains.filter(c => !c.aligned).map(c => c.round_id)), by_verdict, follow_total: counted(chains.filter(c => c.action === "follow").map(c => c.round_id)), scope: "本局习惯：只描述选择，不推断风险偏好。认可一个说法但先不跟，同样是合理的选择。" },
    backed_families: { by_family, frequent: families.filter(f => by_family[f]!.count >= 2), coverage_limited: families.filter(f => rounds.filter(r => r.bet_family === f).length < 2) },
    decision_chains: chains,
    trading_view: [],
  });
}
