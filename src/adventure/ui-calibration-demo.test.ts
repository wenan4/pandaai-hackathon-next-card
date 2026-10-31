import { afterEach, describe, expect, it, vi } from "vitest";
import type { Run } from "./types";

const demo = vi.hoisted(() => ({ make: vi.fn(), context: vi.fn() }));
vi.mock("./calibration-demo", () => ({ makeCalibrationDemo: demo.make, calibrationDemoContext: demo.context }));
import { CalibrationDemoUI } from "./ui-calibration-demo";

// A small DOM surface is enough to exercise the actual controls without a browser dependency.
class FakeNode {
  children: (FakeNode | string)[] = [];
  append(...items: (FakeNode | string)[]): void { this.children.push(...items); }
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
}
function find(node: FakeNode, match: (item: FakeElement) => boolean): FakeElement | undefined {
  if (node instanceof FakeElement && match(node)) return node;
  for (const child of node.children) {
    if (child instanceof FakeNode) { const result = find(child, match); if (result) return result; }
  }
  return undefined;
}
function getButton(panel: FakeNode, text: string): FakeElement {
  const result = find(panel, (element) => element.tag === "button" && element.textContent === text);
  if (!result) throw new Error(`button not found: ${text}`);
  return result;
}
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

describe("judge calibration simulation reset", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it("forgets shown results and inputs, and ignores a pending result after clearing", async () => {
    vi.stubGlobal("Node", FakeNode);
    vi.stubGlobal("document", { createElement: (tag: string) => new FakeElement(tag) });
    const pending: ((value: Run) => void)[] = [];
    demo.make.mockImplementation(() => new Promise<Run>((resolve) => { pending.push(resolve); }));
    demo.context.mockReturnValue({ caseId: "lantern-d", node: "N4", amountCents: 2000, referenceValueCents: 1743, cashCents: 3900, health: 42, maxHealth: 42, priorExposure: false, autonomousChoice: true, pendingSettlement: false, forcedOrAutomatic: false, changedGoalOrUnderstanding: false, afterCloseBeforeExecution: true, sameShareBasis: true });
    const run = { caseId: "lantern-d" } as Run;
    const onExposed = vi.fn();
    const ui = new CalibrationDemoUI({ refresh: vi.fn(), isVisible: () => true, canPresentData: () => true, onExposed });
    const render = (): FakeElement => ui.render() as unknown as FakeElement;

    getButton(render(), "打开模拟对照").fire("click");
    pending.shift()!(run); await flush();
    expect(onExposed).toHaveBeenCalledOnce();
    expect(render().textContent).toContain("当前参考价值");
    const feeling = find(render(), (element) => element.tag === "select" && element.attributes["data-focus-key"] === "sim-模拟：事前预计的感受");
    expect(feeling).toBeDefined();
    feeling!.value = "strong"; feeling!.fire("change");
    expect(render().textContent).toContain("比事前预想更轻");

    ui.reset();
    expect(render().textContent).not.toContain("当前参考价值");
    getButton(render(), "打开模拟对照").fire("click");
    ui.reset();
    getButton(render(), "打开模拟对照").fire("click");
    pending.shift()!(run); await flush(); // The old request resolves while the new one is loading.
    expect(onExposed).toHaveBeenCalledOnce();
    expect(render().textContent).not.toContain("当前参考价值");
    expect(render().textContent).toContain("正在准备真实案例");
    pending.shift()!(run); await flush();
    expect(onExposed).toHaveBeenCalledTimes(2);
    expect(render().textContent).toContain("比事前预想更强");
  });

  it.each(["modal", "background"] as const)("holds unpresented data during %s and reveals it once", async () => {
    vi.stubGlobal("Node", FakeNode);
    vi.stubGlobal("document", { createElement: (tag: string) => new FakeElement(tag) });
    let release: (value: Run) => void = () => { throw new Error("simulation not started"); };
    demo.make.mockImplementation(() => new Promise<Run>((resolve) => { release = resolve; }));
    demo.context.mockReturnValue({ caseId: "lantern-d", node: "N4", amountCents: 2000, referenceValueCents: 1743, cashCents: 3900, health: 42, maxHealth: 42, priorExposure: false, autonomousChoice: true, pendingSettlement: false, forcedOrAutomatic: false, changedGoalOrUnderstanding: false, afterCloseBeforeExecution: true, sameShareBasis: true });
    let presentable = true; const exposed = vi.fn(); const refresh = vi.fn();
    const ui = new CalibrationDemoUI({ refresh, isVisible: () => true, canPresentData: () => presentable, onExposed: exposed });
    getButton(ui.render() as unknown as FakeElement, "打开模拟对照").fire("click");
    presentable = false; release({ caseId: "lantern-d" } as Run); await flush();
    ui.resumePendingPresentation();
    expect(exposed).not.toHaveBeenCalled();
    expect(ui.render().textContent).not.toContain("当前参考价值");
    expect(ui.render().textContent).toContain("正在准备真实案例");
    presentable = true; ui.resumePendingPresentation();
    expect(ui.render().textContent).toContain("当前参考价值");
    expect(exposed).toHaveBeenCalledOnce();
    ui.resumePendingPresentation(); expect(exposed).toHaveBeenCalledOnce();
  });

  it("drops unshown work on leave, keeps already shown content, and ignores stale completions", async () => {
    vi.stubGlobal("Node", FakeNode);
    vi.stubGlobal("document", { createElement: (tag: string) => new FakeElement(tag) });
    const resolves: ((run: Run) => void)[] = [];
    demo.make.mockImplementation(() => new Promise<Run>((resolve) => { resolves.push(resolve); }));
    demo.context.mockReturnValue({ caseId: "lantern-d", node: "N4", amountCents: 2000, referenceValueCents: 1743, cashCents: 3900, health: 42, maxHealth: 42, priorExposure: false, autonomousChoice: true, pendingSettlement: false, forcedOrAutomatic: false, changedGoalOrUnderstanding: false, afterCloseBeforeExecution: true, sameShareBasis: true });
    let presentable = true; const exposed = vi.fn();
    const ui = new CalibrationDemoUI({ refresh: vi.fn(), isVisible: () => true, canPresentData: () => presentable, onExposed: exposed });
    const run = { caseId: "lantern-d" } as Run;
    getButton(ui.render() as unknown as FakeElement, "打开模拟对照").fire("click");
    ui.leave();
    getButton(ui.render() as unknown as FakeElement, "打开模拟对照").fire("click");
    resolves.shift()!(run); await flush();
    expect(exposed).not.toHaveBeenCalled();
    expect(ui.render().textContent).not.toContain("当前参考价值");
    presentable = false; resolves.shift()!(run); await flush();
    ui.leave(); presentable = true; ui.resumePendingPresentation();
    expect(exposed).not.toHaveBeenCalled();
    expect(ui.render().textContent).not.toContain("当前参考价值");
    getButton(ui.render() as unknown as FakeElement, "打开模拟对照").fire("click");
    resolves.shift()!(run); await flush();
    expect(exposed).toHaveBeenCalledOnce();
    ui.leave();
    expect(ui.render().textContent).toContain("当前参考价值");
    ui.resumePendingPresentation(); expect(exposed).toHaveBeenCalledOnce();
  });
});
