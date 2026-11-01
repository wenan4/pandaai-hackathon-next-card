import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calibrationDemoContext, makeCalibrationDemo } from './calibration-demo';
import { forkRun, pendingMarketStep, reduceRun } from './engine';
import { centsForShares } from './ledger';
import { loadMarketStage, relatedCaseIds, resetMarketCacheForTest } from './market';
import { compareSchedule, compareSelfForecast, emptyResearchProfile, showHistoryEvidence, startHistory, submitHistory } from './research';
import type { ResearchMarketCase } from './market';
import type { Forecast } from './research';

const requests: string[] = [];
beforeEach(() => {
  requests.length = 0;
  resetMarketCacheForTest();
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const address = typeof input === 'string' ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
    requests.push(address);
    try { return new Response(await readFile(`public${address}`), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    catch { return new Response('not found', { status: 404 }); }
  });
});
afterEach(() => { vi.unstubAllGlobals(); resetMarketCacheForTest(); });

describe('clearly simulated, real-history calibration path', () => {
  it('reaches an eligible N4 by legal combat and loads only quotes already revealed', async () => {
    const run = await makeCalibrationDemo();
    const context = calibrationDemoContext(run);
    expect(run).toMatchObject({ source: 'demo', caseId: 'lantern-d', status: 'active', node: 'N4', phase: 'camp', camp: { decision: 'not-submitted' } });
    expect(context).toMatchObject({ amountCents: 2000, autonomousChoice: true, pendingSettlement: false, forcedOrAutomatic: false, afterCloseBeforeExecution: true, sameShareBasis: true });
    expect(context.cashCents).toBeGreaterThanOrEqual(1000);
    expect(context.health / context.maxHealth).toBeGreaterThanOrEqual(0.5);
    expect([context.cashCents, context.health, context.referenceValueCents]).toEqual([3900, 42, 1743]);
    expect((context.amountCents - context.referenceValueCents) / context.amountCents).toBeGreaterThanOrEqual(0.1);
    expect((context.amountCents - context.referenceValueCents) / context.amountCents).toBeLessThanOrEqual(0.2);
    expect(run.history.filter((event) => event.action === 'victory')).toHaveLength(2);
    expect(run.history.filter((event) => event.action === 'apply-quote').map((event) => event.data.stage)).toEqual(['entry', 't1']);
    expect(run.history.some((event) => event.action === 'submit-redemption')).toBe(false);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatch(/\/lantern-d\/entry\.json$/);
    expect(requests[1]).toMatch(/\/lantern-d\/t1\.json$/);
    expect(run.market.lastQuote?.price).toBe(869028);
    expect(run.market.pending).toBeNull();
  });

  it('supports matched examples and honestly reports unavailable comparisons', async () => {
    const context = calibrationDemoContext(await makeCalibrationDemo());
    const simulated: Forecast = { id: 'demo-only', caseId: context.caseId, amountCents: context.amountCents, lossMin: 0.1, lossMax: 0.2, minCashCents: 1000, minHealthRatio: 0.5, feeling: 'mild', action: 'continue', priorExposure: false, beforeFuture: true, withdrawn: false };
    expect(compareSelfForecast(simulated, context, 'strong', 'continue')).toMatchObject({ comparison: 'matched', affectComparison: 'stronger', actionComparison: 'same' });
    expect(compareSelfForecast(simulated, context, 'low', 'half')).toMatchObject({ comparison: 'matched', affectComparison: 'weaker', actionComparison: 'different' });
    expect(compareSelfForecast(simulated, { ...context, cashCents: 999 }, 'strong', 'all')).toMatchObject({ comparison: 'unavailable', affectComparison: 'unknown', actionComparison: 'unknown' });
    expect(compareSelfForecast(simulated, { ...context, priorExposure: true }, 'strong', 'all')).toMatchObject({ comparison: 'unavailable', affectComparison: 'unknown', actionComparison: 'unknown' });
  });

  it('matches the research schedule on actual entry and T1 close', async () => {
    const run = await makeCalibrationDemo();
    const historical = JSON.parse(await readFile('public/data/adventure/research/lantern-d.json', 'utf8')) as ResearchMarketCase;
    const result = compareSchedule(historical, { startingCashCents: 7200, participationCents: 2000, t1: 0, t2: 0 });
    expect(result.asset.timeline.find((point) => point.step === 'entry')?.price).toBe(997436);
    expect(result.asset.timeline.find((point) => point.step === 't1')).toMatchObject({ price: run.market.lastQuote!.price, referenceValueCents: run.market.referenceValueCents });
  });

  it('places all three early-exit openings on the next trading date after the preceding execution', async () => {
    const historical = JSON.parse(await readFile('public/data/adventure/research/lantern-d.json', 'utf8')) as ResearchMarketCase;
    for (const [stage, executionIndex, exitIndex] of [
      ['exit-after-entry', 1, 2],
      ['exit-after-t1-exec', 21, 22],
      ['exit-after-t2-exec', 41, 42],
    ] as const) {
      const quote = await loadMarketStage('lantern-d', stage, true);
      expect(quote.date).toBe(historical.dates[exitIndex]);
      expect(quote.date > historical.dates[executionIndex]!).toBe(true);
      expect(quote.price).toBeGreaterThan(0);
    }
  });

  it('treats the actual overlapping C and D windows as related in both directions', async () => {
    const c = JSON.parse(await readFile('public/data/adventure/research/lantern-c.json', 'utf8')) as ResearchMarketCase;
    const d = JSON.parse(await readFile('public/data/adventure/research/lantern-d.json', 'utf8')) as ResearchMarketCase;
    const cDates = new Set(c.dates);
    expect(d.dates.some((date) => cDates.has(date))).toBe(true);
    expect(relatedCaseIds(c.caseId)).toContain(d.caseId);
    expect(relatedCaseIds(d.caseId)).toContain(c.caseId);
    const schedule = { startingCashCents: 7200, participationCents: 2000, t1: 0 as const, t2: 0 as const };
    for (const [first, second] of [[c, d], [d, c]] as const) {
      let profile = startHistory(emptyResearchProfile(), { id: 'first', caseId: first.caseId, questionVersion: 'overlap-test', schedule, initialClaim: 'unknown', priorExposure: false });
      profile = showHistoryEvidence(profile, 'first', first);
      profile = startHistory(profile, { id: 'second', caseId: second.caseId, questionVersion: 'overlap-test', schedule, initialClaim: 'unknown', priorExposure: false });
      expect(profile.research_process.at(-1)?.priorExposure).toBe(true);
    }
    let comparison = startHistory(emptyResearchProfile(), { id: 'pair', caseId: c.caseId, questionVersion: 'overlap-test', schedule, initialClaim: 'unknown', priorExposure: false });
    comparison = showHistoryEvidence(comparison, 'pair', c, d);
    const primary = compareSchedule(c, schedule);
    const other = compareSchedule(d, schedule);
    const difference = other.asset.gainCents > primary.asset.gainCents ? 'outperform' : other.asset.gainCents < primary.asset.gainCents ? 'underperform' : 'equal';
    const done = submitHistory(comparison, 'pair', { comparison: primary.direction, historyDifference: difference, boundary: 'only_samples', reason: '模拟核对相关历史' });
    expect(done.profile.knowledge_evidence.find((evidence) => evidence.dimension === 'K2')).toMatchObject({ counted: false, independent: false });
  });

  it('ends a simulated early loss using the opening after entry, not the later T1 quote', async () => {
    const original = await makeCalibrationDemo();
    const route = original.checkpoints.find((checkpoint) => checkpoint.action === 'choose-route');
    if (!route) throw new Error('缺少路线决策快照。');
    let fork = forkRun(original, route.id);
    fork = reduceRun(fork, { type: 'choose-route', enemyId: 'pursuer' });
    while (fork.phase === 'battle') fork = reduceRun(fork, { type: 'end-turn' });
    expect(fork.status).toBe('defeated');
    expect(pendingMarketStep(fork)?.stage).toBe('exit-after-entry');
    const before = fork.wallet.cashCents;
    const shares = fork.wallet.shareUnits;
    const pending = pendingMarketStep(fork)!;
    const quote = await loadMarketStage(pending.caseId, pending.stage, pending.unlocked);
    expect(quote.date > fork.market.lastQuote!.date).toBe(true);
    fork = reduceRun(fork, { type: 'apply-quote', quote });
    expect(fork.phase).toBe('ended');
    expect(fork.wallet.cashCents).toBe(before + centsForShares(shares, quote.price));
    expect(original.status).toBe('active');
    expect(original.node).toBe('N4');
  });
});
