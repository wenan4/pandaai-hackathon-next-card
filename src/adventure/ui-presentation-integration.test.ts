import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAMP_STOCK } from "./content";
import { canPlayCard, createRun, reduceRun } from "./engine";
import { centsForShares, sharesForCents } from "./ledger";
import { emptyResearchProfile, startHistory, type ResearchProfile } from "./research";
import { chooseAdventureCase, hasSeenRelatedCase } from "./ui-case";
import { SAVE_KEY, SEEN_KEY } from "./ui-storage";
import type { MarketQuote, MarketStage, Run } from "./types";

class FakeNode {
  children: (FakeNode | string)[] = [];
  parent: FakeNode | null = null;
  root = false;
  get isConnected(): boolean { return this.root || !!this.parent?.isConnected; }
  append(...items: (FakeNode | string)[]): void { for (const item of items) { if (item instanceof FakeNode) item.parent = this; this.children.push(item); } }
  replaceChildren(...items: (FakeNode | string)[]): void { for (const item of this.children) if (item instanceof FakeNode) item.parent = null; this.children = []; this.append(...items); }
  get textContent(): string { return this.children.map((item) => typeof item === "string" ? item : item.textContent).join(""); }
  set textContent(value: string) { this.replaceChildren(value); }
  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = [];
    const visit = (node: FakeNode): void => {
      if (node instanceof FakeElement) {
        if (selector === "[data-scroll-key]" && node.attributes["data-scroll-key"]) found.push(node);
        if (node.tag === "summary" && node.parent instanceof FakeElement && node.parent.tag === "details"
          && (selector === "details > summary" || (selector === "details[open] > summary" && node.parent.open))) found.push(node);
      }
      for (const child of node.children) if (child instanceof FakeNode) visit(child);
    };
    visit(this); return found;
  }
  querySelector(selector: string): FakeElement | null {
    const match = /^\[(data-(?:focus-key|scroll-key|game-receipt|archive-view))="([^"]+)"\]$/.exec(selector);
    return match ? find(this, (item) => item.attributes[match[1]!] === match[2]) ?? null : null;
  }
}
class FakeElement extends FakeNode {
  attributes: Record<string, string> = {};
  listeners: Record<string, (event: { currentTarget: FakeElement; target: FakeElement }) => void> = {};
  dataset: Record<string, string> = {};
  inert = false; disabled = false; open = false; scrollLeft = 0; value = "";
  constructor(readonly tag: string) { super(); }
  get parentElement(): FakeElement | null { return this.parent instanceof FakeElement ? this.parent : null; }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === "value") this.value = value;
    if (name === "disabled") this.disabled = true;
    if (name === "inert") this.inert = true;
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())] = value;
  }
  addEventListener(name: string, listener: (event: { currentTarget: FakeElement; target: FakeElement }) => void): void { this.listeners[name] = listener; }
  fire(name: string): void { if (!(name === "click" && (this.disabled || this.closest("[hidden]") || this.closest("[inert]")))) this.listeners[name]?.({ currentTarget: this, target: this }); }
  closest(selector: string): FakeElement | null {
    for (let current: FakeNode | null = this; current; current = current.parent) {
      if (current instanceof FakeElement && ((selector === "[hidden]" && "hidden" in current.attributes) || (selector === "[inert]" && current.inert) || selector === current.tag)) return current;
    }
    return null;
  }
  contains(): boolean { return false; }
  focus(): void { /* no layout */ }
  scrollIntoView(): void { /* no layout */ }
  getClientRects(): unknown[] { return [{}]; }
}
function find(node: FakeNode, match: (item: FakeElement) => boolean): FakeElement | undefined {
  if (node instanceof FakeElement && match(node)) return node;
  for (const child of node.children) if (child instanceof FakeNode) { const result = find(child, match); if (result) return result; }
  return undefined;
}
function button(node: FakeNode, text: string): FakeElement {
  const result = find(node, (item) => item.tag === "button" && item.textContent === text);
  if (!result) throw new Error(`button missing: ${text}`);
  return result;
}
function key(node: FakeNode, value: string): FakeElement {
  const result = find(node, (item) => item.attributes["data-focus-key"] === value);
  if (!result) throw new Error(`element missing: ${value}`);
  return result;
}
function page(node: FakeNode, name: string): void {
  const tab = find(node, (item) => item.attributes["data-focus-key"] === `page-${name}`);
  if (!tab) throw new Error(`page missing: ${name}`);
  tab.fire("click");
}
class MemoryStorage {
  values = new Map<string, string>(); writes: string[] = []; failSeen = false; failSave = false;
  getItem(name: string): string | null { return this.values.get(name) ?? null; }
  setItem(name: string, value: string): void { if ((name === SEEN_KEY && this.failSeen) || (name === SAVE_KEY && this.failSave)) throw new Error("denied"); this.writes.push(name); this.values.set(name, value); }
  removeItem(name: string): void { this.writes.push(name); this.values.delete(name); }
}
const manifest = JSON.parse(readFileSync("public/data/adventure/manifest.v2.json", "utf8")) as unknown;
const initialCase = JSON.parse(readFileSync("public/data/adventure/initial/lantern-a.json", "utf8")) as unknown;
const researchCase = JSON.parse(readFileSync("public/data/adventure/research/lantern-b.json", "utf8")) as unknown;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function camp(caseId = "lantern-a"): Run {
  const run = createRun({ seed: 104, caseId, observationEnabled: false });
  run.node = "N2"; run.phase = "camp"; run.battle = null;
  run.camp = { node: "N2", stock: [...CAMP_STOCK.N2], purchased: [], freeChoiceUsed: false, decision: "not-submitted" };
  return run;
}
function entryPending(amountCents = 2000, caseId = "lantern-a"): Run {
  let run = reduceRun(camp(caseId), { type: "submit-entry", amountCents });
  return reduceRun(run, { type: "continue" });
}
const quote = (stage: MarketStage, date = "20220105"): MarketQuote => ({ caseId: "lantern-a", step: stage, date, price: 1_000_000 });
const actualQuote = (caseId: string, stage: MarketStage): MarketQuote => JSON.parse(readFileSync(`public/data/adventure/stages/${caseId}/${stage}.json`, "utf8")) as MarketQuote;

