/** Journey observations and research exercises. No combat labels are inputs. */
import type { Run } from "./types";
import type { MarketQuote, MarketStage, ResearchMarketCase } from "./market";
import { relatedCaseIds } from "./market";
import { centsForShares, requireCents, sharesForCents, sharesForPercent } from "./ledger";

export type Goal = "funding" | "history" | "idea";
export type HelpPreference = "self" | "hint" | "step";
export type ResearchTask = "D1" | "D2";
export type Reason = "upgrade" | "not_understood" | "not_interested" | "autonomous" | "other";
export type Knowledge = "K1" | "K2" | "K3";
export type KnowledgeStatus = "unobserved" | "independent" | "assisted" | "needs_confirmation" | "conflicting";
export type Direction = "outperform" | "underperform" | "equal";
export type BoundaryAnswer = "only_samples" | "predicts_future";
export type Percent = 0 | 50 | 100;

export interface JourneyObservation {
  rule_id: string;
  source: Run["source"];
  scope: "one_decision";
  text: string;
  evidence_ids: string[];
  eligible_opportunities: number;
  observed_choices: number;
  limitations: string[];
}
export interface KnowledgeEvidence {
  id: string;
  source: Run["source"];
  questionKey: string;
  caseId: string;
  dimension: Knowledge;
  correct: boolean;
  independent: boolean;
  counted: boolean;
  help: HelpPreference;
  answerExposed: boolean;
  priorExposure: boolean;
  exclusion_reason?: string;
  evidence_ids: string[];
  detail: string;
}
export interface KnowledgeObservation {
  dimension: Knowledge;
  status: KnowledgeStatus;
  evidence_ids: string[];
  excluded_evidence_ids: string[];
  disclosure_ids: string[];
  text: string;
  limitations: string[];
}
export interface ProfileChange {
  id: string;
  dimension: Knowledge;
  before: KnowledgeStatus;
  addedEvidence: string;
  after: KnowledgeStatus;
  explanation: string;
}
export interface Recommendation {
  task_id: ResearchTask | null;
  reason: string;
  reason_type: string;
  help: HelpPreference;
  help_reason: string;
  help_explicit: boolean;
  help_evidence_ids: string[];
  user_can_switch: true;
  available_tasks: ["D1", "D2"];
  evidence_ids: string[];
}
/** What the task screens can actually offer now; no case counts or future prices. */
export interface RecommendationAvailability {
  funding: "journey" | "example" | "unavailable";
  history: "unseen" | "review" | "pending" | "unavailable";
}
export interface RecommendationPlan {
  recommendation: Recommendation;
  offers: { D1: string; D2: string };
  observed_steps: KnowledgeObservation[];
  /** Why a completed task did not automatically replace the current route. */
  continuity: string | null;
}
export interface RecommendationPlanChange { task_changed: boolean | null; explanation: string }
export interface TaskGuidance {
  task_id: ResearchTask | null;
  help: HelpPreference;
  reason: string;
  /** True only when the person explicitly chose or stated the help they want. */
  explicit: boolean;
  evidence_ids: string[];
}
export interface Forecast {
  id: string;
  caseId: string;
  amountCents: number;
  lossMin: number;
  lossMax: number;
  minCashCents: number;
  minHealthRatio: number;
  feeling: Feeling | null;
  action: ContractAction | null;
  priorExposure: boolean;
  beforeFuture: boolean;
  withdrawn: boolean;
}
export type Feeling = "low" | "mild" | "noticeable" | "strong" | "unknown";
export type ContractAction = "continue" | "half" | "all" | "unknown";
export interface CalibrationContext {
  caseId: string;
  node: string;
  amountCents: number;
  referenceValueCents: number;
  cashCents: number;
  health: number;
  maxHealth: number;
  priorExposure: boolean;
  autonomousChoice: boolean;
  pendingSettlement: boolean;
  forcedOrAutomatic: boolean;
  changedGoalOrUnderstanding: boolean;
  afterCloseBeforeExecution: boolean;
  sameShareBasis: boolean;
}
export interface CalibrationResponse {
  forecastId: string;
  context: CalibrationContext;
  feeling: Feeling | null;
  action: ContractAction | null;
  reason: string | null;
  comparison: "matched" | "unavailable";
  unavailableReason: string | null;
  affectComparison: "stronger" | "similar" | "weaker" | "unknown";
  actionComparison: "same" | "different" | "unknown";
}
export interface PriorExposureDisclosure {
  id: string;
  caseId: string;
  relatedCaseIds: string[];
  /** The person explicitly says exposure was before the affected tasks/forecasts. */
  priorToTasks: true;
  evidenceIds: string[];
  forecastIds: string[];
  source: Run["source"];
}
export interface CalibrationChange {
  forecastId: string;
  before: CalibrationResponse["comparison"];
  after: "unavailable";
  evidenceId: string;
  explanation: string;
}
export interface ResearchProfile {
  version: "research-v1";
  enabled: boolean;
  source: Run["source"];
  journey_observations: JourneyObservation[];
  knowledge_evidence: KnowledgeEvidence[];
  knowledge_observations: KnowledgeObservation[];
  research_process: HistoryAttempt[];
  funding_attempts: FundingAttempt[];
  funding_exposure: FundingExposure[];
  stated_interest: { id: string; goal: Goal | null }[];
  learning_needs: string[];
  help_preference: { id: string; help: HelpPreference }[];
  user_reasons: { id: string; aboutEvidenceId: string; reason: Reason; detail?: string }[];
  forecasts: Forecast[];
  calibration: CalibrationResponse[];
  prior_exposure_disclosures: PriorExposureDisclosure[];
  profile_changes: ProfileChange[];
  real_world_financial_capacity: "not_assessed";
  stable_trading_type: "not_established";
}

const LIMITS = ["本任务的单次观察，不代表稳定能力", "现实财务承受能力未评估"];
const dimensionNames: Record<Knowledge, string> = { K1: "同期比较", K2: "样本边界", K3: "可用现金" };
function knowledgeFor(profile: ResearchProfile, dimension: Knowledge): KnowledgeObservation {
  const disclosures = profile.prior_exposure_disclosures ?? [];
  const excluded = new Set(disclosures.flatMap((d) => d.evidenceIds));
  const records = profile.knowledge_evidence.filter((e) => e.dimension === dimension && e.counted && !excluded.has(e.id));
  const excludedIds = profile.knowledge_evidence.filter((e) => e.dimension === dimension && e.counted && excluded.has(e.id)).map((e) => e.id);
  let status: KnowledgeStatus = "unobserved";
  if (records.length) {
    const hasCorrect = records.some((e) => e.correct);
    const hasIncorrect = records.some((e) => !e.correct);
    status = hasCorrect && hasIncorrect ? "conflicting" : !hasCorrect ? "needs_confirmation"
      : records.some((e) => e.independent) ? "independent" : "assisted";
  }
  const text: Record<KnowledgeStatus, string> = {
    unobserved: "这一步暂未观察，可自行选择起点。",
    independent: "在本任务的一次未见情境中独立完成。",
    assisted: "在本任务中借助提示或分步完成。",
    needs_confirmation: "本任务的结论仍待确认，可以再核查。",
    conflicting: "不同情境表现不同，保留相反依据供核查。",
  };
  return { dimension, status, evidence_ids: records.map((e) => e.id), excluded_evidence_ids: excludedIds,
    disclosure_ids: disclosures.filter((d) => d.evidenceIds.some((id) => excludedIds.includes(id))).map((d) => d.id),
    text: `${dimensionNames[dimension]}：${text[status]}`, limitations: excludedIds.length ? [...LIMITS, "本人补充了先前已见，相关原始操作保留但不计独立依据。"] : LIMITS };
}
function refresh(profile: ResearchProfile): ResearchProfile {
  const observations = (["K1", "K2", "K3"] as const).map((d) => knowledgeFor(profile, d));
  return { ...profile, knowledge_observations: observations,
    learning_needs: observations.filter((o) => o.status === "needs_confirmation" || o.status === "assisted" || o.status === "conflicting").map((o) => `${dimensionNames[o.dimension]}：${o.status === "assisted" ? "可继续自行练习" : o.status === "conflicting" ? "查看不同情境的依据" : "可先核对这一步"}`) };
}
export function emptyResearchProfile(enabled = true, source: Run["source"] = "real"): ResearchProfile {
  return refresh({ version: "research-v1", enabled, source, journey_observations: [], knowledge_evidence: [], knowledge_observations: [], research_process: [], funding_attempts: [], funding_exposure: [], stated_interest: [], learning_needs: [], help_preference: [], user_reasons: [], forecasts: [], calibration: [], prior_exposure_disclosures: [], profile_changes: [], real_world_financial_capacity: "not_assessed", stable_trading_type: "not_established" });
}
/** Deletes all optional observations; caller persists this replacement immediately. */
export function revokeResearch(profile: ResearchProfile): ResearchProfile { return emptyResearchProfile(false, profile.source); }
function requireEnabled(profile: ResearchProfile): void { if (!profile.enabled) throw new Error("已选择只玩游戏，未记录研究资料"); }
function requireId(id: string): void { if (!id.trim()) throw new Error("需要非空的依据编号"); }
export function setResearchGoal(profile: ResearchProfile, id: string, goal: Goal | null): ResearchProfile {
  if (!profile.enabled) return profile;
  requireId(id);
  return { ...profile, stated_interest: [...profile.stated_interest, { id, goal }] };
}
export function setHelpPreference(profile: ResearchProfile, id: string, help: HelpPreference): ResearchProfile {
  if (!profile.enabled) return profile;
  requireId(id);
  return { ...profile, help_preference: [...profile.help_preference, { id, help }] };
}
export function addUserReason(profile: ResearchProfile, id: string, aboutEvidenceId: string, reason: Reason, detail?: string): ResearchProfile {
  if (!profile.enabled) return profile;
  requireId(id); requireId(aboutEvidenceId);
  return { ...profile, user_reasons: [...profile.user_reasons, { id, aboutEvidenceId, reason, ...(detail ? { detail } : {}) }] };
}

