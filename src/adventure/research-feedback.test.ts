import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ResearchMarketCase } from './market';
import {
  compareSchedule, emptyResearchProfile, evaluateFundingPractice, evaluateHistoryFeedback, evaluateHistoryPractice,
  markHistoryHelp, mechanicalFundingExample, showHistoryEvidence, simulateFundingPlan, startHistory, submitFunding, submitHistory,
  type FixedSchedule, type HistoryAnswers,
} from './research';

const data = (caseId: string): ResearchMarketCase => JSON.parse(readFileSync(`public/data/adventure/research/${caseId}.json`, 'utf8')) as ResearchMarketCase;
const a = data('lantern-a'); const c = data('lantern-c');
const schedule: FixedSchedule = { startingCashCents: 7200, participationCents: 4000, t1: 50, t2: 0 };

function stagedHistory(id: string) {
  const profile = startHistory(emptyResearchProfile(), { id, caseId: a.caseId, questionVersion: 'v1', schedule, initialClaim: 'unknown', priorExposure: false });
  return showHistoryEvidence(profile, id, a, c);
}

describe('shared, transient research feedback', () => {
  it('separates the two K2 steps while preserving their original combined score', () => {
    const scenarios = [
      { difference: 'outperform', boundary: 'only_samples', expectedDifference: true, expectedBoundary: true, k2: true },
      { difference: 'underperform', boundary: 'only_samples', expectedDifference: false, expectedBoundary: true, k2: false },
      { difference: 'outperform', boundary: 'predicts_future', expectedDifference: true, expectedBoundary: false, k2: false },
      { difference: 'underperform', boundary: 'predicts_future', expectedDifference: false, expectedBoundary: false, k2: false },
    ] as const;
    for (const [i, row] of scenarios.entries()) {
      const answers: HistoryAnswers = { comparison: 'outperform', historyDifference: row.difference, boundary: row.boundary, reason: '比较已展示数字' };
      const input = stagedHistory(`history-${i}`);
      const before = JSON.stringify(input);
      const actual = submitHistory(input, `history-${i}`, answers);
      const practice = evaluateHistoryPractice(a, c, schedule, answers);
      expect(actual.feedback).toEqual(practice.feedback);
      expect(actual.feedback.comparison).toMatchObject({ selected: 'outperform', expected: 'underperform', correct: false });
      expect(actual.feedback.comparison?.assetGainCents).toBe(compareSchedule(a, schedule).asset.gainCents);
      expect(actual.feedback.comparison?.benchmarkGainCents).toBe(compareSchedule(a, schedule).benchmark.gainCents);
      expect(actual.feedback.historyDifference).toMatchObject({ selected: row.difference, expected: 'outperform', correct: row.expectedDifference });
      expect(actual.feedback.boundary).toEqual({ selected: row.boundary, expected: 'only_samples', correct: row.expectedBoundary });
      expect(actual.feedback.k2Correct).toBe(row.k2);
      expect(practice.boundaryCorrect).toBe(row.k2); // Backward-compatible combined result.
      expect(actual.profile.knowledge_evidence.find((item) => item.dimension === 'K1')?.correct).toBe(false);
      expect(actual.profile.knowledge_evidence.find((item) => item.dimension === 'K2')?.correct).toBe(row.k2);
      expect(JSON.stringify(input)).toBe(before);
      expect(actual.profile.research_process[0]).not.toHaveProperty('feedback');
    }
  });

  it('keeps omitted or undisplayed history steps unknown and leaves help/exposure rules intact', () => {
    const answers: HistoryAnswers = { comparison: 'underperform', reason: '核对同期数据' };
    let profile = startHistory(emptyResearchProfile(), { id: 'primary-only', caseId: a.caseId, questionVersion: 'v1', schedule, initialClaim: 'unknown', priorExposure: false });
    profile = showHistoryEvidence(profile, 'primary-only', a);
    profile = markHistoryHelp(profile, 'primary-only', 'hint');
    const result = submitHistory(profile, 'primary-only', answers);
    expect(result.feedback).toMatchObject({ historyDifference: null, boundary: null, k2Correct: null });
    expect(result.feedback.comparison).toMatchObject({ selected: 'underperform', expected: 'underperform', correct: true });
    expect(result.profile.knowledge_evidence).toHaveLength(1);
    expect(result.profile.knowledge_evidence[0]).toMatchObject({ dimension: 'K1', help: 'hint', independent: false, counted: true });
    expect(evaluateHistoryPractice(a, null, schedule, answers).feedback).toEqual(result.feedback);
    expect(evaluateHistoryFeedback(compareSchedule(a, schedule), null, { reason: '' })).toEqual({ comparison: null, historyDifference: null, boundary: null, k2Correct: null });
    expect(() => evaluateHistoryPractice(a, null, schedule, { ...answers, boundary: 'only_samples' })).toThrow('先展示并比较另一历史片段');
  });

  it('preserves an optional K2-only submission and the equal-result comparison', () => {
    const answers: HistoryAnswers = { historyDifference: 'outperform', boundary: 'only_samples', reason: '比较两段记录' };
    const result = submitHistory(stagedHistory('k2-only'), 'k2-only', answers);
    expect(result.feedback.comparison).toBeNull();
    expect(result.feedback.k2Correct).toBe(true);
    expect(result.profile.knowledge_evidence.map((item) => item.dimension)).toEqual(['K2']);
    const primary = compareSchedule(a, schedule); const other = structuredClone(compareSchedule(c, schedule));
    other.asset.gainCents = primary.asset.gainCents;
    const equal = evaluateHistoryFeedback(primary, other, { historyDifference: 'equal', boundary: 'only_samples', reason: '' });
    expect(equal.historyDifference).toMatchObject({ selected: 'equal', expected: 'equal', correct: true });
    expect(equal.k2Correct).toBe(true);
  });

  it('identifies the first revised purchase that blocks reaching a later target', () => {
    const example = mechanicalFundingExample();
    const scenario = { ...example.scenario, caseId: 'test-historical', events: [
      ...example.scenario.events.slice(0, 2),
      { id: 'buy-later', label: '稍后的补给', kind: 'purchase' as const, amountCents: 1500 },
      ...example.scenario.events.slice(2),
    ] };
    const plan = example.plan; const revisedPlan = { ...plan, participationCents: 6000 };
    const submission = { id: 'funding', questionVersion: 'v1', plan, revisedPlan, purchaseId: 'buy-later', canPay: false, help: 'self' as const, answerExposed: false, priorExposure: false };
    const input = emptyResearchProfile(); const before = JSON.stringify(input);
    const actual = submitFunding(input, scenario, submission);
    const practice = evaluateFundingPractice(scenario, submission);
    expect(actual.feedback).toEqual(practice.feedback);
    expect(actual.feedback.target).toEqual({ id: 'buy-later', label: '稍后的补给', selected: false, actualCanPay: false, correct: true, cashBeforeCents: 1200, amountCents: 1500 });
    expect(actual.feedback.revised).toEqual({ status: 'blocked', id: 'buy-upgrade', label: '途中计划升级（20 金币）', cashBeforeCents: 1200, amountCents: 2000, shortfallCents: 800 });
    expect(actual.feedback.revisedTarget).toEqual({ status: 'not-reached' });
    expect(actual.revisedTimeline.rows.some((row) => row.id === 'buy-later')).toBe(false);
    expect(actual.profile.funding_attempts[0]).not.toHaveProperty('feedback');
    expect(actual.profile.knowledge_evidence[0]).toMatchObject({ dimension: 'K3', correct: true, independent: true, counted: true });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('distinguishes a reached target, a finished plan, and a pending final quote', () => {
    const { scenario, plan } = mechanicalFundingExample();
    const original = { plan, purchaseId: 'buy-upgrade', canPay: false, revisedPlan: { ...plan, participationCents: 6000 } };
    const blocked = evaluateFundingPractice(scenario, original);
    expect(blocked.feedback.target).toMatchObject({ selected: false, actualCanPay: true, correct: false, amountCents: 2000, cashBeforeCents: 3200 });
    expect(blocked.feedback.revised).toMatchObject({ status: 'blocked', shortfallCents: 800 });
    expect(blocked.feedback.revisedTarget).toEqual({ status: 'reached', cashBeforeCents: 1200, amountCents: 2000, canPay: false });
    const completed = evaluateFundingPractice(scenario, { ...original, revisedPlan: plan });
    expect(completed.feedback.revised).toEqual({ status: 'completed' });
    expect(completed.feedback.revisedTarget).toMatchObject({ status: 'reached', canPay: true });
    const pendingScenario = { ...scenario, events: scenario.events.filter((event) => event.id !== 'final'), pendingFinal: { stage: 'final-exec' as const, afterDate: '20240101' } };
    const pendingPlan = { ...plan, recovery: { recovery: 0 as const } };
    const pending = evaluateFundingPractice(pendingScenario, { ...original, revisedPlan: pendingPlan });
    expect(pending.feedback.revised).toEqual({ status: 'pending-final-quote' });
    expect(pending.revisedTimeline.pendingFinal).toEqual({ stage: 'final-exec', afterDate: '20240101' });
    expect(pending.feedback.revisedTarget).toMatchObject({ status: 'reached', canPay: true });
  });

  it('rejects a target not reached by the original timeline without inventing its answer', () => {
    const example = mechanicalFundingExample();
    const scenario = { ...example.scenario, events: [
      ...example.scenario.events.slice(0, 2), { id: 'later', label: '后续采购', kind: 'purchase' as const, amountCents: 100 }, ...example.scenario.events.slice(2),
    ] };
    const plan = { ...example.plan, participationCents: 6000 };
    expect(simulateFundingPlan(scenario, plan).rows.some((row) => row.id === 'later')).toBe(false);
    const submission = { plan, revisedPlan: example.plan, purchaseId: 'later', canPay: true };
    expect(() => evaluateFundingPractice(scenario, submission)).toThrow('请判断已经到达的采购节点');
    const profile = emptyResearchProfile(); const before = JSON.stringify(profile);
    expect(() => submitFunding(profile, scenario, { ...submission, id: 'unreached', questionVersion: 'v1', help: 'self', answerExposed: false, priorExposure: false })).toThrow('请判断已经到达的采购节点');
    expect(JSON.stringify(profile)).toBe(before);
  });
});
