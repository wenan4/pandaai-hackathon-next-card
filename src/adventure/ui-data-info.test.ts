import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeCalibrationDemo } from "./calibration-demo";
import { createRun, forkRun, pendingMarketStep, reduceRun } from "./engine";
import { loadMarketStage, resetMarketCacheForTest, type MarketManifest } from "./market";
import { dataInfoContent } from "./ui-data-info";

const dir = join(process.cwd(), "public", "data", "adventure");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.v2.json"), "utf8")) as MarketManifest;

class FakeNode {
  children: (FakeNode | string)[] = [];
  append(...items: (FakeNode | string)[]): void { this.children.push(...items); }
  get textContent(): string { return this.children.map((child) => typeof child === "string" ? child : child.textContent).join(""); }
}
class FakeElement extends FakeNode {
  constructor(readonly tag: string) { super(); }
  setAttribute(): void { /* The text and information boundary are the subject of these tests. */ }
  addEventListener(): void { /* No controls in this panel need listeners. */ }
}

function setup(): ReturnType<typeof vi.fn> {
  vi.stubGlobal("Node", FakeNode);
  vi.stubGlobal("document", { createElement: (tag: string) => new FakeElement(tag) });
  const fetch = vi.fn(async (url: string) => {
    const path = String(url).split("/data/adventure/")[1]!;
    return new Response(readFileSync(join(dir, path)), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function render(manifestValue: MarketManifest | null, run: Parameters<typeof dataInfoContent>[1]): string {
  return (dataInfoContent(manifestValue, run) as unknown as FakeElement).textContent;
}

afterEach(() => { vi.unstubAllGlobals(); resetMarketCacheForTest(); });

describe("data source and revealed time boundaries", () => {
  it("shows sources without fetching or exposing case histories before a run", () => {
    const fetch = setup();
    const text = render(manifest, null);
    expect(text).toContain("Panda Data");
    expect(text).toContain("get_stock_daily_pre");
    expect(text).toContain("get_index_daily");
    expect(text).toContain("get_trade_cal");
    expect(text).toContain("前复权");
    expect(text).toContain("样本非随机");
    expect(text).toContain("QuantSkills skill-quant-research");
    expect(text).toContain("未复制代码或集成执行引擎");
    expect(text).not.toContain("000063.SZ");
    expect(text).not.toContain("2025-02-07");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows only the chosen T0 before future stages are revealed", () => {
    const fetch = setup();
    const run = createRun({ caseId: "lantern-d" });
    const text = render(manifest, run);
    expect(text).toContain("中兴通讯（000063.SZ）");
    expect(text).toContain("T0 2025-02-07 收盘");
    expect(text).toContain("000300.SH 沪深300");
    expect(text).toContain("还没有揭晓后续报价");
    expect(text).not.toContain("东方财富");
    expect(text).not.toContain("2025-02-10");
    expect(text).not.toContain("0.997436");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows only applied quotes, never the pending next-open price, and distinguishes no sale", async () => {
    const fetch = setup();
    let run = await makeCalibrationDemo(); // Explicitly simulated route using real reducer and derived prices.
    const callsBeforePanel = fetch.mock.calls.length;
    const before = render(manifest, run);
    expect(fetch).toHaveBeenCalledTimes(callsBeforePanel);
    expect(before).toContain("2025-02-10 · 参与执行（T0 后的下一开盘）：0.997436");
    expect(before).toContain("2025-03-07 · 第一段收盘参考（T0 后第 20 个交易日）：0.869028");
    expect(before).not.toContain("2025-03-10");
    expect(before).not.toContain("0.866698");

    run = reduceRun(run, { type: "submit-redemption", percent: 0 });
    const pending = pendingMarketStep(run)!;
    expect(pending.stage).toBe("t1-exec");
    const whilePending = render(manifest, run);
    expect(whilePending).not.toContain("2025-03-10");
    expect(fetch).toHaveBeenCalledTimes(callsBeforePanel);

    const quote = await loadMarketStage(pending.caseId, pending.stage, pending.unlocked);
    run = reduceRun(run, { type: "apply-quote", quote });
    const after = render(manifest, run);
    expect(after).toContain("2025-03-10 · 第一段后下一开盘（未回收份额，仅推进时间）：0.866698");
    expect(after).not.toContain("2025-04-07");
    expect(after).not.toContain("回收安排结算");
    expect(fetch).toHaveBeenCalledTimes(callsBeforePanel + 1);
  });

  it("does not invent a transaction when an older save has only its last revealed quote", async () => {
    setup();
    const run = await makeCalibrationDemo();
    run.history = run.history.filter((event) => event.type !== "market");
    const text = render(manifest, run);
    expect(text).toContain("2025-03-07 · 第一段收盘参考（T0 后第 20 个交易日）（已展示报价）：0.869028");
    expect(text).not.toContain("2025-02-10");
  });

  it("labels zero participation as advancing time, not a purchase", async () => {
    setup();
    const demo = await makeCalibrationDemo();
    const checkpoint = demo.checkpoints.find((item) => item.action === "submit-entry")!;
    let branch = forkRun(demo, checkpoint.id);
    branch = reduceRun(branch, { type: "submit-entry", amountCents: 0 });
    branch = reduceRun(branch, { type: "continue" });
    const pending = pendingMarketStep(branch)!;
    branch = reduceRun(branch, { type: "apply-quote", quote: await loadMarketStage(pending.caseId, pending.stage, pending.unlocked) });
    const text = render(manifest, branch);
    expect(text).toContain("2025-02-10 · 参与金额为零（T0 后的下一开盘仅推进时间）：0.997436");
    expect(text).not.toContain("参与执行");
    expect(text).not.toContain("2025-03-07");
  });
});
