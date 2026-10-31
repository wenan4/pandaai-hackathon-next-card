import { eventsFromSpecs, type RoundSpec } from "../engine/paths";
import type { GameEvent, RoundConfig } from "../engine/types";

/** 仅替换可编辑的轮次事件，保留真实事件编号、任务历史及帮助暴露。 */
export function forkEvents(original: readonly GameEvent[], specs: RoundSpec[], rounds: RoundConfig[]): GameEvent[] {
  const replacements = new Map<string, GameEvent[]>();
  for (const spec of specs) {
    const prior = original.filter((e) => e.round_id === spec.round_id && e.stage === "pre_reveal");
    const generated = eventsFromSpecs([spec], rounds, prior[0]?.session_id ?? "judge", prior[0]?.content_version ?? "v0.3");
    const replacement = generated.map((e) => {
      const old = prior.find((p) => p.type === e.type && (!("card" in e.payload) || ("card" in p.payload && p.payload.card === e.payload.card)));
      return { ...e, event_id: old?.event_id ?? `fork:${e.event_id}` } as GameEvent;
    });
    replacement.push(...prior.filter((e) => e.type === "self_note"));
    replacements.set(spec.round_id, replacement);
  }
  const out: GameEvent[] = [];
  const emitted = new Set<string>();
  for (const e of original) {
    const replacement = replacements.get(e.round_id);
    if (e.stage !== "pre_reveal" || !replacement) { out.push(e); continue; }
    if (!emitted.has(e.round_id)) { out.push(...replacement); emitted.add(e.round_id); }
  }
  return out;
}

export function changeOnlyActions(events: readonly GameEvent[]): GameEvent[] {
  return events.map((e) => e.type === "decision" ? { ...e, payload: { action: e.payload.action === "follow" ? "skip" : "follow" } } : e);
}