function recordKnowledge(profile: ResearchProfile, evidence: Omit<KnowledgeEvidence, "counted" | "source">, exclusionReason?: string): { profile: ResearchProfile; change: ProfileChange } {
  const before = knowledgeFor(profile, evidence.dimension).status;
  // A retry of the same item cannot replace its original evidence or count as a new case.
  const duplicate = profile.knowledge_evidence.some((e) => e.questionKey === evidence.questionKey);
  const complete: KnowledgeEvidence = { ...evidence, source: profile.source, counted: !duplicate && !evidence.priorExposure && !evidence.answerExposed && !exclusionReason, ...(exclusionReason ? { exclusion_reason: exclusionReason } : {}) };
  const next = refresh({ ...profile, knowledge_evidence: [...profile.knowledge_evidence, complete] });
  const after = knowledgeFor(next, evidence.dimension).status;
  const evidenceExplanation = exclusionReason ?? (duplicate ? "同题重试保留记录，但不增加独立依据。"
    : evidence.priorExposure || evidence.answerExposed ? "已见案例或答案，本次仅作练习，不增加能力依据。"
    : before === after ? "新依据已加入；现有观察保持不变。"
    : after === "conflicting" ? "不同情境出现相反结果，两条依据均保留。"
    : !evidence.correct ? "本次有步骤需要进一步核查，可结合任务中的具体反馈再看一遍。"
    : evidence.help !== "self" ? "本次借助帮助完成，实际帮助暴露已记录。"
    : "本次在未见情境中独立完成，记录一次任务操作。");
  const change: ProfileChange = { id: `${evidence.id}:change`, dimension: evidence.dimension, before, addedEvidence: evidence.id, after,
    explanation: evidenceExplanation };
  return { profile: { ...next, profile_changes: [...next.profile_changes, change] }, change };
}

function hasDeclaredPriorExposure(profile: ResearchProfile, caseId: string): boolean {
  return (profile.prior_exposure_disclosures ?? []).some((d) => d.relatedCaseIds.includes(caseId));
}
function hasShownRelatedHistory(profile: ResearchProfile, caseId: string): boolean {
  const related = relatedCaseIds(caseId);
  return profile.research_process.some((a) => !!a.shown && (related.includes(a.caseId) || (!!a.shown.other && related.includes(a.shown.other.caseId))));
}
function hasRelatedCalibration(profile: ResearchProfile, caseId: string, exceptForecastId?: string): boolean {
  const related = relatedCaseIds(caseId);
  return profile.calibration.some((response) => response.forecastId !== exceptForecastId && related.includes(response.context.caseId));
}
function hasRelatedFunding(profile: ResearchProfile, caseId: string): boolean {
  const related = relatedCaseIds(caseId);
  return profile.funding_attempts.some((attempt) => related.includes(attempt.caseId));
}

/** Derived view: the original response and self-reported feelings stay unchanged. */
export function calibrationForDisplay(profile: ResearchProfile): CalibrationResponse[] {
  return profile.calibration.map((response) => {
    const disclosure = (profile.prior_exposure_disclosures ?? []).find((d) => d.forecastIds.includes(response.forecastId));
    if (!disclosure) return response;
    return { ...response, comparison: "unavailable", unavailableReason: `本人补充在预期之前已见相关案例（依据 ${disclosure.id}）。`, affectComparison: "unknown", actionComparison: "unknown" };
  });
}

/** Only an explicit claim of exposure before these tasks can call this function.
 * It appends a correction event; ordinary later viewing never calls it and
 * does not retroactively invalidate an earlier independent operation.
 */
export function declarePriorExposure(profile: ResearchProfile, input: { id: string; caseId: string; priorToTasks: true }): { profile: ResearchProfile; changes: ProfileChange[]; calibrationChanges: CalibrationChange[]; recommendation: Recommendation } {
  if (!profile.enabled) return { profile, changes: [], calibrationChanges: [], recommendation: recommendResearch(profile) };
  requireId(input.id); requireId(input.caseId);
  if (input.priorToTasks !== true) throw new Error("需要明确声明在这些任务及预期之前已见");
  const previous = profile.prior_exposure_disclosures ?? [];
  if (previous.some((d) => d.id === input.id)) throw new Error("补充依据编号重复");
  const related = relatedCaseIds(input.caseId);
  const evidenceIds = profile.knowledge_evidence.filter((e) => {
    if (related.includes(e.caseId)) return true;
    if (e.dimension !== "K2") return false;
    const attempt = profile.research_process.find((a) => e.evidence_ids.includes(a.id));
    return !!attempt?.shown?.other && related.includes(attempt.shown.other.caseId);
  }).map((e) => e.id);
  const forecastIds = profile.forecasts.filter((f) => related.includes(f.caseId)).map((f) => f.id);
  const alreadyExcluded = new Set(previous.flatMap((d) => d.evidenceIds));
  const changedDimensions = (["K1", "K2", "K3"] as const).filter((dimension) => profile.knowledge_evidence.some((e) => e.dimension === dimension && e.counted && evidenceIds.includes(e.id) && !alreadyExcluded.has(e.id)));
  const oldCalibration = calibrationForDisplay(profile);
  const disclosure: PriorExposureDisclosure = { id: input.id, caseId: input.caseId, relatedCaseIds: [...related], priorToTasks: true, evidenceIds, forecastIds, source: profile.source };
  let next = refresh({ ...profile, prior_exposure_disclosures: [...previous, disclosure] });
  const changes = changedDimensions.map((dimension): ProfileChange => ({
    id: `${input.id}:${dimension}:change`, dimension, before: knowledgeFor(profile, dimension).status,
    addedEvidence: input.id, after: knowledgeFor(next, dimension).status,
    explanation: "你补充说在相关任务前已见过案例；原操作保留，但相关依据不再作为未见情境的独立观察。",
  }));
  const calibrationChanges = oldCalibration.filter((c) => forecastIds.includes(c.forecastId)).map((c): CalibrationChange => ({ forecastId: c.forecastId, before: c.comparison, after: "unavailable", evidenceId: input.id, explanation: "你补充说在预期之前已见相关案例；原预期、感受和行动保留，但不能再直接比较。" }));
  next = { ...next, profile_changes: [...next.profile_changes, ...changes] };
  const funding = explainTaskGuidance(profile, next, changes.filter((c) => c.dimension === "K3"), "D1");
  const history = explainTaskGuidance(profile, funding.profile, changes.filter((c) => c.dimension !== "K3"), "D2");
  const explained = new Map([...funding.changes, ...history.changes].map((change) => [change.id, change]));
  return { profile: history.profile, changes: changes.map((change) => explained.get(change.id) ?? change), calibrationChanges, recommendation: recommendResearch(history.profile) };
}

/** Whitelisted economic actions only; combat results, card tags and timing cannot feed these rules. */
export function observeJourney(run: Pick<Run, "history" | "source" | "observationEnabled">): JourneyObservation[] {
  if (!run.observationEnabled) return [];
  const out: JourneyObservation[] = [];
  const attempted = new Set<string>();
  let archiveRecorded = false;
  for (const e of run.history) {
    if (e.type !== "choice" || !e.snapshot) continue;
    const s = e.snapshot;
    if (e.action === "submit-entry" && typeof e.data.amountCents === "number") {
      const amount = e.data.amountCents;
      out.push({ rule_id: "J1-01", source: run.source, scope: "one_decision", text: `本次提交 ${(amount / 100).toFixed(2)} 金币参与，提交后 ${(Math.max(0, s.cashCents - amount) / 100).toFixed(2)} 金币可用。`, evidence_ids: [e.id], eligible_opportunities: 1, observed_choices: 1, limitations: ["仅描述本次安排", "选择原因未知"] });
      if (s.supplyPlanCents !== null) out.push({ rule_id: "J1-02", source: run.source, scope: "one_decision", text: `本人此前标记的补给计划为 ${(s.supplyPlanCents / 100).toFixed(2)} 金币；提交后可用 ${(Math.max(0, s.cashCents - amount) / 100).toFixed(2)} 金币。`, evidence_ids: [e.id], eligible_opportunities: 1, observed_choices: 1, limitations: ["修改计划不代表好坏"] });
    }
    if (e.action === "purchase-attempted" && e.data.reason === "insufficient-cash") {
      const key = `${e.node}|${s.phase}|${s.cashCents}|${s.shareUnits}|${e.data.purchase}|${e.data.cardId}|${e.data.cardInstanceId}|${e.data.priceCents}`;
      if (!attempted.has(key)) {
        attempted.add(key);
        out.push({ rule_id: "J1-03", source: run.source, scope: "one_decision", text: "本次实际尝试的采购因可用金币不足未完成。", evidence_ids: [e.id], eligible_opportunities: 1, observed_choices: 1, limitations: ["不能推断原因或能力"] });
      }
    }
    if (e.action === "open-archive" && s.archiveOwned && !archiveRecorded) {
      archiveRecorded = true;
      out.push({ rule_id: "J2-01", source: run.source, scope: "one_decision", text: "本次打开了已取得的额外历史资料。", evidence_ids: [e.id], eligible_opportunities: 1, observed_choices: 1, limitations: ["打开不等于已经理解"] });
    }
    if (e.action === "submit-redemption" && typeof e.data.percent === "number") {
      if (/^\d+$/.test(s.shareUnits) && BigInt(s.shareUnits) > 0n) out.push({ rule_id: "J3-01", source: run.source, scope: "one_decision", text: `展示当前状态后，选择回收 ${e.data.percent}% 的当时份额。`, evidence_ids: [e.id], eligible_opportunities: 1, observed_choices: 1, limitations: ["不推断感受或动机", "不能提前使用待到账金额"] });
      else out.push({ rule_id: "J0-00", source: run.source, scope: "one_decision", text: "当时没有契约份额，回收选项没有形成有区别的选择机会。", evidence_ids: [e.id], eligible_opportunities: 0, observed_choices: 0, limitations: ["只记录局内操作", "不推断偏好或能力"] });
    }
  }
  return out;
}
export function updateJourney(profile: ResearchProfile, run: Pick<Run, "history" | "source" | "observationEnabled">): ResearchProfile {
  if (!profile.enabled || !run.observationEnabled) return profile;
  return { ...profile, source: run.source, journey_observations: observeJourney(run) };
}

