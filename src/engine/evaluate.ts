// evaluate(events, config) → { profile, progress }
// 纯函数：同版本同输入必得同输出；不读取筹码、行动结果和事后收益（本模块不导入 settle）。
// 规则编号为暂定版，PRD v0.3 规则表到位后对齐。
import { collectRound, type RoundRecord } from "./rounds";
import type {
  AssistLevel,
  Card,
  GameEvent,
  ObsId,
  ObsInstance,
  Observation,
  Profile,
  Progress,
  RoundConfig,
  Species,
} from "./types";

export interface EngineConfig {
  rules_version: string;
  rounds: RoundConfig[];
  /** 追问里表示“理解有困难”的答案 */
  understanding_answers: string[];
}

export type JudgementId = "consistent" | "unchecked" | "mismatch" | "future_reserved" | "assisted" | "understanding";

function understandingUnclear(rec: RoundRecord, cfg: EngineConfig): boolean {
  return rec.followup?.answer != null && cfg.understanding_answers.includes(rec.followup.answer);
}

function directionalOn(rec: RoundRecord, card: Card): boolean {
  return rec.explains.some((x) => x.card === card && x.kind === "directional");
}

/** 揭晓页判断线：只看揭晓前的证据、最终判断与帮助暴露。 */
export function roundJudgement(events: readonly GameEvent[], round: RoundConfig, cfg: EngineConfig): JudgementId | null {
  const rec = collectRound(events, round);
  if (rec.final === undefined) return null;
  if (understandingUnclear(rec, cfg)) return "understanding";
  if (round.horizon === "future") return rec.final === "insufficient" ? "future_reserved" : "mismatch";
  if (!round.key_card || !rec.flips.includes(round.key_card)) return "unchecked";
  if (rec.final !== round.verdict) return "mismatch";
  return directionalOn(rec, round.key_card) ? "assisted" : "consistent";
}

function keyCardInstance(obs: "O1" | "O2", rec: RoundRecord, round: RoundConfig): ObsInstance | null {
  const card = round.key_card!;
  const ids = [...rec.event_ids.flips, rec.event_ids.final!].filter(Boolean) as string[];
  if (!rec.flips.includes(card)) {
    // 猜中方向不算完成查证
    return { context: round.round_id, rule: `${obs}-c`, outcome: "unchecked", assisted: false, event_ids: ids };
  }
  if (rec.final === round.verdict) {
    return { context: round.round_id, rule: `${obs}-a`, outcome: "consistent", assisted: directionalOn(rec, card), event_ids: ids };
  }
  return { context: round.round_id, rule: `${obs}-b`, outcome: "conflict", assisted: false, event_ids: ids };
}

function taskInstances(events: readonly GameEvent[], obs: "O1" | "O2", step: number): ObsInstance[] {
  // 独立与否由事件推导：提交前看过提示、示范或答案反馈就算有帮助，不看提交时的档位
  let exposed = false;
  const seenAnswers = new Set<string>();
  const out: ObsInstance[] = [];
  for (const e of events) {
    if (e.type === "assist_exposure" && e.payload.task === "A" && e.payload.step === step) exposed = true;
    if (e.type === "task_step" && e.payload.task === "A" && e.payload.step === step && e.payload.phase === "submit") {
      if (seenAnswers.has(e.payload.answer)) continue; // 重复提交同一答案不增加证据
      seenAnswers.add(e.payload.answer);
      const ok = e.payload.correct === true && (step !== 1 || e.payload.aligned === true);
      out.push({
        context: `taskA-${step}`,
        rule: ok ? `${obs}-t` : `${obs}-r`,
        // 提交与数据不一致只记录，不贴标签；之后的重试按“有帮助”记录
        outcome: ok ? "consistent" : "recorded",
        assisted: exposed || out.length > 0,
        event_ids: [e.event_id],
      });
      if (ok) break;
    }
  }
  return out;
}

function aggregate(id: ObsId, instances: ObsInstance[], understanding = false): Observation {
  const counted = instances.filter((i) => i.outcome === "consistent" || i.outcome === "conflict");
  const consistent = counted.filter((i) => i.outcome === "consistent");
  const conflicts = counted.filter((i) => i.outcome === "conflict");
  let status: Observation["status"];
  let summary: string;
  if (understanding) {
    status = "uncertain";
    summary = "理解待确认";
  } else if (counted.length === 0) {
    status = "not_observed";
    summary = "未观察到";
  } else if (conflicts.length && consistent.length) {
    status = "uncertain";
    summary = "有冲突";
  } else if (conflicts.length) {
    status = "uncertain";
    summary = conflicts.length === 1 ? "有一次不一致" : "多次不一致";
  } else {
    status = consistent.some((i) => !i.assisted) ? "observed" : "assisted";
    const contexts = new Set(consistent.map((i) => i.context));
    summary = contexts.size >= 2 ? "两次一致" : "只见一次";
  }
  return { id, status, summary, instances, understanding_unclear: understanding };
}

