import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCalibrationDemo } from "./calibration-demo";
import { createRun, reduceRun } from "./engine";
import { gameplayHighlights } from "./gameplay-highlights";
import { loadMarketInitial, loadMarketStage, resetMarketCacheForTest, type ResearchMarketCase } from "./market";
import { compareSchedule, declarePriorExposure, emptyResearchProfile, mechanicalFundingExample, setResearchGoal, showHistoryEvidence, startHistory, submitFunding, submitHistory, updateJourney, type ResearchProfile } from "./research";
import { reportView, researchSummary } from "./ui-report";

class FakeNode {
  children: (FakeNode | string)[] = [];
  parent: FakeNode | null = null;
  append(...items: (FakeNode | string)[]): void { for (const item of items) { if (item instanceof FakeNode) item.parent = this; this.children.push(item); } }
  get textContent(): string { return this.children.map((child) => typeof child === "string" ? child : child.textContent).join(""); }
}
class FakeElement extends FakeNode {
  attributes: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  open = false;
  value = "";
  constructor(readonly tag: string) { super(); }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  addEventListener(name: string, listener: () => void): void { this.listeners[name] = listener; }
  fire(name: string): void { this.listeners[name]?.(); }
}
function find(node: FakeNode, predicate: (element: FakeElement) => boolean): FakeElement | undefined {
  if (node instanceof FakeElement && predicate(node)) return node;
  for (const child of node.children) if (child instanceof FakeNode) { const result = find(child, predicate); if (result) return result; }
  return undefined;
}
function visibleText(node: FakeNode): string {
  if (node instanceof FakeElement && node.tag === "details" && !node.open) return node.children.filter((child): child is FakeElement => child instanceof FakeElement && child.tag === "summary").map(visibleText).join("");
  return node.children.map((child) => typeof child === "string" ? child : visibleText(child)).join("");
}
function byText(node: FakeNode, tag: string, text: string): FakeElement {
  const item = find(node, (element) => element.tag === tag && element.textContent === text);
  if (!item) throw new Error(`missing ${tag}: ${text}`);
  return item;
}
async function researchCase(id: string): Promise<ResearchMarketCase> { return JSON.parse(await readFile(`public/data/adventure/research/${id}.json`, "utf8")) as ResearchMarketCase; }

beforeEach(() => {
  resetMarketCacheForTest();
  vi.stubGlobal("Node", FakeNode);
  vi.stubGlobal("document", { createElement: (tag: string) => new FakeElement(tag) });
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
    try { return new Response(await readFile(`public${path}`), { status: 200, headers: { "Content-Type": "application/json" } }); }
    catch { return new Response("not found", { status: 404 }); }
  });
});
afterEach(() => { vi.unstubAllGlobals(); resetMarketCacheForTest(); });