/** Suggest help for the task actually opened. This is a read-only recommendation:
 * a preference or suggested help is not evidence that any help was displayed.
 */
export function guidanceForTask(profile: ResearchProfile, taskId: ResearchTask | null): TaskGuidance {
  if (!profile.enabled) return { task_id: taskId, help: "hint", reason: "当前不生成观察，可自行选择自主、提示或分步。", explicit: false, evidence_ids: [] };
  const chosen = profile.help_preference.at(-1);
  if (chosen) {
    const labels: Record<HelpPreference, string> = { self: "自主尝试", hint: "提示", step: "分步说明" };
    return { task_id: taskId, help: chosen.help, reason: `你主动选择了${labels[chosen.help]}，随时可以更改。`, explicit: true, evidence_ids: [chosen.id] };
  }
  const reason = profile.user_reasons.at(-1);
  if (reason?.reason === "autonomous") return { task_id: taskId, help: "self", reason: "你表示希望自主尝试，随时可以切换提示。", explicit: true, evidence_ids: [reason.id] };
  if (!taskId) return { task_id: null, help: "hint", reason: "尚未选择具体任务，可自行选择自主、提示或分步。", explicit: false, evidence_ids: [] };
  const relevant = profile.knowledge_observations.filter((o) => taskId === "D1" ? o.dimension === "K3" : o.dimension !== "K3");
  const need = (["conflicting", "needs_confirmation", "assisted"] as const).map((status) => relevant.find((o) => o.status === status)).find((o) => o !== undefined);
  if (need) {
    const why = need.status === "conflicting" ? "不同情境表现不同，可以先对照依据" : need.status === "assisted" ? "已有借助提示完成的记录，可以继续练习" : "已有任务的结论仍待确认，可以先核对这一步";
    return { task_id: taskId, help: "hint", reason: `${dimensionNames[need.dimension]}：${why}；提示随时可关闭。`, explicit: false, evidence_ids: [...need.evidence_ids] };
  }
  const independent = relevant.find((o) => o.status === "independent");
  if (independent) return { task_id: taskId, help: "self", reason: `${dimensionNames[independent.dimension]}已有一次未见情境的独立操作，可以先自主尝试。`, explicit: false, evidence_ids: [...independent.evidence_ids] };
  return { task_id: taskId, help: "hint", reason: "暂无这项任务的相关观察，可自行选择自主、提示或分步。", explicit: false, evidence_ids: [] };
}

/** Attach the real before/after help decision for this task, after every
 * dimension in a submission has been recorded (no transient recommendation).
 */
function explainTaskGuidance(beforeProfile: ResearchProfile, afterProfile: ResearchProfile, changes: ProfileChange[], taskId: ResearchTask): { profile: ResearchProfile; changes: ProfileChange[] } {
  if (!changes.length) return { profile: afterProfile, changes };
  const before = guidanceForTask(beforeProfile, taskId);
  const after = guidanceForTask(afterProfile, taskId);
  const labels: Record<HelpPreference, string> = { self: "自主尝试", hint: "提示", step: "分步说明" };
  const why = after.explicit ? `帮助仍以你选择的${labels[after.help]}为准。`
    : before.help === after.help ? `本任务的帮助建议保持为${labels[after.help]}。`
    : `本任务的帮助建议从${labels[before.help]}调整为${labels[after.help]}：${after.reason}`;
  const explained = changes.map((change) => ({ ...change, explanation: `${change.explanation} ${why}` }));
  const byId = new Map(explained.map((change) => [change.id, change]));
  return { profile: { ...afterProfile, profile_changes: afterProfile.profile_changes.map((change) => byId.get(change.id) ?? change) }, changes: explained };
}

export function recommendResearch(profile: ResearchProfile): Recommendation {
  // A disabled profile may be an old in-memory object: do not inspect or
  // reuse any preferences, observations, evidence or reasons it contains.
  if (!profile.enabled) return { task_id: null, reason: "当前不生成观察；两个练习可自由选择或跳过。", reason_type: "observation_disabled", help: "hint", help_reason: "当前不生成观察，可自行选择自主、提示或分步。", help_explicit: false, help_evidence_ids: [], user_can_switch: true, available_tasks: ["D1", "D2"], evidence_ids: [] };
  const goal = profile.stated_interest.at(-1);
  const reason = profile.user_reasons.at(-1);
  const invalid = new Set((profile.prior_exposure_disclosures ?? []).flatMap((d) => d.evidenceIds));
  const lastEvidence = profile.knowledge_evidence.filter((e) => e.counted && !invalid.has(e.id)).at(-1);
  const unresolved = profile.knowledge_observations.find((o) => o.status === "needs_confirmation" || o.status === "conflicting" || o.status === "assisted");
  let task: ResearchTask | null = null;
  let why = "可任选资金安排台或历史对照台作为起点。";
  let kind = "optional_exploration";
  let ids: string[] = [];
  if (goal?.goal) {
    task = goal.goal === "funding" ? "D1" : "D2"; why = goal.goal === "funding" ? "你选择了探索资金安排。" : goal.goal === "history" ? "你选择了探索历史比较。" : "你选择了核查一个想法。"; kind = "stated_goal"; ids = [goal.id];
  } else if (reason?.reason === "not_understood" || reason?.reason === "upgrade") {
    task = "D1"; why = reason.reason === "not_understood" ? "你提到规则有不清楚的地方，可以从可用现金开始。" : "你说想为升级留钱，可以试算采购空间。"; kind = "user_reason"; ids = [reason.id, reason.aboutEvidenceId];
  } else if (reason?.reason === "not_interested") {
    why = "你说暂时不感兴趣；两个任务仍可自行选择或跳过。"; kind = "user_reason"; ids = [reason.id];
  } else {
    const limited = [...profile.journey_observations].reverse().find((o) => o.rule_id === "J1-03");
    const calibration = calibrationForDisplay(profile).find((c) => c.comparison === "matched" && c.affectComparison === "stronger");
    const archive = [...profile.journey_observations].reverse().find((o) => o.rule_id === "J2-01");
    if (limited) { task = "D1"; why = "你曾遇到一次无法支付的采购，可以试算另一种安排。"; kind = "purchase_constraint"; ids = limited.evidence_ids; }
    else if (calibration) { task = "D1"; why = "这次自报感受比事前预想更强，可以比较不同参与金额。"; kind = "calibration"; ids = [calibration.forecastId]; }
    else if (unresolved) { task = unresolved.dimension === "K3" ? "D1" : "D2"; why = `${dimensionNames[unresolved.dimension]}这一步可以继续核查。`; kind = "task_evidence"; ids = unresolved.evidence_ids; }
    else if (lastEvidence) { task = lastEvidence.dimension === "K3" ? "D1" : "D2"; why = `${dimensionNames[lastEvidence.dimension]}已有一次任务记录，可以继续核对。`; kind = "task_evidence"; ids = [lastEvidence.id]; }
    else if (archive) { task = "D2"; why = "你打开过历史资料，可以继续比较同期数据。"; kind = "archive_exploration"; ids = archive.evidence_ids; }
  }
  const guidance = guidanceForTask(profile, task);
  return { task_id: task, reason: why, reason_type: kind, help: guidance.help, help_reason: guidance.reason,
    help_explicit: guidance.explicit, help_evidence_ids: [...guidance.evidence_ids], user_can_switch: true, available_tasks: ["D1", "D2"], evidence_ids: [...ids] };
}

/** Explain the existing route using only resources that the task screens can
 * offer now. Availability never changes the user's goal or route by itself.
 */
