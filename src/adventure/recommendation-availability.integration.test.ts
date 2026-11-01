import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRun, pendingMarketStep, reduceRun } from './engine';
import type { MarketManifest, ResearchMarketCase } from './market';
import { compareRecommendationPlans, compareSchedule, emptyResearchProfile, fundingScenarioFromRun, mechanicalFundingExample, recommendationPlan, setResearchGoal, showHistoryEvidence, simulateFundingPlan, startHistory, submitFunding, submitHistory, updateJourney } from './research';
import type { CardId, MarketQuote, Run } from './types';
import { taskAvailability } from './ui-availability';
import { researchCaseChoices } from './ui-research-cases';

const manifest = JSON.parse(readFileSync('public/data/adventure/manifest.v2.json', 'utf8')) as MarketManifest;

function play(run: Run, cardId: CardId): Run {
  const card = run.deck.find((item) => item.cardId === cardId && run.battle?.hand.includes(item.instanceId));
  if (!card) throw new Error(`Seeded action ${cardId} is not legal`);
  return reduceRun(run, { type: 'play-card', cardInstanceId: card.instanceId });
}

function firstCamp(caseId = 'lantern-a'): Run {
  let run = createRun({ seed: 104, caseId });
  for (const card of ['C02', 'C03', 'C01'] as CardId[]) run = play(run, card);
  run = reduceRun(run, { type: 'end-turn' });
  for (const card of ['C01', 'C04', 'C02', 'C02'] as CardId[]) run = play(run, card);
  run = reduceRun(run, { type: 'end-turn' });
  run = play(run, 'C02'); run = reduceRun(run, { type: 'end-turn' });
  run = play(run, 'C01');
  return reduceRun(run, { type: 'choose-reward', cardId: 'C07' });
}

function deliverPending(run: Run): Run {
  const pending = pendingMarketStep(run);
  if (!pending) throw new Error('No quote is unlocked');
  const quote = JSON.parse(readFileSync(`public/data/adventure/stages/${pending.caseId}/${pending.stage}.json`, 'utf8')) as MarketQuote;
  return reduceRun(run, { type: 'apply-quote', quote });
}

function researchCase(caseId: string): ResearchMarketCase {
  return JSON.parse(readFileSync(`public/data/adventure/research/${caseId}.json`, 'utf8')) as ResearchMarketCase;
}

