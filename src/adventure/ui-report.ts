import "./ui-report.css";
import { h, type Child } from "../ui/dom";
import { gameplayHighlights } from "./gameplay-highlights";
import { decisionSummary, type DecisionInsight } from "./decision-summary";
import { recommendationPlan, type Direction, type FundingAttempt, type FundingPlan, type FundingRow, type FundingTimeline, type Knowledge, type KnowledgeEvidence, type Reason, type ResearchProfile } from "./research";
import type { MarketManifest } from "./market";
import type { Run } from "./types";
import { button, coins, deckSummary, details, moneyHistory, pill } from "./ui-components";
import { taskAvailability } from "./ui-availability";
import { nodeNames } from "./ui-game";
import { fundingRowLabel } from "./ui-research-labels";

const names: Record<Knowledge, string> = { K1: "同期比较", K2: "样本边界", K3: "可用现金" };
const statusLabels: Record<string, string> = { unobserved: "尚未观察", independent: "已有独立完成记录", assisted: "已有提示后完成记录", needs_confirmation: "仍需核对", conflicting: "不同情境表现不同" };
const directionLabels: Record<Direction, string> = { outperform: "案例高于基准", underperform: "案例低于基准", equal: "案例与基准相同" };

function evidenceNote(item: KnowledgeEvidence | undefined, excludedByDisclosure: boolean): string | null {
  if (!item) return null;
  const help = item.help === "step" ? "查看过分步说明" : item.help === "hint" ? "查看过提示" : "未查看提示";
  if (excludedByDisclosure) return `${help}；你补充此前已见案例，操作保留，但不计为未见情境依据。`;
  if (!item.counted) return `最近一次${help}；作为练习保留，未改变上面的观察。`;
  return help === "未查看提示" ? "本次未查看提示。" : `${help}，结果按有帮助的任务记录。`;
}
function historyEvidenceNote(profile: ResearchProfile, attemptId: string, dimension: "K1" | "K2", secondaryWasSeen: boolean): string | null {
  const item = profile.knowledge_evidence.find((entry) => entry.id === `${attemptId}:${dimension}`);
  if (!item) return null;
  const label = names[dimension];
  if ((profile.prior_exposure_disclosures ?? []).some((entry) => entry.evidenceIds.includes(item.id))) return `${label}：本人补充此前已见相关案例，原操作保留，本项作为复核。`;
  if (!item.counted) {
    if (item.exclusion_reason) return `${label}：${item.exclusion_reason}`;
    if (item.priorExposure || item.answerExposed) return `${label}：${dimension === "K2" && secondaryWasSeen ? "另一段此前已见" : "案例或答案此前已见"}，本项作为复核。`;
    return `${label}：同题重试作为复习，不增加新依据。`;
  }
  if (!item.correct) return `${label}：本次判断还需核对${item.help === "self" ? "" : "；这次查看过帮助"}。`;
  return `${label}：${item.independent ? "本次独立完成" : "本次借助帮助完成"}。`;
}