export function recommendationPlan(profile: ResearchProfile, availability: RecommendationAvailability): RecommendationPlan {
  const funding: Record<RecommendationAvailability["funding"], string> = {
    journey: "可用本局已发生的资金与采购日程，调整参与金额并核对现金；不推断变化后的战斗。",
    example: "本局暂无可用的完整资金日程，提供人工机制算例供练习；不作为独立能力依据。",
    unavailable: "资金安排暂未准备好，可稍后重试。",
  };
  const history: Record<RecommendationAvailability["history"], string> = {
    unseen: "目前有未标为已见的历史片段，可与同期基准对照；是否形成独立依据还取决于资料或答案暴露、实际帮助及本次是否为模拟。",
    review: "目前可选历史片段均标为已见，仍可比较同期基准，作为复习。",
    pending: "可继续已锁定的历史研究；依据资料或答案暴露、实际帮助及本次是否为模拟判断，资料未加载时可重试。",
    unavailable: "历史目录尚未准备好或没有可用片段，可稍后重试。",
  };
  const recommendation = recommendResearch(profile);
  const offers = { D1: funding[availability.funding], D2: history[availability.history] };
  if (!profile.enabled) {
    const practiceFunding: Record<RecommendationAvailability["funding"], string> = {
      journey: "可用本局资金与采购日程试算；只作即时练习，不保存研究观察。",
      example: "本局暂无可用的完整资金日程，可用人工机制算例练习；不保存研究观察。",
      unavailable: "资金安排暂未准备好，可稍后重试。",
    };
    const practiceHistory: Record<RecommendationAvailability["history"], string> = {
      unseen: "可用未标为已见的历史片段比较同期基准；只作即时练习，不保存研究观察。",
      review: "目前可选历史片段均标为已见，仍可复习；不保存研究观察。",
      pending: "当前可进行即时练习，不保存研究观察。",
      unavailable: "历史目录尚未准备好或没有可用片段，可稍后重试。",
    };
    return { recommendation, offers: { D1: practiceFunding[availability.funding], D2: practiceHistory[availability.history] }, observed_steps: [], continuity: null };
  }

  const relevant: readonly Knowledge[] = recommendation.task_id === "D1" ? ["K3"] : recommendation.task_id === "D2" ? ["K1", "K2"] : [];
  const observed_steps = profile.knowledge_observations
    .filter((o) => relevant.includes(o.dimension) && (o.status !== "unobserved" || (o.excluded_evidence_ids?.length ?? 0) > 0))
    .map((o) => ({ ...o, evidence_ids: [...o.evidence_ids], excluded_evidence_ids: [...(o.excluded_evidence_ids ?? [])], disclosure_ids: [...(o.disclosure_ids ?? [])], limitations: [...o.limitations] }));
  const completed = profile.funding_attempts.length > 0 || profile.research_process.some((a) => a.submitted);
  const explanations: Record<string, string> = {
    stated_goal: "完成一次任务不会自动改变你选择的目标。",
    user_reason: "完成一次任务不会自动改变你补充的需求。",
    purchase_constraint: "一次任务不会改写当时采购未完成的事实。",
    calibration: "一次任务不会改写你当时自报的感受；是否继续由你决定。",
    task_evidence: "推荐依据任务中的观察，是否继续由你决定。",
    archive_exploration: "推荐依据你打开过的历史资料，是否继续由你决定。",
  };
  const continuity = completed && recommendation.task_id ? explanations[recommendation.reason_type] ?? null : null;
  return { recommendation, offers, observed_steps, continuity };
}

/** Compare actual snapshots captured around a submission; no prior plan is inferred. */
export function compareRecommendationPlans(before: RecommendationPlan, after: RecommendationPlan): RecommendationPlanChange {
  if (after.recommendation.reason_type === "observation_disabled") return { task_changed: null, explanation: "当前不生成观察；两个练习可自由选择或跳过。" };
  const previous = before.recommendation.task_id;
  const current = after.recommendation.task_id;
  const task_changed = before.recommendation.reason_type === "observation_disabled" ? null : previous !== current;
  const name = (task: ResearchTask | null): string => task === "D1" ? "资金安排台" : task === "D2" ? "历史对照台" : "自行选择";
  const prefix = task_changed === null ? current ? `当前推荐${name(current)}。` : "当前可自行选择。"
    : task_changed ? `下一步从${name(previous)}调整为${name(current)}。`
    : current ? `推荐仍是${name(current)}。` : "仍可自行选择。";
  const labels: Record<HelpPreference, string> = { self: "自主尝试", hint: "提示", step: "分步说明" };
  const afterHelp = labels[after.recommendation.help];
  const help = !current ? "" : after.recommendation.help_explicit ? `帮助以你选择的${afterHelp}为准。${after.recommendation.help_reason}`
    : task_changed === false && before.recommendation.help !== after.recommendation.help ? `本任务的帮助建议从${labels[before.recommendation.help]}调整为${afterHelp}。${after.recommendation.help_reason}`
    : `本任务的帮助建议为${afterHelp}。${after.recommendation.help_reason}`;
  return { task_changed, explanation: `${prefix}${after.recommendation.reason}${after.continuity ?? ""}${help}` };
}

export type FundingEvent =
  | { id: string; label: string; kind: "entry-exec" }
  | { id: string; label: string; kind: "income"; amountCents: number }
  | { id: string; label: string; kind: "purchase"; amountCents: number }
  | { id: string; label: string; kind: "reference"; price: number }
  | { id: string; label: string; kind: "recovery"; price: number; automatic?: boolean };
export interface FundingScenario {
  id: string;
  caseId: string;
  startingCashCents: number;
  entryPrice: number;
  events: FundingEvent[];
  /** When the original run ended without shares, its automatic quote may not yet have been requested. */
  pendingFinal?: { stage: MarketStage; afterDate: string };
  /** A fixed external schedule, not a claim of the combat outcome of a changed game. */
  assumptions: string;
}
export interface FundingPlan { participationCents: number; recovery: Record<string, Percent> }
export interface FundingRow {
  id: string;
  label: string;
  kind: "entry" | "pending" | FundingEvent["kind"];
  cashBeforeCents: number;
  cashCents: number;
  shareUnits: string;
  referenceValueCents: number | null;
  canPay: boolean | null;
  amountCents: number;
}
export interface FundingTimeline { rows: FundingRow[]; stoppedAt: string | null; pendingFinal: FundingScenario["pendingFinal"] | null; note: string }
export interface FundingFeedback {
  target: { id: string; label: string; selected: boolean; actualCanPay: boolean; correct: boolean; cashBeforeCents: number; amountCents: number };
  revised: { status: "completed" } | { status: "pending-final-quote" }
    | { status: "blocked"; id: string; label: string; cashBeforeCents: number; amountCents: number; shortfallCents: number };
  revisedTarget: { status: "not-reached" }
    | { status: "reached"; cashBeforeCents: number; amountCents: number; canPay: boolean };
}
export interface FundingPracticeResult {
  timeline: FundingTimeline;
  revisedTimeline: FundingTimeline;
  correct: boolean;
  actualCanPay: boolean;
  feedback: FundingFeedback;
}
export interface FundingSubmission {
  id: string;
  questionVersion: string;
  plan: FundingPlan;
  purchaseId: string;
  canPay: boolean;
  revisedPlan: FundingPlan;
  help: HelpPreference;
  answerExposed: boolean;
  priorExposure: boolean;
  reason?: string;
}
export interface FundingAttempt {
  id: string;
  caseId: string;
  scenarioId: string;
  questionVersion: string;
  plan: FundingPlan;
  purchaseId: string;
  answer: boolean;
  actualCanPay: boolean;
  revisedPlan: FundingPlan;
  help: HelpPreference;
  answerExposed: boolean;
  priorExposure: boolean;
  reason: string | null;
  timeline: FundingTimeline;
  revisedTimeline: FundingTimeline;
}
export interface FundingExposure {
  /** Stable question identity. Older saved profiles may instead contain only caseId. */
  questionKey?: string;
  caseId?: string;
  help: HelpPreference;
  answerExposed: boolean;
  priorExposure: boolean;
}
export function fundingQuestionKey(scenario: FundingScenario, purchaseId: string, questionVersion: string, plan: FundingPlan): string {
  requireId(scenario.id); requireId(purchaseId); requireId(questionVersion);
  requireCents(plan.participationCents);
  const purchaseIndex = scenario.events.findIndex((event) => event.id === purchaseId && event.kind === "purchase");
  if (purchaseIndex < 0) throw new Error("题目中的采购节点不存在");
  const earlier = scenario.events.slice(0, purchaseIndex + 1);
  const facts = earlier.map((event) => {
    if (event.kind === "income" || event.kind === "purchase") return { kind: event.kind, amountCents: event.amountCents };
    if (event.kind === "reference") return { kind: event.kind, price: event.price };
    if (event.kind === "recovery") return { kind: event.kind, price: event.price, percent: event.automatic ? 100 : plan.recovery[event.id] ?? 0 };
    return { kind: event.kind };
  });
  const canonical = JSON.stringify({ caseId: scenario.caseId, version: questionVersion, startingCashCents: scenario.startingCashCents, participationCents: plan.participationCents, entryPrice: earlier.some((e) => e.kind === "entry-exec") ? scenario.entryPrice : null, facts });
  // Stable compact identity for local de-duplication, not a secrecy mechanism.
  let hash = 0xcbf29ce484222325n;
  for (const character of canonical) hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0)!)) * 0x100000001b3n);
  return `D1:${questionVersion}:${hash.toString(16).padStart(16, "0")}`;
}
function updateFundingExposure(profile: ResearchProfile, questionKey: string, update: (current: FundingExposure) => FundingExposure): ResearchProfile {
  if (!profile.enabled) return profile;
  requireId(questionKey);
  const exposures = profile.funding_exposure ?? [];
  const current = exposures.filter((e) => e.questionKey === questionKey).reduce<FundingExposure>((merged, e) => ({
    questionKey,
    help: HELP_RANK[e.help] > HELP_RANK[merged.help] ? e.help : merged.help,
    answerExposed: merged.answerExposed || e.answerExposed,
    priorExposure: merged.priorExposure || e.priorExposure,
  }), { questionKey, help: "self", answerExposed: false, priorExposure: false });
  return { ...profile, funding_exposure: [...exposures.filter((e) => e.questionKey !== questionKey), update(current)] };
}
/** Call and persist when D1 help is actually shown, before submitting an answer. */
export function markFundingHelp(profile: ResearchProfile, questionKey: string, help: HelpPreference): ResearchProfile {
  return updateFundingExposure(profile, questionKey, (e) => ({ ...e, help: HELP_RANK[help] > HELP_RANK[e.help] ? help : e.help }));
}
export function markFundingAnswerExposed(profile: ResearchProfile, questionKey: string): ResearchProfile {
  return updateFundingExposure(profile, questionKey, (e) => ({ ...e, answerExposed: true }));
}
export function markFundingPriorExposure(profile: ResearchProfile, questionKey: string): ResearchProfile {
  return updateFundingExposure(profile, questionKey, (e) => ({ ...e, priorExposure: true }));
}
function validPrice(value: number): void { if (!Number.isSafeInteger(value) || value <= 0) throw new Error("需要有效的实际报价"); }
function validPercent(value: number): value is Percent { return value === 0 || value === 50 || value === 100; }