describe("compact journey report", () => {
  it("identifies a defeat that ends immediately without any shares or quote wait", () => {
    let run = createRun({ seed: 104, observationEnabled: false });
    for (let turn = 0; turn < 20 && run.phase === "battle"; turn++) run = reduceRun(run, { type: "end-turn" });
    expect(run.status).toBe("defeated"); expect(run.phase).toBe("ended"); expect(run.market.pending).toBeNull();
    const view = reportView({ run, profile: emptyResearchProfile(false), manifest: null, wasCaseSeen: () => false, header: new FakeElement("header") as unknown as HTMLElement,
      preferences: null, calibration: null, openTask: vi.fn(), saveReason: vi.fn(), resume: vi.fn(), newRun: vi.fn(), home: vi.fn() }) as unknown as FakeElement;
    expect(visibleText(view)).toContain("战斗失败，旅程暂告一段落");
    expect(visibleText(view)).toContain("生命已降至 0");
    expect(visibleText(view)).not.toContain("等待报价");
    expect(visibleText(view)).not.toContain("任务观察");
  });

  it("shows real highlights and a single recommended entry while retaining other actions in disclosures", async () => {
    let run = await makeCalibrationDemo();
    run = reduceRun(run, { type: "submit-redemption", percent: 0 });
    run = reduceRun(run, { type: "apply-quote", quote: await loadMarketStage(run.caseId, "t1-exec", true) });
    run = reduceRun(run, { type: "buy-archive" });
    run = reduceRun(run, { type: "open-archive" });
    run.source = "real";
    const profile = setResearchGoal(updateJourney(emptyResearchProfile(), run), "history-goal", "history");
    const openTask = vi.fn(); const resume = vi.fn();
    const view = reportView({ run, profile, manifest: await loadMarketInitial(), wasCaseSeen: () => false, header: new FakeElement("header") as unknown as HTMLElement, preferences: new FakeElement("div") as unknown as HTMLElement,
      calibration: null, openTask, saveReason: vi.fn(), resume, newRun: vi.fn(), home: vi.fn() }) as unknown as FakeElement;
    const visible = visibleText(view);
    for (const item of gameplayHighlights(run)) expect(visible).toContain(item.text);
    expect(profile.journey_observations.length).toBeGreaterThan(2);
    const observations = find(view, (item) => item.attributes.class === "report-observation-list");
    expect(observations?.children).toHaveLength(2);
    expect(visible).toContain("同期比较"); expect(visible).toContain("样本边界"); expect(visible).toContain("可用现金");
    expect(visible).toContain("推荐 · 历史对照台");
    expect(visible).toContain("打开历史对照台");
    expect(visible).not.toContain("打开资金安排台");
    expect(visible).not.toContain("你的研究线索");
    byText(view, "button", "打开历史对照台").fire("click"); expect(openTask).toHaveBeenCalledWith("D2");
    byText(view, "button", "返回营地").fire("click"); expect(resume).toHaveBeenCalledOnce();
    const other = byText(view, "summary", "也可选择资金安排台");
    (other.parent as FakeElement).open = true;
    expect(visibleText(view)).toContain("打开资金安排台");
    byText(view, "button", "打开资金安排台").fire("click"); expect(openTask).toHaveBeenCalledWith("D1");
    const evidence = byText(view, "summary", "查看观察依据与研究过程");
    (evidence.parent as FakeElement).open = true;
    expect(visibleText(view)).toContain("你的研究线索");
    expect(visibleText(view)).toContain("补充我的原因");
    expect(visibleText(view)).toContain("更改目标与帮助");
    expect(visibleText(view)).toContain("查看牌组、金币账本与旅程依据");
  });

  it("keeps game achievements visible for a simulated play-only journey without showing research observations", async () => {
    const run = await makeCalibrationDemo(); run.source = "fork";
    const view = reportView({ run, profile: emptyResearchProfile(false, "fork"), manifest: null, wasCaseSeen: () => false, header: new FakeElement("header") as unknown as HTMLElement,
      preferences: null, calibration: null, openTask: vi.fn(), saveReason: vi.fn(), resume: vi.fn(), newRun: vi.fn(), home: vi.fn() }) as unknown as FakeElement;
    const visible = visibleText(view);
    expect(visible).toContain("模拟 · 分叉");
    expect(visible).toContain("只玩游戏");
    expect(visible).toContain("旅程亮点");
    expect(visible).not.toContain("任务观察");
    expect(visible).not.toContain("查看观察依据与研究过程");
    expect(visible).toContain("查看牌组、金币账本与旅程依据");
  });

  it("says when a recommended exercise is only a mechanical example or a review", async () => {
    const run = await makeCalibrationDemo(); run.source = "real";
    const manifest = await loadMarketInitial();
    const base = { run, manifest, wasCaseSeen: (id: string) => id === "lantern-a" || id === "lantern-b", header: new FakeElement("header") as unknown as HTMLElement,
      preferences: null, calibration: null, openTask: vi.fn(), saveReason: vi.fn(), resume: vi.fn(), newRun: vi.fn(), home: vi.fn() };
    const funding = reportView({ ...base, profile: setResearchGoal(emptyResearchProfile(), "funding-goal", "funding") }) as unknown as FakeElement;
    expect(visibleText(funding)).toContain("人工机制算例供练习");
    expect(visibleText(funding)).toContain("不作为独立能力依据");
    const history = reportView({ ...base, profile: setResearchGoal(emptyResearchProfile(), "history-goal", "history") }) as unknown as FakeElement;
    expect(visibleText(history)).toContain("目前可选历史片段均标为已见");
    expect(visibleText(history)).toContain("作为复习");
    expect(visibleText(history)).not.toContain("新情境");
    expect(visibleText(history)).toContain("为什么这样推荐与选择帮助");
  });
});

