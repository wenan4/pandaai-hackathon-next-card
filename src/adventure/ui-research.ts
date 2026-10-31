import { h, type Child } from "../ui/dom";
import { loadMarketStage, loadResearchCase, type MarketManifest, type ResearchMarketCase } from "./market";
import { attachFundingFinalQuote, calibrationForDisplay, compareRecommendationPlans, compareSchedule, emptyResearchProfile, evaluateFundingPractice, evaluateHistoryPractice, fundingQuestionKey, fundingScenarioFromRun, guidanceForTask, mechanicalFundingExample, markFundingHelp, markHistoryHelp, recommendationPlan, recordCalibrationAction, recordCalibrationFeeling, saveForecast, showHistoryEvidence, simulateFundingPlan, startHistory, submitFunding, submitHistory, type BoundaryAnswer, type CalibrationContext, type ContractAction, type Direction, type Feeling, type FixedSchedule, type FundingFeedback, type FundingPlan, type FundingScenario, type FundingTimeline, type HelpPreference, type HistoryComparison, type HistoryFeedback, type KnowledgeEvidence, type Percent, type ProfileChange, type RecommendationPlan, type ResearchProfile } from "./research";
import type { Run, RunAction } from "./types";
import { button, coins, dateText, details, metric, note, panel, pill } from "./ui-components";
import { casesAreRelated } from "./ui-case";
import { taskAvailability } from "./ui-availability";
import { otherResearchCase, researchCaseChoices } from "./ui-research-cases";