/** Replays explicitly fixed external income/purchases; stops at the first unaffordable purchase. */
export function simulateFundingPlan(scenario: FundingScenario, plan: FundingPlan): FundingTimeline {
  requireCents(scenario.startingCashCents); requireCents(plan.participationCents); validPrice(scenario.entryPrice);
  if (plan.participationCents > scenario.startingCashCents) throw new Error("参与金额不能超过当时可用金币");
  if (new Set(scenario.events.map((e) => e.id)).size !== scenario.events.length) throw new Error("时间线事件编号重复");
  if (scenario.events.filter((e) => e.kind === "entry-exec").length !== 1) throw new Error("时间线需要且只能有一次入场执行");
  let cash = scenario.startingCashCents - plan.participationCents;
  let shares = "0";
  let lastPrice: number | null = null;
  let executed = false;
  const rows: FundingRow[] = [{ id: "entry", label: "预留参与金额，等待下一开盘", kind: "entry", cashBeforeCents: scenario.startingCashCents, cashCents: cash, shareUnits: shares, referenceValueCents: null, canPay: null, amountCents: plan.participationCents }];
  let stoppedAt: string | null = null;
  for (const e of scenario.events) {
    const cashBeforeCents = cash;
    let canPay: boolean | null = null;
    let amount = 0;
    if (e.kind === "entry-exec") { shares = sharesForCents(plan.participationCents, scenario.entryPrice); lastPrice = scenario.entryPrice; executed = true; }
    if (e.kind === "income") { requireCents(e.amountCents); amount = e.amountCents; cash += amount; }
    if (e.kind === "purchase") {
      requireCents(e.amountCents); amount = e.amountCents; canPay = cash >= amount;
      if (canPay) cash -= amount; else stoppedAt = e.id;
    }
    if (e.kind === "reference") { if (!executed) throw new Error("入场执行前不能展示未来参考报价"); validPrice(e.price); lastPrice = e.price; }
    if (e.kind === "recovery") {
      if (!executed) throw new Error("入场执行前不能回收份额");
      validPrice(e.price); lastPrice = e.price;
      const pct = e.automatic ? 100 : plan.recovery[e.id] ?? 0;
      if (!validPercent(pct)) throw new Error("回收比例必须为 0、50 或 100");
      const sold = sharesForPercent(shares, pct); amount = centsForShares(sold, e.price);
      cash += amount; shares = (BigInt(shares) - BigInt(sold)).toString();
    }
    if (!Number.isSafeInteger(cash)) throw new Error("金币金额超出范围");
    rows.push({ id: e.id, label: e.label, kind: e.kind, cashBeforeCents, cashCents: cash, shareUnits: shares, referenceValueCents: lastPrice === null ? null : centsForShares(shares, lastPrice), canPay, amountCents: amount });
    if (stoppedAt) break;
  }
  let pendingFinal: FundingScenario["pendingFinal"] | null = null;
  if (!stoppedAt && BigInt(shares) > 0n && scenario.pendingFinal) {
    stoppedAt = "pending-final-quote";
    pendingFinal = scenario.pendingFinal;
    rows.push({ id: stoppedAt, label: "结束后仍有份额，等待下一可用执行报价，尚未到账", kind: "pending", cashBeforeCents: cash, cashCents: cash, shareUnits: shares, referenceValueCents: lastPrice === null ? null : centsForShares(shares, lastPrice), canPay: null, amountCents: 0 });
  }
  return { rows, stoppedAt, pendingFinal, note: "固定外部收入与采购日程的账本练习；首次买不起或结算缺价时暂停，不推断改变选择后战斗仍会按原样发生。" };
}

export function submitFunding(profile: ResearchProfile, scenario: FundingScenario, submission: FundingSubmission): { profile: ResearchProfile; change: ProfileChange; recommendation: Recommendation; timeline: FundingTimeline; revisedTimeline: FundingTimeline; feedback: FundingFeedback } {
  requireEnabled(profile); requireId(submission.id); requireId(submission.questionVersion);
  if (profile.funding_attempts.some((a) => a.id === submission.id)) throw new Error("此提交编号已使用");
  const { timeline, revisedTimeline, feedback } = evaluateFundingPractice(scenario, submission);
  const purchase = feedback.target;
  const questionKey = fundingQuestionKey(scenario, submission.purchaseId, submission.questionVersion, submission.plan);
  // Legacy entries only identify a case, so they conservatively apply to that case.
  const oldQuestionKey = `D1:${scenario.id}:${submission.purchaseId}:${submission.questionVersion}`;
  const exposures = (profile.funding_exposure ?? []).filter((e) => e.questionKey === questionKey || e.questionKey === oldQuestionKey || (!e.questionKey && e.caseId === scenario.caseId));
  const help = exposures.reduce<HelpPreference>((highest, e) => HELP_RANK[e.help] > HELP_RANK[highest] ? e.help : highest, submission.help);
  const answerExposed = submission.answerExposed || exposures.some((e) => e.answerExposed);
  const related = relatedCaseIds(scenario.caseId);
  const relatedTaskShown = hasShownRelatedHistory(profile, scenario.caseId);
  const relatedFunding = profile.funding_attempts.some((a) => a.caseId !== scenario.caseId && related.includes(a.caseId));
  const priorExposure = submission.priorExposure || exposures.some((e) => e.priorExposure) || hasDeclaredPriorExposure(profile, scenario.caseId) || relatedTaskShown || relatedFunding || hasRelatedCalibration(profile, scenario.caseId);
  const record: FundingAttempt = { id: submission.id, caseId: scenario.caseId, scenarioId: scenario.id, questionVersion: submission.questionVersion, plan: { ...submission.plan, recovery: { ...submission.plan.recovery } }, purchaseId: submission.purchaseId, answer: submission.canPay, actualCanPay: purchase.actualCanPay, revisedPlan: { ...submission.revisedPlan, recovery: { ...submission.revisedPlan.recovery } }, help, answerExposed, priorExposure, reason: submission.reason ?? null, timeline, revisedTimeline };
  const withAttempt = { ...profile, funding_attempts: [...profile.funding_attempts, record] };
  const manual = scenario.caseId === "manual-example";
  const updated = recordKnowledge(withAttempt, { id: `${submission.id}:K3`, questionKey, caseId: scenario.caseId, dimension: "K3", correct: purchase.correct, independent: !manual && help === "self" && !answerExposed && !priorExposure, help, answerExposed, priorExposure, evidence_ids: [submission.id, submission.purchaseId], detail: `采购前可用 ${purchase.cashBeforeCents / 100} 金币，采购${purchase.actualCanPay ? "可支付" : "不可支付"}；修订后的计划${revisedTimeline.stoppedAt ? `在 ${revisedTimeline.stoppedAt} 暂停` : "完成固定日程核查"}。` }, manual ? "人工示例仅用于练习，不增加能力依据。" : undefined);
  // This function returns the correct answer, so any later attempt at this
  // question must remember that exposure. Artificial practice needs no ledger.
  const saved = manual ? updated.profile : markFundingAnswerExposed(updated.profile, questionKey);
  const explained = explainTaskGuidance(profile, saved, [updated.change], "D1");
  return { profile: explained.profile, change: explained.changes[0]!, recommendation: recommendResearch(explained.profile), timeline, revisedTimeline, feedback };
}

/** An expressly artificial fallback when the journey has no executed entry quote. */
export function mechanicalFundingExample(): { scenario: FundingScenario; plan: FundingPlan } {
  return { scenario: { id: "mechanical-example-v1", caseId: "manual-example", startingCashCents: 7200, entryPrice: 1_000_000,
    assumptions: "人工机制算例，不是真实行情；收入与采购是固定假设，不推断战斗结果。",
    events: [
      { id: "example-entry-exec", label: "人工下一开盘执行", kind: "entry-exec" },
      { id: "buy-upgrade", label: "途中计划升级（20 金币）", kind: "purchase", amountCents: 2000 },
      { id: "income", label: "假设收入（12 金币）", kind: "income", amountCents: 1200 },
      { id: "close", label: "人工参考报价", kind: "reference", price: 900_000 },
      { id: "recovery", label: "人工回收执行报价", kind: "recovery", price: 880_000 },
      { id: "final", label: "人工最终自动回收报价", kind: "recovery", price: 1_100_000, automatic: true },
    ] }, plan: { participationCents: 4000, recovery: { recovery: 50, final: 100 } } };
}

