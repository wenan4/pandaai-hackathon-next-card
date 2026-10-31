import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRun, decisionSnapshot } from "./engine";
import { calibrationDemoContext, makeCalibrationDemo } from "./calibration-demo";
import { resetMarketCacheForTest } from "./market";
import type { ResearchMarketCase } from "./market";
import {
  addUserReason, attachFundingFinalQuote, calibrationForDisplay, compareSchedule, compareSelfForecast, declarePriorExposure, emptyResearchProfile, evaluateFundingPractice,
  evaluateHistoryPractice, fundingQuestionKey, fundingScenarioFromRun, guidanceForTask, markFundingAnswerExposed, markFundingHelp, markHistoryAnswerExposed, markHistoryHelp,
  mechanicalFundingExample, observeJourney, recommendResearch, recordCalibrationAction, recordCalibrationFeeling, revokeResearch, saveForecast, setHelpPreference, setResearchGoal,
  showHistoryEvidence, simulateFundingPlan, startHistory, submitFunding, submitHistory, updateJourney,
} from "./research";
import type { CalibrationContext, FixedSchedule, Forecast, ResearchProfile } from "./research";

function data(id: string): ResearchMarketCase {
  return JSON.parse(readFileSync(join(process.cwd(), "public/data/adventure/research", `${id}.json`), "utf8")) as ResearchMarketCase;
}
const a = data("lantern-a");
const b = data("lantern-b");
const c = data("lantern-c");
const d = data("lantern-d");
const schedule: FixedSchedule = { startingCashCents: 7200, participationCents: 4000, t1: 50, t2: 0 };
function status(profile: ResearchProfile, dimension: string): string | undefined { return profile.knowledge_observations.find((o) => o.dimension === dimension)?.status; }
function initial(profile: ResearchProfile, id: string, primary = a, priorExposure = false): ResearchProfile {
  return startHistory(profile, { id, caseId: primary.caseId, questionVersion: "v1", schedule, initialClaim: "outperform", priorExposure });
}
function observationRun() {
  const run = createRun({ source: "demo" });
  const snapshot = decisionSnapshot(run);
  run.history = [
    { id: "e1", node: "N2", type: "choice", action: "submit-entry", message: "", data: { amountCents: 0 }, snapshot },
    { id: "e2", node: "N3", type: "battle", action: "play-card", message: "", data: { cardId: "C04" } },
  ];
  return run;
}