interface Context { getRun: () => Run; getProfile: () => ResearchProfile; setProfile: (profile: ResearchProfile) => void; getManifest: () => MarketManifest | null; retryManifest: () => void; manifestLoading: () => boolean; manifestError: () => string | null; back: () => void; openTask?: (task: "D1" | "D2") => void; refresh: () => void; revealResult?: (task: "D1" | "D2") => void; notify: (message: string) => void; uid: (prefix: string) => string; isCaseKnown?: (caseId: string) => boolean; wasCaseSeen?: (caseId: string) => boolean; markCaseSeen?: (caseId: string) => void }
interface PlanChange { before: RecommendationPlan; after: RecommendationPlan }
type ResearchTaskId = "D1" | "D2";
interface NextAction { label: string; click: () => void; disabled?: boolean }
interface FundingState { scenario: FundingScenario; plan: FundingPlan; revised: FundingPlan; target: string; answer: boolean | null; help: HelpPreference; preferenceId: string; shownHelp: Record<string, HelpPreference>; answerExposed: boolean; loading: boolean; error: string | null; result: { feedback: FundingFeedback; changes: ProfileChange[]; recommendation: PlanChange; timeline: FundingTimeline; revised: FundingTimeline; attemptId?: string } | null }
interface HistoryState { id: string; caseId: string; otherId: string; caseWasSeen: boolean | null; schedule: FixedSchedule; claim: Direction | "unknown"; locked: boolean; loading: boolean; error: string | null; errorOther: boolean; primary: ResearchMarketCase | null; other: ResearchMarketCase | null; shown: HistoryComparison | null; otherShown: HistoryComparison | null; help: HelpPreference; preferenceId: string; comparison: Direction | ""; difference: Direction | ""; boundary: BoundaryAnswer | ""; reason: string; submitted: boolean; changes: ProfileChange[]; recommendation: PlanChange | null; feedback: HistoryFeedback | null }
const statuses: Record<string, string> = { unobserved: "尚未观察", independent: "本任务独立完成", assisted: "借助提示完成", needs_confirmation: "结论待确认", conflicting: "不同情境表现不同" };
const feelings: [Feeling, string][] = [["low", "不太在意"], ["mild", "轻微在意"], ["noticeable", "明显在意"], ["strong", "强烈在意"], ["unknown", "说不清"]];
const actionNames: [ContractAction, string][] = [["continue", "继续"], ["half", "回收一半"], ["all", "全部回收"], ["unknown", "还不知道"]];
const helpNames: Record<HelpPreference, string> = { self: "自主尝试", hint: "提示", step: "分步说明" };
const helpRank: Record<HelpPreference, number> = { self: 0, hint: 1, step: 2 };
const option = (value: string, label: string, selected = false): HTMLOptionElement => h("option", { value, selected }, label);
function onValue(event: Event): string { return (event.currentTarget as HTMLSelectElement | HTMLInputElement | HTMLTextAreaElement).value; }
function updateBlock(changes: ProfileChange[], evidence: KnowledgeEvidence[], summaries: Partial<Record<"K1" | "K2" | "K3", string>> = {}): HTMLElement {
  if (!changes.length) return note("本次练习即时反馈已显示，不保存人物观察。");
  const names = { K1: "同期比较", K2: "样本边界", K3: "可用现金" };
  return h("div", { class: "update-flow" }, changes.flatMap((change) => [
    h("div", { class: "update-step" }, h("small", null, `${names[change.dimension]} · 此前观察`), h("p", null, statuses[change.before] ?? change.before)),
    h("div", { class: "update-step" }, h("small", null, "新增依据"), (() => { const item = evidence.find((entry) => entry.id === change.addedEvidence); return item ? h("div", null, h("p", null, summaries[change.dimension] ?? item.detail.replaceAll("outperform", "更高").replaceAll("underperform", "更低").replaceAll("equal", "相同")), h("p", null, item.help === "self" ? "这一步自主作答。" : item.help === "hint" ? "这一步查看过提示。" : "这一步查看过分步说明。"), details("查看技术依据", h("p", { class: "fineprint" }, item.evidence_ids.join("、")))) : h("p", null, "本次任务提交的判断已记录，可在观察依据中查看。"); })()),
    h("div", { class: "update-step" }, h("small", null, "现在观察"), h("p", null, statuses[change.after] ?? change.after)),
    h("div", { class: "update-step" }, h("small", null, "下一步为何变化或不变"), h("p", null, change.explanation)),
  ]));
}
function selectPercent(value: Percent, update: (value: Percent) => void, label: string, disabled = false): HTMLElement {
  return h("label", { class: "field" }, label, h("select", { disabled, onchange: (event: Event) => update(Number(onValue(event)) as Percent) }, [0, 50, 100].map((pct) => option(String(pct), pct === 0 ? "继续持有" : `回收 ${pct}%`, pct === value))));
}
function fundingTimeline(timeline: FundingTimeline): HTMLElement {
  return h("div", { class: "timeline" }, timeline.rows.map((row) => h("div", { class: "timeline-item" }, h("strong", null, `${row.label}${row.canPay === false ? " · 暂停" : ""}`), h("p", null, `可用 ${coins(row.cashCents)} 金币 · 份额参考价值 ${row.referenceValueCents === null ? "尚未揭晓" : `${coins(row.referenceValueCents)} 金币`}`))), h("p", { class: "fineprint" }, timeline.note));
}
function resultPanel(task: "D1" | "D2", title: string, ...content: Child[]): HTMLElement {
  const section = panel(title, null, ...content);
  section.setAttribute("id", `research-${task.toLowerCase()}-result`);
  section.setAttribute("data-focus-key", `research-${task.toLowerCase()}-result`);
  section.setAttribute("tabindex", "-1");
  section.setAttribute("aria-label", title);
  section.setAttribute("style", "scroll-margin-top: 16px");
  return section;
}
function fundingFeedback(feedback: FundingFeedback): HTMLElement {
  const { target, revised, revisedTarget } = feedback;
  const difference = Math.abs(target.cashBeforeCents - target.amountCents);
  const gap = target.actualCanPay ? difference ? `支付后剩余 ${coins(difference)} 金币` : "恰好够支付" : `还差 ${coins(difference)} 金币`;
  const revisedSummary = revised.status === "blocked"
    ? `调整后的计划在“${revised.label}”暂停：需要 ${coins(revised.amountCents)} 金币，采购前可用 ${coins(revised.cashBeforeCents)} 金币，还差 ${coins(revised.shortfallCents)} 金币。`
    : revised.status === "pending-final-quote" ? "调整后的计划在等待结束报价，回收金额尚未到账。" : "调整后的计划完成了固定日程核查。";
  const targetSummary = revisedTarget.status === "not-reached" ? "调整后的计划尚未到达本次核查的采购，不能判断这一笔是否可支付。"
    : revised.status === "blocked" && revised.id === target.id ? null
      : `调整后的计划到达本次采购时，可用 ${coins(revisedTarget.cashBeforeCents)} 金币，需要 ${coins(revisedTarget.amountCents)} 金币，${revisedTarget.canPay ? "可以支付" : "不能支付"}。`;
  return h("div", { class: "notice" }, h("strong", null, target.label),
    h("p", null, `你选择：${target.selected ? "可以支付" : "不能支付"}。账本显示：${target.actualCanPay ? "可以支付" : "不能支付"}；${target.correct ? "与判断一致" : "这一步需要再核查"}。`),
    h("p", null, `采购前可用 ${coins(target.cashBeforeCents)} 金币，需要 ${coins(target.amountCents)} 金币，${gap}。`),
    h("p", null, revisedSummary), targetSummary ? h("p", null, targetSummary) : null);
}
function historyFeedback(feedback: HistoryFeedback): HTMLElement {
  const direction: Record<Direction, string> = { outperform: "更高", underperform: "更低", equal: "相同" };
  const boundary: Record<BoundaryAnswer, string> = { only_samples: "描述这两个样本，不能预测未来", predicts_future: "说明未来必然得到相同结果" };
  const comparison = feedback.comparison; const difference = feedback.historyDifference; const limit = feedback.boundary;
  return h("div", { class: "notice" },
    comparison ? h("p", null, h("strong", null, "同期比较："), `你选案例${direction[comparison.selected]}；案例盈亏 ${coins(comparison.assetGainCents)} 金币，同期基准 ${coins(comparison.benchmarkGainCents)} 金币，案例${direction[comparison.expected]}。${comparison.correct ? "这一步与数据一致。" : "这一步需要再核查。"}`) : null,
    difference ? h("p", null, h("strong", null, "两段比较："), `你选另一段${direction[difference.selected]}；第一段盈亏 ${coins(difference.primaryGainCents)} 金币，另一段 ${coins(difference.otherGainCents)} 金币，另一段${direction[difference.expected]}。${difference.correct ? "这一步与数据一致。" : "这一步需要再核查。"}`) : null,
    limit ? h("p", null, h("strong", null, "样本边界："), `你选“${boundary[limit.selected]}”；这些数据只能说明所示样本，不能据此断言未来一定如此。${limit.correct ? "这一步与数据一致。" : "这一步需要再核查。"}`) : null);
}
function preferredPurchase(rows: FundingTimeline["rows"]): string {
  return rows.find((row) => row.canPay === false && row.id.startsWith("attempt-"))?.id
    ?? rows.find((row) => row.canPay === false)?.id ?? rows[0]?.id ?? "";
}
export class ResearchUI {
  private ctx: Context;
  private funding: FundingState | null = null;
  private history: HistoryState | null = null;
  private historyStart: HTMLElement | null = null;
  private epoch = 0;
  private skipPendingHistory = false;
  private helpSelections: Partial<Record<"D1" | "D2", { runId: string; preferenceId: string; help: HelpPreference }>> = {};
  private forecastDraftKey = "";
  private forecastFeeling: Feeling | "" = "";
  private forecastAction: ContractAction | "" = "";
  constructor(ctx: Context) { this.ctx = ctx; }
  leave(): void { this.epoch++; this.funding = null; this.history = null; this.historyStart = null; this.skipPendingHistory = false; }
  private fail(error: unknown): void { this.ctx.notify(error instanceof Error ? error.message : "这一步没有完成，请重试。"); }
  private preferenceKey(profile: ResearchProfile): string { return profile.enabled ? profile.help_preference.at(-1)?.id ?? profile.user_reasons.at(-1)?.id ?? "" : ""; }
  private initialHelp(task: "D1" | "D2"): HelpPreference {
    const profile = this.ctx.getProfile(); const guidance = guidanceForTask(profile, task);
    const saved = this.helpSelections[task];
    if (profile.enabled && saved?.runId === this.ctx.getRun().id && saved.preferenceId === this.preferenceKey(profile)) return saved.help;
    return guidance.explicit ? guidance.help : "self";
  }
  private chooseHelp(task: "D1" | "D2", s: FundingState | HistoryState, help: HelpPreference): void {
    s.help = help;
    const profile = this.ctx.getProfile();
    if (profile.enabled) this.helpSelections[task] = { runId: this.ctx.getRun().id, preferenceId: this.preferenceKey(profile), help };
    this.ctx.refresh();
  }
  private syncPreference(task: "D1" | "D2", s: FundingState | HistoryState): void {
    const preferenceId = this.preferenceKey(this.ctx.getProfile());
    if (preferenceId !== s.preferenceId) { s.preferenceId = preferenceId; s.help = this.initialHelp(task); }
  }
  private guidance(task: "D1" | "D2", selected: HelpPreference, ready: boolean, set: (help: HelpPreference) => void): { panel: HTMLElement; shown: HTMLElement | null } {
    const recommendation = guidanceForTask(this.ctx.getProfile(), task);
    const text = task === "D1"
      ? selected === "hint" ? "把采购前的可用金币与价格比较；未回收的参考价值暂时不能付款。" : "先找采购前的可用金币，再对照采购价格；未到账的份额价值不计入。若买不起，时间线就在这里暂停。"
      : selected === "hint" ? "先比较同日程下两项盈亏，再比较两段历史；已有样本不能证明未来结果。" : "第一步比较案例和同期基准的固定日程盈亏；第二步比较两段历史的案例盈亏；第三步区分样本事实和对未来的预测。";
    const shown = ready && selected !== "self" ? h("div", { class: "notice", role: "note" }, h("strong", null, helpNames[selected]), h("p", null, text)) : null;
    return { shown, panel: h("section", { class: "panel stack", "aria-label": "本任务帮助" }, h("h3", null, "本任务的帮助"), h("p", { class: "hint" }, `${recommendation.explicit ? "你的默认偏好" : "建议"}：${helpNames[recommendation.help]}。${recommendation.reason}`), h("p", { class: "hint strong" }, `本次采用：${helpNames[selected]}。`),
      h("div", { class: "selection-row", role: "group", "aria-label": "选择本次帮助方式" }, (["self", "hint", "step"] as HelpPreference[]).map((mode) => h("button", { type: "button", class: `choice${selected === mode ? " selected" : ""}`, "aria-pressed": String(selected === mode), "data-focus-key": `${task}-help-${mode}`, onclick: () => set(mode) }, helpNames[mode]))),
      selected !== "self" && !ready ? h("p", { class: "fineprint" }, "题目准备好后显示所选帮助；目前尚未记录帮助暴露。") : null,
      shown, h("p", { class: "fineprint" }, this.ctx.getProfile().enabled ? "随时可切换；已经看过的帮助会保留在本题记录中，并影响本题观察。" : "随时可切换；本练习不保存观察。")) };
  }
  private recordFundingHelpWhenShown(s: FundingState, shown: HTMLElement | null): void {
    if (!shown || !s.target || s.help === "self") return;
    const epoch = this.epoch; const mode = s.help; const key = fundingQuestionKey(s.scenario, s.target, "d1-v1", s.plan);
    queueMicrotask(() => {
      if (!shown.isConnected || shown.closest("[inert]") || epoch !== this.epoch || this.funding !== s || s.help !== mode || !s.target || fundingQuestionKey(s.scenario, s.target, "d1-v1", s.plan) !== key) return;
      if (helpRank[s.shownHelp[key] ?? "self"] < helpRank[mode]) s.shownHelp[key] = mode;
      const profile = this.ctx.getProfile(); if (!profile.enabled || s.scenario.caseId === "manual-example") return;
      const already = (profile.funding_exposure ?? []).some((item) => (item.questionKey === key || (!item.questionKey && item.caseId === s.scenario.caseId)) && helpRank[item.help] >= helpRank[mode]);
      if (!already) this.ctx.setProfile(markFundingHelp(profile, key, mode));
    });
  }
  private recordHistoryHelpWhenShown(s: HistoryState, shown: HTMLElement | null): void {
    if (!shown || s.help === "self" || s.submitted || !this.ctx.getProfile().enabled) return;
    const epoch = this.epoch; const mode = s.help;
    queueMicrotask(() => {
      if (!shown.isConnected || shown.closest("[inert]") || epoch !== this.epoch || this.history !== s || s.help !== mode || s.submitted) return;
      const profile = this.ctx.getProfile(); const attempt = profile.research_process.find((item) => item.id === s.id);
      if (!profile.enabled || !attempt || attempt.submitted || helpRank[attempt.helpUsed] >= helpRank[mode]) return;
      try { this.ctx.setProfile(markHistoryHelp(profile, s.id, mode)); } catch (error) { this.fail(error); }
    });
  }
  private caseChoices() {
    const run = this.ctx.getRun(); const profile = this.ctx.getProfile();
    return researchCaseChoices(this.ctx.getManifest()?.cases ?? [], run, profile.enabled ? profile : emptyResearchProfile(false, run.source), this.ctx.wasCaseSeen);
  }
  private plan(profile: ResearchProfile = this.ctx.getProfile()): RecommendationPlan {
    return recommendationPlan(profile, taskAvailability(this.ctx.getRun(), profile, this.ctx.getManifest(), this.ctx.wasCaseSeen));
  }
  private sourceBadge(): Child {
    const source = this.ctx.getRun().source;
    return source === "real" ? null : pill(source === "fork" ? "模拟 · 分叉" : "模拟 · 预设", "gold");
  }
  private nextStep(change: PlanChange): HTMLElement {
    const current = this.plan(); const recommendation = current.recommendation;
    const name = recommendation.task_id === "D1" ? "资金安排台" : recommendation.task_id === "D2" ? "历史对照台" : null;
    const enabled = this.ctx.getProfile().enabled;
    return h("div", { class: "stack" }, h("p", { class: "hint" }, enabled ? `${name ? `当前建议：${name}。` : "当前可以自行选择。"}${recommendation.reason}` : "接下来可以自行选择练习，或返回旅程。"),
      h("p", { class: "fineprint" }, `资金安排：${current.offers.D1}`), h("p", { class: "fineprint" }, `历史对照：${current.offers.D2}`),
      enabled ? details("推荐为何变化或维持", h("p", { class: "hint" }, `提交时：${compareRecommendationPlans(change.before, change.after).explanation}`), current.continuity ? h("p", { class: "hint" }, current.continuity) : null, h("p", { class: "fineprint" }, `当前帮助建议：${recommendation.help_reason}`)) : null);
  }
  private resultActions(from: ResearchTaskId, revisedInput?: HTMLInputElement, nextUnseenCase?: string): HTMLElement {
    const profile = this.ctx.getProfile(); const availability = taskAvailability(this.ctx.getRun(), profile, this.ctx.getManifest(), this.ctx.wasCaseSeen);
    const recommended = profile.enabled ? this.plan().recommendation.task_id : null;
    const cases = this.caseChoices();
    const funding: NextAction | null = from === "D1" && revisedInput ? { label: "调整这份计划", click: () => { revisedInput.focus({ preventScroll: true }); revisedInput.scrollIntoView({ behavior: "auto", block: "center" }); } }
      : availability.funding !== "unavailable" && this.ctx.openTask ? { label: "切换 · 资金安排台", click: () => this.ctx.openTask?.("D1") } : null;
    let history: NextAction | null = null;
    if (availability.history === "pending") {
      history = from === "D2" ? { label: "继续已锁定的历史研究", click: () => this.resumePendingHistory() }
        : this.ctx.openTask ? { label: "继续 · 已锁定历史研究", click: () => this.ctx.openTask?.("D2") } : null;
    } else if (!this.ctx.getManifest()) {
      history = { label: this.ctx.manifestLoading() ? "正在加载案例目录…" : "重新加载案例目录", click: this.ctx.retryManifest, disabled: this.ctx.manifestLoading() };
    } else if (cases.length) {
      if (from === "D1" && this.ctx.openTask) history = { label: availability.history === "unseen" ? "继续 · 历史对照台" : "复习 · 历史对照台", click: () => this.ctx.openTask?.("D2") };
      if (from === "D2") history = { label: nextUnseenCase ? "继续 · 未见历史片段" : "复习已看过的片段", click: () => this.restartHistory(nextUnseenCase) };
    }
    const actions: { task: ResearchTaskId; action: NextAction | null }[] = [{ task: "D1", action: funding }, { task: "D2", action: history }];
    if (recommended === "D2") actions.reverse();
    return h("div", { class: "button-row" }, actions.map(({ task, action }) => action ? button(action.label, action.click, recommended === task ? "gold" : "secondary", action.disabled) : null),
      button(this.ctx.getRun().status === "active" ? "返回营地" : "回到旅程报告", this.ctx.back, "secondary"));
  }
  private get fundingState(): FundingState {
    if (!this.funding) {
      const derived = fundingScenarioFromRun(this.ctx.getRun());
      const base = derived?.scenario.events.some((e) => e.kind === "purchase") ? derived : mechanicalFundingExample();
      this.funding = { scenario: base.scenario, plan: structuredClone(base.plan), revised: structuredClone(base.plan), target: "", answer: null, help: this.initialHelp("D1"), preferenceId: this.preferenceKey(this.ctx.getProfile()), shownHelp: {}, answerExposed: false, loading: false, error: null, result: null };
    }
    return this.funding;
  }
  private get historyState(): HistoryState {
    if (!this.history) {
      const run = this.ctx.getRun(); const available = this.caseChoices();
      const caseId = available[0]?.summary.caseId ?? "";
      const otherId = otherResearchCase(available, caseId);
      const entry = run.history.find((e) => e.action === "submit-entry");
      const cash = entry?.snapshot?.cashCents ?? 7200; const invested = typeof entry?.data.amountCents === "number" ? entry.data.amountCents : 0;
      this.history = { id: this.ctx.uid("history"), caseId, otherId, caseWasSeen: null, schedule: { startingCashCents: cash, participationCents: Math.min(cash, invested || 2000), t1: 0, t2: 0 }, claim: "unknown", locked: false, loading: false, error: null, errorOther: false, primary: null, other: null, shown: null, otherShown: null, help: this.initialHelp("D2"), preferenceId: this.preferenceKey(this.ctx.getProfile()), comparison: "", difference: "", boundary: "", reason: "", submitted: false, changes: [], recommendation: null, feedback: null };
      const profile = this.ctx.getProfile();
      const pending = this.skipPendingHistory || !profile.enabled ? undefined : [...profile.research_process].reverse().find((x) => !x.submitted);
      this.skipPendingHistory = false;
      if (pending) {
        this.history.id = pending.id; this.history.caseId = pending.caseId; this.history.otherId = pending.shown?.other?.caseId ?? otherResearchCase(available, pending.caseId);
        this.history.schedule = { ...pending.schedule }; this.history.claim = pending.initialClaim; this.history.locked = true; this.history.caseWasSeen = pending.priorExposure;
        this.history.shown = pending.shown?.primary ?? null; this.history.otherShown = pending.shown?.other ?? null;
      }
    }
    return this.history;
  }
  renderFunding(): HTMLElement {
    let s: FundingState;
    try { s = this.fundingState; } catch { return panel("资金安排台", "本局账本暂时无法准备。", note("请返回旅程，稍后再试。", true), button("返回", this.ctx.back, "secondary")); }
    this.syncPreference("D1", s); const enabled = this.ctx.getProfile().enabled;
    let timeline;
    try { timeline = simulateFundingPlan(s.scenario, s.plan); } catch (error) { return panel("资金安排台", "请调整计划。", note(error instanceof Error ? error.message : "计划无效", true), button("返回", this.ctx.back, "secondary")); }
    const purchases = timeline.rows.filter((row) => row.kind === "purchase");
    const previousExposure = (target: string): boolean => {
      if (!target || !this.ctx.getProfile().enabled) return false;
    const key = fundingQuestionKey(s.scenario, target, "d1-v1", s.plan);
      return this.ctx.getProfile().funding_exposure.some((item) => (item.questionKey === key || (!item.questionKey && item.caseId === s.scenario.caseId)) && item.answerExposed);
    };
    if (!purchases.some((row) => row.id === s.target)) { s.target = preferredPurchase(purchases); s.answer = null; s.answerExposed = previousExposure(s.target); }
    const target = purchases.find((row) => row.id === s.target); const index = timeline.rows.findIndex((row) => row.id === s.target); const before = index > 0 ? timeline.rows[index - 1] : undefined;
    const planChanged = (kind: "plan" | "revised"): void => {
      s.result = null;
      if (kind === "plan") {
        const reachable = simulateFundingPlan(s.scenario, s.plan).rows.filter((row) => row.kind === "purchase");
        if (!reachable.some((row) => row.id === s.target)) s.target = preferredPurchase(reachable);
        s.answer = null; s.answerExposed = previousExposure(s.target);
      }
      this.ctx.refresh();
    };
    const setMoney = (kind: "plan" | "revised", input: HTMLInputElement): void => { const amount = Math.max(0, Math.min(s.scenario.startingCashCents, Math.round((Number(input.value) || 0) * 100))); if (s[kind].participationCents === amount) { input.value = String(amount / 100); return; } s[kind].participationCents = amount; planChanged(kind); };
    const recoveries = s.scenario.events.filter((event) => event.kind === "recovery" && !event.automatic);
    const automatic = s.scenario.events.some((event) => event.kind === "recovery" && event.automatic);
    const moneyInput = (kind: "plan" | "revised"): HTMLInputElement => h("input", { type: "number", min: 0, max: s.scenario.startingCashCents / 100, step: .01, value: s[kind].participationCents / 100, "data-focus-key": `funding-${kind}-amount`, onchange: (e: Event) => setMoney(kind, e.currentTarget as HTMLInputElement) });
    const currentInput = moneyInput("plan"); const revisedInput = moneyInput("revised");
    const planFields = (kind: "plan" | "revised"): Child[] => [h("label", { class: "field" }, kind === "plan" ? "试算的参与金额（金币）" : "调整后的参与金额（金币）", kind === "plan" ? currentInput : revisedInput),
      ...recoveries.map((event) => selectPercent(s[kind].recovery[event.id] ?? 0, (value) => { if ((s[kind].recovery[event.id] ?? 0) === value) return; s[kind].recovery[event.id] = value; planChanged(kind); }, `${event.label} · ${kind === "plan" ? "当前试算" : "调整后"}`))];
    const needsFinal = !!s.scenario.pendingFinal && (timeline.pendingFinal !== null || simulateFundingPlan(s.scenario, s.revised).pendingFinal !== null);
    const answeredPurchase = s.result?.timeline.rows.find((row) => row.id === s.target);
    const purchaseSummary = answeredPurchase ? `这次采购需要 ${coins(answeredPurchase.amountCents)} 金币，当时可用 ${coins(answeredPurchase.cashBeforeCents)} 金币，因此${answeredPurchase.canPay ? "可以支付" : "不能支付"}。` : undefined;
    const guidance = this.guidance("D1", s.help, !!target, (mode) => this.chooseHelp("D1", s, mode));
    this.recordFundingHelpWhenShown(s, guidance.shown);
    return h("main", { class: "stack", id: "main-content", style: "padding-top:24px;max-width:920px;margin:auto" }, h("div", { class: "task-title" }, h("span", { class: "task-badge" }, "D1"), h("div", null, h("div", { class: "eyebrow" }, "FUNDING WORKBENCH"), h("h1", null, "资金安排台")), this.sourceBadge()),
      h("p", { class: "hint" }, "调整参与和回收，比较可用现金与份额参考价值，再核查一次采购。"), note(this.plan().offers.D1), !enabled ? note("只玩游戏：本练习只显示即时反馈，离开后不保存研究观察。") : null,
      panel("先试一种安排", s.scenario.assumptions, ...planFields("plan"), h("p", { class: "fineprint" }, `起点可用 ${coins(s.scenario.startingCashCents)} 金币。输入后离开输入框即可更新。${automatic ? " 旅程结束时余下份额自动全部回收，不能调整。" : ""}`)),
      panel("沿途会发生什么", "先看采购之前的现金；份额价值须回收并执行后才能用于购买。", h("div", { class: "timeline" }, timeline.rows.slice(0, Math.max(index, 0)).map((row) => h("div", { class: "timeline-item" }, h("strong", null, row.label), h("p", null, `可用 ${coins(row.cashCents)} 金币 · 份额参考价值 ${row.referenceValueCents === null ? "尚未揭晓" : coins(row.referenceValueCents)} 金币`)))),
        target ? h("div", { class: "notice" }, h("strong", null, target.label), h("p", null, `采购需要 ${coins(target.amountCents)} 金币；此前可用 ${coins(before?.cashCents ?? s.scenario.startingCashCents)} 金币。`)) : note("这条日程没有可判断的采购。"),
        h("label", { class: "field" }, "选择要核查的采购", h("select", { onchange: (e: Event) => { s.target = onValue(e); s.answer = null; s.answerExposed = previousExposure(s.target); s.result = null; this.ctx.refresh(); } }, purchases.map((row) => option(row.id, row.label, row.id === s.target)))),
        h("p", { class: "hint strong" }, "这一项能用当时的可用金币支付吗？"), h("div", { class: "selection-row" }, ([ [true, "可以支付"], [false, "不能支付"] ] as const).map(([value, label]) => h("button", { type: "button", class: `choice${s.answer === value ? " selected" : ""}`, "aria-pressed": String(s.answer === value), onclick: () => { if (s.answer !== value) s.result = null; s.answer = value; this.ctx.refresh(); } }, label))),
        guidance.panel),
      panel(enabled ? "为自己保存另一份计划" : "试试另一份计划", "可调整参与金额与回收比例；计划是固定外部日程的账本练习，不保证战斗经过不变。", ...planFields("revised"), needsFinal ? h("div", { class: "stack" }, note("调整后结束时仍有份额，下一执行报价尚未加载，尚未到账。"), s.error ? note(s.error, true) : null, button(s.loading ? "正在加载结束报价…" : "加载结束后的执行报价", () => void this.loadFundingFinal(), "small secondary", s.loading)) : null, button(enabled ? "提交判断并保存计划" : "提交判断并查看核查", () => this.submitFunding(), "gold", s.answer === null || !s.target)),
      s.result ? resultPanel("D1", "这次核查的结果", fundingFeedback(s.result.feedback), details("查看试算的完整时间线", fundingTimeline(s.result.timeline)), details("查看调整后的时间线", fundingTimeline(s.result.revised)), updateBlock(s.result.changes, enabled ? this.ctx.getProfile().knowledge_evidence : [], { K3: purchaseSummary }), enabled && s.result.attemptId && this.ctx.getProfile().funding_attempts.some((attempt) => attempt.id === s.result!.attemptId) ? h("p", { class: "hint" }, "可在本局旅程报告中回看最近一次资金核查。") : null, this.nextStep(s.result.recommendation), this.resultActions("D1", revisedInput)) : null,
      h("div", { class: "button-row" }, button("返回", this.ctx.back, "ghost")));
  }
  private submitFunding(): void {
    const s = this.fundingState; if (s.answer === null || !s.target) return;
    try {
      const before = this.plan();
      const questionKey = fundingQuestionKey(s.scenario, s.target, "d1-v1", s.plan);
      const submission = { id: this.ctx.uid("funding"), questionVersion: "d1-v1", plan: structuredClone(s.plan), purchaseId: s.target, canPay: s.answer, revisedPlan: structuredClone(s.revised), help: s.shownHelp[questionKey] ?? "self", answerExposed: s.answerExposed, priorExposure: this.ctx.getRun().source !== "real" || (this.ctx.isCaseKnown?.(s.scenario.caseId) ?? false) };
      if (this.ctx.getProfile().enabled) {
        const result = submitFunding(this.ctx.getProfile(), s.scenario, submission);
        s.result = { feedback: result.feedback, changes: [result.change], recommendation: { before, after: this.plan(result.profile) }, timeline: result.timeline, revised: result.revisedTimeline, attemptId: submission.id }; s.answerExposed = true; this.ctx.setProfile(result.profile);
      } else { const result = evaluateFundingPractice(s.scenario, submission); s.result = { feedback: result.feedback, changes: [], recommendation: { before, after: this.plan() }, timeline: result.timeline, revised: result.revisedTimeline }; s.answerExposed = true; this.ctx.refresh(); }
      this.ctx.revealResult?.("D1");
    } catch (error) { this.fail(error); }
  }
  private async loadFundingFinal(): Promise<void> {
    const s = this.fundingState; const pending = s.scenario.pendingFinal; if (!pending || s.loading) return; const epoch = this.epoch;
    s.loading = true; s.error = null; this.ctx.refresh();
    try { const quote = await loadMarketStage(s.scenario.caseId, pending.stage, true); if (epoch !== this.epoch) return; s.scenario = attachFundingFinalQuote(s.scenario, quote); s.result = null; }
    catch (error) { if (epoch === this.epoch) s.error = error instanceof Error ? error.message : "报价加载失败，请重试。"; }
    finally { if (epoch === this.epoch) { s.loading = false; this.ctx.refresh(); } }
  }
  renderHistory(): HTMLElement {
    const s = this.historyState; this.syncPreference("D2", s); const enabled = this.ctx.getProfile().enabled; const run = this.ctx.getRun(); const manifest = this.ctx.getManifest(); const cases = this.caseChoices();
    if (!s.locked && cases.length && !cases.some((item) => item.summary.caseId === s.caseId)) { s.caseId = cases[0]!.summary.caseId; s.otherId = otherResearchCase(cases, s.caseId); }
    if (s.locked && !s.otherShown && !s.otherId && cases.length) s.otherId = otherResearchCase(cases, s.caseId);
    const chooseDirection = (label: string, value: Direction | "", set: (value: Direction) => void): HTMLElement => h("label", { class: "field" }, label, h("select", { onchange: (e: Event) => set(onValue(e) as Direction) }, option("", "请选择", value === ""), option("outperform", "更高", value === "outperform"), option("underperform", "更低", value === "underperform"), option("equal", "相同", value === "equal")));
    const guidance = this.guidance("D2", s.help, !!s.shown && !s.submitted, (mode) => this.chooseHelp("D2", s, mode));
    this.recordHistoryHelpWhenShown(s, guidance.shown);
    const unseenNext = cases.find(({ summary, seen }) => !seen && (!s.shown || !casesAreRelated(summary.caseId, s.shown.caseId)) && (!s.otherShown || !casesAreRelated(summary.caseId, s.otherShown.caseId)));
    const startPanel = panel("1 · 留下判断，固定日程", run.status === "active" ? "参与与回收日程锁定后加载另一段历史；本局尚未揭晓的未来不会在这里展示。" : "参与与回收日程锁定后才加载历史片段。", h("label", { class: "field" }, "查看的历史片段", h("select", { disabled: s.locked, onchange: (e: Event) => { s.caseId = onValue(e); s.otherId = otherResearchCase(cases, s.caseId); this.ctx.refresh(); } }, cases.map(({ summary, seen }) => option(summary.caseId, `${summary.title}（${(s.locked && summary.caseId === s.caseId ? s.caseWasSeen ?? seen : seen) ? "已看过 · 复习" : "未见"}）`, summary.caseId === s.caseId)))),
      h("label", { class: "field" }, "初步判断：同一日程下，案例结果相对同期基准", h("select", { disabled: s.locked, onchange: (e: Event) => { s.claim = onValue(e) as Direction | "unknown"; } }, option("unknown", "暂时不知道", s.claim === "unknown"), option("outperform", "更高", s.claim === "outperform"), option("underperform", "更低", s.claim === "underperform"), option("equal", "相同", s.claim === "equal"))),
      h("label", { class: "field" }, `参与金额（起点可用 ${coins(s.schedule.startingCashCents)} 金币）`, h("input", { type: "number", disabled: s.locked, min: .01, max: s.schedule.startingCashCents / 100, step: .01, value: s.schedule.participationCents / 100, onchange: (e: Event) => { s.schedule.participationCents = Math.round(Number(onValue(e)) * 100); } })),
      h("div", { class: "choice-grid" }, selectPercent(s.schedule.t1, (v) => { if (!s.locked) s.schedule.t1 = v; }, "第一检查点", s.locked), selectPercent(s.schedule.t2, (v) => { if (!s.locked) s.schedule.t2 = v; }, "第二检查点", s.locked)),
      s.locked ? pill("判断与日程已锁定", "blue") : button("锁定并查看同期资料", () => void this.lockHistory(), "gold", !cases.length || s.loading));
    startPanel.setAttribute("tabindex", "-1"); startPanel.setAttribute("data-focus-key", "history-task-start"); startPanel.setAttribute("style", "scroll-margin-top: 16px"); this.historyStart = startPanel;
    return h("main", { class: "stack", id: "main-content", style: "padding-top:24px;max-width:920px;margin:auto" }, h("div", { class: "task-title" }, h("span", { class: "task-badge" }, "D2"), h("div", null, h("div", { class: "eyebrow" }, "HISTORY WORKBENCH"), h("h1", null, "历史对照台")), this.sourceBadge()),
      h("p", { class: "hint" }, "先留下可以核查的判断和固定日程，再查看同口径的资料。"), note(this.plan().offers.D2), !enabled ? note("只玩游戏：本练习只显示即时反馈，离开后不保存研究观察。") : null,
      !manifest ? h("section", { class: "panel stack" }, note(this.ctx.manifestLoading() ? "案例目录正在加载；已有锁定题的记录仍保留。" : this.ctx.manifestError() ? `案例目录加载失败：${this.ctx.manifestError()} 已有锁定题的记录仍保留。` : "案例目录尚未加载；已有锁定题的记录仍保留。", !!this.ctx.manifestError()), button(this.ctx.manifestLoading() ? "正在加载案例目录…" : "重新加载案例目录", this.ctx.retryManifest, "secondary", this.ctx.manifestLoading())) : !cases.length && !s.locked ? note("当前没有可选的历史片段，可以先返回旅程或切换任务。") : null,
      startPanel,
      !s.submitted ? guidance.panel : null,
      s.error && !s.submitted ? h("section", { class: "panel stack" }, note(s.error, true), button("重试加载资料", () => void this.loadHistory(s.errorOther), "secondary", s.loading)) : null,
      s.locked && !s.shown && !s.error && !s.loading && !s.submitted ? button("继续加载已锁定资料", () => void this.loadHistory(false), "secondary") : null,
      s.loading ? h("div", { class: "notice", role: "status" }, "正在加载锁定日程后的历史资料……") : null,
      s.shown ? panel("2 · 看同期数据", "资产与基准采用相同起点、日期和固定操作日程。", this.comparisonCard(s.shown), h("p", { class: "hint" }, "持有部分最大回撤描述持有期间价格的高点到后续低点；回收本身不算价格下跌。"),
        !s.otherShown ? (s.submitted ? h("p", { class: "fineprint" }, "本题资料已固定；可以在下一题继续查看其他片段。") : s.otherId ? button(`再查看另一段历史${cases.find((choice) => choice.summary.caseId === s.otherId)?.seen ? "（复习）" : "（未见）"}`, () => void this.loadHistory(true), "secondary", s.loading) : h("p", { class: "fineprint" }, "冒险结束后，可以继续比较本局的历史片段。")) : this.comparisonCard(s.otherShown)) : null,
      s.shown && !s.submitted ? panel("3 · 提交你的描述", "可以保留或修正初步判断；变化与否都不是扣分项。", chooseDirection("本案例结果相对同期基准", s.comparison, (value) => { s.comparison = value; }),
        s.otherShown ? h("div", { class: "stack" }, chooseDirection("另一段历史的结果相对第一段", s.difference, (value) => { s.difference = value; }), h("label", { class: "field" }, "这些结果能说明什么？", h("select", { onchange: (e: Event) => { s.boundary = onValue(e) as BoundaryAnswer | ""; } }, option("", "请选择", !s.boundary), option("only_samples", "描述这两个样本，不能预测未来", s.boundary === "only_samples"), option("predicts_future", "说明未来必然得到相同结果", s.boundary === "predicts_future")))) : null,
        h("label", { class: "field" }, "这次主要依据什么？", h("select", { onchange: (e: Event) => { s.reason = onValue(e); } }, option("", "请选择", !s.reason), option("根据同日期的数字比较", "根据同日期的数字比较", s.reason === "根据同日期的数字比较"), option("查看了不同片段的差异", "查看了不同片段的差异", s.reason === "查看了不同片段的差异"), option("仍不确定，想继续核查", "仍不确定，想继续核查", s.reason === "仍不确定，想继续核查"))),
        button("提交这次研究", () => this.submitHistory(), "gold", s.loading)) : null,
      s.submitted ? resultPanel("D2", "研究后的观察", s.feedback ? historyFeedback(s.feedback) : null, updateBlock(s.changes, enabled ? this.ctx.getProfile().knowledge_evidence : [], { K1: s.shown ? `同一日程下，案例盈亏 ${coins(s.shown.asset.gainCents)} 金币，同期基准盈亏 ${coins(s.shown.benchmark.gainCents)} 金币。` : undefined, K2: s.shown && s.otherShown ? `固定日程下，第一段盈亏 ${coins(s.shown.asset.gainCents)} 金币，另一段盈亏 ${coins(s.otherShown.asset.gainCents)} 金币；它们只能说明这两段历史。` : undefined }), s.recommendation ? this.nextStep(s.recommendation) : null, h("p", { class: "hint" }, !manifest ? "案例目录尚未加载，加载后才能判断可用片段。" : !cases.length ? "当前没有可选的历史片段，可以先返回旅程或切换任务。" : unseenNext ? "还有尚未见过的历史片段，可以继续核查。" : "目前没有可用的未见片段；再次打开是复习，不作为新情境。"), this.resultActions("D2", undefined, unseenNext?.summary.caseId)) : null,
      h("div", { class: "button-row" }, button("返回", this.ctx.back, "ghost")));
  }
  private focusHistoryStart(): void { this.historyStart?.focus({ preventScroll: true }); this.historyStart?.scrollIntoView({ behavior: "auto", block: "start" }); }
  private restartHistory(preferredCase?: string): void {
    this.epoch++; this.history = null; this.skipPendingHistory = true;
    const cases = this.caseChoices();
    if (preferredCase && cases.some((item) => item.summary.caseId === preferredCase)) { const next = this.historyState; next.caseId = preferredCase; next.otherId = otherResearchCase(cases, preferredCase); }
    this.ctx.refresh(); this.focusHistoryStart();
  }
  private resumePendingHistory(): void {
    if (!this.ctx.getProfile().enabled || !this.ctx.getProfile().research_process.some((item) => !item.submitted)) return;
    this.epoch++; this.history = null; this.skipPendingHistory = false; this.ctx.refresh(); this.focusHistoryStart();
  }
  private comparisonCard(c: HistoryComparison): HTMLElement {
    return h("div", { class: "stack" }, h("div", { class: "row" }, pill(c.title, "blue"), h("span", { class: "fineprint" }, `${dateText(c.dates[0])} 至 ${dateText(c.dates[1])}`)), h("div", { class: "metric-grid" }, metric("案例固定日程盈亏", `${coins(c.asset.gainCents)} 金币`), metric("同期基准盈亏", `${coins(c.benchmark.gainCents)} 金币`), metric("持有部分最大回撤", c.asset.heldPriceMaxDrawdown === null ? "无持有" : `${(c.asset.heldPriceMaxDrawdown * 100).toFixed(1)}%`)),
      h("p", { class: "fineprint" }, c.explanation), details("查看可用现金时间线", h("div", { class: "timeline" }, c.asset.timeline.map((row) => h("div", { class: "timeline-item" }, h("strong", null, `${dateText(row.date)} · ${row.step}`), h("p", null, `可用 ${coins(row.cashCents)} 金币 · 参考价值 ${coins(row.referenceValueCents)} 金币`))))));
  }
  private async lockHistory(): Promise<void> {
    const s = this.historyState; if (s.locked || s.loading) return;
    try {
      if (s.schedule.participationCents <= 0 || s.schedule.participationCents > s.schedule.startingCashCents) throw new Error("参与金额需大于 0 且不超过起点可用金币。");
      const run = this.ctx.getRun(); const priorExposure = run.source !== "real" || (this.caseChoices().find((item) => item.summary.caseId === s.caseId)?.seen ?? true);
      s.caseWasSeen = priorExposure;
      if (this.ctx.getProfile().enabled) {
        const updated = startHistory(this.ctx.getProfile(), { id: s.id, caseId: s.caseId, questionVersion: "d2-v1", schedule: { ...s.schedule }, initialClaim: s.claim, priorExposure });
        s.caseWasSeen = updated.research_process.find((item) => item.id === s.id)?.priorExposure ?? true;
        this.ctx.setProfile(updated);
      }
      s.locked = true; await this.loadHistory(false);
    } catch (error) { this.fail(error); }
  }
  private async loadHistory(other: boolean): Promise<void> {
    const s = this.historyState; if (!s.locked || s.loading || s.submitted) return; const epoch = this.epoch;
    s.loading = true; s.error = null; this.ctx.refresh();
    try {
      const primary = s.primary ?? await loadResearchCase(s.caseId, true); const second = other ? await loadResearchCase(s.otherId, true) : s.other;
      if (epoch !== this.epoch || s.submitted) return;
      s.primary = primary; s.other = second; s.shown = compareSchedule(primary, s.schedule); s.otherShown = second ? compareSchedule(second, s.schedule) : null;
      if (this.ctx.getProfile().enabled) {
        const profile = this.ctx.getProfile(); const existing = profile.research_process.find((item) => item.id === s.id)?.shown;
        const realRun = this.ctx.getRun();
        const otherPriorExposure = second ? existing?.other?.caseId === second.caseId ? (existing.otherPriorExposure ?? true) : realRun.source !== "real" || (this.ctx.wasCaseSeen?.(second.caseId) ?? false) || (casesAreRelated(realRun.caseId, second.caseId) && realRun.history.some((event) => event.type === "market" && ["t1", "t2", "t3"].includes(String(event.data.stage)))) : false;
        this.ctx.setProfile(showHistoryEvidence(profile, s.id, primary, second ?? undefined, otherPriorExposure));
      }
      this.ctx.markCaseSeen?.(primary.caseId); if (second) this.ctx.markCaseSeen?.(second.caseId);
    } catch (error) { if (epoch === this.epoch) { s.errorOther = other; s.error = error instanceof Error ? error.message : "资料加载失败。"; } }
    finally { if (epoch === this.epoch) { s.loading = false; this.ctx.refresh(); } }
  }
  private submitHistory(): void {
    const s = this.historyState;
    if (s.loading || s.submitted) return;
    if (!s.comparison || !s.reason) { this.ctx.notify("请选择同期比较结果和理由。"); return; }
    if (s.otherShown && (!s.difference || !s.boundary)) { this.ctx.notify("请比较另一片段并选择样本边界。"); return; }
    try {
      const before = this.plan();
      const answers = { comparison: s.comparison, ...(s.difference ? { historyDifference: s.difference } : {}), ...(s.boundary ? { boundary: s.boundary } : {}), reason: s.reason };
      if (this.ctx.getProfile().enabled) {
        const result = submitHistory(this.ctx.getProfile(), s.id, answers); s.changes = result.changes; s.feedback = result.feedback; s.submitted = true; s.recommendation = { before, after: this.plan(result.profile) }; this.ctx.setProfile(result.profile);
      } else {
        if (!s.primary) throw new Error("请先加载资料。");
        const result = evaluateHistoryPractice(s.primary, s.other, s.schedule, answers); s.feedback = result.feedback; s.submitted = true; s.recommendation = { before, after: this.plan() }; this.ctx.refresh();
      }
      this.ctx.revealResult?.("D2");
    } catch (error) { this.fail(error); }
  }
  campExtras(): Child {
    const run = this.ctx.getRun(); const profile = this.ctx.getProfile(); if (!profile.enabled || run.phase !== "camp" || !run.camp) return null;
    const active = [...profile.forecasts].reverse().find((f) => f.caseId === run.caseId && !f.withdrawn);
    if (run.node === "N2" && run.market.entryCommitted && run.market.order?.kind === "entry" && run.market.order.amountCents > 0 && !active) {
      const amount = run.market.order.amountCents;
      const draftKey = `${run.id}:${amount}`;
      if (this.forecastDraftKey !== draftKey) { this.forecastDraftKey = draftKey; this.forecastFeeling = ""; this.forecastAction = ""; }
      const feeling = h("select", { "aria-label": "预想的感受", "data-focus-key": "forecast-feeling", onchange: (event: Event) => { this.forecastFeeling = onValue(event) as Feeling | ""; } }, option("", "不回答", !this.forecastFeeling), ...feelings.map(([id, label]) => option(id, label, id === this.forecastFeeling)));
      const prediction = h("select", { "aria-label": "预想的行动", "data-focus-key": "forecast-action", onchange: (event: Event) => { this.forecastAction = onValue(event) as ContractAction | ""; } }, option("", "不回答", !this.forecastAction), ...actionNames.map(([id, label]) => option(id, label, id === this.forecastAction)));
      return h("section", { class: "panel forecast-panel" }, details("可选：留给下一营地的预期", h("div", { class: "stack" }, h("p", { class: "hint" }, `假设契约价值相对投入减少 10%–20%（约 ${coins(Math.round(amount * .1))}–${coins(Math.round(amount * .2))} 金币），且届时至少有 10 金币、生命至少一半，你预计会怎样？这只是预测，不是承诺。`),
        h("label", { class: "field" }, "你预计会多在意？", feeling), h("label", { class: "field" }, "届时可能如何安排？", prediction), button("留下一份预期", () => { try { this.ctx.setProfile(saveForecast(profile, { id: this.ctx.uid("forecast"), caseId: run.caseId, amountCents: amount, lossMin: .1, lossMax: .2, minCashCents: 1000, minHealthRatio: .5, feeling: (feeling.value || null) as Feeling | null, action: (prediction.value || null) as ContractAction | null, priorExposure: this.ctx.isCaseKnown?.(run.caseId) ?? false, beforeFuture: true })); this.ctx.notify("预期已保存；之后改变主意也完全可以。"); } catch (error) { this.fail(error); } }, "small secondary"))));
    }
    if (run.node === "N4" && run.camp.decision === "not-submitted" && active && !profile.calibration.some((c) => c.forecastId === active.id) && run.market.referenceValueCents !== null) {
      const feeling = h("select", { "aria-label": "现在的感受" }, option("", "不回答"), ...feelings.map(([id, label]) => option(id, label)));
      const context: CalibrationContext = { caseId: run.caseId, node: run.node, amountCents: run.wallet.investedCents, referenceValueCents: run.market.referenceValueCents, cashCents: run.wallet.cashCents, health: run.hp, maxHealth: run.maxHp, priorExposure: this.ctx.isCaseKnown?.(run.caseId) ?? false, autonomousChoice: true, pendingSettlement: false, forcedOrAutomatic: false, changedGoalOrUnderstanding: profile.user_reasons.length > 0, afterCloseBeforeExecution: run.market.lastQuote?.step === "t1", sameShareBasis: !run.history.some((e) => e.action === "submit-redemption") };
      return h("section", { class: "panel stack" }, h("h3", null, "这一刻的感受"), pill("可跳过", "gold"), h("p", { class: "hint" }, run.source === "fork" ? "原局的事前预期已保留作模拟参考；这次分叉不作为可比的新观察。可以记录此刻感受，再自行选择契约操作。" : "如果愿意，先记录现在的感受，再自行选择契约操作。系统不会先展示之前的回答。"), h("label", { class: "field" }, "此刻有多在意？", feeling), button("记录此刻感受", () => { try { this.ctx.setProfile(recordCalibrationFeeling(profile, active.id, context, (feeling.value || null) as Feeling | null)); this.ctx.notify("已记录。接下来按你的想法安排份额。"); } catch (error) { this.fail(error); } }, "small secondary"));
    }
    return null;
  }
  afterAction(action: RunAction): void {
    if (action.type !== "submit-redemption") return;
    const profile = this.ctx.getProfile(); if (!profile.enabled) return;
    const pending = [...profile.calibration].reverse().find((item) => item.action === null);
    if (!pending) return;
    const choice: ContractAction = action.percent === 0 ? "continue" : action.percent === 50 ? "half" : "all";
    try { this.ctx.setProfile(recordCalibrationAction(profile, pending.forecastId, choice)); } catch (error) { this.fail(error); }
  }
  calibrationReport(): Child {
    const item = calibrationForDisplay(this.ctx.getProfile()).at(-1); if (!item) return null;
    const forecast = this.ctx.getProfile().forecasts.find((f) => f.id === item.forecastId);
    const feelingText = (value: Feeling | null): string => feelings.find(([id]) => id === value)?.[1] ?? "没有回答";
    const actionText = (value: ContractAction | null): string => actionNames.find(([id]) => id === value)?.[1] ?? "没有回答";
    return details("回看这次预期", h("p", { class: "hint" }, `事前预计：${feelingText(forecast?.feeling ?? null)}，倾向${actionText(forecast?.action ?? null)}。`), h("p", { class: "hint" }, `这次自报：${feelingText(item.feeling)}，实际选择${actionText(item.action)}。`), h("p", { class: "hint" }, item.comparison === "matched" ? `符合预先条件。本次感受对照：${item.affectComparison === "stronger" ? "比预计更强" : item.affectComparison === "weaker" ? "比预计更轻" : item.affectComparison === "similar" ? "与预计接近" : "信息不足"}；行动：${item.actionComparison === "same" ? "与预测相同" : item.actionComparison === "different" ? "与预测不同" : "信息不足"}。` : `这次条件不同，不能直接比较：${(item.unavailableReason ?? "信息不足").replace(/（依据 [^）]+）/g, "")}。`), h("p", { class: "fineprint" }, "感受与行动分别由本人报告；这不说明现实中的财务承受能力。"));
  }
}