/** Build a fixed external schedule from actual economic events, never from combat labels. */
export function fundingScenarioFromRun(run: Run): { scenario: FundingScenario; plan: FundingPlan } | null {
  const entry = run.history.find((e) => e.type === "choice" && e.action === "submit-entry" && e.snapshot && typeof e.data.amountCents === "number");
  const filled = run.history.find((e) => e.type === "market" && e.action === "apply-quote" && e.data.stage === "entry" && typeof e.data.price === "number");
  if (!entry?.snapshot || !filled || typeof entry.data.amountCents !== "number" || typeof filled.data.price !== "number") return null;
  const ordinal = (id: string): number => Number(/^e(\d+)$/.exec(id)?.[1] ?? Number.MAX_SAFE_INTEGER);
  const start = ordinal(entry.id);
  type Item = { at: number; tie: number; event: FundingEvent; percent?: Percent };
  const items: Item[] = [];
  run.wallet.ledger.forEach((line, i) => {
    if (ordinal(line.id) - 0.5 <= start) return;
    if (line.kind === "battle-reward") items.push({ at: ordinal(line.id) - 0.5, tie: i, event: { id: `ledger-${i}`, label: `固定收入：${line.description}`, kind: "income", amountCents: line.cashDeltaCents } });
    if (line.kind === "purchase") items.push({ at: ordinal(line.id) - 0.5, tie: i, event: { id: `ledger-${i}`, label: `实际采购：${line.description}`, kind: "purchase", amountCents: -line.cashDeltaCents } });
  });
  let pendingPercent: Percent = 0;
  const attempted = new Set<string>();
  for (const e of run.history) {
    if (ordinal(e.id) <= start) continue;
    if (e.type === "choice" && e.action === "purchase-attempted" && e.data.reason === "insufficient-cash" && typeof e.data.priceCents === "number") {
      const s = e.snapshot;
      const key = `${e.node}|${s?.phase}|${s?.cashCents}|${s?.shareUnits}|${e.data.purchase}|${e.data.cardId}|${e.data.cardInstanceId}|${e.data.priceCents}`;
      if (!attempted.has(key)) { attempted.add(key); items.push({ at: ordinal(e.id), tie: 0, event: { id: `attempt-${e.id}`, label: "原局尝试但未支付的采购（作为固定需求）", kind: "purchase", amountCents: e.data.priceCents } }); }
    }
    if (e.type === "choice" && e.action === "submit-redemption" && typeof e.data.percent === "number" && validPercent(e.data.percent)) pendingPercent = e.data.percent;
    if (e.type !== "market" || e.action !== "apply-quote" || typeof e.data.price !== "number" || typeof e.data.stage !== "string") continue;
    if (e.data.stage === "entry") { items.push({ at: ordinal(e.id), tie: 0, event: { id: `quote-${e.id}`, label: "下一开盘执行参与", kind: "entry-exec" } }); continue; }
    const isClose = ["t1", "t2", "t3"].includes(e.data.stage);
    if (isClose) items.push({ at: ordinal(e.id), tie: 0, event: { id: `quote-${e.id}`, label: `历史参考：${e.data.stage}`, kind: "reference", price: e.data.price } });
    else {
      const percent = e.data.automatic === true ? 100 : pendingPercent;
      items.push({ at: ordinal(e.id), tie: 0, event: { id: `quote-${e.id}`, label: `实际执行：${e.data.stage}${e.data.automatic === true ? "（自动回收）" : ""}`, kind: "recovery", price: e.data.price, automatic: e.data.automatic === true }, percent });
      pendingPercent = 0;
    }
  }
  items.sort((a, b) => a.at - b.at || a.tie - b.tie);
  const recovery: Record<string, Percent> = {};
  for (const item of items) if (item.event.kind === "recovery") recovery[item.event.id] = item.percent ?? 0;
  let pendingFinal: FundingScenario["pendingFinal"];
  const hasAutomatic = items.some((item) => item.event.kind === "recovery" && item.event.automatic);
  const last = run.market.lastQuote;
  if (run.phase === "ended" && !hasAutomatic && !last) throw new Error("缺少最后市场时间点，不能构造结束结算");
  if (run.phase === "ended" && !hasAutomatic && last) {
    const next: Partial<Record<MarketStage, MarketStage>> = { entry: "exit-after-entry", t1: "t1-exec", "t1-exec": "exit-after-t1-exec", t2: "t2-exec", "t2-exec": "exit-after-t2-exec", t3: "final-exec" };
    const stage = next[last.step];
    if (!stage) throw new Error("无法确定结束后的下一执行阶段");
    pendingFinal = { stage, afterDate: last.date };
  }
  return { scenario: { id: `run-${run.id}`, caseId: run.caseId, startingCashCents: entry.snapshot.cashCents, entryPrice: filled.data.price,
    events: items.map((item) => item.event), ...(pendingFinal ? { pendingFinal } : {}), assumptions: "使用本局已发生报价及收入；采购和未支付尝试作为固定需求。改变参与金额后战斗及后续真实行为未被假定不变；首次买不起即停止。" },
    plan: { participationCents: entry.data.amountCents, recovery } };
}

/** Attach a separately loaded, later execution quote after the fixed scenario reaches its end. */
export function attachFundingFinalQuote(scenario: FundingScenario, quote: MarketQuote): FundingScenario {
  const required = scenario.pendingFinal;
  if (!required || quote.caseId !== scenario.caseId || quote.step !== required.stage || quote.date.replaceAll("-", "") <= required.afterDate.replaceAll("-", "")) throw new Error("报价不是结束后所需的下一执行报价");
  validPrice(quote.price);
  const { pendingFinal: _pendingFinal, ...rest } = scenario;
  return { ...rest, events: [...scenario.events, { id: "supplemental-final-exec", label: "固定练习：结束后的下一开盘自动回收", kind: "recovery", price: quote.price, automatic: true }] };
}

/** Instant practice without creating or persisting a profile. */
export function evaluateFundingPractice(scenario: FundingScenario, submission: Pick<FundingSubmission, "plan" | "purchaseId" | "canPay" | "revisedPlan">): FundingPracticeResult {
  const timeline = simulateFundingPlan(scenario, submission.plan);
  const purchase = timeline.rows.find((row) => row.id === submission.purchaseId && row.kind === "purchase");
  if (!purchase || purchase.canPay === null) throw new Error("请判断已经到达的采购节点");
  const revisedTimeline = simulateFundingPlan(scenario, submission.revisedPlan);
  const revisedPurchase = revisedTimeline.rows.find((row) => row.id === submission.purchaseId && row.kind === "purchase");
  const revisedTarget: FundingFeedback["revisedTarget"] = revisedPurchase && revisedPurchase.canPay !== null
    ? { status: "reached", cashBeforeCents: revisedPurchase.cashBeforeCents, amountCents: revisedPurchase.amountCents, canPay: revisedPurchase.canPay }
    : { status: "not-reached" };
  let revised: FundingFeedback["revised"];
  if (revisedTimeline.pendingFinal) revised = { status: "pending-final-quote" };
  else if (revisedTimeline.stoppedAt !== null) {
    const blocked = revisedTimeline.rows.find((row) => row.id === revisedTimeline.stoppedAt && row.kind === "purchase" && row.canPay === false);
    if (!blocked) throw new Error("无法确定暂停的采购节点");
    revised = { status: "blocked", id: blocked.id, label: blocked.label, cashBeforeCents: blocked.cashBeforeCents, amountCents: blocked.amountCents, shortfallCents: blocked.amountCents - blocked.cashBeforeCents };
  } else revised = { status: "completed" };
  const correct = purchase.canPay === submission.canPay;
  const feedback: FundingFeedback = {
    target: { id: purchase.id, label: purchase.label, selected: submission.canPay, actualCanPay: purchase.canPay, correct, cashBeforeCents: purchase.cashBeforeCents, amountCents: purchase.amountCents },
    revised, revisedTarget,
  };
  return { timeline, revisedTimeline, correct, actualCanPay: purchase.canPay, feedback };
}

export interface FixedSchedule { startingCashCents: number; participationCents: number; t1: Percent; t2: Percent }
export interface SchedulePoint { step: string; date: string; cashCents: number; referenceValueCents: number; price: number }
export interface ScheduleResult { cashCents: number; gainCents: number; heldPriceMaxDrawdown: number | null; timeline: SchedulePoint[] }
export interface HistoryComparison {
  caseId: string;
  title: string;
  dates: [string, string];
  asset: ScheduleResult;
  benchmark: ScheduleResult;
  direction: Direction;
  explanation: string;
}
function direction(a: number, b: number): Direction { return a > b ? "outperform" : a < b ? "underperform" : "equal"; }
function drawdown(prices: number[]): number | null {
  if (prices.length < 2) return null;
  let peak = prices[0]!;
  let result = 0;
  for (const value of prices) { validPrice(value); peak = Math.max(peak, value); result = Math.max(result, (peak - value) / peak); }
  return result;
}
function calculateSchedule(data: ResearchMarketCase, schedule: FixedSchedule, benchmark: boolean): ScheduleResult {
  const closes = benchmark ? data.benchmarkClose : data.assetClose;
  const entries = data.execution;
  const price = (i: number): number => benchmark ? entries[i]!.benchmarkPrice : entries[i]!.price;
  let cash = schedule.startingCashCents - schedule.participationCents;
  let shares = sharesForCents(schedule.participationCents, price(0));
  const pricesWhileHeld = [price(0)];
  const points: SchedulePoint[] = [{ step: "entry", date: entries[0]!.date, cashCents: cash, referenceValueCents: centsForShares(shares, price(0)), price: price(0) }];
  for (let day = 1; day <= 60; day++) {
    // A redemption selected after the previous close executes at this day's open.
    if (day === 21 || day === 41) {
      const executionIndex = day === 21 ? 1 : 2;
      const pct = day === 21 ? schedule.t1 : schedule.t2;
      const executionPrice = price(executionIndex);
      if (BigInt(shares) > 0n) pricesWhileHeld.push(executionPrice);
      const sold = sharesForPercent(shares, pct);
      cash += centsForShares(sold, executionPrice);
      shares = (BigInt(shares) - BigInt(sold)).toString();
      points.push({ step: day === 21 ? "t1-exec" : "t2-exec", date: entries[executionIndex]!.date, cashCents: cash, referenceValueCents: centsForShares(shares, executionPrice), price: executionPrice });
    }
    const p = closes[day]!;
    if (BigInt(shares) > 0n) pricesWhileHeld.push(p);
    if (day === 20 || day === 40 || day === 60) points.push({ step: `t${day / 20}`, date: data.dates[day]!, cashCents: cash, referenceValueCents: centsForShares(shares, p), price: p });
  }
  const finalPrice = price(3);
  if (BigInt(shares) > 0n) pricesWhileHeld.push(finalPrice);
  cash += centsForShares(shares, finalPrice);
  points.push({ step: "final-exec", date: entries[3]!.date, cashCents: cash, referenceValueCents: 0, price: finalPrice });
  return { cashCents: cash, gainCents: cash - schedule.startingCashCents, heldPriceMaxDrawdown: drawdown(pricesWhileHeld), timeline: points };
}
/** Applies the same already-fixed schedule to asset and benchmark at matching dates. */
export function compareSchedule(data: ResearchMarketCase, schedule: FixedSchedule): HistoryComparison {
  requireCents(schedule.startingCashCents); requireCents(schedule.participationCents);
  if (schedule.participationCents <= 0 || schedule.participationCents > schedule.startingCashCents) throw new Error("请设置大于零且不超过可用金币的参与金额");
  if (!validPercent(schedule.t1) || !validPercent(schedule.t2)) throw new Error("回收比例必须为 0、50 或 100");
  if (data.dates.length !== 61 || data.assetClose.length !== 61 || data.benchmarkClose.length !== 61 || data.execution.length !== 4) throw new Error("研究数据缺少完整同口径端点");
  const wanted = ["entry", "t1-exec", "t2-exec", "final-exec"];
  for (let i = 0; i < 4; i++) {
    const e = data.execution[i]!;
    if (e.step !== wanted[i]) throw new Error("执行报价顺序无效");
    validPrice(e.price); validPrice(e.benchmarkPrice);
  }
  if (data.execution[0]!.date !== data.dates[1] || data.execution[1]!.date !== data.dates[21] || data.execution[2]!.date !== data.dates[41] || data.execution[3]!.date <= data.dates[60]!) throw new Error("执行日与交易日未对齐");
  const asset = calculateSchedule(data, schedule, false);
  const benchmark = calculateSchedule(data, schedule, true);
  return { caseId: data.caseId, title: data.title, dates: [data.decisionDate, data.execution[3]!.date], asset, benchmark, direction: direction(asset.gainCents, benchmark.gainCents), explanation: "同一固定参与和回收日程、同日期端点；持有部分回撤按持有期间价格计算，主动回收不算价格下跌。历史样本不预测未来，基准指数不代表可无成本交易的产品。" };
}

