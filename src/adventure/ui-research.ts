import { h, type Child } from "../ui/dom";
import { loadMarketStage, loadResearchCase, type MarketManifest, type ResearchMarketCase } from "./market";
import { attachFundingFinalQuote, compareSchedule, evaluateFundingPractice, evaluateHistoryPractice, fundingQuestionKey, fundingScenarioFromRun, mechanicalFundingExample, markFundingHelp, markHistoryHelp, recordCalibrationAction, recordCalibrationFeeling, saveForecast, showHistoryEvidence, simulateFundingPlan, startHistory, submitFunding, submitHistory, type BoundaryAnswer, type CalibrationContext, type ContractAction, type Direction, type Feeling, type FixedSchedule, type FundingPlan, type FundingScenario, type FundingTimeline, type HelpPreference, type HistoryComparison, type KnowledgeEvidence, type Percent, type ProfileChange, type ResearchProfile } from "./research";
import type { Run, RunAction } from "./types";
import { button, coins, dateText, details, metric, note, panel, percent, pill } from "./ui-components";

interface Context { getRun: () => Run; getProfile: () => ResearchProfile; setProfile: (profile: ResearchProfile) => void; getManifest: () => MarketManifest | null; back: () => void; refresh: () => void; notify: (message: string) => void; uid: (prefix: string) => string; isCaseKnown?: (caseId: string) => boolean; wasCaseSeen?: (caseId: string) => boolean; markCaseSeen?: (caseId: string) => void }
interface FundingState { scenario: FundingScenario; plan: FundingPlan; revised: FundingPlan; target: string; answer: boolean | null; help: HelpPreference; answerExposed: boolean; loading: boolean; error: string | null; result: { correct: boolean; actual: boolean; changes: ProfileChange[]; stoppedAt: string | null; reason: string; timeline: FundingTimeline; revised: FundingTimeline } | null }
interface HistoryState { id: string; caseId: string; otherId: string; schedule: FixedSchedule; claim: Direction | "unknown"; locked: boolean; loading: boolean; error: string | null; errorOther: boolean; primary: ResearchMarketCase | null; other: ResearchMarketCase | null; shown: HistoryComparison | null; otherShown: HistoryComparison | null; help: HelpPreference; comparison: Direction | ""; difference: Direction | ""; boundary: BoundaryAnswer | ""; reason: string; submitted: boolean; changes: ProfileChange[]; practiceFeedback: string | null }
const statuses: Record<string, string> = { unobserved: "尚未观察", independent: "本任务独立完成", assisted: "借助提示完成", needs_confirmation: "结论待确认", conflicting: "不同情境表现不同" };
const feelings: [Feeling, string][] = [["low", "不太在意"], ["mild", "轻微在意"], ["noticeable", "明显在意"], ["strong", "强烈在意"], ["unknown", "说不清"]];
const actionNames: [ContractAction, string][] = [["continue", "继续"], ["half", "回收一半"], ["all", "全部回收"], ["unknown", "还不知道"]];
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
export class ResearchUI {
  private ctx: Context;
  private funding: FundingState | null = null;
  private history: HistoryState | null = null;
  private epoch = 0;
  constructor(ctx: Context) { this.ctx = ctx; }
  leave(): void { this.epoch++; this.funding = null; this.history = null; }
  private fail(error: unknown): void { this.ctx.notify(error instanceof Error ? error.message : "这一步没有完成，请重试。"); }
  private get fundingState(): FundingState {
    if (!this.funding) {
      const derived = fundingScenarioFromRun(this.ctx.getRun());
      const base = derived?.scenario.events.some((e) => e.kind === "purchase") ? derived : mechanicalFundingExample();
      this.funding = { scenario: base.scenario, plan: structuredClone(base.plan), revised: structuredClone(base.plan), target: "", answer: null, help: "self", answerExposed: false, loading: false, error: null, result: null };
    }
    return this.funding;
  }
  private get historyState(): HistoryState {
    if (!this.history) {
      const run = this.ctx.getRun(); const available = (this.ctx.getManifest()?.cases ?? []).filter((item) => run.status !== "active" || item.caseId !== run.caseId);
      const caseId = available.find((c) => c.caseId !== run.caseId)?.caseId ?? available[0]?.caseId ?? "lantern-b";
      const otherId = available.find((c) => c.caseId !== caseId)?.caseId ?? "";
      const entry = run.history.find((e) => e.action === "submit-entry");
      const cash = entry?.snapshot?.cashCents ?? 7200; const invested = typeof entry?.data.amountCents === "number" ? entry.data.amountCents : 0;
      this.history = { id: this.ctx.uid("history"), caseId, otherId, schedule: { startingCashCents: cash, participationCents: Math.min(cash, invested || 2000), t1: 0, t2: 0 }, claim: "unknown", locked: false, loading: false, error: null, errorOther: false, primary: null, other: null, shown: null, otherShown: null, help: "self", comparison: "", difference: "", boundary: "", reason: "", submitted: false, changes: [], practiceFeedback: null };
      const pending = [...this.ctx.getProfile().research_process].reverse().find((x) => !x.submitted);
      if (pending) {
        this.history.id = pending.id; this.history.caseId = pending.caseId; this.history.otherId = available.find((c) => c.caseId !== pending.caseId)?.caseId ?? otherId;
        this.history.schedule = { ...pending.schedule }; this.history.claim = pending.initialClaim; this.history.locked = true; this.history.help = pending.helpUsed;
        this.history.shown = pending.shown?.primary ?? null; this.history.otherShown = pending.shown?.other ?? null;
      }
    }
    return this.history;
  }
  renderFunding(): HTMLElement {
    const s = this.fundingState; const enabled = this.ctx.getProfile().enabled; const recordExposure = enabled && s.scenario.caseId !== "manual-example";
    let timeline;
    try { timeline = simulateFundingPlan(s.scenario, s.plan); } catch (error) { return panel("资金安排台", "请调整计划。", note(error instanceof Error ? error.message : "计划无效", true), button("返回", this.ctx.back, "secondary")); }
    const purchases = timeline.rows.filter((row) => row.kind === "purchase");
    const previousExposure = (target: string): boolean => {
      if (!target) return false;
    const key = fundingQuestionKey(s.scenario, target, "d1-v1", s.plan);
      return this.ctx.getProfile().funding_exposure.some((item) => (item.questionKey === key || (!item.questionKey && item.caseId === s.scenario.caseId)) && item.answerExposed);
    };
    if (!purchases.some((row) => row.id === s.target)) { s.target = purchases[0]?.id ?? ""; s.answer = null; s.answerExposed = previousExposure(s.target); }
    const target = purchases.find((row) => row.id === s.target); const index = timeline.rows.findIndex((row) => row.id === s.target); const before = index > 0 ? timeline.rows[index - 1] : undefined;
    const planChanged = (kind: "plan" | "revised"): void => {
      s.result = null;
      if (kind === "plan") {
        const reachable = simulateFundingPlan(s.scenario, s.plan).rows.filter((row) => row.kind === "purchase");
        if (!reachable.some((row) => row.id === s.target)) s.target = reachable[0]?.id ?? "";
        s.answer = null; s.answerExposed = previousExposure(s.target);
      }
      if (kind === "plan" && recordExposure && s.target && s.help !== "self") this.ctx.setProfile(markFundingHelp(this.ctx.getProfile(), fundingQuestionKey(s.scenario, s.target, "d1-v1", s.plan), s.help));
      else this.ctx.refresh();
    };
    const setMoney = (kind: "plan" | "revised", value: string): void => { const amount = Math.max(0, Math.min(s.scenario.startingCashCents, Math.round((Number(value) || 0) * 100))); s[kind].participationCents = amount; planChanged(kind); };
    const recoveries = s.scenario.events.filter((event) => event.kind === "recovery" && !event.automatic);
    const automatic = s.scenario.events.some((event) => event.kind === "recovery" && event.automatic);
    const planFields = (kind: "plan" | "revised"): Child[] => [h("label", { class: "field" }, kind === "plan" ? "试算的参与金额（金币）" : "调整后的参与金额（金币）", h("input", { type: "number", min: 0, max: s.scenario.startingCashCents / 100, step: .01, value: s[kind].participationCents / 100, onchange: (e: Event) => setMoney(kind, onValue(e)) })),
      ...recoveries.map((event) => selectPercent(s[kind].recovery[event.id] ?? 0, (value) => { s[kind].recovery[event.id] = value; planChanged(kind); }, `${event.label} · ${kind === "plan" ? "当前试算" : "调整后"}`))];
    const needsFinal = !!s.scenario.pendingFinal && (timeline.pendingFinal !== null || simulateFundingPlan(s.scenario, s.revised).pendingFinal !== null);
    const answeredPurchase = s.result?.timeline.rows.find((row) => row.id === s.target);
    const purchaseSummary = answeredPurchase ? `这次采购需要 ${coins(answeredPurchase.amountCents)} 金币，当时可用 ${coins(answeredPurchase.cashBeforeCents)} 金币，因此${answeredPurchase.canPay ? "可以支付" : "不能支付"}。` : undefined;
    const help = details("需要一点提示", h("p", { class: "hint" }, "把采购前的可用金币与价格比较；未回收的参考价值暂时不能付款。"));
    help.addEventListener("toggle", () => { if (!help.open || s.help !== "self") return; s.help = "hint"; if (recordExposure && s.target) this.ctx.setProfile(markFundingHelp(this.ctx.getProfile(), fundingQuestionKey(s.scenario, s.target, "d1-v1", s.plan), "hint")); });
    const steps = details("查看分步说明", h("p", { class: "hint" }, "先找采购前的可用金币，再对照采购价格；未到账的份额价值不计入。若买不起，时间线就在这里暂停。"));
    steps.addEventListener("toggle", () => { if (!steps.open || s.help === "step") return; s.help = "step"; if (recordExposure && s.target) this.ctx.setProfile(markFundingHelp(this.ctx.getProfile(), fundingQuestionKey(s.scenario, s.target, "d1-v1", s.plan), "step")); });
    return h("main", { class: "stack", id: "main-content", style: "padding-top:24px;max-width:920px;margin:auto" }, h("div", { class: "task-title" }, h("span", { class: "task-badge" }, "D1"), h("div", null, h("div", { class: "eyebrow" }, "FUNDING WORKBENCH"), h("h1", null, "资金安排台"))),
      h("p", { class: "hint" }, "调整参与和回收，比较可用现金与份额参考价值，再核查一次采购。"), !enabled ? note("只玩游戏：本练习只显示即时反馈，离开后不保存研究观察。") : null,
      panel("先试一种安排", s.scenario.assumptions, ...planFields("plan"), h("p", { class: "fineprint" }, `起点可用 ${coins(s.scenario.startingCashCents)} 金币。输入后离开输入框即可更新。${automatic ? " 旅程结束时余下份额自动全部回收，不能调整。" : ""}`)),
      panel("沿途会发生什么", "先看采购之前的现金；份额价值须回收并执行后才能用于购买。", h("div", { class: "timeline" }, timeline.rows.slice(0, Math.max(index, 0)).map((row) => h("div", { class: "timeline-item" }, h("strong", null, row.label), h("p", null, `可用 ${coins(row.cashCents)} 金币 · 份额参考价值 ${row.referenceValueCents === null ? "尚未揭晓" : coins(row.referenceValueCents)} 金币`)))),
        target ? h("div", { class: "notice" }, h("strong", null, target.label), h("p", null, `采购需要 ${coins(target.amountCents)} 金币；此前可用 ${coins(before?.cashCents ?? s.scenario.startingCashCents)} 金币。`)) : note("这条日程没有可判断的采购。"),
        h("label", { class: "field" }, "选择要核查的采购", h("select", { onchange: (e: Event) => { s.target = onValue(e); s.answer = null; s.answerExposed = previousExposure(s.target); s.result = null; if (recordExposure && s.target && s.help !== "self") this.ctx.setProfile(markFundingHelp(this.ctx.getProfile(), fundingQuestionKey(s.scenario, s.target, "d1-v1", s.plan), s.help)); else this.ctx.refresh(); } }, purchases.map((row) => option(row.id, row.label, row.id === s.target)))),
        h("p", { class: "hint strong" }, "这一项能用当时的可用金币支付吗？"), h("div", { class: "selection-row" }, ([ [true, "可以支付"], [false, "不能支付"] ] as const).map(([value, label]) => h("button", { type: "button", class: `choice${s.answer === value ? " selected" : ""}`, onclick: () => { s.answer = value; this.ctx.refresh(); } }, label))),
        help, steps),
      panel("为自己保存另一份计划", "可调整参与金额与回收比例；计划是固定外部日程的账本练习，不保证战斗经过不变。", ...planFields("revised"), needsFinal ? h("div", { class: "stack" }, note("调整后结束时仍有份额，下一执行报价尚未加载，尚未到账。"), s.error ? note(s.error, true) : null, button(s.loading ? "正在加载结束报价…" : "加载结束后的执行报价", () => void this.loadFundingFinal(), "small secondary", s.loading)) : null, button("提交判断并保存计划", () => this.submitFunding(), "gold", s.answer === null || !s.target)),
      s.result ? panel("这次核查的结果", null, note(`${s.result.correct ? "你的判断与账本一致" : "可以再核查一次"}：该采购${s.result.actual ? "可以支付" : "不能支付"}。${s.result.stoppedAt === "pending-final-quote" ? "调整后的计划在等待结束报价，尚未到账。" : s.result.stoppedAt ? "调整后的计划在第一处无法支付时暂停。" : "调整后的计划完成了固定日程核查。"}`), details("查看试算的完整时间线", fundingTimeline(s.result.timeline)), details("查看调整后的时间线", fundingTimeline(s.result.revised)), updateBlock(s.result.changes, this.ctx.getProfile().knowledge_evidence, { K3: purchaseSummary }), h("p", { class: "hint" }, s.result.reason), button(this.ctx.getRun().status === "active" ? "返回营地" : "回到旅程报告", this.ctx.back, "secondary")) : null,
      h("div", { class: "button-row" }, button("返回", this.ctx.back, "ghost")));
  }
  private submitFunding(): void {
    const s = this.fundingState; if (s.answer === null || !s.target) return;
    try {
      const submission = { id: this.ctx.uid("funding"), questionVersion: "d1-v1", plan: structuredClone(s.plan), purchaseId: s.target, canPay: s.answer, revisedPlan: structuredClone(s.revised), help: s.help, answerExposed: s.answerExposed, priorExposure: this.ctx.getRun().source !== "real" || (this.ctx.isCaseKnown?.(s.scenario.caseId) ?? false) };
      if (this.ctx.getProfile().enabled) {
        const result = submitFunding(this.ctx.getProfile(), s.scenario, submission); const row = result.timeline.rows.find((item) => item.id === s.target)!;
        s.result = { correct: row.canPay === s.answer, actual: !!row.canPay, changes: [result.change], stoppedAt: result.revisedTimeline.stoppedAt, reason: result.recommendation.reason, timeline: result.timeline, revised: result.revisedTimeline }; s.answerExposed = true; this.ctx.setProfile(result.profile);
      } else { const result = evaluateFundingPractice(s.scenario, submission); s.result = { correct: result.correct, actual: result.actualCanPay, changes: [], stoppedAt: result.revisedTimeline.stoppedAt, reason: "可以换一项任务继续探索。", timeline: result.timeline, revised: result.revisedTimeline }; s.answerExposed = true; this.ctx.refresh(); }
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
    const s = this.historyState; const enabled = this.ctx.getProfile().enabled; const run = this.ctx.getRun(); const cases = (this.ctx.getManifest()?.cases ?? []).filter((item) => run.status !== "active" || item.caseId !== run.caseId);
    if (!s.locked && cases.length && !cases.some((item) => item.caseId === s.caseId)) { s.caseId = cases[0]!.caseId; s.otherId = cases.find((item) => item.caseId !== s.caseId)?.caseId ?? ""; }
    const chooseDirection = (label: string, value: Direction | "", set: (value: Direction) => void): HTMLElement => h("label", { class: "field" }, label, h("select", { onchange: (e: Event) => set(onValue(e) as Direction) }, option("", "请选择", value === ""), option("outperform", "更高", value === "outperform"), option("underperform", "更低", value === "underperform"), option("equal", "相同", value === "equal")));
    const help = details("需要一点提示", h("p", { class: "hint" }, "先比较同日程下两项盈亏，再比较两段历史；已有样本不能证明未来结果。"));
    help.addEventListener("toggle", () => { if (!help.open || s.help !== "self") return; s.help = "hint"; if (enabled) { try { this.ctx.setProfile(markHistoryHelp(this.ctx.getProfile(), s.id, "hint")); } catch (error) { this.fail(error); } } });
    const steps = details("查看分步说明", h("p", { class: "hint" }, "第一步比较案例和同期基准的固定日程盈亏；第二步比较两段历史的案例盈亏；第三步区分样本事实和对未来的预测。"));
    steps.addEventListener("toggle", () => { if (!steps.open || s.help === "step") return; s.help = "step"; if (enabled) { try { this.ctx.setProfile(markHistoryHelp(this.ctx.getProfile(), s.id, "step")); } catch (error) { this.fail(error); } } });
    return h("main", { class: "stack", id: "main-content", style: "padding-top:24px;max-width:920px;margin:auto" }, h("div", { class: "task-title" }, h("span", { class: "task-badge" }, "D2"), h("div", null, h("div", { class: "eyebrow" }, "HISTORY WORKBENCH"), h("h1", null, "历史对照台"))),
      h("p", { class: "hint" }, "先留下可以核查的判断和固定日程，再查看同口径的资料。"), !enabled ? note("只玩游戏：本练习只显示即时反馈，离开后不保存研究观察。") : null,
      panel("1 · 留下判断，固定日程", run.status === "active" ? "参与与回收日程锁定后加载另一段历史；本局尚未揭晓的未来不会在这里展示。" : "参与与回收日程锁定后才加载历史片段。", h("label", { class: "field" }, "查看的历史片段", h("select", { disabled: s.locked, onchange: (e: Event) => { s.caseId = onValue(e); s.otherId = cases.find((item) => item.caseId !== s.caseId)?.caseId ?? ""; } }, cases.map((c) => option(c.caseId, c.title, c.caseId === s.caseId)))),
        h("label", { class: "field" }, "初步判断：同一日程下，案例结果相对同期基准", h("select", { disabled: s.locked, onchange: (e: Event) => { s.claim = onValue(e) as Direction | "unknown"; } }, option("unknown", "暂时不知道", s.claim === "unknown"), option("outperform", "更高", s.claim === "outperform"), option("underperform", "更低", s.claim === "underperform"), option("equal", "相同", s.claim === "equal"))),
        h("label", { class: "field" }, `参与金额（起点可用 ${coins(s.schedule.startingCashCents)} 金币）`, h("input", { type: "number", disabled: s.locked, min: .01, max: s.schedule.startingCashCents / 100, step: .01, value: s.schedule.participationCents / 100, onchange: (e: Event) => { s.schedule.participationCents = Math.round(Number(onValue(e)) * 100); } })),
        h("div", { class: "choice-grid" }, selectPercent(s.schedule.t1, (v) => { if (!s.locked) s.schedule.t1 = v; }, "第一检查点", s.locked), selectPercent(s.schedule.t2, (v) => { if (!s.locked) s.schedule.t2 = v; }, "第二检查点", s.locked)),
        s.locked ? pill("判断与日程已锁定", "blue") : button("锁定并查看同期资料", () => void this.lockHistory(), "gold", !cases.length || s.loading)),
      s.error ? h("section", { class: "panel stack" }, note(s.error, true), button("重试加载资料", () => void this.loadHistory(s.errorOther), "secondary", s.loading)) : null,
      s.loading ? h("div", { class: "notice", role: "status" }, "正在加载锁定日程后的历史资料……") : null,
      s.shown ? panel("2 · 看同期数据", "资产与基准采用相同起点、日期和固定操作日程。", this.comparisonCard(s.shown), h("p", { class: "hint" }, "持有部分最大回撤描述持有期间价格的高点到后续低点；回收本身不算价格下跌。"),
        !s.otherShown ? (s.otherId ? button("再查看另一段历史", () => void this.loadHistory(true), "secondary", s.loading) : h("p", { class: "fineprint" }, "冒险结束后，可以继续比较本局的历史片段。")) : this.comparisonCard(s.otherShown),
        help, steps) : null,
      s.shown && !s.submitted ? panel("3 · 提交你的描述", "可以保留或修正初步判断；变化与否都不是扣分项。", chooseDirection("本案例结果相对同期基准", s.comparison, (value) => { s.comparison = value; }),
        s.otherShown ? h("div", { class: "stack" }, chooseDirection("另一段历史的结果相对第一段", s.difference, (value) => { s.difference = value; }), h("label", { class: "field" }, "这些结果能说明什么？", h("select", { onchange: (e: Event) => { s.boundary = onValue(e) as BoundaryAnswer | ""; } }, option("", "请选择", !s.boundary), option("only_samples", "描述这两个样本，不能预测未来", s.boundary === "only_samples"), option("predicts_future", "说明未来必然得到相同结果", s.boundary === "predicts_future")))) : null,
        h("label", { class: "field" }, "这次主要依据什么？", h("select", { onchange: (e: Event) => { s.reason = onValue(e); } }, option("", "请选择", !s.reason), option("根据同日期的数字比较", "根据同日期的数字比较", s.reason === "根据同日期的数字比较"), option("查看了不同片段的差异", "查看了不同片段的差异", s.reason === "查看了不同片段的差异"), option("仍不确定，想继续核查", "仍不确定，想继续核查", s.reason === "仍不确定，想继续核查"))),
        button("提交这次研究", () => this.submitHistory(), "gold")) : null,
      s.submitted ? panel("研究后的观察", s.practiceFeedback, updateBlock(s.changes, this.ctx.getProfile().knowledge_evidence, { K1: s.shown ? `同一日程下，案例盈亏 ${coins(s.shown.asset.gainCents)} 金币，同期基准盈亏 ${coins(s.shown.benchmark.gainCents)} 金币。` : undefined, K2: s.shown && s.otherShown ? `固定日程下，第一段盈亏 ${coins(s.shown.asset.gainCents)} 金币，另一段盈亏 ${coins(s.otherShown.asset.gainCents)} 金币；它们只能说明这两段历史。` : undefined }), h("p", { class: "hint" }, "一次操作只说明本次任务中的步骤；可以切换主题，或在新情境继续练习。"), button(this.ctx.getRun().status === "active" ? "返回营地" : "回到旅程报告", this.ctx.back, "secondary")) : null,
      h("div", { class: "button-row" }, button("返回", this.ctx.back, "ghost")));
  }
  private comparisonCard(c: HistoryComparison): HTMLElement {
    return h("div", { class: "stack" }, h("div", { class: "row" }, pill(c.title, "blue"), h("span", { class: "fineprint" }, `${dateText(c.dates[0])} 至 ${dateText(c.dates[1])}`)), h("div", { class: "metric-grid" }, metric("案例固定日程盈亏", `${coins(c.asset.gainCents)} 金币`), metric("同期基准盈亏", `${coins(c.benchmark.gainCents)} 金币`), metric("持有部分最大回撤", c.asset.heldPriceMaxDrawdown === null ? "无持有" : percent(c.asset.heldPriceMaxDrawdown))),
      h("p", { class: "fineprint" }, c.explanation), details("查看可用现金时间线", h("div", { class: "timeline" }, c.asset.timeline.map((row) => h("div", { class: "timeline-item" }, h("strong", null, `${dateText(row.date)} · ${row.step}`), h("p", null, `可用 ${coins(row.cashCents)} 金币 · 参考价值 ${coins(row.referenceValueCents)} 金币`))))));
  }
  private async lockHistory(): Promise<void> {
    const s = this.historyState; if (s.locked || s.loading) return;
    try {
      if (s.schedule.participationCents <= 0 || s.schedule.participationCents > s.schedule.startingCashCents) throw new Error("参与金额需大于 0 且不超过起点可用金币。");
      if (this.ctx.getProfile().enabled) {
        const run = this.ctx.getRun(); const priorExposure = run.source !== "real" || (this.ctx.wasCaseSeen?.(s.caseId) ?? false) || (s.caseId === run.caseId && run.history.some((e) => e.type === "market" && e.data.stage !== "entry")) || this.ctx.getProfile().research_process.some((attempt) => attempt.caseId === s.caseId && !!attempt.shown);
        this.ctx.setProfile(startHistory(this.ctx.getProfile(), { id: s.id, caseId: s.caseId, questionVersion: "d2-v1", schedule: { ...s.schedule }, initialClaim: s.claim, priorExposure }));
      }
      s.locked = true; await this.loadHistory(false);
    } catch (error) { this.fail(error); }
  }
  private async loadHistory(other: boolean): Promise<void> {
    const s = this.historyState; if (!s.locked || s.loading) return; const epoch = this.epoch;
    s.loading = true; s.error = null; this.ctx.refresh();
    try {
      const primary = s.primary ?? await loadResearchCase(s.caseId, true); const second = other ? await loadResearchCase(s.otherId, true) : s.other;
      if (epoch !== this.epoch) return;
      s.primary = primary; s.other = second; s.shown = compareSchedule(primary, s.schedule); s.otherShown = second ? compareSchedule(second, s.schedule) : null;
      if (this.ctx.getProfile().enabled) {
        const profile = this.ctx.getProfile(); const existing = profile.research_process.find((item) => item.id === s.id)?.shown;
        const realRun = this.ctx.getRun();
        const otherPriorExposure = second ? existing?.other?.caseId === second.caseId ? (existing.otherPriorExposure ?? true) : realRun.source !== "real" || (this.ctx.wasCaseSeen?.(second.caseId) ?? false) || (realRun.caseId === second.caseId && realRun.history.some((event) => event.type === "market" && ["t1", "t2", "t3"].includes(String(event.data.stage)))) : false;
        this.ctx.setProfile(showHistoryEvidence(profile, s.id, primary, second ?? undefined, otherPriorExposure));
      }
      this.ctx.markCaseSeen?.(primary.caseId); if (second) this.ctx.markCaseSeen?.(second.caseId);
    } catch (error) { if (epoch === this.epoch) { s.errorOther = other; s.error = error instanceof Error ? error.message : "资料加载失败。"; } }
    finally { if (epoch === this.epoch) { s.loading = false; this.ctx.refresh(); } }
  }
  private submitHistory(): void {
    const s = this.historyState;
    if (!s.comparison || !s.reason) { this.ctx.notify("请选择同期比较结果和理由。"); return; }
    if (s.otherShown && (!s.difference || !s.boundary)) { this.ctx.notify("请比较另一片段并选择样本边界。"); return; }
    try {
      const answers = { comparison: s.comparison, ...(s.difference ? { historyDifference: s.difference } : {}), ...(s.boundary ? { boundary: s.boundary } : {}), reason: s.reason };
      if (this.ctx.getProfile().enabled) {
        const result = submitHistory(this.ctx.getProfile(), s.id, answers); s.changes = result.changes; s.submitted = true; this.ctx.setProfile(result.profile);
      } else {
        if (!s.primary) throw new Error("请先加载资料。");
        const result = evaluateHistoryPractice(s.primary, s.other, s.schedule, answers); s.practiceFeedback = `同期比较${result.comparisonCorrect ? "与数据一致" : "还可再核查"}${result.boundaryCorrect === null ? "" : result.boundaryCorrect ? "；样本边界判断与数据一致" : "；样本边界还可再核查"}。`; s.submitted = true; this.ctx.refresh();
      }
    } catch (error) { this.fail(error); }
  }
  campExtras(): Child {
    const run = this.ctx.getRun(); const profile = this.ctx.getProfile(); if (!profile.enabled || run.phase !== "camp" || !run.camp) return null;
    const active = [...profile.forecasts].reverse().find((f) => f.caseId === run.caseId && !f.withdrawn);
    if (run.node === "N2" && run.market.entryCommitted && run.market.order?.kind === "entry" && run.market.order.amountCents > 0 && !active) {
      const feeling = h("select", { "aria-label": "预想的感受" }, option("", "不回答"), ...feelings.map(([id, label]) => option(id, label)));
      const prediction = h("select", { "aria-label": "预想的行动" }, option("", "不回答"), ...actionNames.map(([id, label]) => option(id, label)));
      const amount = run.market.order.amountCents;
      return h("section", { class: "panel stack" }, h("h3", null, "留给下一营地的自己"), pill("可跳过", "gold"), h("p", { class: "hint" }, `假设契约价值相对投入减少 10%–20%（约 ${coins(Math.round(amount * .1))}–${coins(Math.round(amount * .2))} 金币），且届时至少有 10 金币、生命至少一半，你预计会怎样？这只是预测，不是承诺。`),
        h("label", { class: "field" }, "你预计会多在意？", feeling), h("label", { class: "field" }, "届时可能如何安排？", prediction), button("留下一份预期", () => { try { this.ctx.setProfile(saveForecast(profile, { id: this.ctx.uid("forecast"), caseId: run.caseId, amountCents: amount, lossMin: .1, lossMax: .2, minCashCents: 1000, minHealthRatio: .5, feeling: (feeling.value || null) as Feeling | null, action: (prediction.value || null) as ContractAction | null, priorExposure: this.ctx.isCaseKnown?.(run.caseId) ?? false, beforeFuture: true })); this.ctx.notify("预期已保存；之后改变主意也完全可以。"); } catch (error) { this.fail(error); } }, "small secondary"));
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
    const item = this.ctx.getProfile().calibration.at(-1); if (!item) return null;
    const forecast = this.ctx.getProfile().forecasts.find((f) => f.id === item.forecastId);
    const feelingText = (value: Feeling | null): string => feelings.find(([id]) => id === value)?.[1] ?? "没有回答";
    const actionText = (value: ContractAction | null): string => actionNames.find(([id]) => id === value)?.[1] ?? "没有回答";
    return details("回看这次预期", h("p", { class: "hint" }, `事前预计：${feelingText(forecast?.feeling ?? null)}，倾向${actionText(forecast?.action ?? null)}。`), h("p", { class: "hint" }, `这次自报：${feelingText(item.feeling)}，实际选择${actionText(item.action)}。`), h("p", { class: "hint" }, item.comparison === "matched" ? `符合预先条件。本次感受对照：${item.affectComparison === "stronger" ? "比预计更强" : item.affectComparison === "weaker" ? "比预计更轻" : item.affectComparison === "similar" ? "与预计接近" : "信息不足"}；行动：${item.actionComparison === "same" ? "与预测相同" : item.actionComparison === "different" ? "与预测不同" : "信息不足"}。` : `这次条件不同，不能直接比较：${item.unavailableReason ?? "信息不足"}。`), h("p", { class: "fineprint" }, "感受与行动分别由本人报告；这不说明现实中的财务承受能力。"));
  }
}
