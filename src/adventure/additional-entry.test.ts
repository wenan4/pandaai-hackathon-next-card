import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decisionSummary } from './decision-summary';
import { availableActions, canPlayCard, createRun, pendingMarketStep, reduceRun } from './engine';
import { centsForShares, sharesForCents, sharesForPercent } from './ledger';
import { validateResearchProfile } from './profile-validation';
import { emptyResearchProfile, evaluateFundingPractice, fundingQuestionKey, fundingScenarioFromRun, observeJourney, recordCalibrationAction, recordCalibrationFeeling, saveForecast, simulateFundingPlan, submitFunding } from './research';
import { parseAdventureSave } from './save-state';
import type { CardId, MarketQuote, Run } from './types';

type Step = CardId | 'end';
function play(initial: Run, steps: Step[]): Run {
  return steps.reduce((run, step) => {
    if (step === 'end') return reduceRun(run, { type: 'end-turn' });
    const card = run.deck.find((item) => item.cardId === step && run.battle?.hand.includes(item.instanceId));
    if (!card) throw new Error(`无法打出 ${step}`);
    return reduceRun(run, { type: 'play-card', cardInstanceId: card.instanceId });
  }, initial);
}
function quote(run: Run): MarketQuote {
  const pending = pendingMarketStep(run);
  if (!pending) throw new Error('没有待执行报价');
  return JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'adventure', 'stages', pending.caseId, `${pending.stage}.json`), 'utf8')) as MarketQuote;
}
function deliver(run: Run): Run { return reduceRun(run, { type: 'apply-quote', quote: quote(run) }); }
function halfway(amount: number): Run {
  let run = createRun({ seed: 104, caseId: 'lantern-d' });
  run = play(run, ['C02', 'C03', 'C01', 'end', 'C01', 'C04', 'C02', 'C02', 'end', 'C02', 'end', 'C01']);
  run = reduceRun(run, { type: 'choose-reward', cardId: 'C07' });
  run = reduceRun(run, { type: 'buy-card', cardId: 'C08' });
  run = reduceRun(run, { type: 'submit-entry', amountCents: amount });
  run = deliver(reduceRun(run, { type: 'continue' }));
  run = reduceRun(run, { type: 'choose-route', enemyId: 'moss' });
  run = play(run, ['C05', 'C04', 'C08', 'C07', 'C01', 'end', 'C02', 'C06', 'end', 'C02', 'C01', 'C01', 'C06', 'end', 'C07']);
  return deliver(reduceRun(run, { type: 'choose-reward', cardId: 'C08' }));
}
function winMoss(initial: Run): Run {
  let run = initial;
  for (let count = 0; count < 200 && run.phase === 'battle'; count++) {
    const battle = run.battle!;
    const eligible = battle.hand.map((id) => run.deck.find((card) => card.instanceId === id)!).filter((card) => canPlayCard(run, card.instanceId).enabled);
    const get = (id: CardId) => eligible.find((card) => card.cardId === id);
    const incoming = battle.enemy.intent.kind === 'attack' && battle.enemy.intent.amount > battle.shield;
    const card = (incoming ? get('C02') ?? get('C06') : undefined) ?? (battle.energy <= 2 ? get('C04') : undefined)
      ?? (get('C07') && battle.energy >= 2 ? get('C08') : undefined) ?? get('C07') ?? get('C01') ?? get('C03') ?? get('C06') ?? get('C02');
    run = card ? reduceRun(run, { type: 'play-card', cardInstanceId: card.instanceId }) : reduceRun(run, { type: 'end-turn' });
  }
  if (run.phase !== 'reward') throw new Error('未到奖励阶段');
  return run;
}
function toLastCamp(initial: Run): Run {
  let run = reduceRun(initial, { type: 'continue' });
  run = winMoss(reduceRun(run, { type: 'choose-route', enemyId: 'moss' }));
  return deliver(reduceRun(run, { type: 'choose-reward', cardId: 'C09' }));
}
function save(run: Run, profile = emptyResearchProfile(true)): string {
  return JSON.stringify({ schema: 'nextcard-adventure-save-v1', savedAt: 1000, observationStartedAt: 900, run, profile });
}