export interface StartHistory {
  id: string;
  caseId: string;
  questionVersion: string;
  schedule: FixedSchedule;
  initialClaim: Direction | "unknown";
  priorExposure: boolean;
}
export interface HistoryAttempt extends StartHistory {
  shown: { primary: HistoryComparison; other?: HistoryComparison; otherPriorExposure?: boolean } | null;
  helpUsed: HelpPreference;
  answerExposed: boolean;
  submitted: boolean;
  final: { comparison?: Direction; historyDifference?: Direction; boundary?: BoundaryAnswer; reason: string; process: "kept" | "revised" | "undetermined" } | null;
}
export interface HistoryAnswers { comparison?: Direction; historyDifference?: Direction; boundary?: BoundaryAnswer; reason: string }
export interface HistoryFeedback {
  comparison: { selected: Direction; expected: Direction; correct: boolean; assetGainCents: number; benchmarkGainCents: number } | null;
  historyDifference: { selected: Direction; expected: Direction; correct: boolean; primaryGainCents: number; otherGainCents: number } | null;
  boundary: { selected: BoundaryAnswer; expected: "only_samples"; correct: boolean } | null;
  /** K2 retains its original all-or-nothing scoring. */
  k2Correct: boolean | null;
}

/** Feedback uses the already displayed snapshots, never an additional data load. */
export function evaluateHistoryFeedback(primary: HistoryComparison, other: HistoryComparison | null, answers: HistoryAnswers): HistoryFeedback {
  const comparison: HistoryFeedback["comparison"] = answers.comparison ? {
    selected: answers.comparison, expected: primary.direction, correct: answers.comparison === primary.direction,
    assetGainCents: primary.asset.gainCents, benchmarkGainCents: primary.benchmark.gainCents,
  } : null;
  const expectedDifference = other ? direction(other.asset.gainCents, primary.asset.gainCents) : null;
  const historyDifference: HistoryFeedback["historyDifference"] = other && answers.historyDifference && expectedDifference ? {
    selected: answers.historyDifference, expected: expectedDifference, correct: answers.historyDifference === expectedDifference,
    primaryGainCents: primary.asset.gainCents, otherGainCents: other.asset.gainCents,
  } : null;
  const boundary: HistoryFeedback["boundary"] = other && answers.boundary ? {
    selected: answers.boundary, expected: "only_samples", correct: answers.boundary === "only_samples",
  } : null;
  return { comparison, historyDifference, boundary, k2Correct: historyDifference && boundary ? historyDifference.correct && boundary.correct : null };
}

function updateAttempt(profile: ResearchProfile, id: string, apply: (a: HistoryAttempt) => HistoryAttempt): ResearchProfile {
  requireEnabled(profile);
  let found = false;
  const attempts = profile.research_process.map((a) => { if (a.id !== id) return a; found = true; return apply(a); });
  if (!found) throw new Error("未找到这次研究操作");
  return { ...profile, research_process: attempts };
}
/** Call before requesting the research data: this locks the claim and schedule. */
export function startHistory(profile: ResearchProfile, input: StartHistory): ResearchProfile {
  requireEnabled(profile); requireId(input.id); requireId(input.questionVersion);
  if (profile.research_process.some((a) => a.id === input.id)) throw new Error("此研究编号已使用");
  requireCents(input.schedule.startingCashCents); requireCents(input.schedule.participationCents);
  if (input.schedule.participationCents <= 0 || input.schedule.participationCents > input.schedule.startingCashCents || !validPercent(input.schedule.t1) || !validPercent(input.schedule.t2)) throw new Error("固定日程无效");
  const previous = profile.research_process.filter((a) => a.caseId === input.caseId && a.questionVersion === input.questionVersion);
  const helpUsed = previous.reduce<HelpPreference>((strongest, a) => HELP_RANK[a.helpUsed] > HELP_RANK[strongest] ? a.helpUsed : strongest, "self");
  // Data previously shown on either side of another comparison is already seen.
  const shownBefore = hasShownRelatedHistory(profile, input.caseId) || hasRelatedCalibration(profile, input.caseId) || hasRelatedFunding(profile, input.caseId);
  const attempt: HistoryAttempt = { ...input, priorExposure: input.priorExposure || shownBefore || hasDeclaredPriorExposure(profile, input.caseId) || previous.some((a) => a.priorExposure), schedule: { ...input.schedule }, shown: null, helpUsed, answerExposed: previous.some((a) => a.answerExposed), submitted: false, final: null };
  return { ...profile, research_process: [...profile.research_process, attempt] };
}
/** Only records what was actually shown. A second historical case is optional. */
export function showHistoryEvidence(profile: ResearchProfile, id: string, primary: ResearchMarketCase, other?: ResearchMarketCase, otherPriorExposure = false): ResearchProfile {
  return updateAttempt(profile, id, (a) => {
    if (a.submitted || primary.caseId !== a.caseId) throw new Error("研究状态或案例不匹配");
    if (other && other.caseId === primary.caseId) throw new Error("新历史片段必须不同于原案例");
    if (a.shown && other && a.shown.other && a.shown.other.caseId !== other.caseId) throw new Error("本题已经展示另一段历史，请另起研究");
    const oldOther = a.shown?.other;
    const comparison = a.shown?.primary ?? compareSchedule(primary, a.schedule);
    const otherComparison = oldOther ?? (other ? compareSchedule(other, a.schedule) : undefined);
    const otherId = otherComparison?.caseId;
    const related = otherId ? relatedCaseIds(otherId) : [];
    const shownElsewhere = !!otherId && profile.research_process.some((previous) => previous.id !== id && !!previous.shown && (related.includes(previous.caseId) || (!!previous.shown.other && related.includes(previous.shown.other.caseId))));
    const relatedPrimaryShown = !!otherId && !!a.shown && related.includes(a.caseId);
    // The relevant fact is exposure *before first display*, not the current
    // seen-set after opening or restoring the page. Older saved attempts did
    // not capture it, so conservatively treat those unknowns as already seen.
    const alreadySeen = oldOther ? (a.shown?.otherPriorExposure ?? true) : otherPriorExposure || shownElsewhere || relatedPrimaryShown || (!!otherId && (hasDeclaredPriorExposure(profile, otherId) || hasRelatedCalibration(profile, otherId) || hasRelatedFunding(profile, otherId)));
    return { ...a, shown: { primary: comparison, ...(otherComparison ? { other: otherComparison, otherPriorExposure: alreadySeen } : {}) } };
  });
}
const HELP_RANK: Record<HelpPreference, number> = { self: 0, hint: 1, step: 2 };
export function markHistoryHelp(profile: ResearchProfile, id: string, help: HelpPreference): ResearchProfile {
  return updateAttempt(profile, id, (a) => {
    if (a.submitted) throw new Error("这次研究已提交");
    return { ...a, helpUsed: HELP_RANK[help] > HELP_RANK[a.helpUsed] ? help : a.helpUsed };
  });
}
export function markHistoryAnswerExposed(profile: ResearchProfile, id: string): ResearchProfile {
  return updateAttempt(profile, id, (a) => { if (a.submitted) throw new Error("这次研究已提交"); return { ...a, answerExposed: true }; });
}
export function submitHistory(profile: ResearchProfile, id: string, answers: HistoryAnswers): { profile: ResearchProfile; changes: ProfileChange[]; recommendation: Recommendation; feedback: HistoryFeedback } {
  requireEnabled(profile);
  const attempt = profile.research_process.find((a) => a.id === id);
  if (!attempt || attempt.submitted || !attempt.shown) throw new Error("请先锁定判断并实际展示数据");
  if (!answers.reason.trim()) throw new Error("请选择或填写本次理由");
  if (!answers.comparison && !answers.boundary) throw new Error("请至少完成一个已展示的判断");
  if (answers.boundary && (!attempt.shown.other || !answers.historyDifference)) throw new Error("先展示另一历史片段，并比较两段固定日程的结果");
  const feedback = evaluateHistoryFeedback(attempt.shown.primary, attempt.shown.other ?? null, answers);
  const process = !answers.comparison || attempt.initialClaim === "unknown" ? "undetermined" : answers.comparison === attempt.initialClaim ? "kept" : "revised";
  let next = updateAttempt(profile, id, (a) => ({ ...a, submitted: true, final: { ...answers, process } }));
  const changes: ProfileChange[] = [];
  const primaryPrior = attempt.priorExposure || hasDeclaredPriorExposure(profile, attempt.caseId);
  const shared = { caseId: attempt.caseId, independent: attempt.helpUsed === "self" && !attempt.answerExposed && !primaryPrior, help: attempt.helpUsed, answerExposed: attempt.answerExposed, priorExposure: primaryPrior, evidence_ids: [id], };
  if (feedback.comparison) {
    const result = recordKnowledge(next, { ...shared, id: `${id}:K1`, questionKey: `D2:${attempt.caseId}:benchmark:${attempt.questionVersion}`, dimension: "K1", correct: feedback.comparison.correct, detail: `同一日程中资产盈亏 ${(attempt.shown.primary.asset.gainCents / 100).toFixed(2)}，同期基准 ${(attempt.shown.primary.benchmark.gainCents / 100).toFixed(2)} 金币。` });
    next = result.profile; changes.push(result.change);
  }
  if (feedback.k2Correct !== null && attempt.shown.other && feedback.historyDifference) {
    const expected = feedback.historyDifference.expected;
    const pair = [attempt.caseId, attempt.shown.other.caseId].sort().join(":");
    const k2PriorExposure = primaryPrior || !!attempt.shown.otherPriorExposure || hasDeclaredPriorExposure(profile, attempt.shown.other.caseId);
    const overlap = relatedCaseIds(attempt.caseId).includes(attempt.shown.other.caseId);
    const result = recordKnowledge(next, { ...shared, priorExposure: k2PriorExposure, independent: !overlap && attempt.helpUsed === "self" && !attempt.answerExposed && !k2PriorExposure, id: `${id}:K2`, questionKey: `D2:${pair}:boundary:${attempt.questionVersion}`, dimension: "K2", correct: feedback.k2Correct, detail: `固定日程下新片段相对原片段为 ${expected}；这只描述样本，不预测未来。` }, overlap ? "这两段历史互相重叠，只作相关情境练习，不增加独立依据。" : undefined);
    next = result.profile; changes.push(result.change);
  }
  const explained = explainTaskGuidance(profile, next, changes, "D2");
  return { profile: explained.profile, changes: explained.changes, recommendation: recommendResearch(explained.profile), feedback };
}

