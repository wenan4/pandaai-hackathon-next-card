import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ResearchMarketCase } from "./market";
import { validateResearchProfile } from "./profile-validation";
import {
  addUserReason, declarePriorExposure, emptyResearchProfile, markPendingHistoryExposure, mechanicalFundingExample, recordCalibrationAction,
  recordCalibrationFeeling, revokeResearch, saveForecast, setHelpPreference, setResearchGoal, showHistoryEvidence,
  startHistory, submitFunding, submitHistory,
} from "./research";

/** Build actual records through the model; the test choices are simulated inputs. */
function populatedProfile() {
  const data = (id: string): ResearchMarketCase => JSON.parse(readFileSync(join(process.cwd(), "public/data/adventure/research", `${id}.json`), "utf8")) as ResearchMarketCase;
  const example = mechanicalFundingExample();
  let profile = setResearchGoal(emptyResearchProfile(true, "real"), "goal", "history");
  profile = setHelpPreference(profile, "preference", "hint");
  profile = addUserReason(profile, "reason", "simulated-choice", "other", "模拟测试输入");
  profile = submitFunding(profile, { ...example.scenario, caseId: "test-synthetic" }, {
    id: "funding", questionVersion: "v1", plan: example.plan, purchaseId: "buy-upgrade", canPay: true,
    revisedPlan: example.plan, help: "self", answerExposed: false, priorExposure: false,
  }).profile;
  const schedule = { startingCashCents: 7200, participationCents: 4000, t1: 50, t2: 0 } as const;
  profile = startHistory(profile, { id: "history", caseId: "lantern-a", questionVersion: "v1", schedule, initialClaim: "unknown", priorExposure: false });
  profile = showHistoryEvidence(profile, "history", data("lantern-a"), data("lantern-b"));
  profile = submitHistory(profile, "history", { comparison: "underperform", historyDifference: "outperform", boundary: "only_samples", reason: "模拟核对" }).profile;
  profile = saveForecast(profile, { id: "forecast", caseId: "lantern-d", amountCents: 2000, lossMin: .1, lossMax: .2, minCashCents: 1000, minHealthRatio: .5, feeling: "mild", action: "continue", priorExposure: false, beforeFuture: true });
  const context = { caseId: "lantern-d", node: "N4", amountCents: 2000, referenceValueCents: 1743, cashCents: 3900, health: 42, maxHealth: 42, priorExposure: false, autonomousChoice: true, pendingSettlement: false, forcedOrAutomatic: false, changedGoalOrUnderstanding: false, afterCloseBeforeExecution: true, sameShareBasis: true };
  profile = recordCalibrationFeeling(profile, "forecast", context, "strong");
  profile = recordCalibrationAction(profile, "forecast", "continue", "模拟测试输入");
  return declarePriorExposure(profile, { id: "disclosure", caseId: "lantern-a", priorToTasks: true }).profile;
}