function species(records: RoundRecord[], rounds: RoundConfig[]): Profile["style"] {
  const counts: Record<Card, number> = { fox: 0, elephant: 0, leopard: 0 };
  const first_flips: Profile["style"]["first_flips"] = [];
  records.forEach((rec, i) => {
    const card = rec.flips[0];
    if (!card) return;
    const counted = card !== rounds[i]!.named_card;
    first_flips.push({ round_id: rec.round_id, card, counted });
    if (counted) counts[card] += 1;
  });
  const total = counts.fox + counts.elephant + counts.leopard;
  const max = Math.max(counts.fox, counts.elephant, counts.leopard);
  const leaders = (Object.keys(counts) as Card[]).filter((c) => counts[c] === max);
  let sp: Species;
  if (total < 2) sp = "unknown";
  else if (max >= 2 && leaders.length === 1) sp = leaders[0]!;
  else sp = "mixed";
  return { species: sp, first_flips, counts };
}

function helpPreference(events: readonly GameEvent[], records: RoundRecord[], understanding: boolean): Profile["help_preference"] {
  const explain_count = records.reduce((n, r) => n + r.explains.length, 0);
  let userLevel: AssistLevel | null = null;
  for (const e of events) if (e.type === "assist_switch") userLevel = e.payload.level;
  if (userLevel) return { level: userLevel, source: "user", explain_count };
  if (understanding) return { level: "guide", source: "understanding", explain_count };
  const level: AssistLevel = explain_count === 0 ? "self" : explain_count === 1 ? "hint" : "guide";
  return { level, source: "explain_count", explain_count };
}

export function evaluate(events: readonly GameEvent[], cfg: EngineConfig): { profile: Profile; progress: Progress } {
  const records = cfg.rounds.map((r) => collectRound(events, r));
  const complete = records.map((rec, i) => ({ rec, round: cfg.rounds[i]! })).filter(({ rec }) => rec.final !== undefined);

  const o1: ObsInstance[] = [];
  const o2: ObsInstance[] = [];
  const o3: ObsInstance[] = [];
  const o4: ObsInstance[] = [];
  let o3d = false;
  let o3Understanding = false;
  let anyUnderstanding = false;

  for (const { rec, round } of complete) {
    const unclear = understandingUnclear(rec, cfg);
    anyUnderstanding ||= unclear;
    if (round.key_card === "fox") {
      const inst = keyCardInstance("O1", rec, round);
      if (inst) o1.push(inst);
    }
    if (round.key_card === "elephant") {
      const inst = keyCardInstance("O2", rec, round);
      if (inst) o2.push(inst);
    }
    if (round.horizon === "future") {
      o3Understanding ||= unclear;
      const ids = [rec.event_ids.final!, ...rec.event_ids.flips];
      if (rec.final === "insufficient") {
        o3.push({ context: round.round_id, rule: "O3-a", outcome: "consistent", assisted: false, event_ids: ids });
      } else if (rec.flips.includes("leopard")) {
        o3d = true; // 翻过近期量价并对未来作了明确方向判断
        o3.push({ context: round.round_id, rule: "O3-d", outcome: "conflict", assisted: false, event_ids: ids });
      } else {
        o3.push({ context: round.round_id, rule: "O3-b", outcome: "conflict", assisted: false, event_ids: ids });
      }
    }
    if (rec.initial && rec.initial !== "unsure" && rec.flips.length > 0) {
      const ids = [rec.event_ids.initial!, ...rec.event_ids.flips, rec.event_ids.final!];
      if (rec.initial !== rec.final && rec.final === round.verdict) {
        o4.push({ context: round.round_id, rule: "O4-a", outcome: "consistent", assisted: round.key_card ? directionalOn(rec, round.key_card) : false, event_ids: ids });
      } else if (rec.initial === rec.final && rec.final !== round.verdict && round.key_card && rec.flips.includes(round.key_card)) {
        // 看到了相反的关键证据却没有调整
        o4.push({ context: round.round_id, rule: "O4-c", outcome: "conflict", assisted: false, event_ids: ids });
      }
    }
  }

  o1.push(...taskInstances(events, "O1", 1));
  o2.push(...taskInstances(events, "O2", 2));

  const O3 = aggregate("O3", o3, o3Understanding);
  // 只在未来型轮次选“证据不足”不足以确认：还要在至少一个可判定轮次给出明确判断
  const decisive = complete.some(({ rec, round }) => round.horizon === "past" && rec.final !== "insufficient");
  if ((O3.status === "observed" || O3.status === "assisted") && !decisive) {
    O3.status = "uncertain";
    O3.summary = "只选了证据不足";
  }

  const observations = {
    O1: aggregate("O1", o1),
    O2: aggregate("O2", o2),
    O3,
    O4: aggregate("O4", o4),
  };

  const profile: Profile = {
    rules_version: cfg.rules_version,
    observations,
    style: species(records, cfg.rounds),
    help_preference: helpPreference(events, records, anyUnderstanding),
    flags: { o3d },
  };

  const taskA_steps_done = [1, 2].filter((step) =>
    events.some((e) => e.type === "task_step" && e.payload.task === "A" && e.payload.step === step && e.payload.phase === "submit"),
  );
  const independent = (o: Observation) => o.instances.some((i) => i.outcome === "consistent" && !i.assisted);
  const progress: Progress = {
    K: [observations.O1, observations.O2].filter((o) => o.status === "observed").length,
    rounds_completed: complete.length,
    taskA_steps_done,
    taskB_done: events.some((e) => e.type === "task_step" && e.payload.task === "B" && e.payload.phase === "submit"),
    ready_for_B: (independent(observations.O1) || taskA_steps_done.includes(1)) && (independent(observations.O2) || taskA_steps_done.includes(2)),
  };
  return { profile, progress };
}