describe("data-driven research observations", () => {
  it("T32: an empty profile reports unobserved, not a low ability", () => {
    const p = emptyResearchProfile();
    expect(p.knowledge_observations.map((x) => x.status)).toEqual(["unobserved", "unobserved", "unobserved"]);
    expect(recommendResearch(p).task_id).toBeNull();
    expect(recommendResearch(p).available_tasks).toEqual(["D1", "D2"]);
    expect(p.real_world_financial_capacity).toBe("not_assessed");
  });

  it("task-specific guidance is neutral for unobserved and never creates help exposure", () => {
    const p = emptyResearchProfile();
    const before = JSON.stringify(p);
    for (const task of ["D1", "D2"] as const) {
      const guidance = guidanceForTask(p, task);
      expect(guidance).toMatchObject({ task_id: task, help: "hint", explicit: false, evidence_ids: [] });
      expect(guidance.reason).toContain("暂无");
    }
    expect(guidanceForTask(p, null).reason).toContain("尚未选择");
    expect(JSON.stringify(p)).toBe(before);
    const off = emptyResearchProfile(false);
    expect(guidanceForTask(off, "D1")).toMatchObject({ help: "hint", explicit: false, evidence_ids: [] });
    expect(off.funding_exposure).toEqual([]);
  });

  it("guidance follows the task actually opened rather than the default topic", () => {
    let p = showHistoryEvidence(initial(emptyResearchProfile(), "independent-a", a), "independent-a", a);
    p = submitHistory(p, "independent-a", { comparison: "underperform", reason: "核对同期数字" }).profile;
    expect(guidanceForTask(p, "D2")).toMatchObject({ help: "self", explicit: false, evidence_ids: ["independent-a:K1"] });
    expect(guidanceForTask(p, "D1")).toMatchObject({ help: "hint", explicit: false, evidence_ids: [] });
    const chosen = setResearchGoal(p, "goal-funding", "funding");
    const recommendation = recommendResearch(chosen);
    expect(recommendation).toMatchObject({ task_id: "D1", help: guidanceForTask(chosen, "D1").help, help_reason: guidanceForTask(chosen, "D1").reason });
    expect(guidanceForTask(chosen, "D2").help).toBe("self");
  });

  it("explicit help preference wins but is not itself recorded as actual help exposure", () => {
    const p = setHelpPreference(emptyResearchProfile(), "prefer-steps", "step");
    expect(guidanceForTask(p, "D2")).toMatchObject({ help: "step", explicit: true, evidence_ids: ["prefer-steps"] });
    expect(p.funding_exposure).toEqual([]);
    let unexposed = showHistoryEvidence(initial(p, "not-shown", a), "not-shown", a);
    const result = submitHistory(unexposed, "not-shown", { comparison: "underperform", reason: "独立核对" });
    expect(result.profile.knowledge_evidence.at(-1)).toMatchObject({ help: "self", independent: true, counted: true });
    expect(result.recommendation).toMatchObject({ task_id: "D2", help: "step", help_explicit: true, help_evidence_ids: ["prefer-steps"] });
    expect(result.recommendation.reason).not.toContain("自主");
    expect(result.changes[0]!.explanation).toContain("帮助仍以你选择的分步说明为准");
    unexposed = showHistoryEvidence(initial(p, "actually-shown", a), "actually-shown", a);
    unexposed = markHistoryHelp(unexposed, "actually-shown", "hint");
    const aided = submitHistory(unexposed, "actually-shown", { comparison: "underperform", reason: "查看后核对" });
    expect(aided.profile.knowledge_evidence.at(-1)).toMatchObject({ help: "hint", independent: false, counted: true });
    expect(aided.recommendation.help).toBe("step");
  });

  it("a self-reported desire to try independently is explicit, but a later help choice takes precedence", () => {
    const autonomous = addUserReason(emptyResearchProfile(), "reason-self", "decision-1", "autonomous");
    expect(guidanceForTask(autonomous, "D1")).toMatchObject({ help: "self", explicit: true, evidence_ids: ["reason-self"] });
    const changed = setHelpPreference(autonomous, "later-help", "hint");
    expect(guidanceForTask(changed, "D1")).toMatchObject({ help: "hint", explicit: true, evidence_ids: ["later-help"] });
    expect(changed.funding_exposure).toEqual([]);
  });

  it("D1 preference is separate from actual help and a different task's result", () => {
    const example = mechanicalFundingExample();
    const scenario = { ...example.scenario, caseId: "test-historical" };
    const p = setHelpPreference(emptyResearchProfile(), "prefer-hint", "hint");
    const submission = { id: "independent-funding", questionVersion: "v1", plan: example.plan, purchaseId: "buy-upgrade", canPay: true, revisedPlan: example.plan, help: "self" as const, answerExposed: false, priorExposure: false };
    const result = submitFunding(p, scenario, submission);
    expect(result.profile.knowledge_evidence.at(-1)).toMatchObject({ help: "self", independent: true, counted: true });
    expect(result.recommendation).toMatchObject({ task_id: "D1", help: "hint", help_explicit: true });
    expect(result.change.explanation).toContain("帮助仍以你选择的提示为准");
    const key = fundingQuestionKey(scenario, submission.purchaseId, submission.questionVersion, submission.plan);
    const shown = markFundingHelp(p, key, "step");
    const aided = submitFunding(shown, scenario, { ...submission, id: "funding-help-shown" });
    expect(aided.profile.knowledge_evidence.at(-1)).toMatchObject({ help: "step", independent: false });
  });

  it("change explanations use the final whole-task guidance, not an intermediate K1 result", () => {
    let p = showHistoryEvidence(initial(emptyResearchProfile(), "mixed", a), "mixed", a, c);
    const result = submitHistory(p, "mixed", { comparison: "underperform", historyDifference: "outperform", boundary: "predicts_future", reason: "核查描述" });
    expect([status(result.profile, "K1"), status(result.profile, "K2")]).toEqual(["independent", "needs_confirmation"]);
    expect(result.recommendation).toMatchObject({ task_id: "D2", help: "hint" });
    expect(result.recommendation.help_reason).toContain("样本边界");
    for (const change of result.changes) {
      expect(change.explanation).toContain("本任务的帮助建议保持为提示");
      expect(change.explanation).not.toContain("调整为自主尝试");
      expect(result.profile.profile_changes.find((record) => record.id === change.id)).toEqual(change);
    }
    p = showHistoryEvidence(initial(emptyResearchProfile(), "correct-first", a), "correct-first", a);
    const first = submitHistory(p, "correct-first", { comparison: "underperform", reason: "独立核对" });
    expect(first.changes[0]!.explanation).toContain("帮助建议从提示调整为自主尝试");
    p = showHistoryEvidence(initial(first.profile, "conflict-next", c), "conflict-next", c);
    const conflicting = submitHistory(p, "conflict-next", { comparison: "underperform", reason: "不同情境" });
    expect(status(conflicting.profile, "K1")).toBe("conflicting");
    expect(conflicting.changes[0]!.explanation).toContain("相反结果");
    expect(conflicting.changes[0]!.explanation).toContain("帮助建议从自主尝试调整为提示");
  });

  it("actual fixed schedule uses same dates and next openings for benchmark and asset", () => {
    const result = compareSchedule(a, schedule);
    expect(result.asset.gainCents).toBe(-403);
    expect(result.benchmark.gainCents).toBe(3);
    expect(result.direction).toBe("underperform");
    expect(result.asset.timeline.map((x) => [x.step, x.date])).toEqual([
      ["entry", "20251104"], ["t1", "20251201"], ["t1-exec", "20251202"],
      ["t2", "20251229"], ["t2-exec", "20251230"], ["t3", "20260128"], ["final-exec", "20260129"],
    ]);
    expect(result.asset.heldPriceMaxDrawdown).toBeGreaterThan(0);
    expect(compareSchedule(c, schedule).asset.gainCents).toBe(275);
  });

  it("T27: same journey, different K1/K2 answers produce different observations without combat inference", () => {
    const run = observationRun();
    const base = updateJourney(emptyResearchProfile(), run);
    const otherRun = structuredClone(run);
    otherRun.history[1]!.data = { cardId: "C11", enemyId: "moss" };
    expect(observeJourney(run)).toEqual(observeJourney(otherRun));
    expect(base.journey_observations[0]!.source).toBe("demo");
    const p1 = showHistoryEvidence(initial(base, "correct"), "correct", a, c);
    const p2 = showHistoryEvidence(initial(base, "incorrect"), "incorrect", a, c);
    const good = submitHistory(p1, "correct", { comparison: "underperform", historyDifference: "outperform", boundary: "only_samples", reason: "比较同期数字和另一段样本" });
    const bad = submitHistory(p2, "incorrect", { comparison: "outperform", historyDifference: "underperform", boundary: "predicts_future", reason: "我的初步判断" });
    expect([status(good.profile, "K1"), status(good.profile, "K2")]).toEqual(["independent", "independent"]);
    expect([status(bad.profile, "K1"), status(bad.profile, "K2")]).toEqual(["needs_confirmation", "needs_confirmation"]);
    expect(good.recommendation.help_reason).not.toBe(bad.recommendation.help_reason);
    expect(good.profile.journey_observations).toEqual(bad.profile.journey_observations);
    expect(good.profile.research_process[0]!.final!.process).toBe("revised");
  });

  it("T28/T30: explicit goals and self-reported reasons change recommendation without rewriting facts", () => {
    const base = updateJourney(emptyResearchProfile(), observationRun());
    const funding = setResearchGoal(base, "goal-f", "funding");
    const history = setResearchGoal(base, "goal-h", "history");
    expect(recommendResearch(funding).task_id).toBe("D1");
    expect(recommendResearch(history).task_id).toBe("D2");
    expect(funding.knowledge_evidence).toEqual(history.knowledge_evidence);
    const upgrade = addUserReason(base, "r1", "e1", "upgrade");
    const confused = addUserReason(base, "r2", "e1", "not_understood");
    const uninterested = addUserReason(base, "r3", "e1", "not_interested");
    expect(recommendResearch(upgrade).reason).toContain("升级");
    expect(recommendResearch(confused).reason).toContain("不清楚");
    expect(recommendResearch(uninterested).task_id).toBeNull();
    expect(upgrade.journey_observations).toEqual(uninterested.journey_observations);
  });

  it("T29: help then an independent new case updates the profile; retry cannot erase exposure", () => {
    let p = showHistoryEvidence(initial(emptyResearchProfile(), "helped"), "helped", a);
    p = markHistoryHelp(p, "helped", "hint");
    p = markHistoryHelp(p, "helped", "self");
    const helped = submitHistory(p, "helped", { comparison: "underperform", reason: "对照数据" });
    expect(status(helped.profile, "K1")).toBe("assisted");
    p = showHistoryEvidence(initial(helped.profile, "new", b), "new", b);
    const independent = submitHistory(p, "new", { comparison: "underperform", reason: "两端点一致" });
    expect(independent.changes[0]).toMatchObject({ before: "assisted", after: "independent" });
    p = showHistoryEvidence(initial(independent.profile, "retry", b), "retry", b);
    p = submitHistory(p, "retry", { comparison: "outperform", reason: "重试" }).profile;
    expect(status(p, "K1")).toBe("independent");
    expect(p.knowledge_evidence.at(-1)).toMatchObject({ counted: false });
    p = showHistoryEvidence(initial(p, "already-seen", c, true), "already-seen", c);
    p = markHistoryAnswerExposed(p, "already-seen");
    p = submitHistory(p, "already-seen", { comparison: "outperform", reason: "已看过" }).profile;
    expect(p.knowledge_evidence.at(-1)).toMatchObject({ counted: false, priorExposure: true, answerExposed: true });
  });

  it("T31: conflicting unseen cases retain both pieces of evidence", () => {
    let p = showHistoryEvidence(initial(emptyResearchProfile(), "wrong"), "wrong", a);
    p = submitHistory(p, "wrong", { comparison: "outperform", reason: "第一次判断" }).profile;
    p = showHistoryEvidence(initial(p, "right", c), "right", c);
    p = submitHistory(p, "right", { comparison: "outperform", reason: "同期数据" }).profile;
    const observation = p.knowledge_observations.find((o) => o.dimension === "K1")!;
    expect(observation.status).toBe("conflicting");
    expect(observation.evidence_ids).toEqual(["wrong:K1", "right:K1"]);
  });

  it("opening another D2 attempt cannot erase help or previously displayed case data", () => {
    let p = initial(emptyResearchProfile(), "first");
    p = markHistoryHelp(p, "first", "step");
    p = showHistoryEvidence(p, "first", a);
    p = initial(p, "reopened");
    const reopened = p.research_process.at(-1)!;
    expect(reopened.helpUsed).toBe("step");
    expect(reopened.priorExposure).toBe(true);
    p = showHistoryEvidence(p, "reopened", a);
    const done = submitHistory(p, "reopened", { comparison: "underperform", reason: "复核" });
    expect(done.profile.knowledge_evidence.at(-1)?.counted).toBe(false);
  });

  it("once displayed, the evidence cannot be rewritten by a later data object", () => {
    let p = showHistoryEvidence(initial(emptyResearchProfile(), "frozen"), "frozen", a);
    const altered = structuredClone(a);
    altered.execution[3]!.price *= 3;
    p = showHistoryEvidence(p, "frozen", altered);
    expect(p.research_process[0]!.shown!.primary.asset.gainCents).toBe(-403);
  });

  it("K2 excludes an already-seen secondary case without downgrading a fresh primary K1", () => {
    let p = showHistoryEvidence(initial(emptyResearchProfile(), "seen-a", a), "seen-a", a);
    p = initial(p, "fresh-b", b);
    expect(p.research_process.at(-1)?.priorExposure).toBe(false);
    p = showHistoryEvidence(p, "fresh-b", b, a);
    expect(p.research_process.at(-1)?.shown?.otherPriorExposure).toBe(true);
    const result = submitHistory(p, "fresh-b", { comparison: "underperform", historyDifference: "underperform", boundary: "only_samples", reason: "比较两段历史" });
    expect(result.profile.knowledge_evidence.find((e) => e.id === "fresh-b:K1")).toMatchObject({ counted: true, independent: true, priorExposure: false });
    expect(result.profile.knowledge_evidence.find((e) => e.id === "fresh-b:K2")).toMatchObject({ counted: false, independent: false, priorExposure: true });
  });

  it("a caller-reported secondary exposure does not contaminate K1", () => {
    let p = initial(emptyResearchProfile(), "b-and-known-a", b);
    p = showHistoryEvidence(p, "b-and-known-a", b, a, true);
    const result = submitHistory(p, "b-and-known-a", { comparison: "underperform", historyDifference: "underperform", boundary: "only_samples", reason: "比较" });
    expect(result.profile.knowledge_evidence.map((e) => [e.dimension, e.counted, e.independent])).toEqual([["K1", true, true], ["K2", false, false]]);
  });

  it("secondary exposure is frozen at first display when a page is restored", () => {
    let p = showHistoryEvidence(initial(emptyResearchProfile(), "fresh-pair", a), "fresh-pair", a, b, false);
    expect(p.research_process.at(-1)?.shown?.otherPriorExposure).toBe(false);
    p = showHistoryEvidence(p, "fresh-pair", a, b, true);
    expect(p.research_process.at(-1)?.shown?.otherPriorExposure).toBe(false);
    const done = submitHistory(p, "fresh-pair", { comparison: "underperform", historyDifference: "outperform", boundary: "only_samples", reason: "两段都首次查看" });
    expect(done.profile.knowledge_evidence.find((e) => e.dimension === "K2")).toMatchObject({ counted: true, independent: true });
  });

  it("switching primary and secondary cannot turn the same pair into new evidence", () => {
    let p = showHistoryEvidence(initial(emptyResearchProfile(), "a-b", a), "a-b", a, b);
    p = submitHistory(p, "a-b", { comparison: "underperform", historyDifference: "outperform", boundary: "only_samples", reason: "先比较" }).profile;
    const first = p.knowledge_evidence.find((e) => e.id === "a-b:K2")!;
    expect(first.counted).toBe(true);
    p = initial(p, "b-a", b);
    expect(p.research_process.at(-1)?.priorExposure).toBe(true);
    p = showHistoryEvidence(p, "b-a", b, a);
    p = submitHistory(p, "b-a", { comparison: "underperform", historyDifference: "underperform", boundary: "only_samples", reason: "对调复查" }).profile;
    const second = p.knowledge_evidence.find((e) => e.id === "b-a:K2")!;
    expect(second.questionKey).toBe(first.questionKey);
    expect(second.counted).toBe(false);
  });

  it("C and D are related: later viewing does not erase earlier independent evidence", () => {
    let p = showHistoryEvidence(initial(emptyResearchProfile(), "first-c", c), "first-c", c);
    p = submitHistory(p, "first-c", { comparison: compareSchedule(c, schedule).direction, reason: "模拟：核对基准" }).profile;
    expect(status(p, "K1")).toBe("independent");
    const original = structuredClone(p.knowledge_evidence[0]);
    p = initial(p, "later-d", d);
    expect(p.research_process.at(-1)?.priorExposure).toBe(true);
    p = showHistoryEvidence(p, "later-d", d);
    p = submitHistory(p, "later-d", { comparison: compareSchedule(d, schedule).direction, reason: "模拟：重叠片段" }).profile;
    expect(p.knowledge_evidence[0]).toEqual(original);
    expect(p.knowledge_evidence.at(-1)).toMatchObject({ priorExposure: true, counted: false });
    expect(status(p, "K1")).toBe("independent");
  });

  it("a fresh C/D comparison is labelled related practice rather than independent K2", () => {
    let p = showHistoryEvidence(initial(emptyResearchProfile(), "pair-cd", c), "pair-cd", c, d);
    const x = compareSchedule(c, schedule).asset.gainCents;
    const y = compareSchedule(d, schedule).asset.gainCents;
    const difference = y > x ? "outperform" : y < x ? "underperform" : "equal";
    const result = submitHistory(p, "pair-cd", { comparison: compareSchedule(c, schedule).direction, historyDifference: difference, boundary: "only_samples", reason: "模拟：核对重叠片段" });
    expect(result.profile.knowledge_evidence.find((e) => e.dimension === "K1")).toMatchObject({ counted: true, independent: true });
    expect(result.profile.knowledge_evidence.find((e) => e.dimension === "K2")).toMatchObject({ counted: false, independent: false, exclusion_reason: "这两段历史互相重叠，只作相关情境练习，不增加独立依据。" });
  });

  it("explicit prior-exposure disclosure revises only related dimensions without rewriting events", () => {
    let p = showHistoryEvidence(initial(emptyResearchProfile(true, "demo"), "b-c", b), "b-c", b, c);
    const bGain = compareSchedule(b, schedule).asset.gainCents;
    const cGain = compareSchedule(c, schedule).asset.gainCents;
    p = submitHistory(p, "b-c", { comparison: compareSchedule(b, schedule).direction, historyDifference: cGain > bGain ? "outperform" : cGain < bGain ? "underperform" : "equal", boundary: "only_samples", reason: "模拟：比较两个样本" }).profile;
    expect([status(p, "K1"), status(p, "K2")]).toEqual(["independent", "independent"]);
    // Simulated legacy state: the original events predate the new related-case rule.
    const f = { id: "simulated-forecast", caseId: "lantern-d", amountCents: 4000, lossMin: .1, lossMax: .2, minCashCents: 1000, minHealthRatio: .5, feeling: "mild" as const, action: "continue" as const, priorExposure: false, beforeFuture: true };
    const ctx: CalibrationContext = { caseId: "lantern-d", node: "N4", amountCents: 4000, referenceValueCents: 3485, cashCents: 3200, health: 30, maxHealth: 42, priorExposure: false, autonomousChoice: true, pendingSettlement: false, forcedOrAutomatic: false, changedGoalOrUnderstanding: false, afterCloseBeforeExecution: true, sameShareBasis: true };
    let earlier = saveForecast(emptyResearchProfile(true, "demo"), f);
    earlier = recordCalibrationFeeling(earlier, f.id, ctx, "strong");
    earlier = recordCalibrationAction(earlier, f.id, "continue", "模拟自报");
    expect(earlier.calibration[0]?.comparison).toBe("matched");
    p = { ...p, forecasts: earlier.forecasts, calibration: earlier.calibration };
    const originals = structuredClone({ tasks: p.research_process, evidence: p.knowledge_evidence, forecasts: p.forecasts, calibration: p.calibration });
    const result = declarePriorExposure(p, { id: "user-disclosure", caseId: "lantern-d", priorToTasks: true });
    expect([status(result.profile, "K1"), status(result.profile, "K2")]).toEqual(["independent", "unobserved"]);
    expect(result.changes).toMatchObject([{ dimension: "K2", before: "independent", after: "unobserved", addedEvidence: "user-disclosure" }]);
    expect(result.profile.knowledge_observations.find((o) => o.dimension === "K2")).toMatchObject({ excluded_evidence_ids: ["b-c:K2"], disclosure_ids: ["user-disclosure"] });
    expect(result.calibrationChanges).toMatchObject([{ forecastId: f.id, before: "matched", after: "unavailable", evidenceId: "user-disclosure" }]);
    expect(calibrationForDisplay(result.profile)[0]).toMatchObject({ comparison: "unavailable", affectComparison: "unknown", actionComparison: "unknown", feeling: "strong", action: "continue" });
    expect({ tasks: result.profile.research_process, evidence: result.profile.knowledge_evidence, forecasts: result.profile.forecasts, calibration: result.profile.calibration }).toEqual(originals);
    expect(result.recommendation.reason_type).not.toBe("calibration");
    expect(result.profile.prior_exposure_disclosures[0]).toMatchObject({ id: "user-disclosure", caseId: "lantern-d", relatedCaseIds: ["lantern-c", "lantern-d"] });
  });

  it("a disclosure affects pending and later related tasks, and only-play stores nothing", () => {
    const off = emptyResearchProfile(false);
    expect(declarePriorExposure(off, { id: "off", caseId: "lantern-c", priorToTasks: true }).profile).toEqual(off);
    let p = initial(emptyResearchProfile(), "pending-d", d);
    p = declarePriorExposure(p, { id: "earlier-c", caseId: "lantern-c", priorToTasks: true }).profile;
    p = showHistoryEvidence(p, "pending-d", d);
    p = submitHistory(p, "pending-d", { comparison: compareSchedule(d, schedule).direction, reason: "模拟：已见" }).profile;
    expect(p.knowledge_evidence.at(-1)).toMatchObject({ priorExposure: true, counted: false });
    const forecast = { id: "later-forecast", caseId: "lantern-d", amountCents: 4000, lossMin: .1, lossMax: .2, minCashCents: 1000, minHealthRatio: .5, feeling: null, action: null, priorExposure: false, beforeFuture: true };
    p = saveForecast(p, forecast);
    expect(p.forecasts.at(-1)?.priorExposure).toBe(true);
    expect(revokeResearch(p).prior_exposure_disclosures).toEqual([]);
  });

  it("T33 D1: stops at unaffordable purchase, checks answer, saves and rechecks a revised plan", () => {
    const example = mechanicalFundingExample(); const scenario = { ...example.scenario, caseId: "test-historical" }; const plan = example.plan;
    const high = { ...plan, participationCents: 6000 };
    const timeline = simulateFundingPlan(scenario, high);
    expect(timeline.stoppedAt).toBe("buy-upgrade");
    expect(timeline.rows.at(-1)).toMatchObject({ canPay: false, cashBeforeCents: 1200 });
    expect(timeline.rows.some((row) => row.id === "income")).toBe(false);
    const r = submitFunding(emptyResearchProfile(), scenario, { id: "fund-1", questionVersion: "v1", plan: high, purchaseId: "buy-upgrade", canPay: false, revisedPlan: plan, help: "self", answerExposed: false, priorExposure: false });
    expect(r.change).toMatchObject({ before: "unobserved", after: "independent" });
    expect(r.profile.funding_exposure).toContainEqual(expect.objectContaining({ questionKey: fundingQuestionKey(scenario, "buy-upgrade", "v1", high), answerExposed: true }));
    expect(r.revisedTimeline.stoppedAt).toBeNull();
    expect(r.profile.funding_attempts[0]!.revisedPlan).toEqual(plan);
    plan.recovery.final = 0;
    expect(r.profile.funding_attempts[0]!.revisedPlan.recovery.final).toBe(100);
  });

  it("D1 help and answer exposure cannot be cleared by a later submission", () => {
    const example = mechanicalFundingExample(); const scenario = { ...example.scenario, caseId: "test-historical" }; const plan = example.plan;
    const key = fundingQuestionKey(scenario, "buy-upgrade", "v1", plan);
    let profile = markFundingHelp(emptyResearchProfile(), key, "hint");
    profile = markFundingHelp(profile, key, "self");
    const submit = { id: "hinted", questionVersion: "v1", plan, purchaseId: "buy-upgrade", canPay: true, revisedPlan: plan, help: "self" as const, answerExposed: false, priorExposure: false };
    const result = submitFunding(profile, scenario, submit);
    expect(result.profile.knowledge_evidence.at(-1)).toMatchObject({ help: "hint", independent: false, counted: true });
    profile = markFundingAnswerExposed(profile, key);
    const seen = submitFunding(profile, scenario, { ...submit, id: "seen" });
    expect(seen.profile.knowledge_evidence.at(-1)).toMatchObject({ answerExposed: true, counted: false });
  });

  it("D1 same question exposure survives a new profile but does not downgrade another question", () => {
    const example = mechanicalFundingExample(); const scenario = { ...example.scenario, caseId: "test-historical" }; const plan = example.plan;
    const key = fundingQuestionKey(scenario, "buy-upgrade", "v1", plan);
    const saved = markFundingAnswerExposed(markFundingHelp(emptyResearchProfile(), key, "hint"), key).funding_exposure;
    const nextRun = { ...emptyResearchProfile(), funding_exposure: structuredClone(saved) };
    const common = { questionVersion: "v1", plan, canPay: true, revisedPlan: plan, help: "self" as const, answerExposed: false, priorExposure: false };
    const same = submitFunding(nextRun, scenario, { ...common, id: "same-question", purchaseId: "buy-upgrade" });
    expect(same.profile.knowledge_evidence.at(-1)).toMatchObject({ help: "hint", answerExposed: true, counted: false });
    const second = { ...scenario, events: [...scenario.events.slice(0, 2), { id: "another-purchase", label: "另一次采购", kind: "purchase" as const, amountCents: 500 }, ...scenario.events.slice(2)] };
    const fresh = submitFunding(nextRun, second, { ...common, id: "different-question", purchaseId: "another-purchase" });
    expect(fresh.profile.knowledge_evidence.at(-1)).toMatchObject({ help: "self", answerExposed: false, counted: true, independent: true });
    expect(revokeResearch(nextRun).funding_exposure).toEqual([]);
    expect(markFundingHelp(emptyResearchProfile(false), key, "step").funding_exposure).toEqual([]);
  });

  it("D1 stable identity detects identical economics across runs but distinguishes new questions", () => {
    const example = mechanicalFundingExample(); const scenario = { ...example.scenario, caseId: "test-historical", id: "run-one" }; const plan = example.plan;
    const key = fundingQuestionKey(scenario, "buy-upgrade", "v1", plan);
    const replay = { ...scenario, id: "run-two" };
    expect(fundingQuestionKey(replay, "buy-upgrade", "v1", plan)).toBe(key);
    expect(fundingQuestionKey(replay, "buy-upgrade", "v1", { ...plan, participationCents: 3000 })).not.toBe(key);
    const changedFuture = { ...replay, events: replay.events.map((e) => e.id === "final" && e.kind === "recovery" ? { ...e, price: 777777 } : e) };
    expect(fundingQuestionKey(changedFuture, "buy-upgrade", "v1", plan)).toBe(key);
    const withExposure = markFundingAnswerExposed(emptyResearchProfile(), key);
    const nextRun = { ...emptyResearchProfile(), funding_exposure: withExposure.funding_exposure };
    const submitted = submitFunding(nextRun, replay, { id: "repeat", questionVersion: "v1", plan, purchaseId: "buy-upgrade", canPay: true, revisedPlan: plan, help: "self", answerExposed: false, priorExposure: false });
    expect(submitted.profile.knowledge_evidence.at(-1)).toMatchObject({ answerExposed: true, counted: false });
  });

  it("the shared artificial example is practice without claiming prior user exposure", () => {
    const { scenario, plan } = mechanicalFundingExample();
    const result = submitFunding(emptyResearchProfile(), scenario, { id: "manual", questionVersion: "v1", plan, purchaseId: "buy-upgrade", canPay: true, revisedPlan: plan, help: "self", answerExposed: false, priorExposure: false });
    expect(result.profile.knowledge_evidence.at(-1)).toMatchObject({ correct: true, independent: false, counted: false, priorExposure: false, exclusion_reason: "人工示例仅用于练习，不增加能力依据。" });
    expect(result.change).toMatchObject({ before: "unobserved", after: "unobserved" });
    expect(result.change.explanation).toContain("人工示例仅用于练习，不增加能力依据。");
    expect(result.profile.funding_exposure).toEqual([]);
  });

  it("merging duplicate D1 exposure records preserves the strongest help and any answer exposure", () => {
    const { scenario, plan } = mechanicalFundingExample();
    const key = fundingQuestionKey(scenario, "buy-upgrade", "v1", plan);
    const profile = { ...emptyResearchProfile(), funding_exposure: [
      { questionKey: key, help: "self" as const, answerExposed: false, priorExposure: false },
      { questionKey: key, help: "step" as const, answerExposed: true, priorExposure: false },
    ] };
    const merged = markFundingHelp(profile, key, "self");
    expect(merged.funding_exposure).toEqual([{ questionKey: key, help: "step", answerExposed: true, priorExposure: false }]);
  });

  it("redemption with zero shares does not count as a meaningful opportunity", () => {
    const run = observationRun();
    const snapshot = { ...decisionSnapshot(run), shareUnits: "0" };
    run.history.push({ id: "e3", node: "N4", type: "choice", action: "submit-redemption", message: "", data: { percent: 50 }, snapshot });
    const zero = observeJourney(run).at(-1)!;
    expect(zero).toMatchObject({ rule_id: "J0-00", eligible_opportunities: 0, observed_choices: 0 });
    run.history[2]!.snapshot!.shareUnits = "1000000000000";
    expect(observeJourney(run).at(-1)).toMatchObject({ rule_id: "J3-01", eligible_opportunities: 1 });
  });

  it("repeated identical unaffordable clicks do not manufacture extra opportunities", () => {
    const run = observationRun();
    const snapshot = { ...decisionSnapshot(run), cashCents: 1000 };
    for (const id of ["e3", "e4"]) run.history.push({ id, node: "N3", type: "choice", action: "purchase-attempted", message: "", data: { reason: "insufficient-cash", purchase: "upgrade-card", cardInstanceId: "card-1", priceCents: 2000 }, snapshot });
    expect(observeJourney(run).filter((o) => o.rule_id === "J1-03")).toHaveLength(1);
  });

  it("T23: repeatedly opening the same archive creates only one evidence item", () => {
    const run = observationRun();
    const snapshot = { ...decisionSnapshot(run), archiveOwned: true };
    for (let i = 0; i < 10; i++) run.history.push({ id: `archive-${i}`, node: "N4", type: "choice", action: "open-archive", message: "", data: {}, snapshot });
    const records = observeJourney(run).filter((o) => o.rule_id === "J2-01");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ eligible_opportunities: 1, observed_choices: 1, evidence_ids: ["archive-0"] });
  });

  it("entry reservation precedes pre-execution purchase and exposes no future price or shares", () => {
    const run = createRun();
    const snapshot = { ...decisionSnapshot(run), cashCents: 7200 };
    run.history = [
      { id: "e1", node: "N2", type: "choice", action: "submit-entry", message: "", data: { amountCents: 4000 }, snapshot },
      { id: "e2", node: "N2", type: "choice", action: "heal", message: "", data: { amountCents: 1000 }, snapshot },
      { id: "e3", node: "N2", type: "market", action: "apply-quote", message: "", data: { stage: "entry", price: 994131 } },
    ];
    run.wallet.ledger = [
      { id: "opening", node: "N1", kind: "opening", cashDeltaCents: 7200, cashAfterCents: 7200, description: "起始" },
      { id: "e3", node: "N2", kind: "purchase", cashDeltaCents: -1000, cashAfterCents: 2200, description: "补给" },
    ];
    const generated = fundingScenarioFromRun(run)!;
    const rows = simulateFundingPlan(generated.scenario, generated.plan).rows;
    expect(rows.map((r) => r.kind)).toEqual(["entry", "purchase", "entry-exec"]);
    expect(rows[1]).toMatchObject({ cashBeforeCents: 3200, cashCents: 2200, shareUnits: "0", referenceValueCents: null });
    expect(BigInt(rows[2]!.shareUnits)).toBeGreaterThan(0n);
    const halted = simulateFundingPlan(generated.scenario, { ...generated.plan, participationCents: 7000 });
    expect(halted.stoppedAt).not.toBeNull();
    expect(halted.rows.map((r) => r.kind)).toEqual(["entry", "purchase"]);
    expect(halted.rows.at(-1)!.referenceValueCents).toBeNull();
  });

  it("automatic end-of-run recovery always sells all remaining shares", () => {
    const { scenario, plan } = mechanicalFundingExample();
    const result = simulateFundingPlan(scenario, { ...plan, recovery: { ...plan.recovery, final: 0 } });
    expect(result.rows.at(-1)).toMatchObject({ id: "final", shareUnits: "0" });
  });

  it("a changed plan with shares at an unquoted end remains pending until a matching later opening", () => {
    const { scenario, plan } = mechanicalFundingExample();
    const pending = { ...scenario, caseId: "lantern-a", events: scenario.events.filter((e) => e.id !== "final"), pendingFinal: { stage: "exit-after-entry" as const, afterDate: "20251104" } };
    const result = simulateFundingPlan(pending, plan);
    expect(result.stoppedAt).toBe("pending-final-quote");
    expect(result.pendingFinal?.stage).toBe("exit-after-entry");
    expect(() => attachFundingFinalQuote(pending, { caseId: "lantern-a", step: "exit-after-entry", date: "20251104", price: 981612 })).toThrow();
    const completed = attachFundingFinalQuote(pending, { caseId: "lantern-a", step: "exit-after-entry", date: "20251105", price: 981612 });
    const done = simulateFundingPlan(completed, plan);
    expect(done.stoppedAt).toBeNull();
    expect(done.rows.at(-1)?.shareUnits).toBe("0");
  });

  it("disabled or revoked observation preserves playable, non-persisting practice", () => {
    let p = emptyResearchProfile(false);
    expect(setResearchGoal(p, "x", "funding")).toEqual(p);
    const { scenario, plan } = mechanicalFundingExample();
    const answer = evaluateFundingPractice(scenario, { plan, purchaseId: "buy-upgrade", canPay: true, revisedPlan: plan });
    expect(answer.correct).toBe(true);
    expect(evaluateHistoryPractice(a, c, schedule, { comparison: "underperform", historyDifference: "outperform", boundary: "only_samples", reason: "" })).toMatchObject({ comparisonCorrect: true, boundaryCorrect: true });
    expect(p.knowledge_evidence).toEqual([]);
    p = revokeResearch(setResearchGoal(emptyResearchProfile(), "goal", "history"));
    expect(p.enabled).toBe(false);
    expect(p.stated_interest).toEqual([]);
  });

  it("calibration requires natural, predeclared matching conditions", () => {
    const forecast: Forecast = { id: "f1", caseId: "lantern-a", amountCents: 4000, lossMin: .1, lossMax: .2, minCashCents: 1000, minHealthRatio: .5, feeling: "mild", action: "continue", priorExposure: false, beforeFuture: true, withdrawn: false };
    const context: CalibrationContext = { caseId: "lantern-a", node: "N4", amountCents: 4000, referenceValueCents: 3400, cashCents: 2000, health: 30, maxHealth: 42, priorExposure: false, autonomousChoice: true, pendingSettlement: false, forcedOrAutomatic: false, changedGoalOrUnderstanding: false, afterCloseBeforeExecution: true, sameShareBasis: true };
    expect(compareSelfForecast(forecast, context, "strong", "continue")).toMatchObject({ comparison: "matched", affectComparison: "stronger", actionComparison: "same" });
    expect(compareSelfForecast(forecast, { ...context, health: 10 }, "strong", "all")).toMatchObject({ comparison: "unavailable", affectComparison: "unknown", actionComparison: "unknown" });
    const p = saveForecast(emptyResearchProfile(), (({ withdrawn: _withdrawn, ...rest }) => rest)(forecast));
    const p2 = saveForecast(p, { ...forecast, id: "f2", amountCents: 3000 });
    expect(p2.forecasts[0]!.withdrawn).toBe(true);
  });

  it("simulated forecast is saved after the entry order but before actual D quotes and legal N4 actions", async () => {
    let profile = emptyResearchProfile(true, "demo");
    const order: string[] = [];
    resetMarketCacheForTest();
    vi.stubGlobal("fetch", async (url: string) => {
      const path = String(url).split("/data/adventure/")[1]!;
      if (path === "stages/lantern-d/entry.json") {
        profile = saveForecast(profile, { id: "simulated-before-entry", caseId: "lantern-d", amountCents: 2000,
          lossMin: .1, lossMax: .2, minCashCents: 1000, minHealthRatio: .5, feeling: "mild", action: "continue", priorExposure: false, beforeFuture: true });
        order.push("simulated-forecast-saved");
      }
      order.push(path);
      return new Response(readFileSync(join(process.cwd(), "public/data/adventure", path)), { status: 200 });
    });
    try {
      const run = await makeCalibrationDemo();
      const context = calibrationDemoContext(run);
      expect(order).toEqual(["simulated-forecast-saved", "stages/lantern-d/entry.json", "stages/lantern-d/t1.json"]);
      expect(context).toMatchObject({ referenceValueCents: 1743, cashCents: 3900, health: 42, afterCloseBeforeExecution: true });
      profile = recordCalibrationFeeling(profile, "simulated-before-entry", context, "strong");
      profile = recordCalibrationAction(profile, "simulated-before-entry", "continue", "模拟测试输入");
      expect(profile.source).toBe("demo");
      expect(calibrationForDisplay(profile)[0]).toMatchObject({ comparison: "matched", affectComparison: "stronger", actionComparison: "same", reason: "模拟测试输入" });
      expect(compareSelfForecast(profile.forecasts[0]!, { ...context, health: 20 }, "strong", "continue")).toMatchObject({ comparison: "unavailable", affectComparison: "unknown" });
    } finally {
      vi.unstubAllGlobals();
      resetMarketCacheForTest();
    }
  });
});
