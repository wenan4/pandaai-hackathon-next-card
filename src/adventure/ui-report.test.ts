import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCalibrationDemo } from "./calibration-demo";
import { reduceRun } from "./engine";
import { gameplayHighlights } from "./gameplay-highlights";
import { loadMarketInitial, loadMarketStage, resetMarketCacheForTest, type ResearchMarketCase } from "./market";
import { compareSchedule, declarePriorExposure, emptyResearchProfile, setResearchGoal, showHistoryEvidence, startHistory, submitHistory, updateJourney } from "./research";
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