describe('recommendation availability against reachable gameplay', () => {
  it('does not call a zero-participation run an example once its actual purchase and entry have occurred', () => {
    const profile = emptyResearchProfile();
    let run = firstCamp();
    expect(taskAvailability(run, profile, manifest).funding).toBe('example');
    run = reduceRun(run, { type: 'submit-entry', amountCents: 0 });
    let withoutPurchase = reduceRun(run, { type: 'continue' });
    withoutPurchase = deliverPending(withoutPurchase);
    expect(taskAvailability(withoutPurchase, profile, manifest).funding).toBe('example');
    run = reduceRun(run, { type: 'buy-card', cardId: 'C08' });
    expect(taskAvailability(run, profile, manifest).funding).toBe('example'); // The entry price is still locked.
    run = reduceRun(run, { type: 'continue' });
    expect(taskAvailability(run, profile, manifest).funding).toBe('example');
    run = deliverPending(run);
    const before = JSON.stringify({ run, profile });
    const available = taskAvailability(run, profile, manifest);
    expect(available.funding).toBe('journey');
    expect(recommendationPlan(profile, available).offers.D1).toContain('本局已发生');
    const derived = fundingScenarioFromRun(run)!;
    expect(derived.plan.participationCents).toBe(0);
    expect(derived.scenario.events.some((event) => event.kind === 'purchase')).toBe(true);
    expect(JSON.stringify({ run, profile })).toBe(before);
  });

  it('retains actual-ledger availability through defeat and its automatic next-open settlement', () => {
    const profile = emptyResearchProfile();
    let run = firstCamp();
    run = reduceRun(run, { type: 'submit-entry', amountCents: 2000 });
    run = reduceRun(run, { type: 'buy-card', cardId: 'C08' });
    run = reduceRun(run, { type: 'continue' });
    run = deliverPending(run);
    run = reduceRun(run, { type: 'choose-route', enemyId: 'moss' });
    for (let i = 0; i < 40 && run.phase === 'battle'; i++) run = reduceRun(run, { type: 'end-turn' });
    expect(run.status).toBe('defeated');
    expect(pendingMarketStep(run)?.stage).toBe('exit-after-entry');
    expect(taskAvailability(run, profile, manifest).funding).toBe('journey');
    run = deliverPending(run);
    expect(run.phase).toBe('ended');
    expect(run.wallet.shareUnits).toBe('0');
    const derived = fundingScenarioFromRun(run)!;
    expect(derived.scenario.events.some((event) => event.kind === 'recovery' && event.automatic)).toBe(true);
    expect(simulateFundingPlan(derived.scenario, { ...derived.plan, recovery: {} }).rows.at(-1)?.shareUnits).toBe('0');
    expect(taskAvailability(run, profile, manifest).funding).toBe('journey');
  });

  it('keeps the real purchase constraint as the reason after an independent D1 answer', () => {
    let run = firstCamp();
    run = reduceRun(run, { type: 'submit-entry', amountCents: 6500 });
    const card = run.deck.find((item) => item.cardId === 'C07')!;
    run = reduceRun(run, { type: 'purchase-attempted', purchase: 'upgrade-card', cardInstanceId: card.instanceId });
    run = reduceRun(run, { type: 'continue' });
    run = deliverPending(run);
    let profile = updateJourney(emptyResearchProfile(), run);
    const before = recommendationPlan(profile, taskAvailability(run, profile, manifest));
    expect(before.recommendation).toMatchObject({ task_id: 'D1', reason_type: 'purchase_constraint' });
    const { scenario, plan } = fundingScenarioFromRun(run)!;
    const purchase = simulateFundingPlan(scenario, plan).rows.find((row) => row.kind === 'purchase')!;
    expect(purchase.canPay).toBe(false);
    profile = submitFunding(profile, scenario, {
      id: 'funding-study', questionVersion: 'd1-v1', plan, purchaseId: purchase.id,
      canPay: false, revisedPlan: plan, help: 'self', answerExposed: false, priorExposure: false,
    }).profile;
    const after = recommendationPlan(profile, taskAvailability(run, profile, manifest));
    expect(after.recommendation).toMatchObject({ task_id: 'D1', reason_type: 'purchase_constraint' });
    expect(after.observed_steps).toContainEqual(expect.objectContaining({ dimension: 'K3', status: 'independent' }));
    expect(after.continuity).toContain('不会改写当时采购未完成的事实');
    expect(compareRecommendationPlans(before, after)).toMatchObject({ task_changed: false });
  });

  it('keeps the artificial example as practice and respects only-play mode', () => {
    const run = createRun({ seed: 104 });
    let profile = emptyResearchProfile();
    const available = taskAvailability(run, profile, manifest);
    expect(available.funding).toBe('example');
    const { scenario, plan } = mechanicalFundingExample();
    const purchase = simulateFundingPlan(scenario, plan).rows.find((row) => row.kind === 'purchase')!;
    profile = submitFunding(profile, scenario, {
      id: 'example-study', questionVersion: 'd1-v1', plan, purchaseId: purchase.id,
      canPay: !!purchase.canPay, revisedPlan: plan, help: 'self', answerExposed: false, priorExposure: false,
    }).profile;
    expect(profile.knowledge_evidence.find((item) => item.dimension === 'K3')?.counted).toBe(false);
    expect(recommendationPlan(profile, available).offers.D1).toContain('人工机制算例供练习');
    const onlyPlayRun = createRun({ seed: 104, observationEnabled: false });
    const onlyPlayProfile = emptyResearchProfile(false);
    const onlyPlayPlan = recommendationPlan(onlyPlayProfile, taskAvailability(onlyPlayRun, onlyPlayProfile, manifest));
    expect(onlyPlayPlan.recommendation.task_id).toBeNull();
    expect(onlyPlayPlan.observed_steps).toEqual([]);
  });

  it('offers pending, then review after both unrelated cases are studied without exposing active C/D', () => {
    const run = createRun({ seed: 104, caseId: 'lantern-c' });
    let profile = setResearchGoal(emptyResearchProfile(), 'goal-history', 'history');
    const choices = researchCaseChoices(manifest.cases, run, profile);
    expect(choices.map((choice) => choice.summary.caseId)).toEqual(['lantern-a', 'lantern-b']);
    expect(taskAvailability(run, profile, null).history).toBe('unavailable');
    expect(taskAvailability(run, profile, manifest).history).toBe('unseen');
    const schedule = { startingCashCents: 7200, participationCents: 2000, t1: 0 as const, t2: 0 as const };
    profile = startHistory(profile, { id: 'study', caseId: 'lantern-a', questionVersion: 'd2-v1', schedule, initialClaim: 'unknown', priorExposure: false });
    expect(taskAvailability(run, profile, null).history).toBe('pending');
    const primary = researchCase('lantern-a'); const other = researchCase('lantern-b');
    profile = showHistoryEvidence(profile, 'study', primary, other);
    const a = compareSchedule(primary, schedule); const b = compareSchedule(other, schedule);
    const difference = b.asset.gainCents > a.asset.gainCents ? 'outperform' : b.asset.gainCents < a.asset.gainCents ? 'underperform' : 'equal';
    profile = submitHistory(profile, 'study', { comparison: a.direction, historyDifference: difference, boundary: 'only_samples', reason: '比较同期数字' }).profile;
    const available = taskAvailability(run, profile, manifest);
    expect(available.history).toBe('review');
    const plan = recommendationPlan(profile, available);
    expect(plan.recommendation.task_id).toBe('D2');
    expect(plan.offers.D2).toContain('复习');
    expect(plan.offers.D2).not.toContain('未见');
    expect(researchCaseChoices(manifest.cases, run, profile).map((choice) => choice.summary.caseId)).toEqual(['lantern-a', 'lantern-b']);
  });
});
