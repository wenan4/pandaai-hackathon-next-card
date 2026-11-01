import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAMP_STOCK, CARDS } from "./content";
import { createRun, reduceRun } from "./engine";
import { emptyResearchProfile, setResearchGoal, type ResearchProfile } from "./research";
import { FUNDING_EXPOSURE_KEY, SAVE_KEY, SEEN_KEY } from "./ui-storage";
import type { CardId, Run } from "./types";

class FakeNode {
  children: (FakeNode | string)[] = [];
  parent: FakeNode | null = null;
  append(...items: (FakeNode | string)[]): void { for (const item of items) { if (item instanceof FakeNode) item.parent = this; this.children.push(item); } }
  replaceChildren(...items: (FakeNode | string)[]): void { for (const item of this.children) if (item instanceof FakeNode) item.parent = null; this.children = []; this.append(...items); }
  get textContent(): string { return this.children.map((child) => typeof child === "string" ? child : child.textContent).join(""); }
  set textContent(value: string) { this.replaceChildren(value); }
  querySelectorAll(selector: string): FakeElement[] {
    if (selector !== "[data-scroll-key]") return [];
    const results: FakeElement[] = [];
    const visit = (node: FakeNode): void => {
      if (node instanceof FakeElement && node.attributes["data-scroll-key"]) results.push(node);
      for (const child of node.children) if (child instanceof FakeNode) visit(child);
    };
    visit(this); return results;
  }
  querySelector(selector: string): FakeElement | null {
    const match = /^\[(data-(?:focus-key|scroll-key|game-receipt))="([^"]+)"\]$/.exec(selector);
    return match ? find(this, (item) => item.attributes[match[1]!] === match[2]) ?? null : null;
  }
}
class FakeElement extends FakeNode {
  attributes: Record<string, string> = {};
  listeners: Record<string, (event: { currentTarget: FakeElement }) => void> = {};
  dataset: Record<string, string> = {};
  isConnected = true; inert = false; value = ""; disabled = false; scrollLeft = 0; focusOptions?: FocusOptions;
  constructor(readonly tag: string) { super(); }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value; if (name === "value") this.value = value; if (name === "disabled") this.disabled = true; if (name === "inert") this.inert = true;
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())] = value;
  }
  addEventListener(name: string, callback: (event: { currentTarget: FakeElement }) => void): void { this.listeners[name] = callback; }
  fire(name: string): void { if (!(name === "click" && (this.disabled || this.closest("[hidden]") || this.closest("[inert]")))) this.listeners[name]?.({ currentTarget: this }); }
  closest(selector: string): FakeElement | null {
    for (let current: FakeNode | null = this; current; current = current.parent) {
      if (current instanceof FakeElement && ((selector === "[hidden]" && "hidden" in current.attributes) || (selector === "[inert]" && current.inert) || selector === current.tag)) return current;
    }
    return null;
  }
  contains(): boolean { return false; }
  focus(options?: FocusOptions): void { this.focusOptions = options; (document as unknown as { activeElement: FakeElement | null }).activeElement = this; }
  scrollIntoView(): void { /* no layout in this harness */ }
}
function find(node: FakeNode, match: (item: FakeElement) => boolean): FakeElement | undefined {
  if (node instanceof FakeElement && match(node)) return node;
  for (const child of node.children) if (child instanceof FakeNode) { const result = find(child, match); if (result) return result; }
  return undefined;
}
function key(node: FakeNode, value: string): FakeElement {
  const result = find(node, (item) => item.attributes["data-focus-key"] === value);
  if (!result) throw new Error(`element missing: ${value}`);
  return result;
}
function button(node: FakeNode, label: string): FakeElement {
  const result = find(node, (item) => item.tag === "button" && item.textContent === label);
  if (!result) throw new Error(`button missing: ${label}`);
  return result;
}
function receipt(node: FakeNode): FakeElement {
  const result = find(node, (item) => item.attributes.class === "game-receipt" && !item.closest("[hidden]") && !item.closest("[inert]"));
  if (!result) throw new Error("receipt missing");
  return result;
}
function page(node: FakeNode, name: string): void { key(node, `page-${name}`).fire("click"); }
class MemoryStorage {
  values = new Map<string, string>();
  writes: string[] = [];
  getItem(name: string): string | null { return this.values.get(name) ?? null; }
  setItem(name: string, value: string): void { this.writes.push(name); this.values.set(name, value); }
  removeItem(name: string): void { this.writes.push(name); this.values.delete(name); }
}
const manifest = JSON.parse(readFileSync("public/data/adventure/manifest.v2.json", "utf8")) as unknown;

