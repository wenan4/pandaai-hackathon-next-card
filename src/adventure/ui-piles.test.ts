import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CARDS } from "./content";
import { createRun, reduceRun } from "./engine";
import { emptyResearchProfile } from "./research";
import type { CardId, Run } from "./types";
import { gameView, type GameViewContext } from "./ui-game";
import { pileView, type PileKind } from "./ui-piles";

class FakeNode {
  children: (FakeNode | string)[] = [];
  append(...items: (FakeNode | string)[]): void { this.children.push(...items); }
  replaceChildren(...items: (FakeNode | string)[]): void { this.children = []; this.append(...items); }
  get textContent(): string { return this.children.map((child) => typeof child === "string" ? child : child.textContent).join(""); }
}
class FakeElement extends FakeNode {
  attributes: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  value = "";
  constructor(readonly tag: string) { super(); }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  addEventListener(name: string, listener: () => void): void { this.listeners[name] = listener; }
  fire(name: string): void { this.listeners[name]?.(); }
}
function find(node: FakeNode, match: (element: FakeElement) => boolean): FakeElement | undefined {
  if (node instanceof FakeElement && match(node)) return node;
  for (const child of node.children) if (child instanceof FakeNode) { const item = find(child, match); if (item) return item; }
  return undefined;
}
function button(node: FakeNode, label: string): FakeElement {
  const item = find(node, (element) => element.tag === "button" && element.textContent === label);
  if (!item) throw new Error(`button not found: ${label}`);
  return item;
}
function tree(node: FakeNode): unknown {
  return { ...(node instanceof FakeElement ? { tag: node.tag, attributes: node.attributes } : {}), children: node.children.map((child) => typeof child === "string" ? child : tree(child)) };
}
function rig(): Run {
  const run = createRun({ seed: 104 });
  const cards: CardId[] = ["C14", "C01", "C12", "C03", "C04", "C02", "C05", "C06"];
  run.deck = cards.map((cardId, index) => ({ instanceId: `private-card-${index}`, cardId, upgraded: index === 6 }));
  run.battle!.hand = run.deck.slice(0, 3).map((card) => card.instanceId);
  run.battle!.drawPile = run.deck.slice(3).map((card) => card.instanceId);
  run.battle!.discardPile = []; run.battle!.exhaustPile = []; run.battle!.retainedOnce = [];
  return run;
}
function context(run: Run, openPile: (pile: PileKind) => void): GameViewContext {
  return { run, initialCase: null, initialCaseError: null, initialCaseLoading: false, retryInitialCase: vi.fn(), selectedCard: "private-card-0", selectedRetain: "private-card-1", selectedUpgrade: null, selectedReward: null,
    entryCents: 0, reserveCents: 0, marketLoading: false, marketError: null, battleFeedback: "", gameFeedback: null, tutorialStep: 4, action: vi.fn(), selectCard: vi.fn(), selectRetain: vi.fn(), selectUpgrade: vi.fn(), selectReward: vi.fn(),
    setEntry: vi.fn(), setReserve: vi.fn(), retryMarket: vi.fn(), extraCamp: () => null, openReport: vi.fn(), openTask: vi.fn(), openPile, openEnemyPlan: vi.fn(), archiveShown: vi.fn(), nextTutorial: vi.fn(), skipTutorial: vi.fn() };
}
beforeEach(() => { vi.stubGlobal("Node", FakeNode); vi.stubGlobal("document", { createElement: (tag: string) => new FakeElement(tag) }); });
afterEach(() => vi.unstubAllGlobals());

