import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCalibrationDemo } from "./calibration-demo";
import { createRun, reduceRun } from "./engine";
import { loadMarketInitial, loadMarketStage, loadResearchCase, resetMarketCacheForTest, type MarketManifest } from "./market";
import { validateResearchProfile } from "./profile-validation";
import { compareSchedule, declarePriorExposure, emptyResearchProfile, fundingScenarioFromRun, markPendingHistoryExposure, setHelpPreference, setResearchGoal, showHistoryEvidence, simulateFundingPlan, startHistory, type ResearchProfile } from "./research";
import type { ResearchMarketCase } from "./market";
import type { CardId, Run } from "./types";
import { hasSeenRelatedCase } from "./ui-case";
import { coins } from "./ui-components";
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
  focused = false; scrolled = false;
  constructor(readonly tag: string) { super(); }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  addEventListener(name: string, listener: (event: { currentTarget: FakeElement }) => void): void { this.listeners[name] = listener; }
  fire(name: string): void { this.listeners[name]?.({ currentTarget: this }); }
  focus(): void { this.focused = true; }
  scrollIntoView(): void { this.scrolled = true; }
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
function visiblePage(node: FakeNode): string | undefined {
  return find(node, (item) => !!item.attributes["data-research-page"] && !("hidden" in item.attributes))?.attributes["data-research-page"];
}
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
async function earlyExitWithShares(): Promise<Run> {
  let run = createRun({ seed: 104, caseId: "lantern-a" });
  for (const step of ["C02", "C03", "C01", "end", "C01", "C04", "C02", "C02", "end", "C02", "end", "C01"] as (CardId | "end")[]) {
    if (step === "end") run = reduceRun(run, { type: "end-turn" });
    else {
      const card = run.deck.find((item) => item.cardId === step && run.battle?.hand.includes(item.instanceId));
      if (!card) throw new Error(`Missing card ${step}`);
      run = reduceRun(run, { type: "play-card", cardInstanceId: card.instanceId });
    }
  }
  run = reduceRun(run, { type: "choose-reward", cardId: null });
  run = reduceRun(run, { type: "submit-entry", amountCents: 2000 });
  run = reduceRun(run, { type: "continue" });
  run = reduceRun(run, { type: "apply-quote", quote: await loadMarketStage(run.caseId, "entry", true) });
  run = reduceRun(run, { type: "choose-route", enemyId: "pursuer" });
  while (run.status === "active") run = reduceRun(run, { type: "end-turn" });
  return run;
}
function harness(run: Run, manifest: MarketManifest, initial: ResearchProfile, seen = new Set<string>()) {
  let currentRun = run; let profile = initial; let section: "D1" | "D2" = "D1"; let inert = false; let hidden = false; let id = 0; let currentManifest: MarketManifest | null = manifest; let loading = false; let error: string | null = null;
  const retryManifest = vi.fn();
  const root = new FakeElement("root"); root.root = true;
  const casePresentations: { caseId: string; page: string | undefined }[] = [];
  const evidencePresentations: { part: "primary" | "other"; page: string | undefined }[] = [];
  const render = (): void => {
    const content = (section === "D1" ? ui.renderFunding() : ui.renderHistory()) as unknown as FakeElement;
    if (inert) content.setAttribute("inert", "");
    root.replaceChildren(content);
  };
  const ui = new ResearchUI({ getRun: () => currentRun, getProfile: () => profile, setProfile: (value) => {
    for (const next of value.research_process) {
      const previous = profile.research_process.find((attempt) => attempt.id === next.id);
      if (next.shown?.primary && !previous?.shown?.primary) evidencePresentations.push({ part: "primary", page: visiblePage(root) });
      if (next.shown?.other && !previous?.shown?.other) evidencePresentations.push({ part: "other", page: visiblePage(root) });
    }
    profile = value; render();
  }, getManifest: () => currentManifest, retryManifest, manifestLoading: () => loading, manifestError: () => error,
    back: vi.fn(), openTask: (task) => { ui.leave(); section = task; render(); }, refresh: render, canPresentData: (task) => section === task && !inert && !hidden, notify: (message) => { throw new Error(message); }, uid: (prefix) => `${prefix}-${++id}`,
    isCaseKnown: () => false, wasCaseSeen: (caseId) => hasSeenRelatedCase(seen, caseId), markCaseSeen: (caseId, excludeAttemptId) => { casePresentations.push({ caseId, page: visiblePage(root) }); seen.add(caseId); profile = markPendingHistoryExposure(profile, caseId, excludeAttemptId); } });
  return { root, ui, render, retryManifest, casePresentations, evidencePresentations, get profile() { return profile; }, set profile(value: ResearchProfile) { profile = value; }, set run(value: Run) { currentRun = value; }, set section(value: "D1" | "D2") { section = value; }, set inert(value: boolean) { inert = value; }, set hidden(value: boolean) { hidden = value; }, set manifest(value: MarketManifest | null) { currentManifest = value; }, set loading(value: boolean) { loading = value; }, set error(value: string | null) { error = value; }, seen };
}

async function delayedCase(caseId: string): Promise<{ requested: ReturnType<typeof vi.fn>; decoded: ReturnType<typeof vi.fn>; release: () => void }> {
  const body = await readFile(`public/data/adventure/research/${caseId}.json`, "utf8");
  const original = globalThis.fetch;
  let release: () => void = () => { throw new Error("load gate not installed"); };
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requested = vi.fn(); const decoded = vi.fn();
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
    if (!path.endsWith(`/research/${caseId}.json`)) return original(input);
    requested(); await gate;
    const response = new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
    const originalJson = response.json.bind(response);
    response.json = async () => { const data = await originalJson(); decoded(); return data; };
    return response;
  });
  return { requested, decoded, release };
}
async function completePrimaryHistory(state: ReturnType<typeof harness>): Promise<void> {
  state.section = "D2"; state.render(); buttonAt(state.root, "锁定并查看同期资料").fire("click");
  await vi.waitFor(() => expect(state.root.textContent).toContain("本案例结果相对同期基准"));
  buttonAt(state.root, "作答").fire("click");
  change(selectAt(state.root, "本案例结果相对同期基准"), "equal");
  change(selectAt(state.root, "这次主要依据什么"), "根据同日期的数字比较");
  buttonAt(state.root, "提交这次研究").fire("click");
}