describe("research trace scope", () => {
  it("keeps the first case independent when only the second case was seen, including later correction", async () => {
    const primary = await researchCase("lantern-a"); const other = await researchCase("lantern-b");
    const schedule = { startingCashCents: 7200, participationCents: 2000, t1: 0 as const, t2: 0 as const };
    let profile = startHistory(emptyResearchProfile(), { id: "review", caseId: primary.caseId, questionVersion: "d2-v1", schedule, initialClaim: "unknown", priorExposure: false });
    profile = showHistoryEvidence(profile, "review", primary, other, true);
    const first = compareSchedule(primary, schedule); const second = compareSchedule(other, schedule);
    const direction = second.asset.gainCents > first.asset.gainCents ? "outperform" : second.asset.gainCents < first.asset.gainCents ? "underperform" : "equal";
    profile = submitHistory(profile, "review", { comparison: first.direction, historyDifference: direction, boundary: "only_samples", reason: "对照数字" }).profile;
    let text = (researchSummary(profile) as unknown as FakeElement).textContent;
    expect(text).toContain("同期比较：本次独立完成");
    expect(text).toContain("样本边界：另一段此前已见，本项作为复核");
    profile = declarePriorExposure(profile, { id: "correct-secondary", caseId: "lantern-b", priorToTasks: true }).profile;
    text = (researchSummary(profile) as unknown as FakeElement).textContent;
    expect(text).toContain("同期比较：本次独立完成");
    expect(text).toContain("样本边界：本人补充此前已见相关案例");
  });
  it("labels overlapping cases as a related exercise without downgrading the primary comparison", async () => {
    const primary = await researchCase("lantern-c"); const other = await researchCase("lantern-d");
    const schedule = { startingCashCents: 7200, participationCents: 2000, t1: 0 as const, t2: 0 as const };
    let profile = startHistory(emptyResearchProfile(), { id: "overlap", caseId: primary.caseId, questionVersion: "d2-v1", schedule, initialClaim: "unknown", priorExposure: false });
    profile = showHistoryEvidence(profile, "overlap", primary, other);
    const first = compareSchedule(primary, schedule); const second = compareSchedule(other, schedule);
    const direction = second.asset.gainCents > first.asset.gainCents ? "outperform" : second.asset.gainCents < first.asset.gainCents ? "underperform" : "equal";
    profile = submitHistory(profile, "overlap", { comparison: first.direction, historyDifference: direction, boundary: "only_samples", reason: "对照数字" }).profile;
    const text = (researchSummary(profile) as unknown as FakeElement).textContent;
    expect(text).toContain("同期比较：本次独立完成");
    expect(text).toContain("样本边界：这两段历史互相重叠");
  });
});