/** Presentation only: statuses and facts are supplied by the research module. */
export function researchSummary(profile: ResearchProfile): HTMLElement {
  const dimensions: Knowledge[] = ["K1", "K2", "K3"];
  const attempts = profile.research_process.filter((item) => item.submitted && item.final && item.shown);
  const latest = attempts.at(-1);
  const latestFunding = profile.funding_attempts.at(-1);
  const columns = dimensions.map((dimension) => {
    const observation = profile.knowledge_observations.find((item) => item.dimension === dimension);
    const evidence = [...profile.knowledge_evidence].reverse().find((item) => item.dimension === dimension);
    const description = observation?.text.replace(/^[^：]+：/, "") ?? "这一步暂未观察，可自行选择起点。";
    const note = evidenceNote(evidence, !!evidence && !!observation?.excluded_evidence_ids?.includes(evidence.id));
    return h("div", { class: `knowledge-row ${observation?.status ?? "unobserved"}` }, h("div", { class: "knowledge-heading" }, h("strong", null, names[dimension]), h("span", { class: "knowledge-status" }, statusLabels[observation?.status ?? "unobserved"] ?? "尚未观察")), h("p", null, description), note ? h("p", { class: "knowledge-help" }, note) : null);
  });
  const trace = latest?.shown && latest.final ? h("div", { class: "research-trace" },
    h("div", { class: "trace-head" }, h("strong", null, "一次研究过程"), h("span", { class: "fineprint" }, latest.shown.primary.title)),
    h("div", { class: "trace-steps" },
      h("div", null, h("small", null, "最初想法"), h("p", null, latest.initialClaim === "unknown" ? "暂时不确定" : directionLabels[latest.initialClaim])),
      h("div", null, h("small", null, "看到的数据"), h("p", null, `案例盈亏 ${coins(latest.shown.primary.asset.gainCents)}，同期基准 ${coins(latest.shown.primary.benchmark.gainCents)} 金币`)),
      h("div", null, h("small", null, "之后的判断"), h("p", null, latest.final.comparison ? directionLabels[latest.final.comparison] : "未提交同期比较"))),
    h("p", { class: "fineprint" }, `${latest.helpUsed === "step" ? "查看过分步说明" : latest.helpUsed === "hint" ? "查看过提示" : "这次未查看提示"}。`),
    (["K1", "K2"] as const).map((dimension) => { const line = historyEvidenceNote(profile, latest.id, dimension, !!latest.shown?.otherPriorExposure && !latest.priorExposure); return line ? h("p", { class: "fineprint" }, line) : null; }),
    latest.final.reason ? h("p", { class: "fineprint" }, `你选择的依据：${latest.final.reason}`) : null) : latestFunding
      ? h("p", { class: "hint" }, "最近的资金核查可在报告中单独回看。")
      : h("p", { class: "hint research-empty" }, "还没有完成研究任务；可以先留下一个判断，再查看数据。" );
  return h("section", { class: "panel stack research-summary" }, h("div", { class: "panel-head" }, h("div", null, h("h2", null, "你的研究线索"), h("p", { class: "hint" }, "这里记录你在任务中实际做过的步骤；未观察到的保留为空。"))),
    h("div", { class: "knowledge-grid" }, columns), trace,
    h("p", { class: "fineprint" }, "这些只是本次任务的观察，不代表稳定能力；现实财务承受能力未评估。"),
    details("查看任务依据与范围", h("div", { class: "stack" }, profile.knowledge_observations.map((item) => h("p", { class: "hint" }, item.text)), profile.knowledge_evidence.length ? h("p", { class: "fineprint" }, `技术依据：${profile.knowledge_evidence.map((item) => item.id).join("、")}`) : h("p", { class: "fineprint" }, "尚无任务证据。"))));
}

interface ReportContext {
  run: Run;
  profile: ResearchProfile;
  manifest: MarketManifest | null;
  wasCaseSeen: (caseId: string) => boolean;
  header: HTMLElement;
  preferences: Child;
  calibration: Child;
  openTask: (task: "D1" | "D2") => void;
  openDetails: (title: string, body: Child) => void;
  saveReason: (evidenceId: string, reason: Reason | "") => void;
  resume: () => void;
  newRun: () => void;
  home: () => void;
}

type ReportPage = "overview" | "choices" | "research" | "deck";
const reportPageByRun = new WeakMap<Run, ReportPage>();

