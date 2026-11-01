import { z } from "zod";
import type { FundingExposure, ResearchProfile } from "./research";
import type { RunSource } from "./types";

// Recovery validates the saved facts; it must not manufacture evidence when
// a field is damaged. Passthrough keeps fields written by compatible clients.
const record = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough();
const id = z.string().min(1);
const source = z.enum(["real", "demo", "fork"]);
const help = z.enum(["self", "hint", "step"]);
const dimension = z.enum(["K1", "K2", "K3"]);
const status = z.enum(["unobserved", "independent", "assisted", "needs_confirmation", "conflicting"]);
const direction = z.enum(["outperform", "underperform", "equal"]);
const boundary = z.enum(["only_samples", "predicts_future"]);
const feeling = z.enum(["low", "mild", "noticeable", "strong", "unknown"]);
const contractAction = z.enum(["continue", "half", "all", "unknown"]);
const percent = z.union([z.literal(0), z.literal(50), z.literal(100)]);
const numeric = z.number().finite();
const integer = numeric.int().safe();
const strings = z.array(z.string());

const exposure = record({
  questionKey: id.optional(), caseId: id.optional(), help,
  answerExposed: z.boolean(), priorExposure: z.boolean(),
}).refine((entry) => !!entry.questionKey || !!entry.caseId);

/** Both current question identities and old case-only identities are valid. */
export function isFundingExposure(value: unknown): value is FundingExposure {
  return exposure.safeParse(value).success;
}