describe("research UI help and next steps", () => {
  it("labels recorded market stages in plain language without changing the underlying journey", async () => {
    const { run, manifest } = await fixture(); const before = JSON.stringify(run);
    const state = harness(run, manifest, emptyResearchProfile()); state.render();
    expect(state.root.textContent).toContain("第一段回收时");
    expect(state.root.textContent).not.toContain("实际执行：t1-exec");
    state.ui.leave(); state.section = "D2"; state.render();
    buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process.at(-1)?.shown).not.toBeNull());
    expect(state.root.textContent).toContain("第一段回收时");
    expect(state.root.textContent).toContain("第二段回收时");
    expect(state.root.textContent).not.toContain("t1-exec");
    expect(state.root.textContent).not.toContain("t2-exec");
    expect(JSON.stringify(run)).toBe(before);
  });

  it("moves focus to the active step when navigating between research pages", async () => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, emptyResearchProfile()); state.render();
    buttonAt(state.root, "下一步：判断采购").fire("click");
    expect(visiblePage(state.root)).toBe("d1-question");
    expect(buttonAt(state.root, "判断").attributes["aria-pressed"]).toBe("true");
    expect(buttonAt(state.root, "判断").focused).toBe(true);
  });

  it("focuses the revised D1 amount for a current funding goal without erasing the submitted result", async () => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, setResearchGoal(emptyResearchProfile(), "goal", "funding")); state.render();
    buttonAt(state.root, "可以支付").fire("click"); buttonAt(state.root, "提交判断并保存计划").fire("click");
    const result = find(state.root, (item) => item.attributes.id === "research-d1-result")!;
    const edit = buttonAt(result, "调整这份计划");
    expect(edit.attributes.class).toContain("gold"); expect(buttonAt(result, "继续 · 历史对照台").attributes.class).toContain("secondary");
    expect(result.textContent).toContain("可在本局旅程报告中回看最近一次资金核查");
    const before = JSON.stringify(state.profile); edit.fire("click");
    const input = find(state.root, (item) => item.attributes["data-focus-key"] === "funding-revised-amount")!;
    expect(input.focused).toBe(true); expect(input.scrolled).toBe(true); expect(JSON.stringify(state.profile)).toBe(before);
    expect(state.root.textContent).toContain("这次核查的结果");
    change(input, input.attributes.value!); expect(state.root.textContent).toContain("这次核查的结果");
    const changed = Number(input.attributes.value) === 0 ? "1" : "0"; change(input, changed);
    expect(state.root.textContent).not.toContain("这次核查的结果"); expect(JSON.stringify(state.profile)).toBe(before);
    expect(state.profile.funding_attempts).toHaveLength(1); expect(state.profile.funding_exposure.some((item) => item.answerExposed)).toBe(true);
  });

  it("updates D1 result actions when the current goal changes and opens the recommended D2", async () => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, setResearchGoal(emptyResearchProfile(), "goal-1", "funding")); state.render();
    buttonAt(state.root, "可以支付").fire("click"); buttonAt(state.root, "提交判断并保存计划").fire("click");
    state.profile = setHelpPreference(setResearchGoal(state.profile, "goal-2", "history"), "help-2", "step"); state.render();
    const result = find(state.root, (item) => item.attributes.id === "research-d1-result")!;
    expect(result.textContent).toContain("当前建议：历史对照台");
    expect(result.textContent).toContain("当前帮助建议");
    expect(buttonAt(result, "继续 · 历史对照台").attributes.class).toContain("gold");
    expect(buttonAt(result, "调整这份计划").attributes.class).toContain("secondary");
    buttonAt(result, "继续 · 历史对照台").fire("click");
    expect(state.root.textContent).toContain("历史对照台"); expect(state.profile.funding_attempts).toHaveLength(1);
  });

  it("prioritizes switching to D1 from a D2 result when the current goal requests funding", async () => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, setResearchGoal(emptyResearchProfile(), "goal", "funding"));
    await completePrimaryHistory(state);
    const result = find(state.root, (item) => item.attributes.id === "research-d2-result")!;
    expect(result.textContent).toContain("当前建议：资金安排台");
    expect(buttonAt(result, "切换 · 资金安排台").attributes.class).toContain("gold");
    expect(buttonAt(result, "继续 · 未见历史片段").attributes.class).toContain("secondary");
    buttonAt(result, "切换 · 资金安排台").fire("click");
    expect(state.root.textContent).toContain("资金安排台"); expect(state.profile.research_process.filter((item) => item.submitted)).toHaveLength(1);
  });

  it("continues the next genuinely unseen D2 case for a history goal and brings it into view", async () => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, setResearchGoal(emptyResearchProfile(), "goal", "history"));
    await completePrimaryHistory(state);
    const result = find(state.root, (item) => item.attributes.id === "research-d2-result")!;
    expect(buttonAt(result, "继续 · 未见历史片段").attributes.class).toContain("gold");
    const attempts = state.profile.research_process.length;
    buttonAt(result, "继续 · 未见历史片段").fire("click");
    expect(state.profile.research_process).toHaveLength(attempts);
    const start = find(state.root, (item) => item.attributes["data-focus-key"] === "history-task-start")!;
    expect(start.focused).toBe(true); expect(start.scrolled).toBe(true);
    expect(find(selectAt(state.root, "查看的历史片段"), (item) => item.tag === "option" && "selected" in item.attributes)?.attributes.value).toBe("lantern-b");
    buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process.at(-1)?.shown).not.toBeNull());
    expect(state.profile.research_process.at(-1)).toMatchObject({ caseId: "lantern-b", priorExposure: false });
  });

  it("labels an exhausted D2 history as review and keeps its prior exposure", async () => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, setResearchGoal(emptyResearchProfile(), "goal", "history"), new Set(["lantern-a", "lantern-b"]));
    await completePrimaryHistory(state);
    const result = find(state.root, (item) => item.attributes.id === "research-d2-result")!;
    expect(buttonAt(result, "复习已看过的片段").attributes.class).toContain("gold");
    expect(result.textContent).not.toContain("继续 · 未见历史片段");
    buttonAt(result, "复习已看过的片段").fire("click");
    const selected = find(selectAt(state.root, "查看的历史片段"), (item) => item.tag === "option" && "selected" in item.attributes)!;
    expect(selected.textContent).toContain("已看过 · 复习");
    buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process.at(-1)?.shown).not.toBeNull());
    expect(state.profile.research_process.at(-1)?.priorExposure).toBe(true);
  });

  it("resumes an existing locked D2 attempt without creating a new one, even with no catalogue", async () => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, setResearchGoal(emptyResearchProfile(), "goal", "history"));
    state.section = "D2"; state.render(); buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process.at(-1)?.shown).not.toBeNull());
    const schedule = { startingCashCents: 7200, participationCents: 2000, t1: 0 as const, t2: 0 as const };
    state.profile = startHistory(state.profile, { id: "already-locked", caseId: "lantern-b", questionVersion: "d2-v1", schedule, initialClaim: "unknown", priorExposure: false }); state.render();
    change(selectAt(state.root, "本案例结果相对同期基准"), "equal"); change(selectAt(state.root, "这次主要依据什么"), "根据同日期的数字比较");
    buttonAt(state.root, "提交这次研究").fire("click"); state.manifest = null; state.error = "网络不可用"; state.render();
    const result = find(state.root, (item) => item.attributes.id === "research-d2-result")!;
    expect(buttonAt(result, "继续已锁定的历史研究").attributes.class).toContain("gold");
    buttonAt(result, "继续已锁定的历史研究").fire("click");
    expect(state.profile.research_process).toHaveLength(2); expect(state.profile.research_process.at(-1)).toMatchObject({ id: "already-locked", submitted: false });
    expect(buttonAt(state.root, "继续加载已锁定资料")).toBeDefined();
    expect(find(state.root, (item) => item.attributes["data-focus-key"] === "history-task-start")?.scrolled).toBe(true);
  });

  it("opens the existing locked history attempt from a D1 result without creating another", async () => {
    const { run, manifest } = await fixture();
    const schedule = { startingCashCents: 7200, participationCents: 2000, t1: 0 as const, t2: 0 as const };
    const profile = startHistory(setResearchGoal(emptyResearchProfile(), "goal", "history"), { id: "locked-from-funding", caseId: "lantern-a", questionVersion: "d2-v1", schedule, initialClaim: "unknown", priorExposure: false });
    const state = harness(run, manifest, profile); state.render();
    buttonAt(state.root, "可以支付").fire("click"); buttonAt(state.root, "提交判断并保存计划").fire("click");
    const result = find(state.root, (item) => item.attributes.id === "research-d1-result")!;
    expect(buttonAt(result, "继续 · 已锁定历史研究").attributes.class).toContain("gold");
    buttonAt(result, "继续 · 已锁定历史研究").fire("click");
    expect(state.profile.research_process).toHaveLength(1); expect(state.profile.research_process[0]).toMatchObject({ id: "locked-from-funding", submitted: false });
    expect(buttonAt(state.root, "继续加载已锁定资料")).toBeDefined();
    buttonAt(state.root, "继续加载已锁定资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process[0]?.shown).not.toBeNull());
    expect(state.profile.research_process).toHaveLength(1);
  });

  it("offers a working catalogue retry from a D2 result without inventing a new case", async () => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, setResearchGoal(emptyResearchProfile(), "goal", "history"));
    await completePrimaryHistory(state); state.manifest = null; state.error = "网络不可用"; state.render();
    const result = find(state.root, (item) => item.attributes.id === "research-d2-result")!;
    expect(buttonAt(result, "重新加载案例目录").attributes.class).toContain("gold");
    buttonAt(result, "重新加载案例目录").fire("click"); expect(state.retryManifest).toHaveBeenCalledOnce();
    expect(state.profile.research_process).toHaveLength(1); expect(state.profile.research_process[0]?.submitted).toBe(true);
  });

  it("retries a missing recommended history catalogue and does not offer a dead end when no cases exist", async () => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, setResearchGoal(emptyResearchProfile(), "goal", "history"));
    state.manifest = null; state.error = "网络不可用"; state.render();
    buttonAt(state.root, "可以支付").fire("click"); buttonAt(state.root, "提交判断并保存计划").fire("click");
    let result = find(state.root, (item) => item.attributes.id === "research-d1-result")!;
    expect(buttonAt(result, "重新加载案例目录").attributes.class).toContain("gold");
    buttonAt(result, "重新加载案例目录").fire("click"); expect(state.retryManifest).toHaveBeenCalledOnce();
    state.loading = true; state.render(); result = find(state.root, (item) => item.attributes.id === "research-d1-result")!;
    expect(buttonAt(result, "正在加载案例目录…").attributes.disabled).toBe("");
    state.loading = false; state.manifest = { ...manifest, cases: manifest.cases.filter((item) => item.caseId === run.caseId) }; state.render();
    result = find(state.root, (item) => item.attributes.id === "research-d1-result")!;
    expect(result.textContent).toContain("历史目录尚未准备好或没有可用片段");
    expect(find(result, (item) => item.tag === "button" && item.textContent.includes("历史对照台"))).toBeUndefined();
    expect(buttonAt(result, "调整这份计划").attributes.class).toContain("secondary");
  });

  it("uses equal self-chosen next steps and no persistence claims in play-only mode", async () => {
    const { run, manifest } = await fixture(); const state = harness(run, manifest, emptyResearchProfile(false)); state.render();
    expect(state.root.textContent).toContain("试试另一份计划"); expect(state.root.textContent).not.toContain("为自己保存另一份计划");
    buttonAt(state.root, "可以支付").fire("click"); buttonAt(state.root, "提交判断并查看核查").fire("click");
    const result = find(state.root, (item) => item.attributes.id === "research-d1-result")!;
    expect(result.textContent).toContain("接下来可以自行选择练习"); expect(result.textContent).not.toContain("当前建议");
    expect(result.textContent).not.toContain("推荐为何变化或维持"); expect(result.textContent).not.toContain("可在本局旅程报告中回看最近一次资金核查");
    expect(buttonAt(result, "调整这份计划").attributes.class).toContain("secondary");
    expect(buttonAt(result, "继续 · 历史对照台").attributes.class).toContain("secondary");
    expect(state.profile.funding_attempts).toHaveLength(0); expect(state.profile.knowledge_evidence).toHaveLength(0);
  });
  it.each([true, false])("invalidates a previous D1 result on a changed answer without erasing exposure (observation=%s)", async (enabled) => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, emptyResearchProfile(enabled));
    state.render();
    buttonAt(state.root, "可以支付").fire("click");
    buttonAt(state.root, enabled ? "提交判断并保存计划" : "提交判断并查看核查").fire("click");
    expect(state.root.textContent).toContain("这次核查的结果");
    expect(state.root.textContent).toContain("你选择：可以支付");
    const savedProfile = JSON.stringify(state.profile);
    buttonAt(state.root, "可以支付").fire("click");
    expect(state.root.textContent).toContain("这次核查的结果");
    buttonAt(state.root, "不能支付").fire("click");
    expect(state.root.textContent).not.toContain("这次核查的结果");
    expect(JSON.stringify(state.profile)).toBe(savedProfile);
    buttonAt(state.root, enabled ? "提交判断并保存计划" : "提交判断并查看核查").fire("click");
    expect(state.root.textContent).toContain("这次核查的结果");
    expect(state.root.textContent).toContain("你选择：不能支付");
    if (enabled) {
      expect(state.profile.funding_attempts).toHaveLength(2);
      expect(state.profile.funding_attempts[0]?.answer).toBe(true);
      expect(state.profile.funding_attempts[1]).toMatchObject({ answer: false, answerExposed: true });
      expect(state.profile.knowledge_evidence.at(-1)?.independent).toBe(false);
    } else {
      expect(state.profile.funding_attempts).toHaveLength(0);
      expect(state.profile.knowledge_evidence).toHaveLength(0);
    }
  });
  it.each([[true, "difference"], [false, "difference"], [true, "boundary"], [false, "boundary"]] as const)("keeps the D2 submitted answers distinct (observation=%s, wrong=%s)", async (enabled, wrong) => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, emptyResearchProfile(enabled));
    state.section = "D2"; state.render();
    expect(state.root.textContent).not.toContain("研究后的观察");
    buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(state.root.textContent).toContain("案例固定日程盈亏"));
    buttonAt(state.root, "再查看另一段历史（未见）").fire("click");
    await vi.waitFor(() => expect(state.root.textContent).toContain("另一段历史的结果相对第一段"));
    const entry = run.history.find((item) => item.action === "submit-entry")!;
    const cash = entry.snapshot!.cashCents; const invested = Number(entry.data.amountCents);
    const schedule = { startingCashCents: cash, participationCents: Math.min(cash, invested || 2000), t1: 0 as const, t2: 0 as const };
    const first = compareSchedule(await loadResearchCase("lantern-a", true), schedule);
    const second = compareSchedule(await loadResearchCase("lantern-b", true), schedule);
    const difference = second.asset.gainCents > first.asset.gainCents ? "outperform" : second.asset.gainCents < first.asset.gainCents ? "underperform" : "equal";
    const wrongDifference = difference === "equal" ? "outperform" : "equal";
    change(selectAt(state.root, "本案例结果相对同期基准"), first.direction);
    change(selectAt(state.root, "另一段历史的结果相对第一段"), wrong === "difference" ? wrongDifference : difference);
    change(selectAt(state.root, "这些结果能说明什么"), wrong === "boundary" ? "predicts_future" : "only_samples");
    change(selectAt(state.root, "这次主要依据什么"), "查看了不同片段的差异");
    buttonAt(state.root, "提交这次研究").fire("click");
    const result = find(state.root, (item) => item.tag === "section" && item.textContent.startsWith("研究后的观察"))!;
    const comparison = find(result, (item) => item.tag === "p" && item.textContent.startsWith("同期比较："))!;
    const differenceResult = find(result, (item) => item.tag === "p" && item.textContent.startsWith("两段比较："))!;
    const boundary = find(result, (item) => item.tag === "p" && item.textContent.startsWith("样本边界："))!;
    expect(comparison.textContent).toContain("这一步与数据一致");
    expect(differenceResult.textContent).toContain(wrong === "difference" ? "这一步需要再核查" : "这一步与数据一致");
    expect(boundary.textContent).toContain(wrong === "boundary" ? "这一步需要再核查" : "这一步与数据一致");
    expect(boundary.textContent).toContain(wrong === "boundary" ? "你选“说明未来必然得到相同结果”" : "你选“描述这两个样本，不能预测未来”");
    expect(result.textContent).not.toContain("本次判断与展示数据不一致");
    if (enabled) {
      expect(state.profile.knowledge_evidence.find((item) => item.dimension === "K1")?.correct).toBe(true);
      expect(state.profile.knowledge_evidence.find((item) => item.dimension === "K2")?.correct).toBe(false);
    } else expect(state.profile.knowledge_evidence).toHaveLength(0);
  });
  it.each([true, false])("does not present a second comparison when only the primary case was opened (observation=%s)", async (enabled) => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, emptyResearchProfile(enabled));
    state.section = "D2"; state.render();
    buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(state.root.textContent).toContain("本案例结果相对同期基准"));
    change(selectAt(state.root, "本案例结果相对同期基准"), "equal");
    change(selectAt(state.root, "这次主要依据什么"), "根据同日期的数字比较");
    expect(state.root.textContent).not.toContain("研究后的观察");
    buttonAt(state.root, "提交这次研究").fire("click");
    const result = find(state.root, (item) => item.tag === "section" && item.textContent.startsWith("研究后的观察"))!;
    const feedback = find(result, (item) => item.attributes.class === "notice")!;
    expect(feedback.textContent).toContain("同期比较：");
    expect(feedback.textContent).not.toContain("两段比较：");
    expect(feedback.textContent).not.toContain("样本边界：");
  });
  it.each([true, false])("reports the first blocked purchase in the revised D1 plan (observation=%s)", async (enabled) => {
    const fixtureState = await fixture(); let run = fixtureState.run;
    const upgrade = run.deck.find((card) => card.cardId === "C07")!;
    const later = run.deck.find((card) => card.cardId === "C01" && !card.upgraded)!;
    run = reduceRun(run, { type: "upgrade-card", cardInstanceId: upgrade.instanceId });
    run = reduceRun(run, { type: "purchase-attempted", purchase: "upgrade-card", cardInstanceId: later.instanceId });
    const derived = fundingScenarioFromRun(run)!;
    const revised = { ...derived.plan, participationCents: derived.scenario.startingCashCents };
    const blocked = simulateFundingPlan(derived.scenario, revised).rows.find((row) => row.canPay === false)!;
    expect(blocked).toBeDefined();
    const state = harness(run, fixtureState.manifest, emptyResearchProfile(enabled)); state.render();
    const selected = find(selectAt(state.root, "选择要核查的采购"), (item) => item.tag === "option" && "selected" in item.attributes)!;
    const field = find(state.root, (item) => item.tag === "label" && item.textContent.startsWith("调整后的参与金额"))!;
    change(find(field, (item) => item.tag === "input")!, String(derived.scenario.startingCashCents / 100));
    buttonAt(state.root, "不能支付").fire("click");
    buttonAt(state.root, enabled ? "提交判断并保存计划" : "提交判断并查看核查").fire("click");
    const result = find(state.root, (item) => item.tag === "section" && item.textContent.startsWith("这次核查的结果"))!;
    expect(result.textContent).toContain(`调整后的计划在“${blocked.label}”暂停`);
    expect(result.textContent).toContain(`需要 ${coins(blocked.amountCents)} 金币，采购前可用 ${coins(blocked.cashBeforeCents)} 金币，还差 ${coins(blocked.amountCents - blocked.cashBeforeCents)} 金币`);
    if (blocked.id !== selected.attributes.value) expect(result.textContent).toContain("调整后的计划尚未到达本次核查的采购");
  });
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
    state.render(); await flush();
    expect(visiblePage(state.root)).toBe("d1-plan");
    expect(state.profile.funding_exposure).toHaveLength(0);
    state.inert = true; buttonAt(state.root, "判断").fire("click"); await flush();
    expect(state.root.textContent).toContain("先找采购前的可用金币");
    expect(state.profile.funding_exposure).toHaveLength(0);
    state.inert = false; state.render(); await flush();
    expect(state.profile.funding_exposure).toHaveLength(1);
    expect(state.profile.funding_exposure[0]?.help).toBe("step");
    buttonAt(state.root, "自主尝试").fire("click"); await flush();
    expect(state.root.textContent).toContain("你的默认偏好：分步说明");
    expect(buttonAt(state.root, "自主尝试").attributes["aria-pressed"]).toBe("true");
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
    await vi.waitFor(() => expect(state.profile.research_process.at(-1)?.shown).not.toBeNull());
    expect(state.profile.research_process.at(-1)?.helpUsed).toBe("self");
    buttonAt(state.root, "作答").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process.at(-1)?.helpUsed).toBe("hint"));
    const attempt = state.profile.research_process.at(-1)!;
    expect(attempt.caseId).toBe("lantern-b");
    expect(attempt.priorExposure).toBe(false);
    expect(state.seen.has("lantern-b")).toBe(true);
    expect(find(state.root, (item) => item.tag === "option" && item.attributes.value === "lantern-b")?.textContent).toContain("未见");
    buttonAt(state.root, "案例").fire("click"); buttonAt(state.root, "再查看另一段历史（复习）").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process.at(-1)?.shown?.other).toBeDefined());
    expect(state.profile.research_process.at(-1)?.shown?.otherPriorExposure).toBe(true);
    buttonAt(state.root, "作答").fire("click"); buttonAt(state.root, "自主尝试").fire("click");
    state.ui.leave(); state.render(); await flush();
    expect(state.profile.research_process.at(-1)?.helpUsed).toBe("hint");
    expect(find(state.root, (item) => item.tag === "option" && item.attributes.value === "lantern-b")?.textContent).toContain("未见");
    buttonAt(state.root, "作答").fire("click");
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
    buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process.at(-1)?.shown).not.toBeNull());
    buttonAt(state.root, "作答").fire("click");
    expect(buttonAt(state.root, "自主尝试").attributes["aria-pressed"]).toBe("true");
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
    buttonAt(state.root, "提交判断并查看核查").fire("click");
    expect(state.profile.funding_exposure).toHaveLength(0);
    expect(state.profile.funding_attempts).toHaveLength(0);
    state.ui.leave(); state.render();
    expect(buttonAt(state.root, "自主尝试").attributes["aria-pressed"]).toBe("true");
  });
});