/** Advance between the camps with legal reducer actions and the actual stage files. */
function battleToNextQuote(route: Run): Run {
  let run = reduceRun(route, { type: "choose-route", enemyId: "moss" });
  for (let turn = 0; turn < 120 && run.phase === "battle"; turn++) {
    const battle = run.battle!;
    const playable = battle.hand.map((id) => run.deck.find((card) => card.instanceId === id)!)
      .filter((card) => canPlayCard(run, card.instanceId).enabled);
    const get = (id: string) => playable.find((card) => card.cardId === id);
    const attack = get("C01");
    const block = get("C02") ?? get("C06");
    const incoming = battle.enemy.intent.kind === "attack" ? battle.enemy.intent.amount : 0;
    const selected = (attack && battle.enemy.hp + battle.enemy.shield <= 6 ? attack : undefined)
      ?? (incoming > battle.shield ? block : undefined) ?? attack ?? get("C03") ?? get("C04") ?? get("C05");
    run = selected ? reduceRun(run, { type: "play-card", cardInstanceId: selected.instanceId }) : reduceRun(run, { type: "end-turn" });
  }
  if (run.phase !== "reward") throw new Error("fixture did not reach the next reward");
  return reduceRun(run, { type: "choose-reward", cardId: null });
}

function firstCampAfterInvestment(amountCents: number): Run {
  const route = reduceRun(entryPending(amountCents), { type: "apply-quote", quote: actualQuote("lantern-a", "entry") });
  return reduceRun(battleToNextQuote(route), { type: "apply-quote", quote: actualQuote("lantern-a", "t1") });
}
const firstCampAfterZero = (): Run => firstCampAfterInvestment(0);

function replaceSavedRun(storage: MemoryStorage, run: Run): void {
  const previous = JSON.parse(storage.values.get(SAVE_KEY)!) as Record<string, unknown>;
  storage.values.set(SAVE_KEY, JSON.stringify({ ...previous, run }));
}
function t1Pending(caseId = "lantern-a"): Run {
  let run = reduceRun(entryPending(2000, caseId), { type: "apply-quote", quote: { ...quote("entry", "20220103"), caseId } });
  run.node = "N3"; run.phase = "reward"; run.reward = { choices: ["C08", "C12", "C06"], coinsCents: 1200 };
  return reduceRun(run, { type: "choose-reward", cardId: null });
}
function storageFor(run: Run, profile: ResearchProfile = emptyResearchProfile(run.observationEnabled)): MemoryStorage {
  const storage = new MemoryStorage();
  storage.values.set(SAVE_KEY, JSON.stringify({ schema: "nextcard-adventure-save-v1", savedAt: Date.now(), observationStartedAt: Date.now(), run, profile }));
  return storage;
}
function savedRun(storage: MemoryStorage): Run { return (JSON.parse(storage.values.get(SAVE_KEY)!) as { run: Run }).run; }
function seen(storage: MemoryStorage): string[] { return JSON.parse(storage.values.get(SEEN_KEY) ?? "[]") as string[]; }
type Loader = (caseId: string, stage: MarketStage, unlocked: boolean) => Promise<MarketQuote>;

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.doUnmock("./market"); vi.doUnmock("./ui-demo"); vi.resetModules(); vi.unstubAllGlobals(); });
async function boot(storage: MemoryStorage, loadStage: Loader, options: { hidden?: boolean; initialCase?: boolean; demo?: () => Promise<Run>; research?: () => Promise<unknown> } = {}) {
  const root = new FakeElement("app"); root.root = true;
  const handlers = new Map<string, () => void>();
  const doc = { visibilityState: options.hidden ? "hidden" : "visible", activeElement: null,
    addEventListener: (name: string, callback: () => void) => handlers.set(name, callback),
    querySelector: (selector: string) => selector === "#app" ? root : null,
    createElement: (tag: string) => new FakeElement(tag), createElementNS: (_ns: string, tag: string) => new FakeElement(tag) };
  vi.stubGlobal("Node", FakeNode); vi.stubGlobal("HTMLButtonElement", FakeElement); vi.stubGlobal("CSS", { escape: (value: string) => value });
  vi.stubGlobal("document", doc); vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage, scrollY: 0, scrollTo: vi.fn(), setTimeout: vi.fn(() => 0), clearTimeout: vi.fn() });
  vi.doMock("./market", async (importOriginal) => ({ ...(await importOriginal<typeof import("./market")>()), loadMarketInitial: async () => manifest,
    loadMarketInitialCase: options.initialCase ? async () => initialCase : () => new Promise(() => {}), loadMarketStage: loadStage, loadResearchCase: options.research ?? (async () => researchCase) }));
  if (options.demo) vi.doMock("./ui-demo", () => ({ makeDemoPath: options.demo }));
  await import("./ui");
  await vi.waitFor(() => expect(root.textContent).not.toContain("正在加载案例目录"));
  return { root, setVisible: (visible: boolean) => { doc.visibilityState = visible ? "visible" : "hidden"; handlers.get("visibilitychange")?.(); } };
}
const resume = (root: FakeElement): void => button(root, "继续上次旅程").fire("click");

