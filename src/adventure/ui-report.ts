import { h } from "../ui/dom";
import type { Direction, Knowledge, KnowledgeEvidence, ResearchProfile } from "./research";
import { coins, details } from "./ui-components";

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
    h("p", { class: "fineprint" }, `${latest.helpUsed === "step" ? "查看过分步说明" : latest.helpUsed === "hint" ? "查看过提示" : "这次未查看提示"}。${(profile.prior_exposure_disclosures ?? []).some((entry) => entry.relatedCaseIds.includes(latest.caseId) || (!!latest.shown?.other && entry.relatedCaseIds.includes(latest.shown.other.caseId))) ? "你补充说此前已见相关片段，原操作保留。" : latest.priorExposure || latest.answerExposed ? "资料或答案曾经见过，这次作为复核。" : ""}`),
    latest.final.reason ? h("p", { class: "fineprint" }, `你选择的依据：${latest.final.reason}`) : null) : latestFunding && purchase ? h("div", { class: "research-trace" },
    h("div", { class: "trace-head" }, h("strong", null, "一次资金核查"), h("span", { class: "fineprint" }, latestFunding.caseId === "manual-example" ? "人工练习" : "本局资金安排")),
    h("div", { class: "trace-steps" }, h("div", null, h("small", null, "你的判断"), h("p", null, latestFunding.answer ? "这项采购可以支付" : "这项采购不能支付")), h("div", null, h("small", null, "对照账本"), h("p", null, `需要 ${coins(purchase.amountCents)}，当时可用 ${coins(purchase.cashBeforeCents)} 金币`)), h("div", null, h("small", null, "核查结果"), h("p", null, latestFunding.actualCanPay ? "当时可以支付" : "当时不能支付"))),
    h("p", { class: "fineprint" }, `${latestFunding.help === "step" ? "查看过分步说明" : latestFunding.help === "hint" ? "查看过提示" : "这次未查看提示"}。${latestFunding.caseId === "manual-example" ? "人工示例仅用于练习，不增加能力依据。" : ""}`)) : h("p", { class: "hint research-empty" }, "还没有完成研究任务；可以先留下一个判断，再查看数据。" );
  return h("section", { class: "panel stack research-summary" }, h("div", { class: "panel-head" }, h("div", null, h("h2", null, "你的研究线索"), h("p", { class: "hint" }, "这里记录你在任务中实际做过的步骤；未观察到的保留为空。"))),
    h("div", { class: "knowledge-grid" }, columns), trace,
    h("p", { class: "fineprint" }, "这些只是本次任务的观察，不代表稳定能力；现实财务承受能力未评估。"),
    details("查看任务依据与范围", h("div", { class: "stack" }, profile.knowledge_observations.map((item) => h("p", { class: "hint" }, item.text)), profile.knowledge_evidence.length ? h("p", { class: "fineprint" }, `技术依据：${profile.knowledge_evidence.map((item) => item.id).join("、")}`) : h("p", { class: "fineprint" }, "尚无任务证据。"))));
}
