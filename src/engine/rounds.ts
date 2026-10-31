// 事件预处理：按轮整理揭晓前的有效事件。纯函数。
import type { Action, Card, ExplainKind, FollowupId, GameEvent, Reaction, RoundConfig, Verdict } from "./types";

export const MAX_FLIPS = 2;

export interface RoundRecord {
  round_id: string;
  initial?: Reaction;
  /** 去重后的翻牌顺序，最多 MAX_FLIPS 张 */
  flips: Card[];
  explains: { card: Card; kind: ExplainKind; content_id: string; event_id: string }[];
  final?: Verdict;
  action?: Action;
  followup?: { question: FollowupId; answer: string | null };
  event_ids: { initial?: string; flips: string[]; final?: string; action?: string; followup?: string };
}

/**
 * 只读取揭晓前（pre_reveal）的事件：揭晓后补全的牌不算主动查证。
 * 同一张牌重复翻只算一次；同一段解释重复打开只算一次；最终判断、行动、追问以第一次为准（锁定）。
 */
export function collectRound(events: readonly GameEvent[], cfg: RoundConfig): RoundRecord {
  const rec: RoundRecord = { round_id: cfg.round_id, flips: [], explains: [], event_ids: { flips: [] } };
  const seenExplain = new Set<string>();
  for (const e of events) {
    if (e.round_id !== cfg.round_id || e.stage !== "pre_reveal") continue;
    switch (e.type) {
      case "initial_reaction":
        if (rec.initial === undefined && rec.flips.length === 0) {
          rec.initial = e.payload.reaction;
          rec.event_ids.initial = e.event_id;
        }
        break;
      case "card_flip":
        if (rec.final === undefined && !rec.flips.includes(e.payload.card) && rec.flips.length < MAX_FLIPS) {
          rec.flips.push(e.payload.card);
          rec.event_ids.flips.push(e.event_id);
        }
        break;
      case "explain_open":
        if (rec.final === undefined && !seenExplain.has(e.payload.content_id)) {
          seenExplain.add(e.payload.content_id);
          rec.explains.push({ card: e.payload.card, kind: e.payload.kind, content_id: e.payload.content_id, event_id: e.event_id });
        }
        break;
      case "final_assessment":
        if (rec.final === undefined) {
          rec.final = e.payload.verdict;
          rec.event_ids.final = e.event_id;
        }
        break;
      case "decision":
        if (rec.action === undefined && rec.final !== undefined) {
          rec.action = e.payload.action;
          rec.event_ids.action = e.event_id;
        }
        break;
      case "followup_answer":
        if (rec.followup === undefined) {
          rec.followup = { question: e.payload.question, answer: e.payload.answer };
          rec.event_ids.followup = e.event_id;
        }
        break;
      default:
        break;
    }
  }
  return rec;
}

/**
 * 追问最多一次，按顺序触发：
 * 1. 最终判断“证据不足” → 还缺什么；
 * 2. 翻过关键牌，且最终判断与证据结论不一致 → 主要依据什么；
 * 3. 行动为“先看看” → 在等什么。
 * 不因行动与判断不同而追问。
 */
export function followupFor(rec: Pick<RoundRecord, "final" | "flips" | "action">, cfg: RoundConfig): FollowupId | null {
  if (rec.final === undefined) return null;
  if (rec.final === "insufficient") return "missing";
  if (cfg.key_card && rec.flips.includes(cfg.key_card) && rec.final !== cfg.verdict) return "basis";
  if (rec.action === "wait") return "waiting";
  return null;
}
