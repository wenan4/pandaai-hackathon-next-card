import "./ui-report.css";
import { h, type Child } from "../ui/dom";
import { gameplayHighlights } from "./gameplay-highlights";
import { recommendationPlan, type Direction, type Knowledge, type KnowledgeEvidence, type Reason, type ResearchProfile } from "./research";
import type { MarketManifest } from "./market";
import type { Run } from "./types";
import { button, coins, deckSummary, details, moneyHistory, pill } from "./ui-components";
import { taskAvailability } from "./ui-availability";
import { nodeNames } from "./ui-game";

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
  const purchase = latestFunding?.timeline.rows.find((row) => row.id === latestFunding.purchaseId);
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
    latest.final.reason ? h("p", { class: "fineprint" }, `你选择的依据：${latest.final.reason}`) : null) : latestFunding && purchase ? h("div", { class: "research-trace" },
    h("div", { class: "trace-head" }, h("strong", null, "一次资金核查"), h("span", { class: "fineprint" }, latestFunding.caseId === "manual-example" ? "人工练习" : "本局资金安排")),
    h("div", { class: "trace-steps" }, h("div", null, h("small", null, "你的判断"), h("p", null, latestFunding.answer ? "这项采购可以支付" : "这项采购不能支付")), h("div", null, h("small", null, "对照账本"), h("p", null, `需要 ${coins(purchase.amountCents)}，当时可用 ${coins(purchase.cashBeforeCents)} 金币`)), h("div", null, h("small", null, "核查结果"), h("p", null, latestFunding.actualCanPay ? "当时可以支付" : "当时不能支付"))),
    h("p", { class: "fineprint" }, `${latestFunding.help === "step" ? "查看过分步说明" : latestFunding.help === "hint" ? "查看过提示" : "这次未查看提示"}。${latestFunding.caseId === "manual-example" ? "人工示例仅用于练习，不增加能力依据。" : ""}`)) : h("p", { class: "hint research-empty" }, "还没有完成研究任务；可以先留下一个判断，再查看数据。" );
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
  saveReason: (evidenceId: string, reason: Reason | "") => void;
  resume: () => void;
  newRun: () => void;
  home: () => void;
}

const shortStatus: Record<string, string> = { unobserved: "尚未观察", independent: "一次独立完成", assisted: "借助帮助完成", needs_confirmation: "需要再核对", conflicting: "情境结果不同" };
function reportDetails(label: string, ...children: Child[]): HTMLElement {
  return h("details", { class: "report-disclosure" }, h("summary", null, label), ...children);
}