describe("saved funding review", () => {
  function viewProfile(profile: ResearchProfile): FakeElement {
    const run = createRun({ seed: 104, source: profile.source, observationEnabled: profile.enabled });
    return reportView({ run, profile, manifest: null, wasCaseSeen: () => false, header: new FakeElement("header") as unknown as HTMLElement,
      preferences: null, calibration: null, openTask: vi.fn(), saveReason: vi.fn(), resume: vi.fn(), newRun: vi.fn(), home: vi.fn() }) as unknown as FakeElement;
  }
  function openFunding(view: FakeElement): string {
    (byText(view, "summary", "回看最近一次资金核查").parent as FakeElement).open = true;
    return visibleText(view);
  }

  it("keeps a saved D1 review accessible after a D2, using the stored blocked timelines", async () => {
    const a = await researchCase("lantern-a");
    const schedule = { startingCashCents: 7200, participationCents: 2000, t1: 0 as const, t2: 0 as const };
    let profile = startHistory(emptyResearchProfile(true, "demo"), { id: "history", caseId: a.caseId, questionVersion: "v1", schedule, initialClaim: "unknown", priorExposure: false });
    profile = showHistoryEvidence(profile, "history", a);
    profile = submitHistory(profile, "history", { comparison: compareSchedule(a, schedule).direction, reason: "模拟：核对数字" }).profile;
    const example = mechanicalFundingExample();
    const scenario = { ...example.scenario, events: [...example.scenario.events.slice(0, 2), { id: "later-purchase", label: "后续采购", kind: "purchase" as const, amountCents: 1500 }, ...example.scenario.events.slice(2)] };
    profile = submitFunding(profile, scenario, { id: "funding", questionVersion: "v1", plan: example.plan, purchaseId: "later-purchase", canPay: false,
      revisedPlan: { ...example.plan, participationCents: 6000 }, help: "self", answerExposed: false, priorExposure: false }).profile;
    const before = JSON.stringify(profile); const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    const view = viewProfile(profile);
    expect(visibleText(view)).toContain("回看最近一次资金核查");
    expect(visibleText(view)).not.toContain("当时核查的采购：后续采购");
    const text = openFunding(view);
    expect(text).toContain("模拟 · 预设");
    expect(text).toContain("人工机制示例，仅供练习");
    expect(text).toContain("当时核查的采购：后续采购。你的判断：不能支付");
    expect(text).toContain("参与金额：40 金币"); expect(text).toContain("参与金额：60 金币");
    expect(text).toContain("采购前可用 12 金币，需要 15 金币；不能支付，还差 3 金币");
    expect(text).toContain("首次无法支付的采购：途中计划升级（20 金币）");
    expect(text).toContain("采购前可用 12 金币，需要 20 金币；不能支付，还差 8 金币");
    expect(text).toContain("尚未到达目标采购");
    expect(text).toContain("回收安排 1（节点名称未记录）：50%");
    expect(text).toContain("回看不会改变实际游戏购买");
    expect(text).not.toContain("later-purchase");
    (byText(view, "summary", "查看修订计划的已保存时间线").parent as FakeElement).open = true;
    expect(visibleText(view)).toContain("预留参与金额，等待下一开盘");
    expect((researchSummary(profile) as unknown as FakeElement).textContent).toContain("一次研究过程");
    expect(JSON.stringify(profile)).toBe(before); expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("distinguishes completed fixed schedules from pending final prices and preserves recovery settings", () => {
    const example = mechanicalFundingExample();
    const submission = { id: "complete", questionVersion: "v1", plan: example.plan, purchaseId: "buy-upgrade", canPay: true,
      revisedPlan: example.plan, help: "self" as const, answerExposed: false, priorExposure: false };
    const complete = submitFunding(emptyResearchProfile(), example.scenario, submission).profile;
    const completeText = openFunding(viewProfile(complete));
    expect(completeText).toContain("已完成这次已记录的固定日程核查");
    expect(completeText).toContain("人工回收执行报价：50%");
    expect(completeText).toContain("回收比例是计划设置，不代表全部已执行");

    const pendingScenario = { ...example.scenario, events: example.scenario.events.filter((event) => event.id !== "final"), pendingFinal: { stage: "final-exec" as const, afterDate: "20240101" } };
    const pendingPlan = { ...example.plan, recovery: { recovery: 0 as const } };
    const pending = submitFunding(emptyResearchProfile(), pendingScenario, { ...submission, id: "pending", revisedPlan: pendingPlan }).profile;
    const pendingText = openFunding(viewProfile(pending));
    expect(pendingText).toContain("结束后的下一执行报价仍待确认，回收金额尚未到账");
    expect(pendingText).toContain("人工回收执行报价：0%");
  });

  it("replays no game while presenting the saved 0-versus-20 participation comparison", () => {
    const example = mechanicalFundingExample();
    const scenario = { ...example.scenario, startingCashCents: 2400, events: [example.scenario.events[0]!, { id: "purchase", label: "计划采购", kind: "purchase" as const, amountCents: 2500 }] };
    const plan = { participationCents: 0, recovery: {} };
    const profile = submitFunding(emptyResearchProfile(), scenario, { id: "compare", questionVersion: "v1", plan, purchaseId: "purchase", canPay: false,
      revisedPlan: { ...plan, participationCents: 2000 }, help: "self", answerExposed: false, priorExposure: false }).profile;
    const text = openFunding(viewProfile(profile));
    expect(text).toContain("参与金额：0 金币"); expect(text).toContain("参与金额：20 金币");
    expect(text).toContain("采购前可用 24 金币，需要 25 金币；不能支付，还差 1 金币");
    expect(text).toContain("采购前可用 4 金币，需要 25 金币；不能支付，还差 21 金币");
    expect(text).toContain("回看不会改变实际游戏购买");
  });

  it("shows the most recent saved funding attempt, not an earlier one", () => {
    const example = mechanicalFundingExample();
    const submission = { questionVersion: "v1", plan: example.plan, purchaseId: "buy-upgrade", canPay: true,
      help: "self" as const, answerExposed: false, priorExposure: false };
    let profile = submitFunding(emptyResearchProfile(), example.scenario, { ...submission, id: "first", revisedPlan: { ...example.plan, participationCents: 6000 } }).profile;
    profile = submitFunding(profile, example.scenario, { ...submission, id: "latest", revisedPlan: { ...example.plan, participationCents: 3000 } }).profile;
    const text = openFunding(viewProfile(profile));
    expect(text).toContain("参与金额：30 金币");
    expect(text).not.toContain("参与金额：60 金币");
  });

  it("does not infer missing names, amounts, target or a completed schedule from an incomplete record", () => {
    const example = mechanicalFundingExample();
    const profile = submitFunding(emptyResearchProfile(), example.scenario, { id: "incomplete", questionVersion: "v1", plan: example.plan,
      purchaseId: "buy-upgrade", canPay: true, revisedPlan: example.plan, help: "self", answerExposed: false, priorExposure: false }).profile;
    const partial = JSON.parse(JSON.stringify(profile));
    delete partial.funding_attempts[0].revisedPlan.participationCents;
    delete partial.funding_attempts[0].revisedTimeline.pendingFinal;
    delete partial.funding_attempts[0].revisedTimeline.stoppedAt;
    partial.funding_attempts[0].timeline.rows = partial.funding_attempts[0].timeline.rows.filter((row: { id: string }) => row.id !== "buy-upgrade");
    partial.funding_attempts[0].revisedTimeline.rows = partial.funding_attempts[0].revisedTimeline.rows.filter((row: { id: string }) => row.id !== "buy-upgrade");
    const text = openFunding(viewProfile(partial));
    expect(text).toContain("当时核查的采购：采购名称未记录");
    expect(text).toContain("参与金额：未知");
    expect(text).toContain("无法确认日程是否完成");
    expect(text).toContain("无法确认是否到达或能否支付");
    expect(text).not.toContain("buy-upgrade");
  });

  it("does not assert that the target is unreached when the stored order cannot prove it", () => {
    const example = mechanicalFundingExample();
    const profile = submitFunding(emptyResearchProfile(), example.scenario, { id: "partial-order", questionVersion: "v1", plan: example.plan,
      purchaseId: "buy-upgrade", canPay: true, revisedPlan: example.plan, help: "self", answerExposed: false, priorExposure: false }).profile;
    const partial = JSON.parse(JSON.stringify(profile));
    const revised = partial.funding_attempts[0].revisedTimeline;
    revised.rows = revised.rows.filter((row: { id: string }) => row.id !== "buy-upgrade");
    revised.rows.push({ id: "unknown-other-purchase", label: "另一项采购", kind: "purchase", cashBeforeCents: 100, cashCents: 100,
      shareUnits: "0", referenceValueCents: null, canPay: false, amountCents: 500 });
    revised.stoppedAt = "unknown-other-purchase";
    const view = viewProfile(partial); openFunding(view);
    const revisedText = (byText(view, "h4", "修订计划").parent as FakeElement).textContent;
    expect(revisedText).toContain("首次无法支付的采购：另一项采购");
    expect(revisedText).toContain("无法确认是否到达或能否支付");
    expect(revisedText).not.toContain("尚未到达目标采购");
  });

  it("does not turn contradictory stop and pending markers into a definite result", () => {
    const example = mechanicalFundingExample();
    const profile = submitFunding(emptyResearchProfile(), example.scenario, { id: "contradictory", questionVersion: "v1", plan: example.plan,
      purchaseId: "buy-upgrade", canPay: true, revisedPlan: example.plan, help: "self", answerExposed: false, priorExposure: false }).profile;
    const partial = JSON.parse(JSON.stringify(profile));
    partial.funding_attempts[0].revisedTimeline.stoppedAt = "buy-upgrade";
    partial.funding_attempts[0].revisedTimeline.pendingFinal = { stage: "final-exec", afterDate: "20240101" };
    const view = viewProfile(partial); openFunding(view);
    const revisedText = (byText(view, "h4", "修订计划").parent as FakeElement).textContent;
    expect(revisedText).toContain("无法确认日程是否完成");
    expect(revisedText).not.toContain("回收金额尚未到账");
  });

  it("never exposes old funding attempts when observation is disabled", () => {
    const example = mechanicalFundingExample();
    const observed = submitFunding(emptyResearchProfile(), example.scenario, { id: "old", questionVersion: "v1", plan: example.plan, purchaseId: "buy-upgrade", canPay: true,
      revisedPlan: example.plan, help: "self", answerExposed: false, priorExposure: false }).profile;
    const disabled = { ...observed, enabled: false };
    const text = viewProfile(disabled).textContent;
    expect(text).not.toContain("回看最近一次资金核查");
    expect(text).not.toContain("人工机制示例，仅供练习");
    expect(text).not.toContain("当时核查的采购");
  });
});
