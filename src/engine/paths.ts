// 事件工厂与“按字段派生事件”：游戏壳、评委面板、测试共用同一套事件生成逻辑。
import { MAX_FLIPS, followupFor } from "./rounds";
import type { Action, Card, ExplainKind, GameEvent, Reaction, RoundConfig, Stage, Verdict } from "./types";

type PayloadOf<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>["payload"];

export type EventMaker = <T extends GameEvent["type"]>(round_id: string, stage: Stage, type: T, payload: PayloadOf<T>) => GameEvent;

/** 递增编号，不用随机数，保证同输入同输出。 */
export function eventFactory(session_id: string, content_version: string, start = 0): EventMaker {
  let n = start;
  return (round_id, stage, type, payload) =>
    ({ event_id: `e${String(++n).padStart(4, "0")}`, session_id, content_version, stage, round_id, type, payload }) as GameEvent;
}

/** 评委面板可编辑的五个字段（外加第一反应与解释），事件由字段派生。 */
export interface RoundSpec {
  round_id: string;
  initial?: Reaction;
  flips: Card[];
  explains?: { card: Card; kind: ExplainKind }[];
  final: Verdict;
  action: Action;
  /** 追问答案；null 表示跳过。只有触发追问时才生成事件 */
  followupAnswer?: string | null;
}

/**
 * 由字段派生事件。事件编号按“轮次 + 类型 + 牌”固定，改一个字段不会让其他事件的编号漂移，
 * 因此“只改行动”时 evaluate 的输出可以逐字节比较。
 */
export function eventsFromSpecs(specs: RoundSpec[], rounds: RoundConfig[], session_id = "preset", content_version = "v0.3"): GameEvent[] {
  const ev = eventFactory(session_id, content_version);
  const out: GameEvent[] = [];
  const push = (id: string, e: GameEvent) => out.push({ ...e, event_id: id });
  for (const spec of specs) {
    const cfg = rounds.find((r) => r.round_id === spec.round_id);
    if (!cfg) throw new Error(`未知轮次 ${spec.round_id}`);
    if (spec.flips.length > MAX_FLIPS) throw new Error(`${spec.round_id} 翻牌超过 ${MAX_FLIPS} 张`);
    if (new Set(spec.flips).size !== spec.flips.length) throw new Error(`${spec.round_id} 同一张牌翻了两次`);
    const r = spec.round_id;
    if (spec.initial) push(`${r}:initial`, ev(r, "pre_reveal", "initial_reaction", { reaction: spec.initial }));
    for (const card of spec.flips) {
      push(`${r}:flip:${card}`, ev(r, "pre_reveal", "card_flip", { card }));
      for (const x of spec.explains ?? []) {
        if (x.card === card) push(`${r}:explain:${card}`, ev(r, "pre_reveal", "explain_open", { card, content_id: cfg.explain[card].content_id, kind: x.kind }));
      }
    }
    push(`${r}:final`, ev(r, "pre_reveal", "final_assessment", { verdict: spec.final }));
    push(`${r}:decision`, ev(r, "pre_reveal", "decision", { action: spec.action }));
    const q = followupFor({ final: spec.final, flips: spec.flips, action: spec.action }, cfg);
    if (q) push(`${r}:followup`, ev(r, "pre_reveal", "followup_answer", { question: q, answer: spec.followupAnswer ?? null }));
  }
  return out;
}
