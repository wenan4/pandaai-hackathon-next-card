import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCalibrationDemo } from "./calibration-demo";
import { reduceRun } from "./engine";
import { loadMarketInitial, loadMarketStage, resetMarketCacheForTest, type MarketManifest } from "./market";
import { emptyResearchProfile, fundingScenarioFromRun, setHelpPreference, showHistoryEvidence, simulateFundingPlan, startHistory, type ResearchProfile } from "./research";
import type { ResearchMarketCase } from "./market";
import type { Run } from "./types";
import { hasSeenRelatedCase } from "./ui-case";
import { ResearchUI } from "./ui-research";

class FakeNode {
  children: (FakeNode | string)[] = [];
  parent: FakeNode | null = null;
  root = false;
  append(...items: (FakeNode | string)[]): void { for (const item of items) { if (item instanceof FakeNode) item.parent = this; this.children.push(item); } }
  replaceChildren(...items: (FakeNode | string)[]): void { for (const child of this.children) if (child instanceof FakeNode) child.parent = null; this.children = []; this.append(...items); }
  get isConnected(): boolean { return this.root || !!this.parent?.isConnected; }
  get textContent(): string { return this.children.map((child) => typeof child === "string" ? child : child.textContent).join(""); }
}
class FakeElement extends FakeNode {
  attributes: Record<string, string> = {};
  listeners: Record<string, (event: { currentTarget: FakeElement }) => void> = {};
  value = "";
  constructor(readonly tag: string) { super(); }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  addEventListener(name: string, listener: (event: { currentTarget: FakeElement }) => void): void { this.listeners[name] = listener; }
  fire(name: string): void { this.listeners[name]?.({ currentTarget: this }); }
  closest(selector: string): FakeElement | null {
    for (let node: FakeNode | null = this; node; node = node.parent) if (node instanceof FakeElement && selector === "[inert]" && "inert" in node.attributes) return node;
    return null;
  }
}
function find(node: FakeNode, match: (item: FakeElement) => boolean): FakeElement | undefined {
  if (node instanceof FakeElement && match(node)) return node;
  for (const child of node.children) if (child instanceof FakeNode) { const found = find(child, match); if (found) return found; }
  return undefined;
}
function buttonAt(node: FakeNode, text: string): FakeElement {
  const element = find(node, (item) => item.tag === "button" && item.textContent === text);
  if (!element) throw new Error(`button not found: ${text}`);
  return element;
}
function selectAt(node: FakeNode, label: string): FakeElement {
  const container = find(node, (item) => item.tag === "label" && item.textContent.startsWith(label));
  const select = container && find(container, (item) => item.tag === "select");
  if (!select) throw new Error(`select not found: ${label}`);
  return select;
}
function change(node: FakeElement, value: string): void { node.value = value; node.fire("change"); }
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

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

async function fixture(): Promise<{ run: Run; manifest: MarketManifest }> {
  let run = await makeCalibrationDemo();
  run = reduceRun(run, { type: "submit-redemption", percent: 0 });
  run = reduceRun(run, { type: "apply-quote", quote: await loadMarketStage(run.caseId, "t1-exec", true) });
  run = reduceRun(run, { type: "buy-archive" });
  run.source = "real";
  return { run, manifest: await loadMarketInitial() };
}
function harness(run: Run, manifest: MarketManifest, initial: ResearchProfile, seen = new Set<string>()) {
  let profile = initial; let section: "D1" | "D2" = "D1"; let inert = false; let id = 0; let currentManifest: MarketManifest | null = manifest; let loading = false; let error: string | null = null;
  const retryManifest = vi.fn();
  const root = new FakeElement("root"); root.root = true;
  const render = (): void => {
    const content = (section === "D1" ? ui.renderFunding() : ui.renderHistory()) as unknown as FakeElement;
    if (inert) content.setAttribute("inert", "");
    root.replaceChildren(content);
  };
  const ui = new ResearchUI({ getRun: () => run, getProfile: () => profile, setProfile: (value) => { profile = value; render(); }, getManifest: () => currentManifest, retryManifest, manifestLoading: () => loading, manifestError: () => error,
    back: vi.fn(), openTask: (task) => { ui.leave(); section = task; render(); }, refresh: render, notify: (message) => { throw new Error(message); }, uid: (prefix) => `${prefix}-${++id}`,
    isCaseKnown: () => false, wasCaseSeen: (caseId) => hasSeenRelatedCase(seen, caseId), markCaseSeen: (caseId) => { seen.add(caseId); } });
  return { root, ui, render, retryManifest, get profile() { return profile; }, set profile(value: ResearchProfile) { profile = value; }, set section(value: "D1" | "D2") { section = value; }, set inert(value: boolean) { inert = value; }, set manifest(value: MarketManifest | null) { currentManifest = value; }, set loading(value: boolean) { loading = value; }, set error(value: string | null) { error = value; }, seen };
}