describe("read-only pile viewer", () => {
  it("switches five zones without changing selected C14, its target, the run, profile, or storage", () => {
    const run = rig(); const profile = emptyResearchProfile();
    const savedRun = JSON.stringify(run); const savedProfile = JSON.stringify(profile); const storageWrite = vi.fn();
    vi.stubGlobal("localStorage", { setItem: storageWrite });
    let dialog: FakeElement | null = null;
    const ctx = context(run, (pile) => { dialog = pileView(run, pile) as unknown as FakeElement; });
    const view = gameView(ctx) as unknown as FakeElement;
    const draw = find(view, (element) => element.attributes["data-focus-key"] === "pile-draw");
    expect(draw?.attributes["aria-label"]).toBe("查看抽牌堆，5 张");
    draw!.fire("click");
    const pane = dialog as unknown as FakeElement;
    expect(pane.textContent).toContain("抽牌堆");
    for (const name of ["手牌", "弃牌堆", "消耗区", "完整牌组", "抽牌堆"]) button(pane, name).fire("click");
    expect(ctx.selectedCard).toBe("private-card-0"); expect(ctx.selectedRetain).toBe("private-card-1");
    expect(ctx.action).not.toHaveBeenCalled(); expect(ctx.selectCard).not.toHaveBeenCalled(); expect(ctx.selectRetain).not.toHaveBeenCalled();
    expect(JSON.stringify(run)).toBe(savedRun); expect(JSON.stringify(profile)).toBe(savedProfile); expect(storageWrite).not.toHaveBeenCalled();
  });
  it("reveals only sorted composition, never draw order, IDs or the next card", () => {
    const run = rig(); const reversed = structuredClone(run); reversed.battle!.drawPile.reverse(); reversed.battle!.rngState = 123;
    const first = tree(pileView(run, "draw") as unknown as FakeNode);
    const second = tree(pileView(reversed, "draw") as unknown as FakeNode);
    expect(first).toEqual(second);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain("private-card"); expect(serialized).not.toContain("rngState");
    expect(serialized).toContain("引根+"); expect(serialized).toContain("1 能量");
    const pane = pileView(run, "draw") as unknown as FakeElement;
    const upgraded = find(pane, (element) => element.tag === "li" && element.textContent.startsWith("引根+"));
    expect(upgraded?.textContent).toContain("1 能量");
    expect(upgraded?.textContent).toContain(CARDS.C05.upgradedDescription);
    expect(serialized).toContain("需要继续抽牌且抽牌堆为空时");
  });
  it("does not guess an incomplete draw composition", () => {
    const run = rig(); run.battle!.drawPile.push("missing-card");
    const view = pileView(run, "draw") as unknown as FakeElement;
    expect(view.textContent).toContain("当前抽牌堆组成无法确认");
    expect(view.textContent).not.toContain("引根");
    expect(JSON.stringify(tree(view))).not.toContain("missing-card");
  });
  it("distinguishes one-turn and inherent retain without changing the accessible card name", () => {
    let run = reduceRun(rig(), { type: "play-card", cardInstanceId: "private-card-0", retainCardId: "private-card-1" });
    let view = gameView(context(run, vi.fn())) as unknown as FakeElement;
    const temporary = find(view, (element) => element.attributes["data-focus-key"] === "card-private-card-1")!;
    const permanent = find(view, (element) => element.attributes["data-focus-key"] === "card-private-card-2")!;
    expect(temporary.textContent).toContain("本次结束后保留"); expect(permanent.textContent).toContain("保留至打出");
    expect(temporary.attributes["aria-label"]).toBe(`${CARDS.C01.name}，费用 ${CARDS.C01.cost}。${CARDS.C01.description}`);
    expect(temporary.attributes["aria-describedby"]).toBeDefined(); expect(permanent.attributes["aria-describedby"]).toBeDefined();
    run = reduceRun(run, { type: "end-turn" });
    view = gameView(context(run, vi.fn())) as unknown as FakeElement;
    expect(find(view, (element) => element.attributes["data-focus-key"] === "card-private-card-1")?.attributes["data-retain"]).toBeUndefined();
    expect(find(view, (element) => element.attributes["data-focus-key"] === "card-private-card-2")?.attributes["data-retain"]).toBe("permanent");
  });
  it("does not add overlapping retention counts together", () => {
    const run = reduceRun(rig(), { type: "play-card", cardInstanceId: "private-card-0", retainCardId: "private-card-2" });
    const pane = pileView(run, "hand") as unknown as FakeElement;
    expect(pane.textContent).toContain("保留至打出 1 张；本次结束后保留 1 张（可能是同一张）");
    const view = gameView(context(run, vi.fn())) as unknown as FakeElement;
    expect(find(view, (element) => element.attributes["data-focus-key"] === "card-private-card-2")?.textContent).toContain("保留至打出 · 本次也保留");
  });
  it("shows actual turn-start recovery after overload separately from current energy", () => {
    let run = rig(); run.battle!.hand.push("private-card-4"); run.battle!.drawPile = run.battle!.drawPile.filter((id) => id !== "private-card-4");
    run = reduceRun(run, { type: "play-card", cardInstanceId: "private-card-4" });
    expect(run.battle!.energy).toBe(5);
    run = reduceRun(run, { type: "end-turn" });
    expect(run.battle!.energy).toBe(1);
    const view = gameView(context(run, vi.fn())) as unknown as FakeElement;
    expect(view.textContent).toContain("本回合开始恢复 1/3，已结算过载 2");
    expect(view.textContent).toContain("现在可用能量1");
  });
});