describe("research profile recovery validation", () => {
  it("accepts and preserves complete model-generated records, including the disclosure and calibration", () => {
    const original = populatedProfile();
    const snapshot = structuredClone(original);
    const result = validateResearchProfile(original, "real");
    expect(result).toEqual({ ok: true, profile: snapshot });
    expect(original).toEqual(snapshot);
    expect(validateResearchProfile(emptyResearchProfile(false), "real").ok).toBe(true);
  });

  it("keeps the public research-v1 legacy fields compatible without inventing observations", () => {
    const legacy = JSON.parse(JSON.stringify(emptyResearchProfile(true, "real")));
    delete legacy.source;
    delete legacy.funding_exposure;
    delete legacy.prior_exposure_disclosures;
    for (const item of legacy.knowledge_observations) { delete item.excluded_evidence_ids; delete item.disclosure_ids; }
    legacy.futureCompatibleField = "preserve";
    const before = structuredClone(legacy);
    const result = validateResearchProfile(legacy, "real");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.profile).toMatchObject({ source: "real", funding_exposure: [], prior_exposure_disclosures: [], knowledge_evidence: [], futureCompatibleField: "preserve" });
    expect(result.profile.knowledge_observations.every((item) => item.status === "unobserved" && !item.excluded_evidence_ids.length && !item.disclosure_ids.length)).toBe(true);
    expect(legacy).toEqual(before);
  });

  it("accepts legacy case-only exposure and preserves its actual help and answer state", () => {
    const profile = emptyResearchProfile();
    profile.funding_exposure = [{ caseId: "lantern-a", help: "step", answerExposed: true, priorExposure: false }];
    expect(validateResearchProfile(profile, "real")).toMatchObject({ ok: true, profile: { funding_exposure: profile.funding_exposure } });
  });

  it("round-trips optional post-lock exposure and rejects malformed IDs without changing legacy records", () => {
    const schedule = { startingCashCents: 7200, participationCents: 2000, t1: 0, t2: 0 } as const;
    const locked = startHistory(emptyResearchProfile(), { id: "locked", caseId: "lantern-c", questionVersion: "v1", schedule, initialClaim: "unknown", priorExposure: false });
    const exposed = markPendingHistoryExposure(locked, "lantern-d");
    const restored = validateResearchProfile(JSON.parse(JSON.stringify(exposed)), "real");
    expect(restored).toMatchObject({ ok: true, profile: { research_process: [{ priorExposure: false, exposedCaseIdsAfterLock: ["lantern-d"] }] } });
    const legacy = validateResearchProfile(JSON.parse(JSON.stringify(locked)), "real");
    expect(legacy.ok).toBe(true);
    for (const invalid of [null, [], [""], ["  "], [12], "lantern-d"]) {
      const damaged = JSON.parse(JSON.stringify(exposed));
      damaged.research_process[0].exposedCaseIdsAfterLock = invalid;
      expect(validateResearchProfile(damaged, "real").ok).toBe(false);
    }
  });

  it("rejects missing required fields and malformed legacy fields rather than replacing evidence", () => {
    for (const damage of [
      (p: Record<string, unknown>) => { delete p.research_process; },
      (p: Record<string, unknown>) => { p.funding_exposure = null; },
      (p: Record<string, unknown>) => { p.source = ""; },
      (p: Record<string, unknown>) => { p.prior_exposure_disclosures = {}; },
      (p: Record<string, unknown>) => { p.enabled = "false"; },
    ]) {
      const profile = JSON.parse(JSON.stringify(populatedProfile())) as Record<string, unknown>;
      damage(profile);
      const snapshot = structuredClone(profile);
      expect(validateResearchProfile(profile, "real").ok).toBe(false);
      expect(profile).toEqual(snapshot);
    }
  });

  it("validates nested records and never treats a mismatched simulated source as real", () => {
    const profile = populatedProfile();
    expect(validateResearchProfile(profile, "demo").ok).toBe(false);
    const badSource = structuredClone(profile);
    badSource.knowledge_evidence[0]!.source = "demo";
    expect(validateResearchProfile(badSource, "real").ok).toBe(false);
    const badNested = JSON.parse(JSON.stringify(profile));
    badNested.research_process[0].shown.primary.asset.timeline = null;
    expect(validateResearchProfile(badNested, "real").ok).toBe(false);
    badNested.research_process[0].shown.primary.asset.timeline = [];
    badNested.funding_attempts[0].timeline.rows[0].cashCents = "0";
    expect(validateResearchProfile(badNested, "real").ok).toBe(false);
  });

  it("rejects a structurally valid independent status without supporting evidence", () => {
    const profile = emptyResearchProfile();
    profile.knowledge_observations[0]!.status = "independent";
    expect(validateResearchProfile(profile, "real").ok).toBe(false);
    const inconsistentEvidence = populatedProfile();
    inconsistentEvidence.knowledge_evidence[0]!.help = "step";
    inconsistentEvidence.knowledge_evidence[0]!.independent = true;
    expect(validateResearchProfile(inconsistentEvidence, "real").ok).toBe(false);
  });

  it("does not restore leftover observations from an explicitly disabled profile", () => {
    const profile = populatedProfile();
    profile.enabled = false;
    expect(validateResearchProfile(profile, "real")).toMatchObject({ ok: false });
    expect(validateResearchProfile(revokeResearch(profile), "real")).toMatchObject({ ok: true, profile: { enabled: false, knowledge_evidence: [], funding_exposure: [] } });
  });
});