describe("visible presentation coordination", () => {
  it("keeps the exact pending stage and old seen cases while away, then reveals it once on return", async () => {
    const storage = storageFor(t1Pending()); storage.values.set(SEEN_KEY, '["lantern-b"]');
    const original = storage.values.get(SAVE_KEY); const next = deferred<MarketQuote>();
    const loader = vi.fn((_caseId: string, _stage: MarketStage, _unlocked: boolean) => next.promise);
    const { root } = await boot(storage, loader); resume(root);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    find(root, (item) => item.attributes["aria-label"] === "回到冒险首页")!.fire("click");
    next.resolve(quote("t1")); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(storage.values.get(SAVE_KEY)).toBe(original); expect(seen(storage)).toEqual(["lantern-b"]);
    expect(root.textContent).toContain("继续上次旅程");
    resume(root);
    await vi.waitFor(() => expect(savedRun(storage).phase).toBe("camp"));
    expect(savedRun(storage).node).toBe("N4"); expect(seen(storage)).toEqual(["lantern-b", "lantern-a"]);
    expect(savedRun(storage).history.filter((event) => event.action === "apply-quote" && event.data.stage === "t1")).toHaveLength(1);
    expect(loader.mock.calls.every((call) => call[1] === "t1")).toBe(true);
    expect((JSON.parse(storage.values.get(SAVE_KEY)!) as { priorExposure?: boolean }).priorExposure).toBe(false);
  });

  it("defers a locked entry under a dialog and executes the same order only once when closed", async () => {
    const run = entryPending(); const storage = storageFor(run); const original = storage.values.get(SAVE_KEY);
    const next = deferred<MarketQuote>(); const loader = vi.fn(() => next.promise);
    const { root } = await boot(storage, loader); resume(root); await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    button(root, "设置").fire("click"); next.resolve(quote("entry", "20220103"));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(storage.values.get(SAVE_KEY)).toBe(original); expect(savedRun(storage).market.order).toEqual(run.market.order);
    button(root, "完成").fire("click"); await vi.waitFor(() => expect(savedRun(storage).phase).toBe("route"));
    const after = savedRun(storage); expect(after.market.order).toBeNull();
    expect(after.history.filter((event) => event.action === "apply-quote" && event.data.stage === "entry")).toHaveLength(1);
    expect(seen(storage)).toEqual([]);
  });

  it("starts and completes a quote only while the document is visible", async () => {
    const storage = storageFor(t1Pending()); const original = storage.values.get(SAVE_KEY);
    const next = deferred<MarketQuote>(); const loader = vi.fn(() => next.promise);
    const app = await boot(storage, loader, { hidden: true }); resume(app.root);
    await Promise.resolve(); expect(loader).not.toHaveBeenCalled();
    app.setVisible(true); await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    app.setVisible(false); next.resolve(quote("t1"));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(storage.values.get(SAVE_KEY)).toBe(original); expect(seen(storage)).toEqual([]);
    app.setVisible(true); await vi.waitFor(() => expect(savedRun(storage).node).toBe("N4"));
    expect(seen(storage)).toEqual(["lantern-a"]);
  });

  it("retries a failed seen-case write without losing prior cases", async () => {
    const storage = storageFor(t1Pending()); storage.values.set(SEEN_KEY, '["lantern-b"]'); storage.failSeen = true;
    const app = await boot(storage, async () => quote("t1")); resume(app.root);
    await vi.waitFor(() => expect(savedRun(storage).node).toBe("N4"));
    expect(seen(storage)).toEqual(["lantern-b"]);
    storage.failSeen = false; app.setVisible(false); app.setVisible(true);
    expect(seen(storage)).toEqual(["lantern-b", "lantern-a"]);
  });

  it("preserves cases added by another page before persisting a new visible case", async () => {
    const storage = storageFor(t1Pending()); storage.values.set(SEEN_KEY, '["lantern-b"]');
    const next = deferred<MarketQuote>(); const loader = vi.fn(() => next.promise);
    const { root } = await boot(storage, loader); resume(root); await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    storage.values.set(SEEN_KEY, '["lantern-b","lantern-c"]'); next.resolve(quote("t1"));
    await vi.waitFor(() => expect(savedRun(storage).node).toBe("N4"));
    expect([...seen(storage)].sort()).toEqual(["lantern-a", "lantern-b", "lantern-c"]);
  });

  it("does not apply an old response after a new journey replaces the pending one", async () => {
    const storage = storageFor(t1Pending()); const next = deferred<MarketQuote>(); const loader = vi.fn(() => next.promise);
    const { root } = await boot(storage, loader); resume(root); await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    find(root, (item) => item.attributes["aria-label"] === "回到冒险首页")!.fire("click");
    button(root, "开始新旅程 · 生成观察").fire("click"); button(root, "开始新旅程").fire("click");
    const replacement = storage.values.get(SAVE_KEY); expect(savedRun(storage).node).toBe("N1");
    next.resolve(quote("t1")); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(storage.values.get(SAVE_KEY)).toBe(replacement); expect(seen(storage)).toEqual([]);
  });

  it("records an actually displayed entry quote even for zero participation, without changing the real forecast flag", async () => {
    const run = reduceRun(entryPending(0), { type: "apply-quote", quote: quote("entry", "20220103") });
    const storage = storageFor(run); const original = storage.values.get(SAVE_KEY);
    const { root } = await boot(storage, async () => { throw new Error("unexpected request"); });
    button(root, "数据说明").fire("click");
    expect(root.textContent).toContain("参与金额为零"); expect(seen(storage)).toEqual(["lantern-a"]);
    expect(storage.values.get(SAVE_KEY)).toBe(original);
  });

  it("records the data dialog after a hidden document becomes visible", async () => {
    const run = reduceRun(entryPending(0), { type: "apply-quote", quote: quote("entry", "20220103") });
    const storage = storageFor(run); const app = await boot(storage, async () => { throw new Error("unexpected request"); }, { hidden: true });
    button(app.root, "数据说明").fire("click"); expect(seen(storage)).toEqual([]);
    app.setVisible(true); expect(app.root.textContent).toContain("参与金额为零"); expect(seen(storage)).toEqual(["lantern-a"]);
  });

  it("records a natural entry-price display against an already locked question without changing the original forecast or answer", async () => {
    let run = reduceRun(entryPending(0), { type: "apply-quote", quote: quote("entry", "20220103") });
    run = reduceRun(run, { type: "choose-route", enemyId: "pursuer" });
    run.hp = 1; run.battle!.shield = 0; run.battle!.enemy.intent = { kind: "attack", amount: 8 };
    run = reduceRun(run, { type: "end-turn" }); run.observationEnabled = true;
    expect(run.phase).toBe("ended");
    expect(run.history.filter((event) => event.action === "apply-quote").map((event) => event.data.stage)).toEqual(["entry"]);
    const storage = storageFor(run); const pending = deferred<unknown>();
    const { root } = await boot(storage, async () => { throw new Error("unexpected request"); }, { research: () => pending.promise });
    button(root, "查看上次旅程").fire("click"); button(root, "打开历史对照台").fire("click");
    button(root, "开始看数据").fire("click");
    const before = JSON.parse(storage.values.get(SAVE_KEY)!) as { priorExposure?: boolean; profile: ResearchProfile };
    const attempt = before.profile.research_process.at(-1)!;
    expect(attempt.caseId).toBe("lantern-a"); expect(attempt.priorExposure).toBe(false); expect(attempt.shown).toBeNull();
    button(root, "数据说明").fire("click");
    const after = JSON.parse(storage.values.get(SAVE_KEY)!) as { priorExposure?: boolean; profile: ResearchProfile };
    const recorded = after.profile.research_process.at(-1)!;
    expect(recorded.exposedCaseIdsAfterLock).toEqual(["lantern-a"]);
    expect(recorded.initialClaim).toBe(attempt.initialClaim); expect(recorded.schedule).toEqual(attempt.schedule);
    expect(recorded.priorExposure).toBe(false); expect(after.priorExposure ?? false).toBe(before.priorExposure ?? false);
    expect(after.profile.calibration).toEqual(before.profile.calibration);
    expect(savedRun(storage)).toEqual(run); expect(seen(storage)).toEqual(["lantern-a"]);
  });

  it("counts a positive automatic redemption in the visible ending as a familiar case", async () => {
    let run = reduceRun(entryPending(), { type: "apply-quote", quote: quote("entry", "20220103") });
    run = reduceRun(run, { type: "choose-route", enemyId: "pursuer" });
    run.hp = 1; run.battle!.shield = 0; run.battle!.enemy.intent = { kind: "attack", amount: 8 };
    run = reduceRun(run, { type: "end-turn" });
    const storage = storageFor(run); const { root } = await boot(storage, async () => quote("exit-after-entry"));
    resume(root); await vi.waitFor(() => expect(savedRun(storage).phase).toBe("ended"));
    expect(seen(storage)).toEqual(["lantern-a"]);
    expect(savedRun(storage).wallet.ledger.filter((entry) => entry.kind === "redemption")).toHaveLength(1);
    expect(chooseAdventureCase(["lantern-a", "lantern-b"], new Set(seen(storage)), () => 0).caseId).toBe("lantern-b");
  });

  it("marks a visible fork's new market stage externally for the related real case", async () => {
    const real = reduceRun(camp("lantern-d"), { type: "buy-archive" });
    const checkpoint = real.checkpoints.find((item) => item.action === "buy-archive")!;
    const pending = t1Pending("lantern-d");
    const { checkpoints: _checkpoints, ...snapshot } = pending;
    checkpoint.snapshot = snapshot;
    const storage = storageFor(real); const next = deferred<MarketQuote>();
    const { root } = await boot(storage, () => next.promise);
    button(root, "评委面板").fire("click"); button(root, "从这里分叉").fire("click");
    expect(seen(storage)).toEqual([]);
    next.resolve({ ...quote("t1"), caseId: "lantern-d" });
    await vi.waitFor(() => expect(seen(storage)).toEqual(["lantern-d"]));
    expect(hasSeenRelatedCase(new Set(seen(storage)), "lantern-c")).toBe(true);
    expect((JSON.parse(storage.values.get(SAVE_KEY)!) as { priorExposure: boolean }).priorExposure).toBe(true);
    button(root, "评委面板").fire("click"); button(root, "恢复真实旅程").fire("click");
    expect((JSON.parse(storage.values.get(SAVE_KEY)!) as { priorExposure: boolean }).priorExposure).toBe(true);
  });

  it("does not reveal a staged demo or record exposure behind a dialog", async () => {
    const storage = storageFor(camp()); const original = storage.values.get(SAVE_KEY);
    const demo = deferred<Run>(); const makeDemo = vi.fn(() => demo.promise);
    const { root } = await boot(storage, async () => { throw new Error("unexpected request"); }, { demo: makeDemo });
    resume(root); button(root, "评委面板").fire("click"); button(root, "路径甲 · 查看资料").fire("click");
    await vi.waitFor(() => expect(makeDemo).toHaveBeenCalledTimes(1));
    button(root, "设置").fire("click");
    const generated = reduceRun(t1Pending(), { type: "apply-quote", quote: quote("t1") }); generated.source = "demo";
    demo.resolve(generated); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(seen(storage)).toEqual([]); expect(storage.values.get(SAVE_KEY)).toBe(original);
    expect(root.textContent).not.toContain("模拟路径甲已生成");
    button(root, "完成").fire("click");
    await vi.waitFor(() => expect(root.textContent).toContain("模拟路径甲已生成"));
    expect(seen(storage)).toEqual(["lantern-a"]);
    expect((JSON.parse(storage.values.get(SAVE_KEY)!) as { priorExposure: boolean }).priorExposure).toBe(true);
  });

  it("does not mark a fixed-label study as case exposure", async () => {
    const storage = storageFor(camp()); const original = storage.values.get(SAVE_KEY);
    const { root } = await boot(storage, async () => { throw new Error("unexpected request"); });
    resume(root); button(root, "评委面板").fire("click"); button(root, "生成研究对照").fire("click");
    await vi.waitFor(() => expect(root.textContent).toContain("独立完成"));
    expect(root.textContent).toContain("提示后完成"); expect(root.textContent).toContain("结论待核查");
    expect(storage.values.get(SAVE_KEY)).toBe(original); expect(seen(storage)).toEqual([]);
  });

  it("records an unrelated displayed demo against a previously locked real question without changing the real journey's prior flag", async () => {
    const run = camp(); run.observationEnabled = true;
    const profile = startHistory(emptyResearchProfile(true), { id: "locked-b", caseId: "lantern-b", questionVersion: "d2-v1", initialClaim: "unknown", priorExposure: false,
      schedule: { startingCashCents: 7200, participationCents: 2000, t1: 0, t2: 0 } });
    const storage = storageFor(run, profile);
    const generated = reduceRun(t1Pending("lantern-b"), { type: "apply-quote", quote: { ...quote("t1"), caseId: "lantern-b" } }); generated.source = "demo";
    const { root } = await boot(storage, async () => { throw new Error("unexpected request"); }, { demo: async () => generated });
    resume(root); button(root, "评委面板").fire("click"); button(root, "路径甲 · 查看资料").fire("click");
    await vi.waitFor(() => expect(root.textContent).toContain("模拟路径甲已生成"));
    const saved = JSON.parse(storage.values.get(SAVE_KEY)!) as { priorExposure?: boolean; profile: ResearchProfile };
    const attempt = saved.profile.research_process.find((item) => item.id === "locked-b")!;
    expect((attempt as unknown as { exposedCaseIdsAfterLock?: string[] }).exposedCaseIdsAfterLock).toEqual(["lantern-b"]);
    expect(saved.priorExposure ?? false).toBe(false);
    expect(saved.profile.prior_exposure_disclosures).toEqual([]);
    button(root, "恢复真实旅程").fire("click");
    const restored = JSON.parse(storage.values.get(SAVE_KEY)!) as { profile: ResearchProfile };
    expect((restored.profile.research_process[0] as unknown as { exposedCaseIdsAfterLock?: string[] }).exposedCaseIdsAfterLock).toEqual(["lantern-b"]);
  });

  it("retries saving a displayed external case against locked real questions after storage recovers", async () => {
    const run = camp(); run.observationEnabled = true;
    const profile = startHistory(emptyResearchProfile(true), { id: "locked-b", caseId: "lantern-b", questionVersion: "d2-v1", initialClaim: "unknown", priorExposure: false,
      schedule: { startingCashCents: 7200, participationCents: 2000, t1: 0, t2: 0 } });
    const storage = storageFor(run, profile);
    const generated = reduceRun(t1Pending("lantern-b"), { type: "apply-quote", quote: { ...quote("t1"), caseId: "lantern-b" } }); generated.source = "demo";
    const app = await boot(storage, async () => { throw new Error("unexpected request"); }, { demo: async () => generated });
    resume(app.root); button(app.root, "评委面板").fire("click"); storage.failSave = true;
    button(app.root, "路径甲 · 查看资料").fire("click");
    await vi.waitFor(() => expect(app.root.textContent).toContain("模拟路径甲已生成"));
    const beforeRetry = JSON.parse(storage.values.get(SAVE_KEY)!) as { profile: ResearchProfile };
    expect((beforeRetry.profile.research_process[0] as unknown as { exposedCaseIdsAfterLock?: string[] }).exposedCaseIdsAfterLock ?? []).toEqual([]);
    storage.failSave = false; app.setVisible(false); app.setVisible(true);
    const afterRetry = JSON.parse(storage.values.get(SAVE_KEY)!) as { profile: ResearchProfile };
    expect((afterRetry.profile.research_process[0] as unknown as { exposedCaseIdsAfterLock?: string[] }).exposedCaseIdsAfterLock).toEqual(["lantern-b"]);
  });

  it("excludes a question's own display while marking another locked question for the same case", async () => {
    const run = camp(); run.observationEnabled = true;
    const inputs = { caseId: "lantern-b", questionVersion: "d2-v1", initialClaim: "unknown" as const, priorExposure: false,
      schedule: { startingCashCents: 7200, participationCents: 2000, t1: 0 as const, t2: 0 as const } };
    let profile = startHistory(emptyResearchProfile(true), { ...inputs, id: "other" });
    profile = startHistory(profile, { ...inputs, id: "current" });
    const storage = storageFor(run, profile); const { root } = await boot(storage, async () => { throw new Error("unexpected request"); });
    resume(root); page(root, "insight"); button(root, "试试历史比较").fire("click"); button(root, "继续加载已锁定资料").fire("click");
    await vi.waitFor(() => {
      const saved = JSON.parse(storage.values.get(SAVE_KEY)!) as { profile: ResearchProfile };
      expect(saved.profile.research_process.find((item) => item.id === "current")?.shown).not.toBeNull();
      expect(seen(storage)).toEqual(["lantern-b"]);
    });
    const saved = JSON.parse(storage.values.get(SAVE_KEY)!) as { profile: ResearchProfile };
    const own = saved.profile.research_process.find((item) => item.id === "current")!;
    const other = saved.profile.research_process.find((item) => item.id === "other")!;
    expect((own as unknown as { exposedCaseIdsAfterLock?: string[] }).exposedCaseIdsAfterLock ?? []).toEqual([]);
    expect((other as unknown as { exposedCaseIdsAfterLock?: string[] }).exposedCaseIdsAfterLock).toEqual(["lantern-b"]);
  });

  it("allows a zero-entry player to buy the archive before arranging a later investment", async () => {
    const initial = camp(); initial.observationEnabled = true;
    const storage = storageFor(initial, emptyResearchProfile(true));
    const execution = deferred<MarketQuote>();
    const loader = vi.fn(async (caseId: string, stage: MarketStage) => stage === "t1-exec" ? execution.promise : actualQuote(caseId, stage));
    let app = await boot(storage, loader, { initialCase: true });
    resume(app.root);
    key(app.root, "entry-submit").fire("click");
    expect(savedRun(storage).market.order).toMatchObject({ kind: "entry", amountCents: 0 });
    expect(savedRun(storage).wallet.cashCents).toBe(6000);
    key(app.root, "camp-continue").fire("click");
    await vi.waitFor(() => expect(savedRun(storage).phase).toBe("route"));
    expect(savedRun(storage).wallet.shareUnits).toBe("0");

    const pendingClose = battleToNextQuote(savedRun(storage));
    replaceSavedRun(storage, pendingClose);
    vi.resetModules(); app = await boot(storage, loader, { initialCase: true });
    resume(app.root);
    await vi.waitFor(() => expect(savedRun(storage).node).toBe("N4"));
    expect(savedRun(storage).camp?.decision).toBe("not-submitted");
    const beforeArchive = savedRun(storage).wallet.cashCents;
    page(app.root, "archive");
    key(app.root, "archive").fire("click");
    expect(savedRun(storage).archiveOwned).toBe(true);
    expect(savedRun(storage).wallet.cashCents).toBe(beforeArchive - 400);
    expect(savedRun(storage).camp?.decision).toBe("not-submitted");

    page(app.root, "allocation");
    const beforeChoice = storage.values.get(SAVE_KEY);
    const amount = key(app.root, "additional-entry-amount");
    amount.value = "12"; amount.fire("input");
    expect(storage.values.get(SAVE_KEY)).toBe(beforeChoice);
    expect(savedRun(storage).wallet.shareUnits).toBe("0");
    key(app.root, "camp-allocation-submit").fire("click");
    await vi.waitFor(() => expect(loader.mock.calls.some((call) => call[1] === "t1-exec")).toBe(true));
    const pending = savedRun(storage);
    expect(pending.phase).toBe("market");
    expect(pending.wallet.cashCents).toBe(beforeArchive - 400 - 1200);
    expect(pending.wallet.reservedCents).toBe(1200);
    expect(pending.wallet.shareUnits).toBe("0");
    expect(pending.market.order).toMatchObject({ kind: "sell", shareUnits: "0", additionalEntryCents: 1200 });

    const pendingSave = storage.values.get(SAVE_KEY);
    button(app.root, "我的交易风格").fire("click");
    expect(app.root.textContent).toContain("累计已执行 0 金币");
    expect(app.root.textContent).toContain("12 金币已预留、待下一报价执行");
    button(app.root, "返回旅程").fire("click");
    expect(storage.values.get(SAVE_KEY)).toBe(pendingSave);
    app.setVisible(false);
    execution.resolve(actualQuote("lantern-a", "t1-exec"));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(storage.values.get(SAVE_KEY)).toBe(pendingSave);
    expect(savedRun(storage).wallet.reservedCents).toBe(1200);
    app.setVisible(true);
    await vi.waitFor(() => expect(savedRun(storage).phase).toBe("camp"));
    const settled = savedRun(storage);
    expect(settled.wallet.reservedCents).toBe(0);
    expect(BigInt(settled.wallet.shareUnits)).toBeGreaterThan(0n);
    expect(settled.wallet.investedCents).toBe(1200);
    expect(settled.history.filter((event) => event.action === "submit-redemption")).toHaveLength(1);
    expect(settled.history.filter((event) => event.action === "apply-quote" && event.data.stage === "t1-exec")).toHaveLength(1);
    expect(loader.mock.calls.some((call) => call[1] === "t1-exec")).toBe(true);
    button(app.root, "我的交易风格").fire("click");
    expect(app.root.textContent).toContain("累计已执行 12 金币");
    expect(app.root.textContent).toContain("中途选择追加 12 金币");
    key(app.root, "report-open-choices").fire("click");
    key(app.root, "report-evidence-资金取舍").fire("click");
    const detail = find(app.root, (item) => item.attributes["aria-label"] === "资金取舍 · 本局记录")!;
    expect(detail.textContent).toContain("选择参与 0 金币");
    expect(detail.textContent).toContain("选择追加 12 金币");
  });

  it("records an unaffordable archive attempt before camp settlement without making a purchase", async () => {
    const run = firstCampAfterZero(); run.wallet.cashCents = 300; run.observationEnabled = true;
    const storage = storageFor(run, emptyResearchProfile(true));
    const app = await boot(storage, async (caseId, stage) => actualQuote(caseId, stage), { initialCase: true });
    resume(app.root); page(app.root, "archive");
    expect(key(app.root, "archive").disabled).toBe(false);
    key(app.root, "archive").fire("click");
    const after = savedRun(storage);
    expect(after.archiveOwned).toBe(false); expect(after.wallet.cashCents).toBe(300);
    expect(after.camp?.decision).toBe("not-submitted");
    expect(after.history.filter((event) => event.action === "purchase-attempted" && event.data.purchase === "buy-archive")).toHaveLength(1);
    expect(after.history.some((event) => event.action === "buy-archive")).toBe(false);
    expect(seen(storage)).toEqual([]);
  });

  it("submits one combined arrangement against existing shares and executes both at the next quote", async () => {
    const before = firstCampAfterInvestment(2000);
    const storage = storageFor(before); const execution = deferred<MarketQuote>();
    const app = await boot(storage, async (caseId, stage) => stage === "t1-exec" ? execution.promise : actualQuote(caseId, stage));
    resume(app.root);
    const unchanged = storage.values.get(SAVE_KEY);
    const amount = key(app.root, "additional-entry-amount"); amount.value = "5"; amount.fire("input");
    const percent = key(app.root, "redemption-percent"); percent.value = "100"; percent.fire("change");
    expect(storage.values.get(SAVE_KEY)).toBe(unchanged);
    key(app.root, "camp-allocation-submit").fire("click");
    const pending = savedRun(storage);
    expect(pending.wallet.cashCents).toBe(before.wallet.cashCents - 500);
    expect(pending.wallet.reservedCents).toBe(500);
    expect(pending.wallet.shareUnits).toBe(before.wallet.shareUnits);
    expect(pending.market.order).toMatchObject({ kind: "sell", shareUnits: before.wallet.shareUnits, additionalEntryCents: 500 });

    const opening = actualQuote("lantern-a", "t1-exec"); execution.resolve(opening);
    await vi.waitFor(() => expect(savedRun(storage).phase).toBe("camp"));
    const settled = savedRun(storage);
    expect(settled.wallet.cashCents).toBe(before.wallet.cashCents - 500 + centsForShares(before.wallet.shareUnits, opening.price));
    expect(settled.wallet.shareUnits).toBe(sharesForCents(500, opening.price));
    expect(settled.wallet.costBasisCents).toBe(500);
    expect(settled.wallet.reservedCents).toBe(0);
    expect(settled.history.filter((event) => event.action === "submit-redemption")).toHaveLength(1);
    expect(settled.history.filter((event) => event.action === "apply-quote" && event.data.stage === "t1-exec")).toHaveLength(1);
  });

  it("shows real zero-participation choices in the report without inventing a trading type", async () => {
    const run = firstCampAfterZero(); run.observationEnabled = true;
    const storage = storageFor(run, emptyResearchProfile(true));
    const app = await boot(storage, async (caseId, stage) => actualQuote(caseId, stage));
    resume(app.root); key(app.root, "camp-allocation-submit").fire("click");
    await vi.waitFor(() => expect(savedRun(storage).camp?.decision).toBe("settled"));
    expect(savedRun(storage).wallet.shareUnits).toBe("0");
    button(app.root, "我的交易风格").fire("click");
    expect(app.root.textContent).toContain("累计已执行 0 金币");
    key(app.root, "report-open-choices").fire("click");
    key(app.root, "report-evidence-资金取舍").fire("click");
    const detail = find(app.root, (item) => item.attributes["aria-label"] === "资金取舍 · 本局记录")!;
    expect(detail.textContent).toContain("选择参与 0 金币");
    expect(detail.textContent).toContain("选择追加 0 金币");
    expect(detail.textContent).not.toContain("稳健投资者");
  });

  it("waits for the current archive data, then records separate openings at N4 and N6", async () => {
    let run = firstCampAfterZero(); run.observationEnabled = true;
    run = reduceRun(run, { type: "buy-archive" });
    const storage = storageFor(run, emptyResearchProfile(true));
    const firstSegment = deferred<MarketQuote>();
    const loader = vi.fn(async (caseId: string, stage: MarketStage) => stage === "t1" ? firstSegment.promise : actualQuote(caseId, stage));
    let app = await boot(storage, loader, { initialCase: true });
    resume(app.root);
    expect(loader).not.toHaveBeenCalled();
    page(app.root, "archive");
    await vi.waitFor(() => expect(loader.mock.calls.some((call) => call[1] === "t1")).toBe(true));
    expect(find(app.root, (item) => item.attributes["data-archive-view"] === "true")).toBeUndefined();
    expect(seen(storage)).toEqual([]);
    expect(savedRun(storage).history.some((event) => event.action === "open-archive")).toBe(false);

    page(app.root, "cards");
    firstSegment.resolve(actualQuote("lantern-a", "t1"));
    await vi.waitFor(() => expect(find(app.root, (item) => item.attributes["data-archive-view"] === "true")).toBeDefined());
    let view = find(app.root, (item) => item.attributes["data-archive-view"] === "true")!;
    expect(view.closest("[hidden]")).not.toBeNull();
    expect(seen(storage)).toEqual([]);
    expect(savedRun(storage).history.some((event) => event.action === "open-archive")).toBe(false);
    page(app.root, "archive");
    view = find(app.root, (item) => item.attributes["data-archive-view"] === "true")!;
    expect(view.textContent).toContain("2025-12-01"); expect(view.textContent).toContain("已加入 1 段");
    view.open = true; view.fire("toggle");
    expect(seen(storage)).toEqual(["lantern-a"]);
    expect(savedRun(storage).history.filter((event) => event.action === "open-archive").map((event) => event.node)).toEqual(["N4"]);

    run = reduceRun(savedRun(storage), { type: "submit-redemption", percent: 0 });
    run = reduceRun(run, { type: "apply-quote", quote: actualQuote("lantern-a", "t1-exec") });
    if (run.hp < run.maxHp) run = reduceRun(run, { type: "heal" });
    run = reduceRun(run, { type: "continue" });
    run = battleToNextQuote(run);
    run = reduceRun(run, { type: "apply-quote", quote: actualQuote("lantern-a", "t2") });
    expect(run.node).toBe("N6");
    replaceSavedRun(storage, run);
    vi.resetModules();
    const laterLoader = vi.fn(async (caseId: string, stage: MarketStage) => actualQuote(caseId, stage));
    app = await boot(storage, laterLoader, { initialCase: true });
    resume(app.root); page(app.root, "archive");
    await vi.waitFor(() => expect(find(app.root, (item) => item.attributes["data-archive-view"] === "true")).toBeDefined());
    view = find(app.root, (item) => item.attributes["data-archive-view"] === "true")!;
    expect(view.textContent).toContain("2025-12-29"); expect(view.textContent).toContain("已加入 2 段");
    expect(laterLoader.mock.calls.map((call) => call[1]).sort()).toEqual(["t1", "t2"]);
    view.open = true; view.fire("toggle");
    expect(savedRun(storage).history.filter((event) => event.action === "open-archive").map((event) => event.node)).toEqual(["N4", "N6"]);
    expect(savedRun(storage).history.filter((event) => event.action === "buy-archive")).toHaveLength(1);
  });

  it("keeps the menu and optional preferences clear without recording a choice until selected", async () => {
    const run = camp(); run.observationEnabled = true;
    const storage = storageFor(run, emptyResearchProfile(true));
    const app = await boot(storage, async () => { throw new Error("unexpected request"); });
    resume(app.root);
    const original = storage.values.get(SAVE_KEY);
    button(app.root, "菜单").fire("click");
    const menu = find(app.root, (item) => item.attributes["aria-label"] === "旅程菜单")!;
    expect(menu).toBeDefined(); expect(menu.textContent).not.toContain("回到旅程");
    button(menu, "目标与帮助").fire("click");
    const preferences = find(app.root, (item) => item.attributes["aria-label"] === "练习内容与提示")!;
    expect(preferences.textContent).toContain("不改变战斗难度，也不花金币");
    expect(preferences.textContent).toContain("进入练习后还能切换");
    expect(storage.values.get(SAVE_KEY)).toBe(original); expect(storage.writes).toEqual([]);
    button(preferences, "完成").fire("click");
    expect(storage.values.get(SAVE_KEY)).toBe(original); expect(storage.writes).toEqual([]);

    button(app.root, "菜单").fire("click");
    const reopenedMenu = find(app.root, (item) => item.attributes["aria-label"] === "旅程菜单")!;
    button(reopenedMenu, "目标与帮助").fire("click");
    key(app.root, "preference-goal-funding").fire("click");
    key(app.root, "preference-help-step").fire("click");
    const saved = JSON.parse(storage.values.get(SAVE_KEY)!) as { run: Run; profile: ResearchProfile };
    expect(saved.profile.stated_interest.at(-1)?.goal).toBe("funding");
    expect(saved.profile.help_preference.at(-1)?.help).toBe("step");
    expect(saved.profile.funding_exposure).toEqual([]);
    expect(saved.run.history).toEqual(run.history);
  });

  it("records an archive only when it is open on the visible camp tab", async () => {
    const run = camp(); run.archiveOwned = true;
    const storage = storageFor(run); const original = storage.values.get(SAVE_KEY);
    const { root } = await boot(storage, async () => { throw new Error("unexpected request"); }, { initialCase: true });
    resume(root);
    expect(find(root, (item) => item.attributes["data-archive-view"] === "true")).toBeUndefined();
    page(root, "archive");
    await vi.waitFor(() => expect(find(root, (item) => item.attributes["data-archive-view"] === "true")).toBeDefined());
    let view = find(root, (item) => item.attributes["data-archive-view"] === "true")!;
    expect(view.closest("[hidden]")).toBeNull(); expect(view.open).toBe(false);
    expect(seen(storage)).toEqual([]); expect(storage.values.get(SAVE_KEY)).toBe(original);

    page(root, "cards");
    view = find(root, (item) => item.attributes["data-archive-view"] === "true")!;
    expect(view.closest("[hidden]")).not.toBeNull();
    view.open = true; view.fire("toggle");
    expect(seen(storage)).toEqual([]); expect(storage.values.get(SAVE_KEY)).toBe(original);
    expect(savedRun(storage).history.some((event) => event.action === "open-archive")).toBe(false);

    page(root, "archive");
    view = find(root, (item) => item.attributes["data-archive-view"] === "true")!;
    expect(view.closest("[hidden]")).toBeNull(); expect(view.open).toBe(false);
    expect(seen(storage)).toEqual([]);
    view.open = true; view.fire("toggle");
    expect(seen(storage)).toEqual(["lantern-a"]);
    expect(savedRun(storage).history.filter((event) => event.action === "open-archive")).toHaveLength(1);
  });

  it("ignores a detached archive toggle and records an open archive when the dialog closes", async () => {
    const run = camp(); run.archiveOwned = true;
    const storage = storageFor(run); const { root } = await boot(storage, async () => { throw new Error("unexpected request"); }, { initialCase: true });
    resume(root);
    page(root, "archive");
    await vi.waitFor(() => expect(find(root, (item) => item.attributes["data-archive-view"] === "true")).toBeDefined());
    const oldView = find(root, (item) => item.attributes["data-archive-view"] === "true")!; oldView.open = true;
    button(root, "设置").fire("click"); oldView.fire("toggle");
    expect(seen(storage)).toEqual([]); expect(savedRun(storage).history.some((event) => event.action === "open-archive")).toBe(false);
    button(root, "完成").fire("click");
    expect(seen(storage)).toEqual(["lantern-a"]);
    expect(savedRun(storage).history.filter((event) => event.action === "open-archive")).toHaveLength(1);
  });
});
