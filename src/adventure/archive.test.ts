import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRun } from "./engine";
import { archiveKey, loadArchiveSnapshot } from "./archive";
import { loadMarketInitialCase, loadMarketStage, type MarketQuote } from "./market";
import type { Run } from "./types";
vi.mock("./market", () => ({ loadMarketInitialCase: vi.fn(), loadMarketStage: vi.fn() }));
const initial = JSON.parse(readFileSync("public/data/adventure/initial/lantern-a.json", "utf8"));
const stage = (name: string): MarketQuote => JSON.parse(readFileSync(`public/data/adventure/stages/lantern-a/${name}.json`, "utf8"));
function fixture(names: string[]): Run {
  const run = createRun({ caseId: "lantern-a" }); run.archiveOwned = true;
  for (const name of names) {
    const quote = stage(name);
    run.history.push({ id: `test-${name}`, node: "N4", type: "market", action: "apply-quote", message: "fixture", data: { stage: name, date: quote.date, price: quote.price } });
    run.market.lastQuote = quote;
  }
  return run;
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadMarketInitialCase).mockResolvedValue(initial); vi.mocked(loadMarketStage).mockImplementation(async (_case, name) => stage(name)); });
describe("archive advances only through applied history", () => {
  it("requires ownership and does not fetch before purchase", async () => {
    await expect(loadArchiveSnapshot(createRun({ caseId: "lantern-a" }))).rejects.toThrow("解锁");
    expect(loadMarketInitialCase).not.toHaveBeenCalled(); expect(loadMarketStage).not.toHaveBeenCalled();
  });
  it("shows T0 at the first camp even if a future quote is pending", async () => {
    const run = fixture([]); run.market.pending = { caseId: run.caseId, stage: "t1", unlocked: true };
    const result = await loadArchiveSnapshot(run);
    expect(result.throughDate).toBe(initial.decisionDate); expect(result.history).toEqual(initial.history);
    expect(loadMarketStage).not.toHaveBeenCalled();
  });
  it("keeps the first segment after an execution replaces lastQuote and after JSON restoration", async () => {
    const run = fixture(["t1", "t1-exec"]); const saved = JSON.stringify(run);
    const result = await loadArchiveSnapshot(JSON.parse(saved));
    expect(result.throughDate).toBe(stage("t1").date); expect(result.revealedSegments).toBe(1);
    expect(result.history.dates.length).toBe(initial.history.dates.length + 20);
    expect(loadMarketStage).toHaveBeenCalledExactlyOnceWith("lantern-a", "t1", true);
    expect(JSON.stringify(run)).toBe(saved);
  });
  it("merges both visited segments without duplicate dates, and never requests the third", async () => {
    const run = fixture(["t1", "t1-exec", "t2", "t2-exec"]);
    const result = await loadArchiveSnapshot(run);
    expect(result.throughDate).toBe(stage("t2").date); expect(result.history.dates.length).toBe(initial.history.dates.length + 40);
    expect(new Set(result.history.dates).size).toBe(result.history.dates.length);
    expect(vi.mocked(loadMarketStage).mock.calls.map((args) => args[1])).toEqual(["t1", "t2"]);
    expect(archiveKey(run)).not.toBe(archiveKey(fixture(["t1"])));
  });
  it("accepts the dashed dates supported by older saved quotes", async () => {
    const run = fixture(["t1"]);
    const date = String(run.history.at(-1)!.data.date);
    run.history.at(-1)!.data.date = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`;
    const result = await loadArchiveSnapshot(run);
    expect(result.revealedSegments).toBe(1); expect(result.throughDate).toBe(stage("t1").date);
  });
  it("rejects missing, mismatched or conflicting segments rather than inventing data", async () => {
    await expect(loadArchiveSnapshot(fixture(["t2"]))).rejects.toThrow("缺少");
    const run = fixture(["t1"]); run.history.at(-1)!.data.price = 123;
    await expect(loadArchiveSnapshot(run)).rejects.toThrow("不一致");
    vi.mocked(loadMarketStage).mockResolvedValue({ ...stage("t1"), segment: { ...stage("t1").segment!, asset: [999, ...stage("t1").segment!.asset.slice(1)] } });
    await expect(loadArchiveSnapshot(fixture(["t1"]))).rejects.toThrow("衔接");
  });
});