function rewardRun(observationEnabled = false): Run {
  let run = createRun({ seed: 104, caseId: "lantern-a", observationEnabled });
  const play = (cardId: CardId): void => {
    const card = run.deck.find((item) => item.cardId === cardId && run.battle?.hand.includes(item.instanceId));
    if (!card) throw new Error(`missing card ${cardId}`);
    run = reduceRun(run, { type: "play-card", cardInstanceId: card.instanceId });
  };
  for (const card of ["C02", "C03", "C01"] as CardId[]) play(card);
  run = reduceRun(run, { type: "end-turn" });
  for (const card of ["C01", "C04", "C02", "C02"] as CardId[]) play(card);
  run = reduceRun(run, { type: "end-turn" }); play("C02");
  run = reduceRun(run, { type: "end-turn" }); play("C01");
  if (run.phase !== "reward") throw new Error("fixture did not reach reward");
  return run;
}
function campRun(node: "N2" | "N4" | "N6", hp = 38): Run {
  const run = reduceRun(rewardRun(), { type: "choose-reward", cardId: null });
  run.node = node; run.hp = hp;
  run.camp = { node, stock: [...CAMP_STOCK[node]], purchased: [], freeChoiceUsed: false, decision: node === "N2" ? "not-submitted" : "settled" };
  return run;
}
function investedRoute(): Run {
  let run = campRun("N2");
  run = reduceRun(run, { type: "submit-entry", amountCents: 2000 });
  run = reduceRun(run, { type: "continue" });
  return reduceRun(run, { type: "apply-quote", quote: { caseId: run.caseId, step: "entry", date: "20220103", price: 1_000_000 } });
}
function pendingDefeat(): Run {
  let run = investedRoute();
  run = reduceRun(run, { type: "choose-route", enemyId: "pursuer" });
  run.hp = 1; run.battle!.shield = 0; run.battle!.enemy.intent = { kind: "attack", amount: 8 };
  return reduceRun(run, { type: "end-turn" });
}
function pendingReturn(): Run {
  const run = investedRoute(); run.node = "N6"; run.phase = "camp";
  run.camp = { node: "N6", stock: [...CAMP_STOCK.N6], purchased: [], freeChoiceUsed: false, decision: "settled" };
  return reduceRun(run, { type: "return-home" });
}
function pendingBossVictory(): Run {
  let run = reduceRun(investedRoute(), { type: "choose-route", enemyId: "pursuer" });
  run.node = "N7";
  run.battle!.enemy = { id: "keeper", hp: 1, maxHp: 90, shield: 0, intent: { kind: "attack", amount: 6 }, attackBonus: 0 };
  const attack = run.deck.find((card) => card.cardId === "C01")!;
  for (const zone of [run.battle!.hand, run.battle!.drawPile, run.battle!.discardPile, run.battle!.exhaustPile]) {
    const index = zone.indexOf(attack.instanceId); if (index >= 0) zone.splice(index, 1);
  }
  run.battle!.hand.push(attack.instanceId); run.battle!.energy = 3;
  run = reduceRun(run, { type: "play-card", cardInstanceId: attack.instanceId });
  return run;
}
function storageFor(run: Run, profile: ResearchProfile = emptyResearchProfile(run.observationEnabled)): MemoryStorage {
  const storage = new MemoryStorage();
  storage.values.set(SAVE_KEY, JSON.stringify({ schema: "nextcard-adventure-save-v1", savedAt: Date.now(), observationStartedAt: Date.now(), run, profile }));
  return storage;
}
function savedRun(storage: MemoryStorage): Run { return (JSON.parse(storage.values.get(SAVE_KEY)!) as { run: Run }).run; }

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.doUnmock("./market"); vi.resetModules(); vi.unstubAllGlobals(); });
async function boot(storage: MemoryStorage) {
  const root = new FakeElement("app");
  vi.stubGlobal("Node", FakeNode);
  vi.stubGlobal("HTMLButtonElement", FakeElement);
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  vi.stubGlobal("document", { activeElement: null, querySelector: (selector: string) => selector === "#app" ? root : null, createElement: (tag: string) => new FakeElement(tag), createElementNS: (_ns: string, tag: string) => new FakeElement(tag) });
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage, scrollY: 0, scrollTo: vi.fn(), setTimeout: vi.fn(() => 0), clearTimeout: vi.fn() });
  vi.doMock("./market", async (importOriginal) => ({ ...(await importOriginal<typeof import("./market")>()), loadMarketInitial: async () => manifest, loadMarketInitialCase: () => new Promise(() => {}) }));
  await import("./ui");
  await vi.waitFor(() => expect(root.textContent).not.toContain("正在加载案例目录"));
  button(root, "继续上次旅程").fire("click");
  return root;
}