const journey = record({
  rule_id: id, source, scope: z.literal("one_decision"), text: z.string(),
  evidence_ids: strings, eligible_opportunities: integer, observed_choices: integer, limitations: strings,
});
const evidence = record({
  id, source, questionKey: id, caseId: id, dimension, correct: z.boolean(),
  independent: z.boolean(), counted: z.boolean(), help, answerExposed: z.boolean(),
  priorExposure: z.boolean(), exclusion_reason: z.string().optional(), evidence_ids: strings, detail: z.string(),
});
const observation = record({
  dimension, status, evidence_ids: strings,
  // The first public research-v1 did not have disclosure-derived fields.
  excluded_evidence_ids: strings.optional(), disclosure_ids: strings.optional(),
  text: z.string(), limitations: strings,
});
const change = record({ id, dimension, before: status, addedEvidence: id, after: status, explanation: z.string() });
const fixedSchedule = record({ startingCashCents: integer, participationCents: integer, t1: percent, t2: percent });
const schedulePoint = record({ step: z.string(), date: z.string(), cashCents: integer, referenceValueCents: integer, price: integer });
const scheduleResult = record({ cashCents: integer, gainCents: integer, heldPriceMaxDrawdown: numeric.nullable(), timeline: z.array(schedulePoint) });
const comparison = record({ caseId: id, title: z.string(), dates: z.tuple([z.string(), z.string()]), asset: scheduleResult, benchmark: scheduleResult, direction, explanation: z.string() });
const history = record({
  id, caseId: id, questionVersion: id, schedule: fixedSchedule,
  initialClaim: z.union([direction, z.literal("unknown")]), priorExposure: z.boolean(),
  exposedCaseIdsAfterLock: z.array(id.refine((value) => !!value.trim())).min(1).optional(),
  shown: record({ primary: comparison, other: comparison.optional(), otherPriorExposure: z.boolean().optional() }).nullable(),
  helpUsed: help, answerExposed: z.boolean(), submitted: z.boolean(),
  final: record({ comparison: direction.optional(), historyDifference: direction.optional(), boundary: boundary.optional(), reason: z.string(), process: z.enum(["kept", "revised", "undetermined"]) }).nullable(),
});
const fundingPlan = record({ participationCents: integer, recovery: z.record(z.string(), percent) });
const pendingFinal = record({
  stage: z.enum(["entry", "t1", "t1-exec", "t2", "t2-exec", "t3", "final-exec", "exit-after-entry", "exit-after-t1-exec", "exit-after-t2-exec"]), afterDate: z.string(),
});
const fundingRow = record({
  id, label: z.string(), kind: z.enum(["entry", "pending", "entry-exec", "additional-reserve", "additional-exec", "income", "purchase", "reference", "recovery"]),
  cashBeforeCents: integer, cashCents: integer, shareUnits: z.string().regex(/^\d+$/),
  referenceValueCents: integer.nullable(), canPay: z.boolean().nullable(), amountCents: integer,
});
const fundingTimeline = record({ rows: z.array(fundingRow), stoppedAt: z.string().nullable(), pendingFinal: pendingFinal.nullable(), note: z.string() });
const fundingAttempt = record({
  id, caseId: id, scenarioId: id, questionVersion: id, plan: fundingPlan, purchaseId: id,
  answer: z.boolean(), actualCanPay: z.boolean(), revisedPlan: fundingPlan, help,
  answerExposed: z.boolean(), priorExposure: z.boolean(), reason: z.string().nullable(),
  timeline: fundingTimeline, revisedTimeline: fundingTimeline,
});
const forecast = record({
  id, caseId: id, amountCents: integer, lossMin: numeric, lossMax: numeric, minCashCents: integer,
  minHealthRatio: numeric, feeling: feeling.nullable(), action: contractAction.nullable(),
  priorExposure: z.boolean(), beforeFuture: z.boolean(), withdrawn: z.boolean(),
});
const calibrationContext = record({
  caseId: id, node: id, amountCents: integer, referenceValueCents: integer, cashCents: integer,
  health: numeric, maxHealth: numeric, priorExposure: z.boolean(), autonomousChoice: z.boolean(),
  pendingSettlement: z.boolean(), forcedOrAutomatic: z.boolean(), changedGoalOrUnderstanding: z.boolean(),
  afterCloseBeforeExecution: z.boolean(), sameShareBasis: z.boolean(),
});
const calibration = record({
  forecastId: id, context: calibrationContext, feeling: feeling.nullable(), action: contractAction.nullable(),
  reason: z.string().nullable(), comparison: z.enum(["matched", "unavailable"]), unavailableReason: z.string().nullable(),
  affectComparison: z.enum(["stronger", "similar", "weaker", "unknown"]), actionComparison: z.enum(["same", "different", "unknown"]),
});
const disclosure = record({ id, caseId: id, relatedCaseIds: strings, priorToTasks: z.literal(true), evidenceIds: strings, forecastIds: strings, source });
const profileSchema = record({
  version: z.literal("research-v1"), enabled: z.boolean(), source: source.optional(),
  journey_observations: z.array(journey), knowledge_evidence: z.array(evidence), knowledge_observations: z.array(observation),
  research_process: z.array(history), funding_attempts: z.array(fundingAttempt), funding_exposure: z.array(exposure).optional(),
  stated_interest: z.array(record({ id, goal: z.enum(["funding", "history", "idea"]).nullable() })),
  learning_needs: strings, help_preference: z.array(record({ id, help })),
  user_reasons: z.array(record({ id, aboutEvidenceId: id, reason: z.enum(["upgrade", "not_understood", "not_interested", "autonomous", "other"]), detail: z.string().optional() })),
  forecasts: z.array(forecast), calibration: z.array(calibration), prior_exposure_disclosures: z.array(disclosure).optional(),
  profile_changes: z.array(change), real_world_financial_capacity: z.literal("not_assessed"), stable_trading_type: z.literal("not_established"),
});

export type ResearchProfileValidation = { ok: true; profile: ResearchProfile } | { ok: false; reason: string };