describe("research data presentation while backgrounded or obscured", () => {
  it("restores a locked task after a true external display and excludes its later result", async () => {
    const { run, manifest } = await fixture();
    const schedule = { startingCashCents: 7200, participationCents: 2000, t1: 0, t2: 0 } as const;
    let profile = startHistory(emptyResearchProfile(), { id: "locked-before-external", caseId: "lantern-a", questionVersion: "d2-v1", schedule, initialClaim: "underperform", priorExposure: false });
    profile = markPendingHistoryExposure(profile, "lantern-a");
    const restored = validateResearchProfile(JSON.parse(JSON.stringify(profile)), "real");
    if (!restored.ok) throw new Error(restored.reason);
    const state = harness(run, manifest, restored.profile, new Set(["lantern-a"]));
    state.section = "D2"; state.render();
    expect(state.root.textContent).toContain("锁题时未见 · 锁题后已在其他入口展示");
    buttonAt(state.root, "继续加载已锁定资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process[0]?.shown).not.toBeNull());
    const attempt = state.profile.research_process[0]!;
    expect(attempt).toMatchObject({ id: "locked-before-external", schedule, initialClaim: "underperform", priorExposure: false, exposedCaseIdsAfterLock: ["lantern-a"] });
    change(selectAt(state.root, "本案例结果相对同期基准"), attempt.shown!.primary.direction);
    change(selectAt(state.root, "这次主要依据什么"), "根据同日期的数字比较");
    buttonAt(state.root, "提交这次研究").fire("click");
    expect(state.profile.knowledge_evidence.find((item) => item.dimension === "K1")).toMatchObject({ priorExposure: false, counted: false, independent: false, exclusion_reason: expect.stringContaining("锁题后在其他入口展示") });
    expect(state.root.textContent).toContain("锁题后在其他入口展示过相关资料");
  });

  it("uses recorded post-lock displays for a later second case even if the global seen set is unavailable", async () => {
    const { run, manifest } = await fixture();
    const schedule = { startingCashCents: 7200, participationCents: 2000, t1: 0, t2: 0 } as const;
    let profile = startHistory(emptyResearchProfile(), { id: "secondary-later", caseId: "lantern-a", questionVersion: "d2-v1", schedule, initialClaim: "unknown", priorExposure: false });
    profile = markPendingHistoryExposure(profile, "lantern-b");
    const restored = validateResearchProfile(JSON.parse(JSON.stringify(profile)), "real");
    if (!restored.ok) throw new Error(restored.reason);
    const state = harness(run, manifest, restored.profile); // No persisted seen-case key.
    state.section = "D2"; state.render();
    buttonAt(state.root, "继续加载已锁定资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process[0]?.shown).not.toBeNull());
    expect(state.profile.research_process[0]?.exposedCaseIdsAfterLock).toEqual(["lantern-b"]);
    buttonAt(state.root, "再查看另一段历史（复习）").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process[0]?.shown?.other).toBeDefined());
    const shown = state.profile.research_process[0]!.shown!;
    expect(shown.otherPriorExposure).toBe(true);
    change(selectAt(state.root, "本案例结果相对同期基准"), shown.primary.direction);
    const difference = shown.other!.asset.gainCents > shown.primary.asset.gainCents ? "outperform" : shown.other!.asset.gainCents < shown.primary.asset.gainCents ? "underperform" : "equal";
    change(selectAt(state.root, "另一段历史的结果相对第一段"), difference);
    change(selectAt(state.root, "这些结果能说明什么"), "only_samples");
    change(selectAt(state.root, "这次主要依据什么"), "查看了不同片段的差异");
    buttonAt(state.root, "提交这次研究").fire("click");
    expect(state.profile.knowledge_evidence.find((item) => item.dimension === "K1")).toMatchObject({ counted: true, independent: true });
    expect(state.profile.knowledge_evidence.find((item) => item.dimension === "K2")).toMatchObject({ counted: false, independent: false, exclusion_reason: expect.stringContaining("其他入口") });
  });

  it("does not record the task's own first display as external exposure", async () => {
    const { run, manifest } = await fixture(); const state = harness(run, manifest, emptyResearchProfile());
    state.section = "D2"; state.render(); buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process[0]?.shown).not.toBeNull());
    const attempt = state.profile.research_process[0]!;
    expect(attempt.exposedCaseIdsAfterLock).toBeUndefined();
    change(selectAt(state.root, "本案例结果相对同期基准"), attempt.shown!.primary.direction);
    change(selectAt(state.root, "这次主要依据什么"), "根据同日期的数字比较");
    buttonAt(state.root, "提交这次研究").fire("click");
    expect(state.profile.knowledge_evidence.find((item) => item.dimension === "K1")).toMatchObject({ counted: true, independent: true });
  });

  it("holds an old locked current case until the outstanding settlement completes", async () => {
    const pending = await earlyExitWithShares();
    const manifest = await loadMarketInitial();
    const schedule = { startingCashCents: 7200, participationCents: 2000, t1: 0, t2: 0 } as const;
    const profile = startHistory(emptyResearchProfile(), { id: "legacy-locked", caseId: pending.caseId, questionVersion: "d2-v1", schedule, initialClaim: "underperform", priorExposure: false });
    const state = harness(pending, manifest, profile);
    const fetchSpy = vi.fn(globalThis.fetch); vi.stubGlobal("fetch", fetchSpy);
    state.section = "D2"; state.render(); await flush();
    expect(state.root.textContent).toContain("历史对照台暂时等待结算");
    expect(state.root.textContent).not.toContain("案例固定日程盈亏");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.profile.research_process[0]).toMatchObject({ id: "legacy-locked", schedule, initialClaim: "underperform", priorExposure: false, shown: null });
    const settled = reduceRun(pending, { type: "apply-quote", quote: await loadMarketStage(pending.caseId, "exit-after-entry", true) });
    state.ui.leave(); state.run = settled; state.render();
    buttonAt(state.root, "继续加载已锁定资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process[0]?.shown).not.toBeNull());
    expect(state.profile.research_process[0]).toMatchObject({ id: "legacy-locked", schedule, initialClaim: "underperform", priorExposure: false });
  });

  it("keeps an unrelated saved primary visible, but hides a saved related secondary until settlement", async () => {
    const pending = await earlyExitWithShares(); const manifest = await loadMarketInitial();
    const primary = JSON.parse(await readFile("public/data/adventure/research/lantern-b.json", "utf8")) as ResearchMarketCase;
    const other = JSON.parse(await readFile("public/data/adventure/research/lantern-a.json", "utf8")) as ResearchMarketCase;
    const schedule = { startingCashCents: 7200, participationCents: 2000, t1: 0, t2: 0 } as const;
    let profile = startHistory(emptyResearchProfile(), { id: "legacy-pair", caseId: "lantern-b", questionVersion: "d2-v1", schedule, initialClaim: "unknown", priorExposure: false });
    profile = showHistoryEvidence(profile, "legacy-pair", primary, other);
    const state = harness(pending, manifest, profile);
    state.section = "D2"; state.render();
    expect(state.root.textContent).toContain("历史对照台暂时等待结算");
    expect(state.root.textContent).toContain(primary.title);
    expect(state.root.textContent).not.toContain(other.title);
    expect(state.profile.research_process[0]?.shown?.other?.caseId).toBe("lantern-a");
    const settled = reduceRun(pending, { type: "apply-quote", quote: await loadMarketStage(pending.caseId, "exit-after-entry", true) });
    state.ui.leave(); state.run = settled; state.render();
    expect(state.root.textContent).toContain(other.title);
  });

  it("treats a real early execution as seen when it is the second comparison case", async () => {
    let run = await earlyExitWithShares();
    run = reduceRun(run, { type: "apply-quote", quote: await loadMarketStage(run.caseId, "exit-after-entry", true) });
    expect(run.phase).toBe("ended");
    const all = await loadMarketInitial();
    const manifest = { ...all, cases: all.cases.filter((item) => item.caseId === "lantern-a" || item.caseId === "lantern-b") };
    const state = harness(run, manifest, emptyResearchProfile());
    state.section = "D2"; state.render(); buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process[0]?.shown).not.toBeNull());
    expect(state.profile.research_process[0]).toMatchObject({ caseId: "lantern-b", priorExposure: false });
    buttonAt(state.root, "再查看另一段历史（复习）").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process[0]?.shown?.other).toBeDefined());
    const attempt = state.profile.research_process[0]!;
    expect(attempt.shown?.other?.caseId).toBe("lantern-a");
    expect(attempt.shown?.otherPriorExposure).toBe(true);
    change(selectAt(state.root, "本案例结果相对同期基准"), attempt.shown!.primary.direction);
    const shown = attempt.shown!;
    const difference = shown.other!.asset.gainCents > shown.primary.asset.gainCents ? "outperform" : shown.other!.asset.gainCents < shown.primary.asset.gainCents ? "underperform" : "equal";
    change(selectAt(state.root, "另一段历史的结果相对第一段"), difference);
    change(selectAt(state.root, "这些结果能说明什么"), "only_samples");
    change(selectAt(state.root, "这次主要依据什么"), "查看了不同片段的差异");
    buttonAt(state.root, "提交这次研究").fire("click");
    expect(state.profile.knowledge_evidence.find((item) => item.dimension === "K1")).toMatchObject({ priorExposure: false, counted: true });
    expect(state.profile.knowledge_evidence.find((item) => item.dimension === "K2")).toMatchObject({ priorExposure: true, counted: false });
  });

  it.each(["modal", "background"] as const)("reveals a locked primary once after %s becomes visible", async (obstacle) => {
    const { run, manifest } = await fixture();
    const gate = await delayedCase("lantern-a");
    const state = harness(run, manifest, setHelpPreference(emptyResearchProfile(), "help", "step"));
    state.section = "D2"; state.render();
    change(selectAt(state.root, "初步判断"), "underperform");
    buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(gate.requested).toHaveBeenCalledOnce());
    const locked = structuredClone(state.profile.research_process[0]!);
    expect(locked).toMatchObject({ initialClaim: "underperform", priorExposure: false, shown: null });
    if (obstacle === "modal") state.inert = true; else state.hidden = true;
    state.render(); gate.release();
    await vi.waitFor(() => expect(gate.decoded).toHaveBeenCalledOnce()); await flush();
    state.ui.resumePendingPresentation(); await flush();
    expect(state.root.textContent).not.toContain("案例固定日程盈亏");
    expect(state.profile.research_process[0]?.shown).toBeNull();
    expect(state.profile.research_process[0]?.helpUsed).toBe("self");
    expect(state.seen.has("lantern-a")).toBe(false);

    state.inert = false; state.hidden = false; state.render(); state.ui.resumePendingPresentation();
    await vi.waitFor(() => expect(state.profile.research_process[0]?.shown).not.toBeNull());
    expect(state.root.textContent).toContain("案例固定日程盈亏");
    expect(state.profile.research_process).toHaveLength(1);
    expect(state.profile.research_process[0]).toMatchObject({ id: locked.id, caseId: locked.caseId, schedule: locked.schedule, initialClaim: locked.initialClaim, priorExposure: false });
    expect(state.seen.has("lantern-a")).toBe(true);
    expect(visiblePage(state.root)).toBe("d2-data");
    expect(state.casePresentations).toEqual([{ caseId: "lantern-a", page: "d2-data" }]);
    expect(state.evidencePresentations).toEqual([{ part: "primary", page: "d2-data" }]);
    expect(state.profile.research_process[0]?.helpUsed).toBe("self");
    buttonAt(state.root, "作答").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process[0]?.helpUsed).toBe("step"));
    state.ui.resumePendingPresentation();
    expect(state.profile.research_process).toHaveLength(1);
  });

  it.each([false, true])("keeps primary visible while a second case waits and captures actual previous exposure (%s)", async (alreadySeen) => {
    const { run, manifest } = await fixture();
    const state = harness(run, manifest, emptyResearchProfile());
    state.section = "D2"; state.render(); buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process[0]?.shown).not.toBeNull());
    const primary = structuredClone(state.profile.research_process[0]!.shown!.primary);
    const gate = await delayedCase("lantern-b");
    buttonAt(state.root, "再查看另一段历史（未见）").fire("click");
    await vi.waitFor(() => expect(gate.requested).toHaveBeenCalledOnce());
    state.inert = true; state.render(); gate.release();
    await vi.waitFor(() => expect(gate.decoded).toHaveBeenCalledOnce()); await flush();
    expect(state.profile.research_process[0]?.shown?.primary).toEqual(primary);
    expect(state.profile.research_process[0]?.shown?.other).toBeUndefined();
    expect(state.root.textContent).toContain("案例固定日程盈亏");
    expect(state.root.textContent).not.toContain("另一段历史的结果相对第一段");
    expect(state.seen.has("lantern-b")).toBe(false);
    if (alreadySeen) state.seen.add("lantern-b");
    state.inert = false; state.render(); state.ui.resumePendingPresentation();
    await vi.waitFor(() => expect(state.profile.research_process[0]?.shown?.other).toBeDefined());
    expect(state.profile.research_process[0]?.priorExposure).toBe(false);
    expect(state.profile.research_process[0]?.shown?.otherPriorExposure).toBe(alreadySeen);
    expect(state.seen.has("lantern-b")).toBe(true);
    expect(visiblePage(state.root)).toBe("d2-other");
    expect(state.casePresentations).toEqual([{ caseId: "lantern-a", page: "d2-data" }, { caseId: "lantern-b", page: "d2-other" }]);
    expect(state.evidencePresentations).toEqual([{ part: "primary", page: "d2-data" }, { part: "other", page: "d2-other" }]);
  });

  it("drops a late response on leave and can resume the same saved locked question", async () => {
    const { run, manifest } = await fixture();
    const gate = await delayedCase("lantern-a");
    const state = harness(run, manifest, emptyResearchProfile());
    state.section = "D2"; state.render(); buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(gate.requested).toHaveBeenCalledOnce());
    const locked = structuredClone(state.profile.research_process[0]!);
    state.ui.leave(); state.section = "D1"; state.render(); gate.release();
    await vi.waitFor(() => expect(gate.decoded).toHaveBeenCalledOnce()); await flush();
    state.ui.resumePendingPresentation();
    expect(state.profile.research_process[0]?.shown).toBeNull();
    expect(state.seen.has("lantern-a")).toBe(false);
    state.section = "D2"; state.render();
    buttonAt(state.root, "继续加载已锁定资料").fire("click");
    await vi.waitFor(() => expect(state.profile.research_process[0]?.shown).not.toBeNull());
    expect(state.profile.research_process).toHaveLength(1);
    expect(state.profile.research_process[0]).toMatchObject({ id: locked.id, schedule: locked.schedule, priorExposure: false });
  });

  it("drops a pending response if the run is replaced before the request resolves", async () => {
    const { run, manifest } = await fixture();
    const gate = await delayedCase("lantern-a");
    const state = harness(run, manifest, emptyResearchProfile());
    state.section = "D2"; state.render(); buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(gate.requested).toHaveBeenCalledOnce());
    state.run = createRun({ seed: 44 }); gate.release();
    await vi.waitFor(() => expect(gate.decoded).toHaveBeenCalledOnce()); await flush();
    state.ui.resumePendingPresentation();
    expect(state.profile.research_process[0]?.shown).toBeNull();
    expect(state.seen.has("lantern-a")).toBe(false);
  });

  it("preserves a prior-exposure correction made while the original task waits", async () => {
    const { run, manifest } = await fixture();
    const gate = await delayedCase("lantern-a");
    const state = harness(run, manifest, emptyResearchProfile());
    state.section = "D2"; state.render(); buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(gate.requested).toHaveBeenCalledOnce());
    const id = state.profile.research_process[0]!.id;
    state.inert = true; state.render(); gate.release();
    await vi.waitFor(() => expect(gate.decoded).toHaveBeenCalledOnce()); await flush();
    state.profile = declarePriorExposure(state.profile, { id: "disclosure", caseId: "lantern-a", priorToTasks: true }).profile;
    state.inert = false; state.render(); state.ui.resumePendingPresentation();
    await vi.waitFor(() => expect(state.profile.research_process[0]?.shown).not.toBeNull());
    expect(state.profile.research_process[0]).toMatchObject({ id, priorExposure: false });
    expect(state.profile.prior_exposure_disclosures).toHaveLength(1);
    change(selectAt(state.root, "本案例结果相对同期基准"), state.profile.research_process[0]!.shown!.primary.direction);
    change(selectAt(state.root, "这次主要依据什么"), "根据同日期的数字比较");
    buttonAt(state.root, "提交这次研究").fire("click");
    expect(state.profile.knowledge_evidence.find((item) => item.id === `${id}:K1`)).toMatchObject({ priorExposure: true, counted: false });
  });

  it("reveals in play-only mode without saving research answers or observations", async () => {
    const { run, manifest } = await fixture();
    const gate = await delayedCase("lantern-a");
    const state = harness(run, manifest, emptyResearchProfile(false));
    const original = JSON.stringify(state.profile);
    state.section = "D2"; state.render(); buttonAt(state.root, "锁定并查看同期资料").fire("click");
    await vi.waitFor(() => expect(gate.requested).toHaveBeenCalledOnce());
    state.hidden = true; state.render(); gate.release();
    await vi.waitFor(() => expect(gate.decoded).toHaveBeenCalledOnce()); await flush();
    expect(state.root.textContent).not.toContain("案例固定日程盈亏");
    expect(state.seen.has("lantern-a")).toBe(false);
    state.hidden = false; state.render(); state.ui.resumePendingPresentation();
    await vi.waitFor(() => expect(state.root.textContent).toContain("案例固定日程盈亏"));
    expect(state.seen.has("lantern-a")).toBe(true);
    expect(JSON.stringify(state.profile)).toBe(original);
  });
});