describe("game feedback and confirmation", () => {
  it("only previews reward cards, permits cancellation, and forgets the selection on refresh", async () => {
    const run = rewardRun(); const storage = storageFor(run); const raw = storage.values.get(SAVE_KEY);
    let root = await boot(storage);
    expect(key(root, "confirm-reward").attributes.disabled).toBe("");
    expect(key(root, "reward-C07").attributes["aria-pressed"]).toBe("false");
    key(root, "reward-C07").fire("click");
    expect(key(root, "reward-C07").attributes["aria-pressed"]).toBe("true");
    expect(key(root, "reward-C07").attributes.class).toContain("selected");
    expect(root.textContent).toContain("已选 连刃，尚未加入牌组");
    key(root, "reward-C11").fire("click");
    expect(key(root, "reward-C07").attributes["aria-pressed"]).toBe("false");
    expect(key(root, "reward-C11").attributes["aria-pressed"]).toBe("true");
    button(root, "取消选择").fire("click");
    expect(key(root, "confirm-reward").attributes.disabled).toBe("");
    key(root, "reward-C07").fire("click");
    expect(storage.values.get(SAVE_KEY)).toBe(raw); expect(storage.writes).toEqual([]);
    vi.resetModules(); root = await boot(storage);
    expect(key(root, "reward-C07").attributes["aria-pressed"]).toBe("false");
    expect(key(root, "confirm-reward").attributes.disabled).toBe("");
    expect(storage.values.get(SAVE_KEY)).toBe(raw); expect(storage.writes).toEqual([]);
    key(root, "reward-C07").fire("click"); key(root, "confirm-reward").fire("click");
    const after = savedRun(storage);
    expect(after.phase).toBe("camp"); expect(after.deck.length).toBe(run.deck.length + 1);
    expect(after.deck.at(-1)?.cardId).toBe("C07");
    expect(receipt(root).textContent).toContain("连刃已加入牌组");
    expect(receipt(root).attributes.role).toBe("status");
    page(root, "cards");
    expect(find(root, (item) => item.attributes.class === "game-receipt")).toBeUndefined();
    expect(savedRun(storage).deck.at(-1)?.cardId).toBe("C07");
    expect(savedRun(storage).history.filter((event) => event.action === "choose-reward")).toHaveLength(1);
  });

  it("can explicitly skip without choosing and reports the unchanged deck", async () => {
    const before = rewardRun(); const storage = storageFor(before); const root = await boot(storage);
    key(root, "skip-reward").fire("click");
    expect(savedRun(storage).deck).toEqual(before.deck);
    expect(receipt(root).textContent).toContain("本次没有加入新牌");
  });

  it("returns focus to the cancelled reward without moving its scroll position or saving", async () => {
    const storage = storageFor(rewardRun()); const original = storage.values.get(SAVE_KEY); const root = await boot(storage);
    key(root, "reward-C10").fire("click");
    const choices = find(root, (item) => item.attributes["data-scroll-key"] === "reward-choices")!;
    choices.scrollLeft = 137;
    const cancel = key(root, "cancel-reward"); cancel.focus(); cancel.fire("click");
    const card = key(root, "reward-C10");
    expect(document.activeElement).toBe(card); expect(card.focusOptions).toEqual({ preventScroll: true });
    expect(card.attributes["aria-pressed"]).toBe("false");
    expect(find(root, (item) => item.attributes["data-scroll-key"] === "reward-choices")?.scrollLeft).toBe(137);
    expect(storage.values.get(SAVE_KEY)).toBe(original); expect(storage.writes).toEqual([]);
  });

  it("keeps observed data, exposure records, and history untouched until a reward is confirmed", async () => {
    const run = rewardRun(true);
    const storage = storageFor(run, setResearchGoal(emptyResearchProfile(true), "goal-1", "funding"));
    storage.values.set(SEEN_KEY, '["lantern-b"]');
    storage.values.set(FUNDING_EXPOSURE_KEY, JSON.stringify({ version: 1, createdAt: Date.now(), entries: [] }));
    const original = [...storage.values.entries()]; const root = await boot(storage);
    key(root, "reward-C07").fire("click"); key(root, "reward-C11").fire("click");
    button(root, "取消选择").fire("click"); key(root, "reward-C07").fire("click");
    expect([...storage.values.entries()]).toEqual(original); expect(storage.writes).toEqual([]);
    expect(savedRun(storage).history).toEqual(run.history); expect(savedRun(storage).seed).toBe(run.seed);
    key(root, "confirm-reward").fire("click");
    expect(savedRun(storage).history.filter((event) => event.action === "choose-reward")).toHaveLength(1);
    expect(receipt(root).textContent).toContain("连刃已加入牌组");
    expect(storage.values.get(SEEN_KEY)).toBe(original.find(([name]) => name === SEEN_KEY)?.[1]);
    expect(storage.values.get(FUNDING_EXPOSURE_KEY)).toBe(original.find(([name]) => name === FUNDING_EXPOSURE_KEY)?.[1]);
  });

  it("starts on allocation and lets the player defer or confirm a purchase before investing", async () => {
    const run = campRun("N2"); const storage = storageFor(run); const original = storage.values.get(SAVE_KEY);
    const root = await boot(storage);
    expect(key(root, "page-allocation").attributes["aria-pressed"]).toBe("true");
    expect(key(root, "page-cards").attributes["aria-pressed"]).toBe("false");
    expect(key(root, "entry-submit").closest("[hidden]")).toBeNull();
    expect(key(root, "buy-C08").closest("[hidden]")).not.toBeNull();
    expect(key(root, "camp-continue").attributes.disabled).toBe("");

    page(root, "cards"); key(root, "buy-C08").fire("click");
    expect(root.textContent).toContain("花费 25 金币后剩 47");
    expect(root.textContent).toContain("你还没决定留多少参与随行投资");
    expect(storage.values.get(SAVE_KEY)).toBe(original); expect(storage.writes).toEqual([]);
    button(root, "先安排金币").fire("click");
    expect(key(root, "page-allocation").attributes["aria-pressed"]).toBe("true");
    expect(storage.values.get(SAVE_KEY)).toBe(original); expect(storage.writes).toEqual([]);
    expect(savedRun(storage).deck).toEqual(run.deck);

    page(root, "cards"); key(root, "buy-C08").fire("click"); button(root, "继续购买").fire("click");
    expect(savedRun(storage).wallet.cashCents).toBe(4700);
    expect(savedRun(storage).market.entryCommitted).toBe(false);
    expect(savedRun(storage).history.filter((event) => event.action === "buy-card")).toHaveLength(1);
    expect(receipt(root).textContent).toContain("余烬已加入牌组，花费 25 金币；剩余 47 金币");
  });

  it("shows a below-budget purchase tradeoff and does not charge when the player keeps the coins", async () => {
    let run = campRun("N2");
    run = reduceRun(run, { type: "submit-entry", amountCents: 1000 });
    run = reduceRun(run, { type: "set-supply-plan", amountCents: 5000 });
    const storage = storageFor(run); const original = storage.values.get(SAVE_KEY); const root = await boot(storage);
    page(root, "cards"); key(root, "buy-C08").fire("click");
    expect(root.textContent).toContain("这次消费会低于补给预算");
    expect(root.textContent).toContain("花费 25 金币后剩 37");
    expect(root.textContent).toContain("此前希望留 50 给补给");
    button(root, "先保留金币").fire("click");
    expect(storage.values.get(SAVE_KEY)).toBe(original); expect(storage.writes).toEqual([]);
    expect(savedRun(storage).deck).toEqual(run.deck);

    key(root, "buy-C08").fire("click"); button(root, "继续购买").fire("click");
    expect(savedRun(storage).wallet.cashCents).toBe(3700);
    expect(savedRun(storage).wallet.reservedCents).toBe(1000);
    expect(savedRun(storage).history.filter((event) => event.action === "buy-card")).toHaveLength(1);
  });

  it("can follow the reminder to invest first, then buy with the actual remaining balance", async () => {
    const storage = storageFor(campRun("N2")); const root = await boot(storage);
    page(root, "cards"); key(root, "buy-C08").fire("click"); button(root, "先安排金币").fire("click");
    const entry = key(root, "entry-amount"); entry.value = "20"; entry.fire("input");
    expect(key(root, "entry-submit").textContent).toBe("确认参与 20 金币");
    key(root, "entry-submit").fire("click");
    expect(savedRun(storage).wallet.cashCents).toBe(5200);
    expect(savedRun(storage).wallet.reservedCents).toBe(2000);
    page(root, "cards"); key(root, "buy-C08").fire("click");
    expect(savedRun(storage).wallet.cashCents).toBe(2700);
    expect(savedRun(storage).wallet.reservedCents).toBe(2000);
    expect(savedRun(storage).history.filter((event) => ["submit-entry", "buy-card"].includes(event.action)).map((event) => event.action)).toEqual(["submit-entry", "buy-card"]);
    expect(receipt(root).textContent).toContain("余烬已加入牌组，花费 25 金币；剩余 27 金币");
  });

  it("shows real paid changes in the shop and keeps same-name card ordinals stable", async () => {
    const storage = storageFor(campRun("N2")); const root = await boot(storage);
    page(root, "supplies");
    expect(key(root, "upgrade-select").textContent).toContain("敲击 · 第 1 张");
    key(root, "upgrade").fire("click");
    button(root, "继续购买").fire("click");
    expect(receipt(root).textContent).toContain("敲击（第 1 张）已升级");
    expect(receipt(root).textContent).toContain("花费 20 金币；剩余 52 金币");
    expect(key(root, "upgrade-select").textContent).toContain("敲击 · 第 2 张");
    expect(key(root, "upgrade-select").textContent).not.toContain("敲击 · 第 1 张");
    key(root, "heal").fire("click");
    button(root, "继续购买").fire("click");
    expect(receipt(root).textContent).toContain("生命 38 → 42，恢复 4 点");
    expect(receipt(root).textContent).toContain("花费 10 金币；剩余 42 金币");
    page(root, "cards"); key(root, "buy-C08").fire("click"); button(root, "继续购买").fire("click");
    expect(receipt(root).textContent).toContain(`${CARDS.C08.name}已加入牌组，花费 25 金币；剩余 17 金币`);
    page(root, "archive"); key(root, "archive").fire("click");
    expect(receipt(root).textContent).toContain("历史档案已拥有，花费 4 金币；剩余 13 金币");
    expect(savedRun(storage).wallet.cashCents).toBe(1300);
    page(root, "supplies"); key(root, "upgrade").fire("click");
    expect(find(root, (item) => item.attributes.class === "game-receipt" && !item.closest("[hidden]"))).toBeUndefined();
    expect(root.textContent).toContain("可用金币不足，这次购买没有完成");
    expect(savedRun(storage).history.at(-1)?.action).toBe("purchase-attempted");
  });

  it("clears a receipt when forking a simulation and restoring the real journey", async () => {
    const run = campRun("N2"); run.wallet.cashCents = 1000;
    const storage = storageFor(run); const root = await boot(storage);
    page(root, "archive"); key(root, "archive").fire("click"); expect(receipt(root).textContent).toContain("档案购买成功");
    button(root, "评委面板").fire("click"); button(root, "从这里分叉").fire("click");
    expect(find(root, (item) => item.attributes.class === "game-receipt")).toBeUndefined();
    expect(root.textContent).toContain("模拟");
    button(root, "评委面板").fire("click"); button(root, "恢复真实旅程").fire("click");
    expect(find(root, (item) => item.attributes.class === "game-receipt")).toBeUndefined();
    page(root, "archive");
    expect(savedRun(storage).archiveOwned).toBe(true);
    expect(root.textContent).toContain("正在加载本局已固定案例的历史档案");
    page(root, "supplies"); key(root, "upgrade").fire("click"); expect(root.textContent).toContain("可用金币不足，这次购买没有完成");
    button(root, "评委面板").fire("click"); button(root, "从这里分叉").fire("click");
    expect(root.textContent).not.toContain("可用金币不足，这次购买没有完成");
  });

  it("keeps a reward receipt visible when an automatic quote opens the next camp", async () => {
    const run = rewardRun(); run.node = "N3"; run.reward = { choices: ["C08", "C12", "C06"], coinsCents: 1200 };
    const storage = storageFor(run);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ caseId: run.caseId, step: "t1", date: "20220105", price: 1_000_000,
      segment: { dates: ["20220104", "20220105"], asset: [1_000_000, 1_000_000], benchmark: [1_000_000, 1_000_000] } }), { status: 200 })));
    const root = await boot(storage);
    key(root, "reward-C08").fire("click"); key(root, "confirm-reward").fire("click");
    await vi.waitFor(() => expect(savedRun(storage).node).toBe("N4"));
    expect(savedRun(storage).phase).toBe("camp"); expect(receipt(root).textContent).toContain("余烬已加入牌组");
    page(root, "free");
    expect(find(root, (item) => item.attributes.class === "game-receipt")).toBeUndefined();
    expect(savedRun(storage).deck.at(-1)?.cardId).toBe("C08");
    expect(savedRun(storage).history.filter((event) => event.action === "choose-reward")).toHaveLength(1);
  });

  it.each(["N4", "N6"] as const)("shows and applies only the available free healing in %s", async (node) => {
    const storage = storageFor(campRun(node)); const root = await boot(storage);
    page(root, "free");
    expect(key(root, "free-rest").textContent).toBe("休息，恢复 4 生命");
    key(root, "free-rest").fire("click");
    expect(receipt(root).textContent).toContain("生命 38 → 42，恢复 4 点；未花费金币");
    expect(root.textContent).toContain("本营地的免费整备已使用");
    expect(savedRun(storage).camp?.freeChoiceUsed).toBe(true);
  });

  it("does not spend a free choice after paid healing reaches full health", async () => {
    const storage = storageFor(campRun("N4")); const root = await boot(storage);
    page(root, "supplies"); key(root, "heal").fire("click"); page(root, "free");
    expect(key(root, "free-rest").textContent).toBe("休息，恢复 0 生命");
    expect(key(root, "free-rest").attributes.disabled).toBe("");
    key(root, "free-rest").fire("click");
    expect(savedRun(storage).camp?.freeChoiceUsed).toBe(false);
    key(root, "free-upgrade").fire("click");
    expect(receipt(root).textContent).toContain("免费整理完成");
    expect(receipt(root).textContent).toContain("未花费金币");
    expect(savedRun(storage).camp?.freeChoiceUsed).toBe(true);
  });

  it("does not suggest an unavailable upgrade or departure before settlement", async () => {
    const run = campRun("N4", 42); run.camp!.decision = "not-submitted";
    const root = await boot(storageFor(run));
    page(root, "free");
    expect(key(root, "free-rest").attributes.disabled).toBe("");
    expect(root.textContent).toContain("生命已满，暂不能休息；请先完成契约安排与结算");
    expect(root.textContent).not.toContain("你可以免费升级基础牌");
  });

  it("keeps a defeated ending and locked order on rejected quote, reloads the corrected stage, and settles once", async () => {
    const run = pendingDefeat(); expect(run.status).toBe("defeated"); expect(run.market.order?.kind).toBe("sell");
    const storage = storageFor(run); const original = storage.values.get(SAVE_KEY);
    const fetchQuote = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ caseId: run.caseId, step: "exit-after-entry", date: fetchQuote.mock.calls.length === 1 ? "20220102" : "20220104", price: 1_000_000 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchQuote);
    const root = await boot(storage);
    await vi.waitFor(() => expect(root.textContent).toContain("报价必须晚于已推进的时间点"));
    expect(root.textContent).toContain("战斗失败"); expect(root.textContent).toContain("自动回收正等待报价");
    expect(root.textContent).toContain("重试不会重复提交订单");
    expect(storage.values.get(SAVE_KEY)).toBe(original); expect(storage.writes).toEqual([]);
    key(root, "retry-market").fire("click");
    await vi.waitFor(() => expect(savedRun(storage).phase).toBe("ended"));
    const after = savedRun(storage);
    expect(fetchQuote).toHaveBeenCalledTimes(2);
    expect(fetchQuote.mock.calls[1]?.[1]).toEqual({ cache: "no-store" });
    expect(after.status).toBe("defeated"); expect(after.market.order).toBeNull();
    expect(after.history.filter((event) => event.action === "auto-liquidation")).toHaveLength(1);
    expect(after.wallet.ledger.filter((entry) => entry.kind === "redemption")).toHaveLength(1);
  });

  it.each([["returned", pendingReturn, "提前返程"], ["cleared", pendingBossVictory, "冒险通关"]] as const)("keeps the %s ending clear when its quote fails", async (status, makeRun, ending) => {
    const run = makeRun(); const storage = storageFor(run); const original = storage.values.get(SAVE_KEY);
    expect(run.status).toBe(status); expect(run.phase).toBe("market");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network failed"); }));
    const root = await boot(storage);
    await vi.waitFor(() => expect(root.textContent).toContain("报价未能完成处理"));
    expect(root.textContent).toContain(ending);
    if (status === "cleared") {
      expect(run.market.order).toBeNull(); expect(run.market.pending?.stage).toBe("t3");
      expect(root.textContent).toContain("最终时点报价尚未到达");
      expect(root.textContent).toContain("报价处理后剩余份额还需回收");
      expect(root.textContent).not.toContain("已锁定的订单");
    } else {
      expect(run.market.order?.kind).toBe("sell");
      expect(root.textContent).toContain("自动回收正等待报价");
    }
    key(root, "retry-market").fire("click");
    await vi.waitFor(() => expect(root.textContent).toContain("报价未能完成处理"));
    expect(root.textContent).toContain(ending); expect(storage.values.get(SAVE_KEY)).toBe(original); expect(storage.writes).toEqual([]);
  });
});
