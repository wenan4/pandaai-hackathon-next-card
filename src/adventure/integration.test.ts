import { describe, expect, it } from 'vitest';
import { createRun, reduceRun } from './engine';
import { attachFundingFinalQuote, compareSchedule, fundingScenarioFromRun, mechanicalFundingExample, simulateFundingPlan } from './research';
import type { ResearchMarketCase } from './market';
import type { CardId, Run } from './types';

function play(run: Run, cardId: CardId): Run {
  const card = run.deck.find((item) => item.cardId === cardId && run.battle?.hand.includes(item.instanceId));
  if (!card) throw new Error(`Seeded action ${cardId} is not legal`);
  return reduceRun(run, { type: 'play-card', cardInstanceId: card.instanceId });
}

function legallyReachFirstCamp(): Run {
  let run = createRun({ seed: 104 });
  for (const card of ['C02', 'C03', 'C01'] as CardId[]) run = play(run, card);
  run = reduceRun(run, { type: 'end-turn' });
  for (const card of ['C01', 'C04', 'C02', 'C02'] as CardId[]) run = play(run, card);
  run = reduceRun(run, { type: 'end-turn' });
  run = play(run, 'C02'); run = reduceRun(run, { type: 'end-turn' });
  run = play(run, 'C01');
  return reduceRun(run, { type: 'choose-reward', cardId: 'C07' });
}

function date(offset: number): string {
  return new Date(Date.UTC(2024, 0, 1 + offset)).toISOString().slice(0, 10).replaceAll('-', '');
}

function fixedCase(): ResearchMarketCase {
  const assetClose = Array.from({ length: 61 }, () => 1_000_000);
  assetClose[20] = 900_000; assetClose[40] = 1_100_000; assetClose[60] = 1_200_000;
  return {
    caseId: 'manual-case', title: '人工时间边界算例', decisionDate: date(0), benchmarkName: '人工基准', priceScale: 1_000_000,
    dates: Array.from({ length: 61 }, (_, i) => date(i)), assetClose,
    benchmarkClose: Array.from({ length: 61 }, () => 1_000_000),
    execution: [
      { step: 'entry', date: date(1), price: 1_000_000, benchmarkPrice: 1_000_000 },
      { step: 't1-exec', date: date(21), price: 880_000, benchmarkPrice: 1_000_000 },
      { step: 't2-exec', date: date(41), price: 1_000_000, benchmarkPrice: 1_000_000 },
      { step: 'final-exec', date: date(61), price: 1_100_000, benchmarkPrice: 1_000_000 },
    ],
  };
}

describe('adventure and research calculations agree', () => {
  it('places an actual N2 purchase between cash reservation and next-open execution', () => {
    let run = legallyReachFirstCamp();
    run = reduceRun(run, { type: 'submit-entry', amountCents: 4000 });
    run = reduceRun(run, { type: 'buy-card', cardId: 'C08' });
    const actualPurchase = run.history.find((item) => item.action === 'buy-card')!;
    expect(actualPurchase.snapshot).toMatchObject({ cashCents: 3200, reservedCents: 4000, shareUnits: '0', referenceValueCents: null });
    run = reduceRun(run, { type: 'continue' });
    run = reduceRun(run, { type: 'apply-quote', quote: { caseId: run.caseId, step: 'entry', date: '20251104', price: 994131 } });
    const derived = fundingScenarioFromRun(run)!;
    const timeline = simulateFundingPlan(derived.scenario, derived.plan);
    const row = timeline.rows.find((item) => item.kind === 'purchase')!;
    expect(row).toMatchObject({ cashBeforeCents: 3200, cashCents: 700, shareUnits: '0', referenceValueCents: null });
    expect(timeline.rows.findIndex((item) => item.kind === 'purchase')).toBeLessThan(timeline.rows.findIndex((item) => item.kind === 'entry-exec'));
    const revised = simulateFundingPlan(derived.scenario, { participationCents: 7000, recovery: {} });
    expect(revised.stoppedAt).toBe(row.id);
    expect(revised.rows.some((item) => item.kind === 'entry-exec')).toBe(false);
  });

  it('compares a known same-date schedule using actual opening prices and cash settlement', () => {
    const comparison = compareSchedule(fixedCase(), { startingCashCents: 10_000, participationCents: 4000, t1: 50, t2: 50 });
    expect(comparison.asset.cashCents).toBe(9860);
    expect(comparison.asset.gainCents).toBe(-140);
    expect(comparison.benchmark.gainCents).toBe(0);
    expect(comparison.direction).toBe('underperform');
    expect(comparison.asset.timeline.find((point) => point.step === 't1-exec')).toMatchObject({ date: date(21), cashCents: 7760, referenceValueCents: 1760 });
    expect(comparison.asset.timeline.find((point) => point.step === 't2-exec')).toMatchObject({ date: date(41), cashCents: 8760, referenceValueCents: 1000 });
    expect(comparison.asset.heldPriceMaxDrawdown).toBeCloseTo(0.12);
  });

  it('does not allow a simulated plan to leave shares after an automatic settlement', () => {
    const { scenario, plan } = mechanicalFundingExample();
    plan.recovery.final = 0; // A changed plan cannot override the final automatic order.
    const timeline = simulateFundingPlan(scenario, plan);
    expect(timeline.rows.at(-1)).toMatchObject({ id: 'final', shareUnits: '0' });
  });

  it('keeps alternative holdings pending when the original ending never loaded an execution quote', () => {
    const { scenario, plan } = mechanicalFundingExample();
    scenario.events = scenario.events.filter((item) => item.id !== 'final');
    scenario.pendingFinal = { stage: 'final-exec', afterDate: '20240101' };
    const pending = simulateFundingPlan(scenario, plan);
    expect(pending.stoppedAt).toBe('pending-final-quote');
    expect(pending.rows.at(-1)?.cashCents).toBe(4160);
    expect(pending.rows.at(-1)?.shareUnits).not.toBe('0');
    expect(() => attachFundingFinalQuote(scenario, { caseId: scenario.caseId, step: 't2-exec', date: '20240102', price: 1_100_000 })).toThrow();
    const completed = attachFundingFinalQuote(scenario, { caseId: scenario.caseId, step: 'final-exec', date: '20240102', price: 1_100_000 });
    expect(simulateFundingPlan(completed, plan)).toMatchObject({ stoppedAt: null });
    expect(simulateFundingPlan(completed, plan).rows.at(-1)?.shareUnits).toBe('0');
  });

  it('does not count price changes after full exit as held-period drawdown', () => {
    const data = fixedCase();
    for (let i = 21; i <= 60; i++) data.assetClose[i] = 100_000;
    data.execution[2]!.price = 100_000; data.execution[3]!.price = 100_000;
    const comparison = compareSchedule(data, { startingCashCents: 10_000, participationCents: 4000, t1: 100, t2: 0 });
    expect(comparison.asset.cashCents).toBe(9520);
    expect(comparison.asset.heldPriceMaxDrawdown).toBeCloseTo(0.12);
  });
});