/** Compact journey recap; research findings remain separate from gameplay events. */
export function reportView(ctx: ReportContext): HTMLElement {
  const { run, profile } = ctx;
  const active = run.status === "active";
  const ending = active ? "旅程中的小发现" : run.status === "cleared" ? "灯火已点亮" : run.status === "returned" ? "带着收获返程" : "旅程暂时停在这里";
  const subtitle = active ? `现在位于${nodeNames[run.node]}，随时可以继续。` : run.status === "cleared" ? "你完成了守灯者的挑战。" : run.status === "returned" ? "这段旅程的发现，可以慢慢回看。" : "这次冒险结束了，带走的发现仍然属于你。";
  const highlights = gameplayHighlights(run).slice(0, 3);
  const observations = profile.enabled ? profile.journey_observations.slice(-2).reverse() : [];
  const plan = recommendationPlan(profile, taskAvailability(run, profile, ctx.manifest, ctx.wasCaseSeen));
  const rec = plan.recommendation;
  const task = profile.enabled ? rec.task_id ?? "D1" : "D1";
  const alternate = task === "D1" ? "D2" : "D1";
  const taskName = (value: "D1" | "D2"): string => value === "D1" ? "资金安排台" : "历史对照台";
  const reasonEvidence = profile.enabled ? profile.journey_observations[0]?.evidence_ids[0] : undefined;
  const reasonSelect = h("select", { "aria-label": "补充我的原因" }, h("option", { value: "" }, "选择一个原因"), h("option", { value: "upgrade" }, "想留钱升级"), h("option", { value: "not_understood" }, "有些规则没看懂"), h("option", { value: "not_interested" }, "暂时不感兴趣"), h("option", { value: "autonomous" }, "想自主尝试"), h("option", { value: "other" }, "其他或不确定"));
  const otherTask = reportDetails(`也可选择${taskName(alternate)}`, h("p", { class: "hint" }, alternate === "D1" ? "试算参与、回收与途中采购。" : "固定日程，再比较同期基准与另一段历史。"), button(`打开${taskName(alternate)}`, () => ctx.openTask(alternate), "small secondary"));
  const evidence = profile.enabled ? reportDetails("查看观察依据与研究过程", h("div", { class: "report-expanded stack" },
    researchSummary(profile),
    h("section", { class: "panel stack" }, h("h3", null, "经营观察与边界"), profile.journey_observations.length ? profile.journey_observations.map((item) => h("p", { class: "hint" }, `${item.text} 依据：${item.evidence_ids.join("、")}。${item.limitations.join("；")}。`)) : h("p", { class: "hint" }, "还没有足够的经营选择可供描述。"), h("p", { class: "fineprint" }, "现实财务承受能力未评估；单次游戏不能建立稳定交易类型。"),
      ctx.calibration,
      reasonEvidence ? details("补充我的原因", h("p", { class: "hint" }, "你的补充作为新记录保留，不改写原来的操作。"), reasonSelect, button("保存补充", () => ctx.saveReason(reasonEvidence, reasonSelect.value as Reason | ""), "small secondary")) : null))) : null;
  return h("div", { class: "app-shell" }, ctx.header, h("main", { class: "report-page", id: "main-content" },
    h("section", { class: "panel report-hero" }, h("div", { class: "report-hero-top" }, h("div", null, h("div", { class: "eyebrow" }, active ? "A PAUSE IN THE JOURNEY" : "JOURNEY COMPLETE"), h("h1", null, ending)), run.source !== "real" ? pill(run.source === "fork" ? "模拟 · 分叉" : "模拟 · 预设", "gold") : !profile.enabled ? pill("只玩游戏", "blue") : null),
      h("p", { class: "hint" }, subtitle), h("p", { class: "report-stats" }, `生命 ${run.hp}/${run.maxHp} · ${run.deck.length} 张牌 · 可用 ${coins(run.wallet.cashCents)} 金币`)),
    h("section", { class: "panel report-highlights" }, h("div", { class: "report-section-heading" }, h("h2", null, "旅程亮点"), h("span", { class: "fineprint" }, "来自本局记录")),
      highlights.length ? h("ul", { class: "report-highlight-list" }, highlights.map((item, index) => h("li", null, h("span", { class: "report-highlight-number", "aria-hidden": "true" }, String(index + 1).padStart(2, "0")), h("div", null, h("strong", null, item.title), h("p", null, item.text))))) : h("p", { class: "hint" }, "旅程刚开始，继续冒险会留下新的战斗记录。")),
    profile.enabled ? h("section", { class: "panel report-observations" }, h("h2", null, "这一路的线索"), observations.length ? h("ul", { class: "report-observation-list" }, observations.map((item) => h("li", null, item.text))) : h("p", { class: "hint" }, "暂时没有可描述的经营选择。"),
      h("div", { class: "report-knowledge" }, h("h3", null, "任务观察"), h("div", { class: "report-knowledge-list" }, (["K1", "K2", "K3"] as Knowledge[]).map((dimension) => { const item = profile.knowledge_observations.find((observation) => observation.dimension === dimension); return h("div", null, h("span", null, names[dimension]), h("strong", null, shortStatus[item?.status ?? "unobserved"] ?? "尚未观察")); })), h("p", { class: "fineprint" }, "只反映本次任务，未观察的保持未知。"))) : h("section", { class: "panel report-observations" }, h("h2", null, "这一路的线索"), h("p", { class: "hint" }, "你选择了只玩游戏；可以自由练习，不保存研究观察。")),
    h("section", { class: "panel report-next" }, h("div", null, h("div", { class: "eyebrow" }, profile.enabled && rec.task_id ? "A SUGGESTED NEXT STEP" : "A STEP YOU CAN TRY"), h("h2", null, profile.enabled && rec.task_id ? `推荐 · ${taskName(task)}` : `可先试试${taskName(task)}`), h("p", { class: "hint" }, rec.reason), h("p", { class: "fineprint" }, plan.offers[task])), button(`打开${taskName(task)}`, () => ctx.openTask(task), "gold")),
    h("section", { class: "panel report-more", "aria-label": "更多旅程内容" }, otherTask, evidence,
      reportDetails("为什么这样推荐与选择帮助", h("div", { class: "report-expanded stack" }, h("p", { class: "hint" }, rec.reason), plan.continuity ? h("p", { class: "hint" }, plan.continuity) : null, h("p", { class: "hint" }, `帮助方式：${rec.help_reason}`), h("p", { class: "hint" }, `资金安排：${plan.offers.D1}`), h("p", { class: "hint" }, `历史对照：${plan.offers.D2}`), plan.observed_steps.map((item) => h("p", { class: "fineprint" }, item.text, item.excluded_evidence_ids?.length ? ` ${item.limitations.find((limit) => limit.includes("本人补充")) ?? "本人补充了先前已见，相关操作保留。"}` : "")))),
      reportDetails("查看牌组、金币账本与旅程依据", h("div", { class: "report-expanded stack" }, h("h3", null, "当前牌组"), deckSummary(run), h("h3", null, "金币往来"), moneyHistory(run), highlights.length ? h("div", null, h("h3", null, "旅程亮点依据"), highlights.map((item) => h("p", { class: "fineprint" }, `${item.title}：${item.evidenceIds.join("、")}`))) : null)),
      profile.enabled ? reportDetails("更改目标与帮助", ctx.preferences) : null),
    h("div", { class: "button-row report-actions" }, active ? button("返回营地", ctx.resume, "secondary") : button("再来一局", ctx.newRun, "secondary"), active ? null : button("回到首页", ctx.home, "ghost"))));
}