const savedAmount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const amountText = (value: unknown): string => savedAmount(value) ? `${coins(value)} 金币` : "未知";
type SavedTimeline = Partial<FundingTimeline> | null | undefined;
type SavedRow = Partial<FundingRow>;
function timelineRows(timeline: SavedTimeline): SavedRow[] | null {
  return timeline && Array.isArray(timeline.rows) && timeline.rows.every((row) => !!row && typeof row === "object") ? timeline.rows : null;
}
function purchaseRow(timeline: SavedTimeline, id: unknown): SavedRow | undefined {
  if (typeof id !== "string" || !id) return undefined;
  return timelineRows(timeline)?.find((row) => row.kind === "purchase" && row.id === id);
}
function purchaseDescription(row: SavedRow): string {
  const cash = amountText(row.cashBeforeCents); const cost = amountText(row.amountCents);
  if (typeof row.canPay !== "boolean") return `采购前可用 ${cash}，需要 ${cost}；是否可支付未知。`;
  if (!savedAmount(row.cashBeforeCents) || !savedAmount(row.amountCents)) return `采购前可用 ${cash}，需要 ${cost}；记录的结论为${row.canPay ? "可以支付" : "不能支付"}。`;
  const difference = row.cashBeforeCents - row.amountCents;
  if ((row.canPay && difference < 0) || (!row.canPay && difference >= 0)) return `采购前可用 ${cash}，需要 ${cost}；保存的结论与金额不一致，需重新核查。`;
  const balance = row.canPay ? difference === 0 ? "恰好够支付" : `支付后剩余 ${amountText(difference)}` : `还差 ${amountText(-difference)}`;
  return `采购前可用 ${cash}，需要 ${cost}；${row.canPay ? "可以支付" : "不能支付"}，${balance}。`;
}
type TimelineStatus = { kind: "completed" | "pending" | "unknown" } | { kind: "blocked"; row: SavedRow };
function timelineStatus(timeline: SavedTimeline): TimelineStatus {
  const rows = timelineRows(timeline);
  if (!timeline || !rows?.length) return { kind: "unknown" };
  if (timeline.stoppedAt === "pending-final-quote") return timeline.pendingFinal === null ? { kind: "unknown" } : { kind: "pending" };
  if (timeline.pendingFinal !== null && timeline.pendingFinal !== undefined) {
    const pending = timeline.pendingFinal;
    return timeline.stoppedAt === undefined && typeof pending === "object" && !Array.isArray(pending)
      && typeof pending.stage === "string" && typeof pending.afterDate === "string" ? { kind: "pending" } : { kind: "unknown" };
  }
  if (typeof timeline.stoppedAt === "string" && timeline.stoppedAt) {
    const blocked = rows.find((row) => row.id === timeline.stoppedAt && row.kind === "purchase" && row.canPay === false);
    return blocked ? { kind: "blocked", row: blocked } : { kind: "unknown" };
  }
  return timeline.stoppedAt === null && timeline.pendingFinal === null ? { kind: "completed" } : { kind: "unknown" };
}
function timelineStatusText(status: TimelineStatus): string {
  if (status.kind === "completed") return "已完成这次已记录的固定日程核查。";
  if (status.kind === "pending") return "结束后的下一执行报价仍待确认，回收金额尚未到账。";
  if (status.kind === "blocked") return `首次无法支付的采购：${status.row.label || "名称未知"}。${purchaseDescription(status.row)}`;
  return "保存的时间线信息不足，无法确认日程是否完成。";
}
function targetStatusText(timeline: SavedTimeline, other: SavedTimeline, targetId: unknown): string {
  const row = purchaseRow(timeline, targetId);
  if (row && typeof row.canPay === "boolean") return `目标采购：${purchaseDescription(row)}`;
  const status = timelineStatus(timeline);
  const reference = timelineRows(other);
  const blockedIndex = status.kind === "blocked" ? reference?.findIndex((item) => item.id === status.row.id && item.kind === "purchase") ?? -1 : -1;
  const targetIndex = reference?.findIndex((item) => item.id === targetId && item.kind === "purchase") ?? -1;
  if (!row && blockedIndex >= 0 && targetIndex > blockedIndex) return "目标采购：此前的采购已使计划暂停，尚未到达目标采购。";
  return "目标采购：已保存的时间线无法确认是否到达或能否支付。";
}
function recoverySettings(plan: Partial<FundingPlan> | null | undefined, timeline: SavedTimeline, other: SavedTimeline): Child {
  const recovery = plan?.recovery;
  if (!recovery || typeof recovery !== "object" || Array.isArray(recovery)) return h("p", { class: "hint" }, "回收设置：未保存或未知。");
  const entries = Object.entries(recovery);
  if (!entries.length) return h("p", { class: "hint" }, "没有记录回收设置。");
  const ownRows = timelineRows(timeline); const otherRows = timelineRows(other);
  return h("div", { class: "stack" }, h("p", { class: "hint" }, "保存的回收设置："), entries.map(([id, pct], index) => {
    const own = ownRows?.find((row) => row.id === id && row.kind === "recovery");
    const fallback = otherRows?.find((row) => row.id === id && row.kind === "recovery");
    const label = fundingRowLabel(own?.label || fallback?.label) || `回收安排 ${index + 1}（节点名称未记录）`;
    const selected = pct === 0 || pct === 50 || pct === 100 ? `${pct}%` : "比例未知";
    return h("p", { class: "fineprint" }, `${label}：${selected}${own ? "" : "（此时间线未记录该节点）"}。`);
  }));
}
function savedTimeline(timeline: SavedTimeline, title: string): Child {
  const rows = timelineRows(timeline);
  if (!rows?.length) return h("p", { class: "fineprint" }, "时间线未保存或无法读取。");
  return details(title, h("div", { class: "timeline" }, rows.map((row) => h("div", { class: "timeline-item" }, h("strong", null, fundingRowLabel(row.label) || "节点名称未知"),
    h("p", null, row.kind === "purchase" ? purchaseDescription(row) : `处理后可用 ${amountText(row.cashCents)}；份额参考价值 ${row.referenceValueCents === null ? "尚未显示" : amountText(row.referenceValueCents)}。`)))));
}
function savedFundingPlan(title: string, plan: Partial<FundingPlan> | null | undefined, timeline: SavedTimeline, other: SavedTimeline, targetId: unknown): HTMLElement {
  return h("section", { class: "stack" }, h("h4", null, title), h("p", { class: "hint" }, `参与金额：${amountText(plan?.participationCents)}。`),
    recoverySettings(plan, timeline, other), h("p", { class: "hint" }, timelineStatusText(timelineStatus(timeline))),
    h("p", { class: "hint" }, targetStatusText(timeline, other, targetId)), savedTimeline(timeline, `查看${title}的已保存时间线`));
}
/** A read-only account of the saved exercise, not a replay of the game. */
function savedFundingReview(attempt: FundingAttempt, run: Run): HTMLElement {
  const original = attempt.timeline as SavedTimeline; const revised = attempt.revisedTimeline as SavedTimeline;
  const target = purchaseRow(original, attempt.purchaseId);
  const targetLabel = target?.label || "采购名称未记录";
  const answer = typeof attempt.answer !== "boolean" ? "未保存" : attempt.answer ? "可以支付" : "不能支付";
  return h("div", { class: "report-expanded stack" }, run.source !== "real" ? pill(run.source === "fork" ? "模拟 · 分叉" : "模拟 · 预设", "gold") : null,
    attempt.caseId === "manual-example" ? h("p", { class: "fineprint" }, "人工机制示例，仅供练习，不作为独立能力依据。") : null,
    h("p", { class: "hint" }, `当时核查的采购：${targetLabel}。你的判断：${answer}。`),
    h("p", { class: "fineprint" }, "以下是当时保存的固定外部日程试算；回收比例是计划设置，不代表全部已执行。回看不会改变实际游戏购买，也不推断更改计划后的战斗经过。"),
    savedFundingPlan("原试算", attempt.plan, original, revised, attempt.purchaseId),
    savedFundingPlan("修订计划", attempt.revisedPlan, revised, original, attempt.purchaseId));
}

