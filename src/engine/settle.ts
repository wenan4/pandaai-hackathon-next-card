// 筹码结算，与画像隔离：evaluate / recommend 不得导入本模块（见 isolation.test.ts）。
// 简化模拟：T+1 开盘进入、T+20 收盘退出，收益 = C[T+20] / O[T+1] - 1，无费用、滑点和成交保证。
import type { Action } from "./types";

export const START_TOKENS = 100;
export const STAKE = 30;

const round2 = (x: number) => Math.round(x * 100) / 100;

export interface RoundSettlement {
  round_id: string;
  action: Action | null;
  /** 本轮余额变动：只有“跟”才变动 */
  delta: number;
  /** 假如跟了：±X（不跟 / 先看看时展示） */
  hypothetical: number;
  ret: number | null;
}

export interface Settlement {
  rounds: RoundSettlement[];
  balance: number;
}

export function settleRound(round_id: string, action: Action | null, ret: number | null): RoundSettlement {
  if (ret === null || !Number.isFinite(ret)) return { round_id, action, delta: 0, hypothetical: 0, ret: null };
  const hypothetical = round2(STAKE * ret);
  return { round_id, action, delta: action === "follow" ? hypothetical : 0, hypothetical, ret };
}

export function settle(decisions: { round_id: string; action: Action | null }[], outcomes: Record<string, number | null>): Settlement {
  const rounds = decisions.map((d) => settleRound(d.round_id, d.action, outcomes[d.round_id] ?? null));
  return { rounds, balance: round2(START_TOKENS + rounds.reduce((s, r) => s + r.delta, 0)) };
}

/** 评委面板的模拟反例：把指定轮次的后续涨跌翻转。 */
export function flipOutcomes(outcomes: Record<string, number | null>, rounds: string[]): Record<string, number | null> {
  const out = { ...outcomes };
  for (const r of rounds) if (out[r] != null) out[r] = -out[r]!;
  return out;
}