describe("research UI help and next steps", () => {
  it("retries a missing case catalogue without mistaking it for exhausted cases", async () => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, emptyResearchProfile());
    state.manifest = null; state.error = "网络不可用。"; state.section = "D2"; state.render();
    expect(state.root.textContent).toContain("案例目录加载失败");
    expect(state.root.textContent).not.toContain("目前没有可用的未见片段");
    buttonAt(state.root, "重新加载案例目录").fire("click");
    expect(state.retryManifest).toHaveBeenCalledOnce();
    expect(state.profile.research_process).toHaveLength(0);
    state.loading = true; state.error = null; state.render();
    expect(buttonAt(state.root, "正在加载案例目录…").attributes.disabled).toBe("");
    state.loading = false; state.manifest = manifest; state.render();
    expect(buttonAt(state.root, "锁定并查看同期资料").attributes.disabled).toBeUndefined();
    expect(state.profile.research_process).toHaveLength(0);
  });
  it("continues a locked task when the catalogue is missing and restores the second-case choice after recovery", async () => {
    const { run, manifest } = await fixture();
    const schedule = { startingCashCents: 7200, participationCents: 2000, t1: 0 as const, t2: 0 as const };
    let profile = startHistory(emptyResearchProfile(), { id: "old-pending", caseId: "lantern-a", questionVersion: "d2-v1", schedule, initialClaim: "unknown", priorExposure: false });
    const state = harness(run, manifest, profile);
    state.manifest = null; state.section = "D2"; state.render();
    expect(state.root.textContent).toContain("继续已锁定的历史研究");
    buttonAt(state.root, "继续加载已锁定资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process[0]?.shown).not.toBeNull());
    expect(state.profile.research_process[0]?.priorExposure).toBe(false);
    state.manifest = manifest; state.render();
    expect(buttonAt(state.root, "再查看另一段历史（未见）")).toBeDefined();
    // Re-entering an already shown pending task retains the original pre-display exposure.
    const primary = JSON.parse(await readFile("public/data/adventure/research/lantern-a.json", "utf8")) as ResearchMarketCase;
    profile = showHistoryEvidence(startHistory(emptyResearchProfile(), { id: "shown-pending", caseId: "lantern-a", questionVersion: "d2-v1", schedule, initialClaim: "unknown", priorExposure: false }), "shown-pending", primary);
    const shown = harness(run, manifest, profile); shown.manifest = null; shown.section = "D2"; shown.render();
    shown.manifest = manifest; shown.render();
    expect(buttonAt(shown.root, "再查看另一段历史（未见）")).toBeDefined();
    expect(shown.profile.research_process[0]?.priorExposure).toBe(false);
  });
  it("does not submit the selected mode as exposed when the task is still behind a modal", async () => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, setHelpPreference(emptyResearchProfile(), "preferred", "step"));
    state.inert = true; state.render(); await flush();
    buttonAt(state.root, "可以支付").fire("click");
    buttonAt(state.root, "提交判断并保存计划").fire("click");
    expect(state.profile.funding_attempts.at(-1)?.help).toBe("self");
  });
  it("records explicit help only after it is visible and never erases it when switching to self", async () => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, setHelpPreference(emptyResearchProfile(), "preferred", "step"));
    state.inert = true; state.render(); await flush();
    expect(state.root.textContent).toContain("先找采购前的可用金币");
    expect(state.profile.funding_exposure).toHaveLength(0);
    state.inert = false; state.render(); await flush();
    expect(state.profile.funding_exposure).toHaveLength(1);
    expect(state.profile.funding_exposure[0]?.help).toBe("step");
    buttonAt(state.root, "自主尝试").fire("click"); await flush();
    expect(state.root.textContent).toContain("你的默认偏好：分步说明");
    expect(state.root.textContent).toContain("本次采用：自主尝试");
    expect(state.root.textContent).toContain("已经看过的帮助会保留在本题记录中");
    expect(state.profile.help_preference.at(-1)?.help).toBe("step");
    expect(state.profile.funding_exposure[0]?.help).toBe("step");
    buttonAt(state.root, "可以支付").fire("click");
    buttonAt(state.root, "提交判断并保存计划").fire("click");
    expect(state.profile.funding_attempts.at(-1)?.help).toBe("step");
    buttonAt(state.root, "继续 · 历史对照台").fire("click");
    expect(state.root.textContent).toContain("历史对照台");
  });

  it("prefers unseen unrelated cases, preserves exposure on return, and identifies review", async () => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, setHelpPreference(emptyResearchProfile(), "preferred", "hint"), new Set(["lantern-a"]));
    state.section = "D2"; state.render();
    expect(state.profile.research_process).toHaveLength(0);
    expect(state.root.textContent).not.toContain("先比较同日程下两项盈亏");
    expect(state.root.textContent).not.toContain("相关片段 · 当前旅程");
    buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process.at(-1)?.helpUsed).toBe("hint"));
    const attempt = state.profile.research_process.at(-1)!;
    expect(attempt.caseId).toBe("lantern-b");
    expect(attempt.priorExposure).toBe(false);
    expect(state.seen.has("lantern-b")).toBe(true);
    expect(find(state.root, (item) => item.tag === "option" && item.attributes.value === "lantern-b")?.textContent).toContain("未见");
    buttonAt(state.root, "再查看另一段历史（复习）").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process.at(-1)?.shown?.other).toBeDefined());
    expect(state.profile.research_process.at(-1)?.shown?.otherPriorExposure).toBe(true);
    buttonAt(state.root, "自主尝试").fire("click");
    state.ui.leave(); state.render(); await flush();
    expect(state.profile.research_process.at(-1)?.helpUsed).toBe("hint");
    expect(find(state.root, (item) => item.tag === "option" && item.attributes.value === "lantern-b")?.textContent).toContain("未见");
    expect(buttonAt(state.root, "自主尝试").attributes["aria-pressed"]).toBe("true");
    change(selectAt(state.root, "本案例结果相对同期基准"), attempt.shown!.primary.direction);
    const shown = state.profile.research_process.at(-1)!.shown!;
    const difference = shown.other!.asset.gainCents > shown.primary.asset.gainCents ? "outperform" : shown.other!.asset.gainCents < shown.primary.asset.gainCents ? "underperform" : "equal";
    change(selectAt(state.root, "另一段历史的结果相对第一段"), difference);
    change(selectAt(state.root, "这些结果能说明什么"), "only_samples");
    change(selectAt(state.root, "这次主要依据什么"), "根据同日期的数字比较");
    buttonAt(state.root, "提交这次研究").fire("click");
    expect(state.root.textContent).toContain("目前没有可用的未见片段");
    buttonAt(state.root, "复习已看过的片段").fire("click");
    buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process.at(-1)?.shown).not.toBeNull());
    expect(state.profile.research_process).toHaveLength(2);
    expect(state.profile.research_process.at(-1)?.priorExposure).toBe(true);
    expect(state.profile.research_process.at(-1)?.id).not.toBe(attempt.id);
  });

  it("offers an actually unseen next primary after completing one case", async () => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, emptyResearchProfile());
    state.section = "D2"; state.render();
    expect(buttonAt(state.root, "自主尝试").attributes["aria-pressed"]).toBe("true");
    buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process.at(-1)?.shown).not.toBeNull());
    const attempt = state.profile.research_process.at(-1)!;
    expect(attempt.caseId).toBe("lantern-a");
    expect(attempt.helpUsed).toBe("self");
    change(selectAt(state.root, "本案例结果相对同期基准"), attempt.shown!.primary.direction);
    change(selectAt(state.root, "这次主要依据什么"), "根据同日期的数字比较");
    buttonAt(state.root, "提交这次研究").fire("click");
    expect(find(state.root, (item) => item.tag === "button" && item.textContent.startsWith("再查看另一段历史"))).toBeUndefined();
    expect(state.root.textContent).toContain("本题资料已固定");
    buttonAt(state.root, "继续 · 未见历史片段").fire("click");
    buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process.at(-1)?.shown).not.toBeNull());
    expect(state.profile.research_process).toHaveLength(2);
    expect(state.profile.research_process.at(-1)).toMatchObject({ caseId: "lantern-b", priorExposure: false });
  });

  it("describes actual available resources and compares recommendation snapshots on submission", async () => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, emptyResearchProfile(), new Set(["lantern-a", "lantern-b"]));
    state.render();
    expect(state.root.textContent).toContain("可用本局已发生的资金与采购日程");
    buttonAt(state.root, "可以支付").fire("click");
    buttonAt(state.root, "提交判断并保存计划").fire("click");
    expect(state.root.textContent).toContain("目前可选历史片段均标为已见");
    expect(state.root.textContent).toContain("推荐为何变化或维持");
    expect(state.root.textContent).not.toContain("可以在新情境继续核对");
  });

  it("starts with an actual unaffordable purchase, preserves a manual choice, and falls back only when unreachable", async () => {
    const fixtureState = await fixture(); let run = fixtureState.run;
    const upgrade = run.deck.find((card) => card.cardId === "C07")!;
    const later = run.deck.find((card) => card.cardId === "C01" && !card.upgraded)!;
    run = reduceRun(run, { type: "upgrade-card", cardInstanceId: upgrade.instanceId });
    run = reduceRun(run, { type: "purchase-attempted", purchase: "upgrade-card", cardInstanceId: later.instanceId });
    const state = harness(run, fixtureState.manifest, emptyResearchProfile()); state.render();
    let select = selectAt(state.root, "选择要核查的采购");
    const selected = find(select, (item) => item.tag === "option" && "selected" in item.attributes)!;
    expect(selected.textContent).toContain("原局尝试但未支付的采购");
    const first = find(select, (item) => item.tag === "option" && item.textContent.includes("实际采购"))!;
    change(select, first.attributes.value!);
    select = selectAt(state.root, "选择要核查的采购");
    expect(find(select, (item) => item.tag === "option" && "selected" in item.attributes)?.attributes.value).toBe(first.attributes.value);
    const attempted = find(select, (item) => item.tag === "option" && item.textContent.includes("原局尝试但未支付"))!;
    change(select, attempted.attributes.value!);
    const moneyLabel = find(state.root, (item) => item.tag === "label" && item.textContent.startsWith("试算的参与金额"))!;
    const money = find(moneyLabel, (item) => item.tag === "input")!;
    change(money, "1000");
    select = selectAt(state.root, "选择要核查的采购");
    const derived = fundingScenarioFromRun(run)!;
    const unpaid = simulateFundingPlan(derived.scenario, { ...derived.plan, participationCents: derived.scenario.startingCashCents }).rows.find((row) => row.canPay === false)!;
    expect(find(select, (item) => item.tag === "option" && "selected" in item.attributes)?.attributes.value).toBe(unpaid.id);
    expect(unpaid.id).not.toBe(attempted.attributes.value);
  });

  it("does not submit while another historical fragment is still loading", async () => {
    const { run, manifest } = await fixture();
    const realFetch = globalThis.fetch;
    let release: () => void = () => { throw new Error("load gate not installed"); };
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
      if (path.endsWith("/research/lantern-b.json")) await gate;
      return realFetch(input);
    });
    const state = harness(run, manifest, emptyResearchProfile());
    state.section = "D2"; state.render();
    buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process.at(-1)?.shown).not.toBeNull());
    const attempt = state.profile.research_process.at(-1)!;
    change(selectAt(state.root, "本案例结果相对同期基准"), attempt.shown!.primary.direction);
    change(selectAt(state.root, "这次主要依据什么"), "根据同日期的数字比较");
    buttonAt(state.root, "再查看另一段历史（未见）").fire("click");
    expect(buttonAt(state.root, "提交这次研究").attributes.disabled).toBe("");
    buttonAt(state.root, "提交这次研究").fire("click");
    expect(state.profile.research_process.at(-1)?.submitted).toBe(false);
    release();
    await vi.waitFor(() => expect(state.profile.research_process.at(-1)?.shown?.other).toBeDefined());
  });

  it("allows help in play-only practice without recording an observation", async () => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, emptyResearchProfile(false));
    state.render(); buttonAt(state.root, "分步说明").fire("click"); await flush();
    expect(state.root.textContent).toContain("先找采购前的可用金币");
    buttonAt(state.root, "可以支付").fire("click");
    buttonAt(state.root, "提交判断并保存计划").fire("click");
    expect(state.profile.funding_exposure).toHaveLength(0);
    expect(state.profile.funding_attempts).toHaveLength(0);
    state.ui.leave(); state.render();
    expect(buttonAt(state.root, "自主尝试").attributes["aria-pressed"]).toBe("true");
  });
});
