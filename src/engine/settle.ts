// Settlement is isolated from capability inference. Unexecutable windows are
// explicitly refunded/skipped, never silently treated as observed zero returns.
import { SettlementSchema, type Settlement } from "../../contracts/outputs";
import type { Action, RoundId } from "./types";
export const START_TOKENS = 100;
export const STAKE = 30;
const round2 = (x: number) => Math.round(x * 100) / 100;
export interface Outcome { value: number | null; note?: string }
export type OutcomeInput = number | null | Outcome;
export type Outcomes = Record<string, OutcomeInput>;
export interface ExecutionWindow { open_t1?: number | null; close_t20?: number | null; t1_suspended?: boolean; t20_suspended?: boolean; t1_open_at_limit_up?: boolean; t20_at_limit_down?: boolean; return_open_t1_to_close_t20?: number | null }
export function settlementOutcome(w: ExecutionWindow): Outcome {
  const reason = w.t1_suspended ? "T+1 停牌" : w.t20_suspended ? "T+20 停牌" : w.t1_open_at_limit_up ? "T+1 开盘涨停，不能保证执行" : w.t20_at_limit_down ? "T+20 跌停，不能保证退出" : !w.open_t1 || !Number.isFinite(w.open_t1) || w.open_t1 <= 0 ? "缺少有效 T+1 执行价" : !w.close_t20 || !Number.isFinite(w.close_t20) || w.close_t20 <= 0 ? "缺少有效 T+20 退出价" : null;
  return reason ? {value: null, note: `${reason}；按本游戏口径，本轮不结算，原有代币不变。`} : {value: w.close_t20! / w.open_t1! - 1};
}
export function settleRound(round_id: string, action: Action, input: OutcomeInput): Settlement["rounds"][number] {
  const o = typeof input === "object" && input !== null ? input : {value: input};
  const valid = o.value !== null && Number.isFinite(o.value);
  const hypothetical_delta = valid ? round2(STAKE * o.value!) : 0;
  return { round_id: round_id as RoundId, action, chips_delta: action === "follow" ? hypothetical_delta : 0, hypothetical_delta,
    ...(!valid ? {settlement_note: o.note ?? "执行或退出数据缺失；本轮不结算，原有代币不变。"} : o.note ? {settlement_note:o.note} : {}) };
}
export function settle(decisions: { round_id: string; action: Action | null }[], outcomes: Outcomes, counterfactual = false): Settlement {
  const rounds = decisions.flatMap(d => d.action === null ? [] : [settleRound(d.round_id, d.action, outcomes[d.round_id] ?? null)]);
  return SettlementSchema.parse({start: START_TOKENS, rounds, balance: round2(START_TOKENS + rounds.reduce((s,r)=>s+r.chips_delta,0)), counterfactual});
}
export function flipOutcomes(outcomes: Outcomes, rounds: string[]): Outcomes {
  const out = {...outcomes};
  for (const id of rounds) {
    const o=out[id];
    if (typeof o === "number") out[id] = -o;
    else if (o && o.value !== null) out[id] = {...o,value:-o.value};
  }
  return out;
}
