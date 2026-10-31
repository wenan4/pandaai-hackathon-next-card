// PRD v0.3：情境观察、任务证据和推荐进度分别计算；不读取交易收益。
import { collectRound, type RoundRecord } from "./rounds";
import type { AssistLevel, Card, GameEvent, ObsId, ObsInstance, Observation, Profile, Progress, RoundConfig, Species } from "./types";

export interface EngineConfig {
  rules_version: string;
  rounds: RoundConfig[];
  understanding_answers: string[];
}
export type JudgementId = "consistent" | "unchecked" | "mismatch" | "future_reserved" | "sample_reserved" | "assisted" | "understanding";

function understandingUnclear(rec: RoundRecord, cfg: EngineConfig): boolean {
  return rec.followup?.answer != null && cfg.understanding_answers.includes(rec.followup.answer);
}
function directionalOn(rec: RoundRecord, card: Card): boolean {
  return rec.explains.some((x) => x.card === card && x.kind === "directional");
}
export function roundJudgement(events: readonly GameEvent[], round: RoundConfig, cfg: EngineConfig): JudgementId | null {
  const rec = collectRound(events, round);
  if (rec.final === undefined) return null;
  if (understandingUnclear(rec, cfg)) return "understanding";
  if (!round.key_card || !rec.flips.includes(round.key_card)) return "unchecked";
  if (rec.final !== round.verdict) return "mismatch";
  if (directionalOn(rec, round.key_card)) return "assisted";
  return round.horizon === "future" ? "future_reserved" : round.horizon === "sample" ? "sample_reserved" : "consistent";
}
function instance(rec: RoundRecord, rule: string, outcome: ObsInstance["outcome"], assisted = false): ObsInstance {
  return { context: rec.round_id, rule, outcome, assisted, event_ids: [...rec.event_ids.flips, rec.event_ids.final!].filter(Boolean) };
}
function keyCardInstance(obs: "O1" | "O2", rec: RoundRecord, round: RoundConfig, unclear: boolean): ObsInstance {
  if (unclear) return instance(rec, `${obs}-c`, "uncertain");
  if (!rec.flips.includes(round.key_card!)) {
    const asksForEvidence = (obs === "O1" ? /对照|和别的比一比/ : /历史/).test(rec.followup?.answer ?? "");
    return instance(rec, `${obs}-${asksForEvidence ? "f" : "g"}`, asksForEvidence ? "uncertain" : "unchecked");
  }
  if (rec.final === round.verdict) return instance(rec, `${obs}-a`, "consistent", directionalOn(rec, round.key_card!));
  return instance(rec, `${obs}-${rec.final === "insufficient" ? "e" : "b"}`, "conflict");
}
function taskInstances(events: readonly GameEvent[], obs: "O1" | "O2", step: number): ObsInstance[] {
  let exposed = false;
  const seen = new Set<string>();
  const out: ObsInstance[] = [];
  for (const e of events) {
    if (e.stage !== "in_task") continue;
    if (e.type === "assist_exposure" && e.payload.task === "A" && e.payload.step === step) exposed = true;
    if (e.type !== "task_step" || e.payload.task !== "A" || e.payload.step !== step || e.payload.phase !== "submit") continue;
    const p = e.payload;
    const key = JSON.stringify([p.answer, p.aligned, p.window_extended]);
    if (seen.has(key)) continue;
    seen.add(key);
    const ok = p.correct === true && (step === 1 ? p.aligned === true : p.window_extended === true);
    out.push({ context: `taskA-${step}`, rule: `${obs}-${ok ? "t" : "r"}`, outcome: ok ? "consistent" : "recorded", assisted: exposed || out.length > 0, event_ids: [e.event_id] });
    // 首次成功是这个具体情境的唯一完成证据；重开不能新增独立证据。
    if (ok) break;
  }
  return out;
}
/** 任务 B 第 3 步的提交：与数据一致记 O5-t，否则只记录。看过提示、示范或答案反馈后，同题不再算独立完成。 */
function taskBInstances(events: readonly GameEvent[]): ObsInstance[] {
  let exposed = false;
  const seen = new Set<string>();
  const out: ObsInstance[] = [];
  for (const e of events) {
    if (e.stage !== "in_task") continue;
    if (e.type === "assist_exposure" && e.payload.task === "B") exposed = true;
    if (e.type !== "task_step" || e.payload.task !== "B" || e.payload.step !== 3 || e.payload.phase !== "submit") continue;
    if (seen.has(e.payload.answer)) continue;
    seen.add(e.payload.answer);
    const ok = e.payload.correct === true;
    out.push({ context: "taskB", rule: `O5-${ok ? "t" : "r"}`, outcome: ok ? "consistent" : "recorded", assisted: exposed || out.length > 0, event_ids: [e.event_id] });
    if (ok) break;
  }
  return out;
}
function aggregate(id: ObsId, instances: ObsInstance[]): Observation {
  const independent = instances.filter((i) => i.outcome === "consistent" && !i.assisted);
  const helped = instances.filter((i) => i.outcome === "consistent" && i.assisted);
  const conflicts = instances.filter((i) => i.outcome === "conflict");
  const understanding = instances.some((i) => i.rule === `${id}-c`);
  let aggregation: Observation["aggregation"];
  let status: Observation["status"];
  if (independent.length >= 2 && independent.length === instances.length) { aggregation = "repeated"; status = "observed"; }
  else if (independent.length && conflicts.length) { aggregation = "mixed"; status = "uncertain"; }
  else if (independent.length) { aggregation = "single"; status = "observed"; }
  else if (helped.length) { aggregation = "assisted"; status = "assisted"; }
  else if (!instances.length || instances.every((i) => i.outcome === "unchecked")) { aggregation = "none"; status = "not_observed"; }
  else { aggregation = "uncertain"; status = "uncertain"; }
  const summaries = { repeated: "两次一致", mixed: "两个情境表现不同，新情境仍待确认", single: "只见一次", assisted: "在提示下完成", none: "未观察到", uncertain: understanding ? "理解待确认" : "尚待确认", partial: "" };
  let summary = summaries[aggregation];
  if (instances.length === 1) { aggregation = "partial"; summary += "；还没有第二个情境可以对照"; }
  return { id, status, aggregation, summary, instances, understanding_unclear: understanding };
}
function revisionObservation(instances: ObsInstance[]): Observation {
  const changed = instances.filter((i) => i.outcome === "consistent");
  const independent = changed.filter((i) => !i.assisted).length;
  const assisted = changed.length - independent;
  return {
    id: "O4", status: independent ? "observed" : assisted ? "assisted" : instances.length ? "not_observed" : "uncertain",
    aggregation: independent ? "single" : assisted ? "assisted" : "uncertain",
    summary: instances.length ? `本局 ${instances.length} 次可比较情境中调整 ${changed.length} 次（独立 ${independent}，有帮助 ${assisted}）` : "这局没有可比较的改判机会",
    instances, understanding_unclear: false,
  };
}
function species(records: RoundRecord[], rounds: RoundConfig[]): Profile["style"] {
  const counts: Record<Card, number> = { fox: 0, elephant: 0, leopard: 0 };
  const first_flips: Profile["style"]["first_flips"] = [];
  records.forEach((rec, i) => {
    const card = rec.flips[0];
    if (!card) return;
    const counted = card !== rounds[i]!.named_card;
    first_flips.push({ round_id: rec.round_id, card, counted });
    if (counted) counts[card]++;
  });
  const total = counts.fox + counts.elephant + counts.leopard;
  const max = Math.max(...Object.values(counts));
  const leaders = (Object.keys(counts) as Card[]).filter((c) => counts[c] === max);
  const sp: Species = total < 2 ? "unknown" : max >= 2 && leaders.length === 1 ? leaders[0]! : "mixed";
  return { species: sp, first_flips, counts };
}
function helpPreference(events: readonly GameEvent[], records: RoundRecord[], understanding: boolean, repeated: boolean): Profile["help_preference"] {
  const explain_count = records.reduce((n, r) => n + r.explains.filter((x) => x.kind === "neutral").length, 0);
  let userLevel: AssistLevel | null = null;
  for (const e of events) if (e.stage === "in_task" && e.type === "assist_switch") userLevel = e.payload.level;
  if (userLevel) return { level: userLevel, source: "user", explain_count };
  if (understanding) return { level: "guide", source: "understanding", explain_count };
  return { level: explain_count >= 3 ? "guide" : explain_count === 0 && repeated ? "self" : "hint", source: "explain_count", explain_count };
}
export function evaluate(events: readonly GameEvent[], cfg: EngineConfig): { profile: Profile; progress: Progress } {
  const records = cfg.rounds.map((r) => collectRound(events, r));
  const complete = records.map((rec, i) => ({ rec, round: cfg.rounds[i]! })).filter(({ rec }) => rec.final !== undefined);
  const o1: ObsInstance[] = [], o2: ObsInstance[] = [], o3: ObsInstance[] = [], o4: ObsInstance[] = [];
  let o3d = false, anyUnderstanding = false;
  const decisive = complete.some(({ rec, round }) => round.horizon === "past" && rec.final === round.verdict && !understandingUnclear(rec, cfg));
  for (const { rec, round } of complete) {
    const unclear = understandingUnclear(rec, cfg);
    anyUnderstanding ||= unclear;
    if (round.key_card === "fox") o1.push(keyCardInstance("O1", rec, round, unclear));
    if (round.key_card === "elephant") o2.push(keyCardInstance("O2", rec, round, unclear));
    // O3 的情境：R3（未来还没发生）与 R6（历史样本太少）；两者都不算“可判定情境”
    if (round.horizon !== "past") {
      const seen = rec.flips.includes("leopard");
      if (unclear) o3.push(instance(rec, "O3-c", "uncertain"));
      else if (seen && rec.final === "insufficient") o3.push(instance(rec, "O3-a", decisive ? "consistent" : "uncertain", directionalOn(rec, "leopard")));
      else if (rec.final === "insufficient") o3.push(instance(rec, "O3-b", "uncertain"));
      else if (seen) { o3d = true; o3.push(instance(rec, "O3-d", "conflict")); }
      else {
        const asksForEvidence = /数据|验证/.test(rec.followup?.answer ?? "");
        o3.push(instance(rec, asksForEvidence ? "O3-e" : "O3-g", asksForEvidence ? "uncertain" : "unchecked"));
      }
    }
    if (!unclear && round.key_card && rec.flips.includes(round.key_card) && rec.initial && rec.initial !== "unsure" && rec.initial !== round.verdict) {
      const changed = rec.final === round.verdict;
      const inst = instance(rec, changed ? "O4-a" : "O4-c", changed ? "consistent" : "unchecked", changed && directionalOn(rec, round.key_card));
      inst.event_ids.unshift(rec.event_ids.initial!);
      o4.push(inst);
    }
  }
  const task_observations = { O1: taskInstances(events, "O1", 1), O2: taskInstances(events, "O2", 2), O5: taskBInstances(events) };
  // 任务中的先猜后验也使用同一命题；只有第一次成功的提交可提供一条修正证据。
  for (const [id, step] of [["O1", 1], ["O2", 2]] as const) {
    const completion = task_observations[id].find((i) => i.outcome === "consistent");
    if (!completion) continue;
    const at = events.findIndex((e) => e.event_id === completion.event_ids[0]);
    const guess = events.slice(0, at).find((e) => e.stage === "in_task" && e.type === "task_step" && e.payload.task === "A" && e.payload.step === step && e.payload.phase === "guess");
    const submitted = events[at];
    if (guess?.type === "task_step" && submitted?.type === "task_step" && !["insufficient", "unsure"].includes(guess.payload.answer) && guess.payload.answer !== submitted.payload.answer) {
      o4.push({ ...completion, rule: "O4-a", event_ids: [guess.event_id, ...completion.event_ids] });
    }
  }
  // 任务 B 同理（PRD v0.3 §5.3）：先猜“会高出”而数据两段都没达到，或先猜“不会”而两段都达到，之后答对，算一次修正。
  // 只有一段达到、样本不够，以及先猜“说不准”，都不算明确冲突。
  const doneB = task_observations.O5.find((i) => i.outcome === "consistent");
  if (doneB) {
    const at = events.findIndex((e) => e.event_id === doneB.event_ids[0]);
    const guess = events.slice(0, at).find((e) => e.stage === "in_task" && e.type === "task_step" && e.payload.task === "B" && e.payload.step === 1 && e.payload.phase === "guess");
    const submitted = events[at];
    if (guess?.type === "task_step" && submitted?.type === "task_step") {
      const answer = submitted.payload.answer.split("|")[0];
      const conflict = (guess.payload.answer === "higher" && answer === "no_observed_advantage") || (guess.payload.answer === "not_higher" && answer === "both_segments");
      if (conflict) o4.push({ ...doneB, rule: "O4-a", event_ids: [guess.event_id, ...doneB.event_ids] });
    }
  }
  const observations = { O1: aggregate("O1", o1), O2: aggregate("O2", o2), O3: aggregate("O3", o3), O4: revisionObservation(o4) };
  if (!decisive && o3.some((i) => i.rule === "O3-a")) observations.O3.summary = "尚未在可核对情境里作出与证据一致的明确判断";
  const taskA_steps_done = ([1, 2] as const).filter((step) => task_observations[step === 1 ? "O1" : "O2"].some((i) => i.outcome === "consistent"));
  const S1 = observations.O1.aggregation === "repeated" || taskA_steps_done.includes(1);
  const S2 = observations.O2.aggregation === "repeated" || taskA_steps_done.includes(2);
  const profile: Profile = {
    rules_version: cfg.rules_version, observations, task_observations, style: species(records, cfg.rounds),
    help_preference: helpPreference(events, records, anyUnderstanding, observations.O1.aggregation === "repeated" && observations.O2.aggregation === "repeated"), flags: { o3d },
  };
  return { profile, progress: { K: [observations.O1, observations.O2].filter((o) => o.aggregation === "repeated").length, S1, S2, rounds_completed: complete.length, taskA_steps_done, taskB_done: task_observations.O5.some((i) => i.outcome === "consistent"), ready_for_B: S1 && S2 } };
}
