import { createRun, pendingMarketStep, reduceRun } from './engine';
import { loadMarketStage } from './market';
import type { CalibrationContext } from './research';
import type { CardId, MarketStage, Run } from './types';

type CombatStep = CardId | 'end';

/**
 * The script is an explicitly simulated player policy, not a user record.
 * Each step is validated and executed by the same reducer as the game.
 */
function playSequence(initial: Run, steps: CombatStep[]): Run {
  let run = initial;
  for (const step of steps) {
    if (step === 'end') { run = reduceRun(run, { type: 'end-turn' }); continue; }
    const battle = run.battle;
    const card = run.deck.find((item) => item.cardId === step && battle?.hand.includes(item.instanceId));
    if (!card) throw new Error(`模拟路径当前无法打出 ${step}，请检查游戏配置。`);
    run = reduceRun(run, { type: 'play-card', cardInstanceId: card.instanceId });
  }
  return run;
}

async function deliverExpected(run: Run, stage: MarketStage): Promise<Run> {
  const pending = pendingMarketStep(run);
  if (!pending || pending.stage !== stage) throw new Error(`模拟路径未到达预期的 ${stage} 报价。`);
  const quote = await loadMarketStage(pending.caseId, pending.stage, pending.unlocked);
  return reduceRun(run, { type: 'apply-quote', quote });
}

/**
 * Derive the actual N4 constraints for an explicitly simulated comparison.
 * `priorExposure: false` is an as-if assumption for this demo, never a claim
 * about the person using it. The caller must label the entire result simulated
 * and must not write these choices or answers to a real research profile.
 */
export function calibrationDemoContext(run: Run): CalibrationContext {
  const canChoose = run.source === 'demo' && run.caseId === 'lantern-d' && run.status === 'active'
    && run.node === 'N4' && run.phase === 'camp' && run.camp?.decision === 'not-submitted'
    && run.market.lastQuote?.step === 't1' && !run.market.pending && !run.market.order
    && BigInt(run.wallet.shareUnits) > 0n && run.market.referenceValueCents !== null;
  if (!canChoose || run.market.referenceValueCents === null) throw new Error('模拟必须停在 N4 参考价展示后、回收选择之前。');
  const sameShareBasis = !run.history.some((item) => item.action === 'submit-redemption');
  if (!sameShareBasis || run.wallet.investedCents !== 2000) throw new Error('模拟参与金额或份额口径不符合预先条件。');
  const loss = (run.wallet.investedCents - run.market.referenceValueCents) / run.wallet.investedCents;
  if (loss < 0.1 || loss > 0.2 || run.wallet.cashCents < 1000 || run.hp * 2 < run.maxHp) throw new Error('此行情或旅程状态不满足模拟对照的条件。');
  return {
    caseId: run.caseId, node: run.node, amountCents: run.wallet.investedCents,
    referenceValueCents: run.market.referenceValueCents, cashCents: run.wallet.cashCents,
    health: run.hp, maxHealth: run.maxHp, priorExposure: false,
    autonomousChoice: true, pendingSettlement: false, forcedOrAutomatic: false,
    changedGoalOrUnderstanding: false, afterCloseBeforeExecution: true, sameShareBasis,
  };
}

/**
 * Reach lantern-d N4 naturally, stopping before the redemption decision.
 * No forecast, feeling, response or future execution quote is fabricated.
 */
export async function makeCalibrationDemo(): Promise<Run> {
  let run = createRun({ seed: 104, caseId: 'lantern-d', source: 'demo', observationEnabled: true });
  run = playSequence(run, [
    'C02', 'C03', 'C01', 'end',
    'C01', 'C04', 'C02', 'C02', 'end',
    'C02', 'end', 'C01',
  ]);
  run = reduceRun(run, { type: 'choose-reward', cardId: 'C07' });
  run = reduceRun(run, { type: 'buy-card', cardId: 'C08' });
  run = reduceRun(run, { type: 'submit-entry', amountCents: 2000 });
  run = reduceRun(run, { type: 'continue' });
  run = await deliverExpected(run, 'entry');
  run = reduceRun(run, { type: 'choose-route', enemyId: 'moss' });
  run = playSequence(run, [
    'C05', 'C04', 'C08', 'C07', 'C01', 'end',
    'C02', 'C06', 'end',
    'C02', 'C01', 'C01', 'C06', 'end',
    'C07',
  ]);
  run = reduceRun(run, { type: 'choose-reward', cardId: 'C08' });
  run = await deliverExpected(run, 't1');
  calibrationDemoContext(run);
  return run;
}