/** Read a known research-v1 profile without modifying the stored input. */
export function validateResearchProfile(value: unknown, runSource: RunSource): ResearchProfileValidation {
  if (!source.safeParse(runSource).success) return { ok: false, reason: "无法确认旅程来源" };
  const result = profileSchema.safeParse(value);
  if (!result.success) return { ok: false, reason: `研究记录结构不完整或无效：${result.error.issues[0]?.path.join(".") || "profile"}` };
  const profile = result.data;
  const profileSource = profile.source ?? runSource;
  if (profileSource !== runSource || [...profile.journey_observations, ...profile.knowledge_evidence, ...(profile.prior_exposure_disclosures ?? [])].some((entry) => entry.source !== runSource)) {
    return { ok: false, reason: "研究记录与旅程来源不一致" };
  }
  if (profile.research_process.some((attempt) => (attempt.submitted !== (attempt.final !== null)) || (attempt.submitted && !attempt.shown)
    || (!!attempt.shown && (attempt.shown.primary.caseId !== attempt.caseId || attempt.shown.other?.caseId === attempt.caseId)))) {
    return { ok: false, reason: "历史研究记录的状态或案例不一致" };
  }
  const disclosures = profile.prior_exposure_disclosures ?? [];
  if (disclosures.length && profile.knowledge_observations.some((item) => !item.excluded_evidence_ids || !item.disclosure_ids)) {
    return { ok: false, reason: "先验说明与画像依据不完整" };
  }
  const excluded = new Set(disclosures.flatMap((item) => item.evidenceIds));
  const sameIds = (actual: string[], expected: string[]): boolean => actual.length === expected.length && actual.every((item, index) => item === expected[index]);
  if (profile.knowledge_observations.length !== 3 || new Set(profile.knowledge_observations.map((item) => item.dimension)).size !== 3
    || profile.knowledge_evidence.some((item) => (item.independent && (item.help !== "self" || item.answerExposed || item.priorExposure))
      || (item.counted && (item.answerExposed || item.priorExposure || !!item.exclusion_reason)))) {
    return { ok: false, reason: "研究观察与依据状态不一致" };
  }
  for (const item of profile.knowledge_observations) {
    const matching = profile.knowledge_evidence.filter((entry) => entry.dimension === item.dimension && entry.counted);
    const records = matching.filter((entry) => !excluded.has(entry.id));
    const removed = matching.filter((entry) => excluded.has(entry.id)).map((entry) => entry.id);
    const expectedStatus = !records.length ? "unobserved" : records.some((entry) => entry.correct) && records.some((entry) => !entry.correct) ? "conflicting"
      : records.every((entry) => !entry.correct) ? "needs_confirmation" : records.some((entry) => entry.independent) ? "independent" : "assisted";
    const disclosureIds = disclosures.filter((entry) => entry.evidenceIds.some((entryId) => removed.includes(entryId))).map((entry) => entry.id);
    if (item.status !== expectedStatus || !sameIds(item.evidence_ids, records.map((entry) => entry.id))
      || !sameIds(item.excluded_evidence_ids ?? [], removed) || !sameIds(item.disclosure_ids ?? [], disclosureIds)) {
      return { ok: false, reason: "研究观察与依据状态不一致" };
    }
  }
  if (!profile.enabled && (profile.journey_observations.length || profile.knowledge_evidence.length || profile.research_process.length
    || profile.funding_attempts.length || profile.funding_exposure?.length || profile.stated_interest.length || profile.learning_needs.length
    || profile.help_preference.length || profile.user_reasons.length || profile.forecasts.length || profile.calibration.length
    || disclosures.length || profile.profile_changes.length || profile.knowledge_observations.some((item) => item.status !== "unobserved"
      || item.evidence_ids.length || item.excluded_evidence_ids?.length || item.disclosure_ids?.length))) {
    return { ok: false, reason: "已关闭观察的记录仍含研究资料" };
  }
  // Missing values below are known legacy fields, never new user evidence.
  return { ok: true, profile: {
    ...profile, source: profileSource, funding_exposure: profile.funding_exposure ?? [], prior_exposure_disclosures: disclosures,
    knowledge_observations: profile.knowledge_observations.map((item) => ({ ...item, excluded_evidence_ids: item.excluded_evidence_ids ?? [], disclosure_ids: item.disclosure_ids ?? [] })),
  } };
}