describe('additional participation at later camps', () => {
  it('supports 0 initially, then invests at N4 and both sells and invests at N6', () => {
    let run = halfway(0);
    expect(run.wallet.shareUnits).toBe('0');
    expect(availableActions(run).find((item) => item.type === 'buy-archive')?.enabled).toBe(true);
    run = reduceRun(run, { type: 'buy-archive' });
    run = reduceRun(run, { type: 'open-archive' });
    run = reduceRun(run, { type: 'open-archive' });
    expect(run.history.filter((event) => event.action === 'open-archive')).toHaveLength(1);
    expect(run.camp?.decision).toBe('not-submitted');

    const previous = run; const cash = run.wallet.cashCents;
    const pending = reduceRun(run, { type: 'submit-redemption', percent: 0, additionalEntryCents: 2000, actionId: 'n4-choice' });
    expect(reduceRun(pending, { type: 'submit-redemption', percent: 0, additionalEntryCents: 2000, actionId: 'n4-choice' })).toBe(pending);
    expect(pending.wallet.cashCents).toBe(cash - 2000);
    expect(pending.wallet.reservedCents).toBe(2000); expect(pending.wallet.investedCents).toBe(0);
    expect(pending.market.order).toMatchObject({ kind: 'sell', shareUnits: '0', additionalEntryCents: 2000 });
    expect(decisionSummary(pending).funding.brief).toContain('20 金币已预留、待下一报价执行');
    expect(decisionSummary(pending).response.brief).toBe('中途选择追加 20 金币');
    expect(observeJourney(pending).some((item) => item.text.includes('选择追加 20.00'))).toBe(true);
    const badQuote = { ...quote(pending), date: pending.market.lastQuote!.date };
    const unchanged = JSON.stringify(pending);
    expect(() => reduceRun(pending, { type: 'apply-quote', quote: badQuote })).toThrow();
    expect(JSON.stringify(pending)).toBe(unchanged); expect(previous.wallet.cashCents).toBe(cash);
    const restored = parseAdventureSave(save(pending)); expect(restored.kind).toBe('valid');
    if (restored.kind !== 'valid') throw new Error('追加订单未能恢复');
    const execution = quote(restored.value.run);
    run = reduceRun(restored.value.run, { type: 'apply-quote', quote: execution, actionId: 'n4-quote' });
    expect(run.wallet.shareUnits).toBe(sharesForCents(2000, execution.price));
    expect(run.wallet.investedCents).toBe(2000); expect(run.wallet.costBasisCents).toBe(2000); expect(run.wallet.reservedCents).toBe(0);
    expect(run.wallet.ledger.filter((line) => line.kind === 'redemption' && line.node === 'N4')).toHaveLength(0);
    expect([...run.history].reverse().find((event) => event.action === 'apply-quote')?.message).toContain('本次没有回收份额');
    expect(reduceRun(run, { type: 'apply-quote', quote: execution, actionId: 'n4-quote' })).toBe(run);
    expect(reduceRun(run, { type: 'apply-quote', quote: execution })).toEqual(run);
    const incomplete = structuredClone(run);
    const addedChoice = incomplete.history.find((event) => event.action === 'submit-redemption')!;
    addedChoice.snapshot = undefined;
    expect(decisionSummary(incomplete).funding.detail).toContain('追加 20 金币，当时可用金额未知');
    const addedFill = incomplete.history.find((event) => event.action === 'apply-quote' && event.data.stage === 't1-exec')!;
    delete addedFill.data.additionalShareUnits;
    expect(fundingScenarioFromRun(incomplete)).toBeNull();

    const upgrade = run.deck.find((card) => card.cardId === 'C01' && !card.upgraded)!;
    run = reduceRun(run, { type: 'upgrade-card', cardInstanceId: upgrade.instanceId });
    run = toLastCamp(run);
    expect(run.node).toBe('N6');
    run = reduceRun(run, { type: 'open-archive' });
    expect(run.history.filter((event) => event.action === 'open-archive').map((event) => event.node)).toEqual(['N4', 'N6']);
    expect(run.history.filter((event) => event.action === 'buy-archive')).toHaveLength(1);

    const beforeLast = run; const sold = sharesForPercent(run.wallet.shareUnits, 50);
    const last = reduceRun(run, { type: 'submit-redemption', percent: 50, additionalEntryCents: 1000 });
    const lastQuote = quote(last); const proceeds = centsForShares(sold, lastQuote.price);
    expect(last.wallet.cashCents).toBe(beforeLast.wallet.cashCents - 1000);
    expect(last.market.order).toMatchObject({ shareUnits: sold, additionalEntryCents: 1000 });
    run = deliver(last);
    expect(run.wallet.cashCents).toBe(beforeLast.wallet.cashCents - 1000 + proceeds);
    expect(run.wallet.shareUnits).toBe((BigInt(beforeLast.wallet.shareUnits) - BigInt(sold) + BigInt(sharesForCents(1000, lastQuote.price))).toString());
    expect(run.wallet.investedCents).toBe(3000); expect(run.wallet.reservedCents).toBe(0);
    expect([...run.history].reverse().find((event) => event.action === 'apply-quote')?.message).toContain('原份额回收与追加参与');
    expect(decisionSummary(run).funding.brief).toBe('累计已执行 30 金币');
    expect(decisionSummary(run).funding.detail).toContain('首营地可用 47 金币，选择参与 0');
    expect(decisionSummary(run).funding.detail).toContain('中途营地可用 55 金币，选择追加 20');
    expect(decisionSummary(run).response.brief).toContain('中途选择追加 20 金币');
    expect(decisionSummary(run).response.brief).toContain('最后营地选择回收一半并追加 10 金币');

    const derived = fundingScenarioFromRun(run)!;
    const timeline = simulateFundingPlan(derived.scenario, derived.plan);
    expect(timeline.stoppedAt).toBeNull();
    expect(timeline.rows.filter((row) => row.kind === 'additional-reserve').map((row) => row.amountCents)).toEqual([2000, 1000]);
    expect(timeline.rows.filter((row) => row.kind === 'additional-exec').map((row) => row.amountCents)).toEqual([2000, 1000]);
    expect(timeline.rows.at(-1)?.cashCents).toBe(run.wallet.cashCents);
    expect(timeline.rows.at(-1)?.shareUnits).toBe(run.wallet.shareUnits);
    const purchase = derived.scenario.events.find((event) => event.kind === 'purchase' && event.label.includes('历史档案'))!;
    const revisedPlan = { ...derived.plan, participationCents: derived.scenario.startingCashCents };
    const revisedTimeline = simulateFundingPlan(derived.scenario, revisedPlan);
    const feedback = evaluateFundingPractice(derived.scenario, { plan: derived.plan, revisedPlan, purchaseId: purchase.id, canPay: true }).feedback;
    expect(feedback.revised.status).toBe('blocked');
    if (feedback.revised.status !== 'blocked') throw new Error('预期追加预留无法支付');
    expect(feedback.revised.label).toContain('固定追加预留');
    expect(feedback.revised.cashBeforeCents).toBe(800);
    expect(feedback.revised.amountCents).toBe(2000);
    expect(revisedTimeline.rows.at(-1)).toMatchObject({ kind: 'additional-reserve', canPay: false, cashCents: 800 });
    expect(revisedTimeline.rows.some((row) => row.kind === 'additional-exec')).toBe(false);
    expect(revisedTimeline.rows.some((row) => row.kind === 'recovery')).toBe(false);
    const laterPurchase = derived.scenario.events.find((event) => event.kind === 'purchase' && event.label.includes('升级'))!;
    const withoutExtras = { ...derived.scenario, events: derived.scenario.events.filter((event) => event.kind !== 'additional-reserve' && event.kind !== 'additional-exec') };
    expect(fundingQuestionKey(derived.scenario, laterPurchase.id, 'd1-v1', derived.plan))
      .not.toBe(fundingQuestionKey(withoutExtras, laterPurchase.id, 'd1-v1', derived.plan));
    const saved = submitFunding(emptyResearchProfile(true), derived.scenario, { id: 'd1-added', questionVersion: 'd1-v1', plan: derived.plan, revisedPlan, purchaseId: purchase.id, canPay: true, help: 'self', answerExposed: false, priorExposure: false });
    expect(validateResearchProfile(saved.profile, 'real').ok).toBe(true);
    expect(parseAdventureSave(save(run, saved.profile)).kind).toBe('valid');

    const leaving = reduceRun(run, { type: 'return-home' });
    expect(leaving.market.order).toMatchObject({ kind: 'sell', automatic: true, shareUnits: run.wallet.shareUnits });
    expect(leaving.market.order).not.toHaveProperty('additionalEntryCents');
    const returned = deliver(leaving);
    expect(returned.phase).toBe('ended'); expect(returned.status).toBe('returned');
    expect(returned.wallet.shareUnits).toBe('0'); expect(returned.wallet.costBasisCents).toBe(0);
    const endedScenario = fundingScenarioFromRun(returned)!;
    const endedTimeline = simulateFundingPlan(endedScenario.scenario, endedScenario.plan);
    expect(endedTimeline.rows.at(-1)?.cashCents).toBe(returned.wallet.cashCents);
    expect(endedTimeline.rows.at(-1)?.shareUnits).toBe('0');
  });

  it('keeps a pending later investment out of shares and never borrows future sale proceeds', () => {
    const camp = reduceRun(halfway(2000), { type: 'buy-archive' }); const currentCash = camp.wallet.cashCents;
    expect(() => reduceRun(camp, { type: 'submit-redemption', percent: 100, additionalEntryCents: currentCash + 1 })).toThrow('金币不足');
    for (const amount of [-1, 0.5, Number.NaN]) expect(() => reduceRun(camp, { type: 'submit-redemption', percent: 0, additionalEntryCents: amount })).toThrow();
    const run = reduceRun(camp, { type: 'submit-redemption', percent: 100, additionalEntryCents: 1000 });
    const derived = fundingScenarioFromRun(run)!;
    const timeline = simulateFundingPlan(derived.scenario, derived.plan);
    expect(timeline.stoppedAt).toBe('pending-additional-quote');
    expect(timeline.rows.at(-1)?.kind).toBe('pending');
    expect(timeline.rows.at(-1)?.shareUnits).toBe(camp.wallet.shareUnits);
    expect(timeline.rows.at(-1)?.cashCents).toBe(currentCash - 1000);
    expect(timeline.rows.at(-1)?.label).toContain('等待下一开盘价');
    expect(timeline.rows.some((row) => row.kind === 'additional-exec')).toBe(false);
    const purchase = derived.scenario.events.find((event) => event.kind === 'purchase' && event.label.includes('档案'))!;
    expect(evaluateFundingPractice(derived.scenario, { plan: derived.plan, revisedPlan: derived.plan, purchaseId: purchase.id, canPay: true }).feedback.revised.status).toBe('pending-additional-quote');
  });

  it('sells the old position before adding a new position at the same quote', () => {
    const camp = halfway(2000);
    const pending = reduceRun(camp, { type: 'submit-redemption', percent: 100, additionalEntryCents: 1000 });
    const next = quote(pending);
    const expectedProceeds = centsForShares(camp.wallet.shareUnits, next.price);
    const run = deliver(pending);
    expect(run.wallet.shareUnits).toBe(sharesForCents(1000, next.price));
    expect(run.wallet.costBasisCents).toBe(1000);
    expect(run.wallet.investedCents).toBe(3000);
    expect(run.wallet.realizedPnlCents).toBe(expectedProceeds - 2000);
    expect(run.wallet.cashCents).toBe(camp.wallet.cashCents - 1000 + expectedProceeds);
    expect(run.history.filter((event) => event.action === 'apply-quote' && event.data.stage === 't1-exec')).toHaveLength(1);
  });

  it('allows buying the archive at N6 before deciding, while other supplies remain locked', () => {
    const middle = deliver(reduceRun(halfway(0), { type: 'submit-redemption', percent: 0 }));
    const camp = toLastCamp(middle);
    expect(camp.node).toBe('N6'); expect(camp.camp?.decision).toBe('not-submitted');
    expect(availableActions(camp).find((item) => item.type === 'buy-archive')?.enabled).toBe(true);
    expect(availableActions(camp).find((item) => item.type === 'buy-card')?.enabled).toBe(false);
    const purchased = reduceRun(camp, { type: 'buy-archive' });
    expect(purchased.wallet.cashCents).toBe(camp.wallet.cashCents - 400);
    expect(purchased.camp?.decision).toBe('not-submitted');
    expect(() => reduceRun(purchased, { type: 'buy-archive' })).toThrow();
    expect(() => reduceRun(camp, { type: 'buy-card', cardId: 'C10' })).toThrow();

    const lowCash = structuredClone(camp); lowCash.wallet.cashCents = 300;
    const availability = availableActions(lowCash).find((item) => item.type === 'purchase-attempted');
    expect(availability).toMatchObject({ enabled: false, archiveAttemptAvailable: true });
    expect(availability?.reason).toContain('仍可单独尝试购买档案');
    const attempted = reduceRun(lowCash, { type: 'purchase-attempted', purchase: 'buy-archive' });
    expect(attempted.history.at(-1)?.snapshot?.available.find((item) => item.type === 'purchase-attempted')).toEqual(availability);
    expect(attempted.wallet.cashCents).toBe(300);
    expect(parseAdventureSave(save(attempted)).kind).toBe('valid');
    expect(() => reduceRun(lowCash, { type: 'purchase-attempted', purchase: 'buy-card', cardId: 'C10' })).toThrow('等待回收');
  });

  it('preserves old zero-addition semantics and rejects damaged pending orders', () => {
    const camp = halfway(2000);
    const omitted = reduceRun(camp, { type: 'submit-redemption', percent: 50 });
    const explicitZero = reduceRun(camp, { type: 'submit-redemption', percent: 50, additionalEntryCents: 0 });
    expect(omitted.market.order).not.toHaveProperty('additionalEntryCents');
    expect(parseAdventureSave(save(omitted)).kind).toBe('valid');
    const onlyRecovery = deliver(omitted);
    expect(onlyRecovery.wallet).toEqual(deliver(explicitZero).wallet);
    expect([...onlyRecovery.history].reverse().find((event) => event.action === 'apply-quote')?.message).toBe('回收按实际开盘价到账。');
    const neither = deliver(reduceRun(halfway(0), { type: 'submit-redemption', percent: 0 }));
    expect([...neither.history].reverse().find((event) => event.action === 'apply-quote')?.message).toBe('本次没有回收或追加份额。');
    expect(neither.wallet.ledger.filter((line) => line.kind === 'redemption' && line.node === 'N4')).toHaveLength(0);
    const beforeAdditional = reduceRun(camp, { type: 'submit-redemption', percent: 0, additionalEntryCents: 1000 });
    const invalid = structuredClone(beforeAdditional);
    if (invalid.market.order?.kind !== 'sell') throw new Error('缺少订单');
    invalid.market.order.additionalEntryCents = invalid.wallet.reservedCents + 1;
    expect(parseAdventureSave(save(invalid)).kind).toBe('invalid');
    invalid.market.order.additionalEntryCents = -1;
    expect(parseAdventureSave(save(invalid)).kind).toBe('invalid');

    const build = (value: Run) => {
      const settled = deliver(value); const upgrade = settled.deck.find((card) => card.cardId === 'C01')!;
      return fundingScenarioFromRun(reduceRun(settled, { type: 'upgrade-card', cardInstanceId: upgrade.instanceId }))!;
    };
    const oldScenario = build(omitted); const zeroScenario = build(explicitZero);
    const purchase = oldScenario.scenario.events.find((event) => event.kind === 'purchase' && event.label.includes('升级'))!;
    expect(fundingQuestionKey(oldScenario.scenario, purchase.id, 'd1-v1', oldScenario.plan))
      .toBe(fundingQuestionKey(zeroScenario.scenario, purchase.id, 'd1-v1', zeroScenario.plan));
  });

  it('does not compare an originally forecast action to a combined action with additional entry', () => {
    let profile = saveForecast(emptyResearchProfile(true), { id: 'f1', caseId: 'lantern-d', amountCents: 2000, lossMin: .1, lossMax: .2,
      minCashCents: 1000, minHealthRatio: .5, feeling: 'mild', action: 'continue', priorExposure: false, beforeFuture: true });
    const context = { caseId: 'lantern-d', node: 'N4' as const, amountCents: 2000, referenceValueCents: 1700, cashCents: 3000, health: 30, maxHealth: 42,
      priorExposure: false, autonomousChoice: true, pendingSettlement: false, forcedOrAutomatic: false, changedGoalOrUnderstanding: false, afterCloseBeforeExecution: true, sameShareBasis: true };
    profile = recordCalibrationFeeling(profile, 'f1', context, 'strong');
    expect(profile.calibration[0]?.comparison).toBe('matched');
    profile = recordCalibrationAction(profile, 'f1', 'continue', undefined, { additionalEntryCents: 1000 });
    expect(profile.calibration[0]).toMatchObject({ feeling: 'strong', action: 'continue', comparison: 'unavailable', affectComparison: 'unknown', actionComparison: 'unknown', context });
    expect(profile.calibration[0]?.unavailableReason).toContain('同时追加投入');
    expect(validateResearchProfile(profile, 'real').ok).toBe(true);
  });
});