/** Report pages are local UI state and are never saved as part of the journey. */
export function reportView(ctx: ReportContext): HTMLElement {
  const { run, profile } = ctx;
  const active = run.status === "active";
  const pending = !active && run.phase === "market";
  const ending = active ? "旅程进行中" : run.status === "cleared" ? "灯火已点亮" : run.status === "returned" ? "带着收获返程" : "战斗失败，旅程暂告一段落";
  const subtitle = pending ? "结局已确定，仍在等待结算。" : active ? "现在位于" + nodeNames[run.node] + "，随时可以继续。" : run.status === "defeated" ? "生命已降至 0；本局旅程已结束。" : "这段旅程的记录可以慢慢回看。";
  const observed = profile.enabled && run.observationEnabled;
  const summary = observed ? decisionSummary(run) : null;
  const highlights = gameplayHighlights(run).slice(0, 3);
  const availability = taskAvailability(run, profile, ctx.manifest, ctx.wasCaseSeen);
  const plan = recommendationPlan(profile, availability);
  const rec = plan.recommendation;
  const task = observed ? rec.task_id ?? "D1" : "D1";
  const alternate = task === "D1" ? "D2" : "D1";
  const taskName = (value: "D1" | "D2"): string => value === "D1" ? "资金安排台" : "历史对照台";
  const alternateUnavailable = alternate === "D1" ? availability.funding === "unavailable" : availability.history === "unavailable";
  const shortOffer = task === "D1" ? ({
    journey: "试算参与金额与采购后的可用金币。", example: "本局暂无完整日程，可用人工示例试算。", unavailable: "资金安排暂未准备好，可稍后重试。",
  })[availability.funding] : ({
    unseen: "比较一段未见历史与同期基准。", review: "可复习已看过的历史片段。", pending: "继续已锁定的历史研究。", unavailable: "历史目录尚未准备好或没有可用片段。",
  })[availability.history];
  const savedFunding = observed ? profile.funding_attempts.at(-1) : undefined;
  const reasonEvidence = observed ? profile.journey_observations[0]?.evidence_ids[0] : undefined;
  const rows: { label: string; insight: DecisionInsight }[] = summary ? [
    { label: "资金取舍", insight: summary.funding },
    { label: "信息使用", insight: summary.information },
    { label: "应对变化", insight: summary.response },
  ] : [];

  const pages = new Map<ReportPage, HTMLElement>();
  const tabs = new Map<ReportPage, HTMLButtonElement>();
  const changePage = (page: ReportPage, focus = false): void => {
    reportPageByRun.set(run, page);
    for (const [name, element] of pages) element.hidden = name !== page;
    for (const [name, tab] of tabs) tab.setAttribute("aria-pressed", String(name === page));
    if (focus) tabs.get(page)?.focus({ preventScroll: true });
  };
  const definitions: { id: ReportPage; label: string }[] = [
    { id: "overview", label: "概览" }, { id: "choices", label: "选择依据" },
    { id: "research", label: "研究与下一步" }, { id: "deck", label: "牌组账本" },
  ];
  const navigation = h("nav", { class: "report-pages", "aria-label": "报告分页" }, definitions.map(({ id, label }) => {
    const tab = button(label, () => changePage(id), "report-tab", false, "report-tab-" + id);
    tab.setAttribute("id", "report-tab-" + id);
    tab.setAttribute("aria-controls", "report-panel-" + id);
    tabs.set(id, tab); return tab;
  }));
  const page = (id: ReportPage, content: Child): HTMLElement => {
    const label = definitions.find((item) => item.id === id)!.label;
    const element = h("section", { class: "report-screen", id: "report-panel-" + id, "aria-label": label }, content);
    pages.set(id, element); return element;
  };
  const detailEvents = (insight: DecisionInsight): Child => {
    const events = insight.evidenceIds.map((id) => run.history.find((event) => event.id === id)).filter((event) => !!event);
    return events.length ? h("div", { class: "report-evidence" }, events.map((event) => h("p", { class: "fineprint" }, nodeNames[event.node] + " · " + event.message))) : h("p", { class: "fineprint" }, "还没有可引用的本局选择记录。");
  };

  const overview = page("overview", h("div", { class: "panel report-portrait" },
    h("div", { class: "report-portrait-head" }, h("div", null, h("span", { class: "eyebrow" }, "本局画像"), h("h2", null, "本局交易倾向")), run.source !== "real" ? pill(run.source === "fork" ? "模拟 · 分叉" : "模拟 · 预设", "gold") : null),
    summary ? h("div", { class: "report-traits" }, rows.map(({ label, insight }) => h("div", { class: "report-trait" }, h("span", null, label), h("strong", { class: insight.status === "unobserved" ? "muted" : "" }, insight.brief))))
      : h("p", { class: "report-disabled" }, "本局未开启或已撤销观察，未生成画像。开启观察的新旅程才会生成本局画像。"),
    summary ? h("p", { class: "fineprint report-boundary" }, "仅描述本局选择，不代表现实投资人格。") : null,
    h("div", { class: "button-row report-primary-actions" },
      summary ? button("查看选择依据", () => changePage("choices", true), "small", false, "report-open-choices") : null,
      button("查看战报", () => changePage("deck", true), "small secondary", false, "report-open-battle"))));

  const choices = page("choices", summary ? h("div", { class: "panel report-choice-page" },
    h("h2", null, "选择依据"), h("p", { class: "hint" }, "由这次旅程中实际记录的选择整理。"),
    h("div", { class: "report-choice-list" }, rows.map(({ label, insight }) => h("article", { class: "report-choice" }, h("div", null, h("span", null, label), h("h3", null, insight.title), h("p", null, insight.brief)),
      button("查看详情", () => ctx.openDetails(label + " · 本局记录", h("div", { class: "stack" }, h("p", { class: "hint" }, insight.detail), detailEvents(insight))), "small ghost", false, "report-evidence-" + label)))),
    h("div", { class: "button-row" }, button("如何理解这些描述", () => ctx.openDetails("如何理解本局画像", h("p", { class: "hint" }, summary.boundary)), "small secondary", false, "report-boundary"),
      reasonEvidence ? button("补充我的原因", () => {
        const select = h("select", { "aria-label": "补充我的原因" }, h("option", { value: "" }, "选择一个原因"), h("option", { value: "upgrade" }, "想留钱升级"), h("option", { value: "not_understood" }, "有些规则没看懂"), h("option", { value: "not_interested" }, "暂时不感兴趣"), h("option", { value: "autonomous" }, "想自主尝试"), h("option", { value: "other" }, "其他或不确定"));
        ctx.openDetails("补充我的原因", h("div", { class: "stack" }, h("p", { class: "hint" }, "你的补充会保留为新的记录。"), select, button("保存补充", () => ctx.saveReason(reasonEvidence, select.value as Reason | ""), "small")));
      }, "small secondary", false, "report-reason") : null))
    : h("div", { class: "panel report-empty" }, h("h2", null, "选择依据"), h("p", { class: "hint" }, "本局未开启或已撤销观察，因此没有画像依据。开启观察的新旅程才会生成画像。"), button("查看战报", () => changePage("deck", true), "small secondary")));

  const research = page("research", h("div", { class: "panel report-research-page" },
    h("span", { class: "eyebrow" }, "下一步"), h("h2", null, observed && rec.task_id ? "推荐 · " + taskName(task) : "可先试试" + taskName(task)),
    h("p", { class: "hint" }, rec.reason), h("p", { class: "fineprint" }, shortOffer),
    h("div", { class: "button-row" }, button("打开" + taskName(task), () => ctx.openTask(task), "small", false, "report-task-primary"),
      button("打开" + taskName(alternate) + (alternateUnavailable ? "（待准备）" : ""), () => ctx.openTask(alternate), "small secondary", false, "report-task-other")),
    h("div", { class: "report-link-list" },
      observed ? button("查看研究线索", () => ctx.openDetails("你的研究线索", researchSummary(profile)), "small secondary", false, "report-research-details") : null,
      savedFunding ? button("回看最近一次资金核查", () => ctx.openDetails("回看最近一次资金核查", savedFundingReview(savedFunding, run)), "small secondary", false, "report-funding-review") : null,
      observed && ctx.calibration ? button("查看预期对照", () => ctx.openDetails("本局预期对照", ctx.calibration), "small secondary", false, "report-calibration") : null,
      observed && ctx.preferences ? button("更改目标与帮助", () => ctx.openDetails("目标与帮助", ctx.preferences), "small secondary", false, "report-preferences") : null,
      button("为什么这样推荐", () => ctx.openDetails("推荐依据", h("div", { class: "stack" }, h("p", { class: "hint" }, rec.reason), plan.continuity ? h("p", { class: "hint" }, plan.continuity) : null, h("p", { class: "fineprint" }, "帮助方式：" + rec.help_reason), h("p", { class: "fineprint" }, "资金安排：" + plan.offers.D1), h("p", { class: "fineprint" }, "历史对照：" + plan.offers.D2), plan.observed_steps.map((item) => h("p", { class: "fineprint" }, item.text)))), "small secondary", false, "report-recommendation"))));

  const deck = page("deck", h("div", { class: "panel report-deck-page" },
    h("h2", null, "本局战报"), h("p", { class: "hint" }, "这里只回顾游戏中的战斗与收获。"),
    highlights.length ? h("ul", { class: "report-highlight-list" }, highlights.map((item) => h("li", null, item.title))) : h("p", { class: "hint" }, "旅程刚开始，还没有战斗亮点。"),
    highlights.length ? button("查看战报详情", () => ctx.openDetails("本局战报", h("div", { class: "stack" }, highlights.map((item) => h("div", null, h("strong", null, item.title), h("p", { class: "hint" }, item.text))))), "small secondary", false, "report-battle-details") : null,
    h("div", { class: "report-deck-stats" }, h("span", null, "随行牌组 " + run.deck.length + " 张"), h("span", null, "可用金币 " + coins(run.wallet.cashCents))),
    h("div", { class: "button-row" }, button("查看随行牌组", () => ctx.openDetails("随行牌组", deckSummary(run)), "small secondary", false, "report-deck-details"),
      button("查看金币账本", () => ctx.openDetails("金币往来", moneyHistory(run)), "small secondary", false, "report-ledger"))));

  const chosen = reportPageByRun.get(run) ?? "overview";
  changePage(chosen);
  return h("div", { class: "app-shell" }, ctx.header, h("main", { class: "report-page", id: "main-content" },
    h("header", { class: "report-heading" }, h("span", { class: "eyebrow" }, "我的旅程"), h("h1", null, "我的交易风格"),
      h("p", { class: "report-status" }, ending + " · " + subtitle)),
    navigation, overview, choices, research, deck,
    h("div", { class: "button-row report-actions" }, active ? button("返回旅程", ctx.resume, "small secondary") : button("再来一局", ctx.newRun, "small secondary"), active ? null : button("回到首页", ctx.home, "small ghost"))));
}
