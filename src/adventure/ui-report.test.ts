import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCalibrationDemo } from "./calibration-demo";
import { createRun, reduceRun } from "./engine";
import { gameplayHighlights } from "./gameplay-highlights";
import { decisionSummary } from "./decision-summary";
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
  open = false; hidden = false;
  value = "";
  constructor(readonly tag: string) { super(); }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  addEventListener(name: string, listener: () => void): void { this.listeners[name] = listener; }
  fire(name: string): void { this.listeners[name]?.(); }
  focus(): void { /* no layout in this harness */ }
}
function find(node: FakeNode, predicate: (element: FakeElement) => boolean): FakeElement | undefined {
  if (node instanceof FakeElement && predicate(node)) return node;
  for (const child of node.children) if (child instanceof FakeNode) { const result = find(child, predicate); if (result) return result; }
  return undefined;
}
function visibleText(node: FakeNode): string {
  if (node instanceof FakeElement && node.hidden) return "";
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

describe("paged journey report", () => {
  it("places the disabled portrait explanation and a battle report entry on the first page", () => {
    let run = createRun({ seed: 104, observationEnabled: false });
    for (let turn = 0; turn < 20 && run.phase === "battle"; turn++) run = reduceRun(run, { type: "end-turn" });
    expect(run.status).toBe("defeated");
    const view = reportView({ run, profile: emptyResearchProfile(false), manifest: null, wasCaseSeen: () => false, header: new FakeElement("header") as unknown as HTMLElement,
      preferences: null, calibration: null, openTask: vi.fn(), openDetails: vi.fn(), saveReason: vi.fn(), resume: vi.fn(), newRun: vi.fn(), home: vi.fn() }) as unknown as FakeElement;
    const visible = visibleText(view);
    expect(visible).toContain("我的交易风格"); expect(visible).toContain("本局画像");
    expect(visible).toContain("战斗失败，旅程暂告一段落"); expect(visible).toContain("生命已降至 0");
    expect(visible).toContain("开启观察的新旅程才会生成本局画像");
    expect(visible).toContain("查看战报"); expect(visible).not.toContain("任务观察");
    byText(view, "button", "查看战报").fire("click");
    expect(visibleText(view)).toContain("本局战报");
    expect(visibleText(view)).toContain("这里只回顾游戏中的战斗与收获");
  });

  it("shows three specific results first and keeps evidence, tasks and the battle report on separate pages", async () => {
    let run = await makeCalibrationDemo();
    run = reduceRun(run, { type: "submit-redemption", percent: 0 });
    run = reduceRun(run, { type: "apply-quote", quote: await loadMarketStage(run.caseId, "t1-exec", true) });
    run = reduceRun(run, { type: "buy-archive" }); run = reduceRun(run, { type: "open-archive" });
    run.source = "real";
    const profile = setResearchGoal(updateJourney(emptyResearchProfile(), run), "history-goal", "history");
    const initialRun = JSON.stringify(run); const initialProfile = JSON.stringify(profile);
    const openTask = vi.fn(); const resume = vi.fn(); const openDetails = vi.fn();
    const ctx = { run, profile, manifest: await loadMarketInitial(), wasCaseSeen: () => false, header: new FakeElement("header") as unknown as HTMLElement,
      preferences: new FakeElement("div") as unknown as HTMLElement, calibration: null, openTask, openDetails, saveReason: vi.fn(), resume, newRun: vi.fn(), home: vi.fn() };
    const view = reportView(ctx) as unknown as FakeElement;
    const summary = decisionSummary(run); const visible = visibleText(view);
    expect(visible).toContain("我的交易风格"); expect(visible).toContain("本局交易倾向");
    expect(visible).toContain("仅描述本局选择，不代表现实投资人格");
    expect(visible).toContain(summary.funding.brief); expect(visible).toContain(summary.information.brief); expect(visible).toContain(summary.response.brief);
    expect(visible).toContain("参与 20 金币"); expect(visible).toContain("购买并打开档案"); expect(visible).toContain("中途继续持有");
    expect(visible).not.toContain(summary.funding.detail); expect(visible).not.toContain("本局战报");
    expect(byText(view, "button", "概览").attributes["aria-pressed"]).toBe("true");
    expect(byText(view, "button", "选择依据").attributes["aria-controls"]).toBe("report-panel-choices");

    byText(view, "button", "选择依据").fire("click");
    expect(byText(view, "button", "概览").attributes["aria-pressed"]).toBe("false");
    expect(byText(view, "button", "选择依据").attributes["aria-pressed"]).toBe("true");
    expect(visibleText(view)).toContain(summary.funding.brief); expect(visibleText(view)).toContain(summary.information.brief);
    expect(visibleText(view)).toContain(summary.response.brief);
    find(view, (item) => item.attributes["data-focus-key"] === "report-evidence-资金取舍")!.fire("click");
    expect(openDetails.mock.calls.at(-1)?.[0]).toBe("资金取舍 · 本局记录");
    expect((openDetails.mock.calls.at(-1)![1] as unknown as FakeElement).textContent).toContain(summary.funding.detail);
    expect((openDetails.mock.calls.at(-1)![1] as unknown as FakeElement).textContent).toContain("提交契约参与金额");
    byText(view, "button", "如何理解这些描述").fire("click");
    expect(openDetails).toHaveBeenCalledWith("如何理解本局画像", expect.any(FakeElement));
    expect((openDetails.mock.calls.at(-1)![1] as unknown as FakeElement).textContent).toContain("战斗打法不参与金融观察");

    byText(view, "button", "研究与下一步").fire("click");
    expect(visibleText(view)).toContain("推荐 · 历史对照台");
    byText(view, "button", "打开历史对照台").fire("click"); expect(openTask).toHaveBeenCalledWith("D2");
    byText(view, "button", "打开资金安排台").fire("click"); expect(openTask).toHaveBeenCalledWith("D1");
    byText(view, "button", "查看研究线索").fire("click"); expect(openDetails.mock.calls.at(-1)?.[0]).toBe("你的研究线索");

    byText(view, "button", "牌组账本").fire("click"); expect(visibleText(view)).toContain("本局战报");
    byText(view, "button", "查看战报详情").fire("click");
    const battle = openDetails.mock.calls.at(-1)![1] as unknown as FakeElement;
    for (const item of gameplayHighlights(run)) expect(battle.textContent).toContain(item.text);
    expect(battle.textContent).not.toContain("交易人格");
    byText(view, "button", "返回旅程").fire("click"); expect(resume).toHaveBeenCalledOnce();
    expect(JSON.stringify(run)).toBe(initialRun); expect(JSON.stringify(profile)).toBe(initialProfile);
    const rerendered = reportView(ctx) as unknown as FakeElement;
    expect(byText(rerendered, "button", "牌组账本").attributes["aria-pressed"]).toBe("true");
    const fresh = reportView({ ...ctx, run: structuredClone(run) }) as unknown as FakeElement;
    expect(byText(fresh, "button", "概览").attributes["aria-pressed"]).toBe("true");
  });

  it("keeps a simulated play-only journey's battle report without producing a financial portrait", async () => {
    const run = await makeCalibrationDemo(); run.source = "fork"; run.observationEnabled = false;
    const view = reportView({ run, profile: emptyResearchProfile(false, "fork"), manifest: null, wasCaseSeen: () => false, header: new FakeElement("header") as unknown as HTMLElement,
      preferences: null, calibration: null, openTask: vi.fn(), openDetails: vi.fn(), saveReason: vi.fn(), resume: vi.fn(), newRun: vi.fn(), home: vi.fn() }) as unknown as FakeElement;
    expect(visibleText(view)).toContain("模拟 · 分叉"); expect(visibleText(view)).toContain("未开启或已撤销观察");
    expect(visibleText(view)).not.toContain("参与 20 金币");
    byText(view, "button", "查看战报").fire("click"); expect(visibleText(view)).toContain("本局战报");
  });

  it("shows missing evidence honestly in the initial portrait", () => {
    const run = createRun({ observationEnabled: true });
    const view = reportView({ run, profile: emptyResearchProfile(true), manifest: null, wasCaseSeen: () => false, header: new FakeElement("header") as unknown as HTMLElement,
      preferences: null, calibration: null, openTask: vi.fn(), openDetails: vi.fn(), saveReason: vi.fn(), resume: vi.fn(), newRun: vi.fn(), home: vi.fn() }) as unknown as FakeElement;
    const text = visibleText(view);
    expect(text).toContain("尚无参与安排"); expect(text).toContain("尚无档案使用记录"); expect(text).toContain("尚无持有后的自主选择");
    expect(text).not.toContain("参与 0 金币");
    byText(view, "button", "研究与下一步").fire("click");
    expect(visibleText(view)).toContain("历史对照台（待准备）");
  });

  it("labels a mechanical example and a review on the research page", async () => {
    const run = await makeCalibrationDemo(); run.source = "real";
    const manifest = await loadMarketInitial();
    const base = { run, manifest, wasCaseSeen: (id: string) => id === "lantern-a" || id === "lantern-b", header: new FakeElement("header") as unknown as HTMLElement,
      preferences: null, calibration: null, openTask: vi.fn(), openDetails: vi.fn(), saveReason: vi.fn(), resume: vi.fn(), newRun: vi.fn(), home: vi.fn() };
    const funding = reportView({ ...base, profile: setResearchGoal(emptyResearchProfile(), "funding-goal", "funding") }) as unknown as FakeElement;
    byText(funding, "button", "研究与下一步").fire("click");
    expect(visibleText(funding)).toContain("可用人工示例试算");
    byText(funding, "button", "为什么这样推荐").fire("click");
    expect((base.openDetails.mock.calls.at(-1)![1] as unknown as FakeElement).textContent).toContain("不作为独立能力依据");
    const history = reportView({ ...base, run: structuredClone(run), profile: setResearchGoal(emptyResearchProfile(), "history-goal", "history") }) as unknown as FakeElement;
    byText(history, "button", "研究与下一步").fire("click");
    expect(visibleText(history)).toContain("可复习已看过的历史片段");
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
    let view: FakeElement;
    const openDetails = (_title: string, body: unknown): void => { if (body instanceof FakeNode) view.append(body); };
    view = reportView({ run, profile, manifest: null, wasCaseSeen: () => false, header: new FakeElement("header") as unknown as HTMLElement,
      preferences: null, calibration: null, openTask: vi.fn(), openDetails, saveReason: vi.fn(), resume: vi.fn(), newRun: vi.fn(), home: vi.fn() }) as unknown as FakeElement;
    return view;
  }
  function openFunding(view: FakeElement): string {
    byText(view, "button", "研究与下一步").fire("click");
    byText(view, "button", "回看最近一次资金核查").fire("click");
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
    byText(view, "button", "研究与下一步").fire("click");
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