/** Compute immediate feedback for users who disabled observation; never stores an answer. */
export function evaluateHistoryPractice(primary: ResearchMarketCase, other: ResearchMarketCase | null, schedule: FixedSchedule, answers: HistoryAnswers): { primary: HistoryComparison; other: HistoryComparison | null; comparisonCorrect: boolean | null; boundaryCorrect: boolean | null; feedback: HistoryFeedback } {
  const a = compareSchedule(primary, schedule);
  const b = other ? compareSchedule(other, schedule) : null;
  if (other && other.caseId === primary.caseId) throw new Error("新历史片段必须不同于原案例");
  if (answers.boundary && (!b || !answers.historyDifference)) throw new Error("先展示并比较另一历史片段");
  const feedback = evaluateHistoryFeedback(a, b, answers);
  return { primary: a, other: b, comparisonCorrect: feedback.comparison?.correct ?? null, boundaryCorrect: feedback.k2Correct, feedback };
}

const FEELING_ORDER: Record<Exclude<Feeling, "unknown">, number> = { low: 0, mild: 1, noticeable: 2, strong: 3 };
/** An optional hypothesis, saved before the future segment is shown. */
export function saveForecast(profile: ResearchProfile, forecast: Omit<Forecast, "withdrawn">): ResearchProfile {
  if (!profile.enabled) return profile;
  requireId(forecast.id); requireCents(forecast.amountCents); requireCents(forecast.minCashCents);
  if (profile.forecasts.some((f) => f.id === forecast.id)) throw new Error("预期编号重复");
  if (forecast.amountCents === 0 || !(forecast.lossMin >= 0 && forecast.lossMin <= forecast.lossMax && forecast.lossMax <= 1) || !(forecast.minHealthRatio >= 0 && forecast.minHealthRatio <= 1)) throw new Error("预期条件无效");
  const previous = profile.forecasts.map((f) => f.caseId === forecast.caseId && !f.withdrawn && f.amountCents !== forecast.amountCents ? { ...f, withdrawn: true } : f);
  const related = relatedCaseIds(forecast.caseId);
  const priorExposure = forecast.priorExposure || hasDeclaredPriorExposure(profile, forecast.caseId) || hasShownRelatedHistory(profile, forecast.caseId) || profile.funding_attempts.some((a) => related.includes(a.caseId)) || hasRelatedCalibration(profile, forecast.caseId);
  return { ...profile, forecasts: [...previous, { ...forecast, priorExposure, withdrawn: false }] };
}
export function withdrawForecast(profile: ResearchProfile, id: string): ResearchProfile {
  if (!profile.enabled) return profile;
  return { ...profile, forecasts: profile.forecasts.map((f) => f.id === id ? { ...f, withdrawn: true } : f) };
}
/** Both axes remain unknown whenever the predeclared context does not match. */
export function compareSelfForecast(forecast: Forecast, context: CalibrationContext, feeling: Feeling | null, action: ContractAction | null): CalibrationResponse {
  const loss = forecast.amountCents > 0 ? (forecast.amountCents - context.referenceValueCents) / forecast.amountCents : -1;
  let unavailableReason: string | null = null;
  if (forecast.withdrawn || !forecast.beforeFuture || forecast.priorExposure || context.priorExposure) unavailableReason = "预期已撤回或案例已有未来信息暴露";
  else if (context.caseId !== forecast.caseId || context.node !== "N4" || context.amountCents !== forecast.amountCents || !context.sameShareBasis) unavailableReason = "案例、节点、金额或份额口径不同";
  else if (loss <= 0 || loss < forecast.lossMin || loss > forecast.lossMax) unavailableReason = "自然发生的损失不在预先约定区间";
  else if (context.cashCents < forecast.minCashCents || context.maxHealth <= 0 || context.health / context.maxHealth < forecast.minHealthRatio) unavailableReason = "现金或生命条件不同";
  else if (!context.autonomousChoice || context.pendingSettlement || context.forcedOrAutomatic || context.changedGoalOrUnderstanding || !context.afterCloseBeforeExecution) unavailableReason = "缺少自主选择或时间与背景条件不同";
  let affectComparison: CalibrationResponse["affectComparison"] = "unknown";
  let actionComparison: CalibrationResponse["actionComparison"] = "unknown";
  if (!unavailableReason) {
    if (forecast.feeling && forecast.feeling !== "unknown" && feeling && feeling !== "unknown") {
      const diff = FEELING_ORDER[feeling] - FEELING_ORDER[forecast.feeling];
      affectComparison = diff > 0 ? "stronger" : diff < 0 ? "weaker" : "similar";
    }
    if (forecast.action && forecast.action !== "unknown" && action && action !== "unknown") actionComparison = forecast.action === action ? "same" : "different";
  }
  return { forecastId: forecast.id, context: { ...context }, feeling, action, reason: null, comparison: unavailableReason ? "unavailable" : "matched", unavailableReason, affectComparison, actionComparison };
}
/** First record the present feeling; do not show the old forecast at this step. */
export function recordCalibrationFeeling(profile: ResearchProfile, forecastId: string, context: CalibrationContext, feeling: Feeling | null): ResearchProfile {
  if (!profile.enabled) return profile;
  const forecast = profile.forecasts.find((f) => f.id === forecastId);
  if (!forecast || profile.calibration.some((c) => c.forecastId === forecastId)) throw new Error("预期不存在或已记录回应");
  const related = relatedCaseIds(forecast.caseId);
  const priorExposure = forecast.priorExposure || hasDeclaredPriorExposure(profile, forecast.caseId) || hasShownRelatedHistory(profile, forecast.caseId) || profile.funding_attempts.some((a) => related.includes(a.caseId)) || hasRelatedCalibration(profile, forecast.caseId, forecast.id);
  return { ...profile, calibration: [...profile.calibration, compareSelfForecast({ ...forecast, priorExposure }, context, feeling, null)] };
}
/** Then record the voluntary contract action and optional self-reported reason. */
export function recordCalibrationAction(profile: ResearchProfile, forecastId: string, action: ContractAction, reason?: string): ResearchProfile {
  if (!profile.enabled) return profile;
  const forecast = profile.forecasts.find((f) => f.id === forecastId);
  const current = profile.calibration.find((c) => c.forecastId === forecastId);
  if (!forecast || !current || current.action !== null) throw new Error("请先记录当前感受，且每次只记录一个行动");
  const related = relatedCaseIds(forecast.caseId);
  const priorExposure = forecast.priorExposure || hasDeclaredPriorExposure(profile, forecast.caseId) || hasShownRelatedHistory(profile, forecast.caseId) || profile.funding_attempts.some((a) => related.includes(a.caseId)) || hasRelatedCalibration(profile, forecast.caseId, forecast.id);
  const compared = { ...compareSelfForecast({ ...forecast, priorExposure }, current.context, current.feeling, action), reason: reason ?? null };
  return { ...profile, calibration: profile.calibration.map((c) => c.forecastId === forecastId ? compared : c) };
}
