import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadMarketInitial, loadMarketStage, loadResearchCase, MarketLockedError, PRICE_SCALE, resetMarketCacheForTest } from "./market";

const dir = join(process.cwd(), "public", "data", "adventure");
function read<T>(path: string): T { return JSON.parse(readFileSync(join(dir, path), "utf8")) as T; }
afterEach(() => { vi.unstubAllGlobals(); resetMarketCacheForTest(); });

describe("stage-separated market data", () => {
  it("initial data ends at T0, and locked stages and research never fetch", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url).split("/data/adventure/")[1]!;
      requested.push(path);
      return new Response(JSON.stringify(read(path)), { status: 200 });
    }));
    const initial = await loadMarketInitial();
    expect(initial.cases).toHaveLength(3);
    for (const c of initial.cases) {
      expect(c.history.dates.at(-1)).toBe(c.decisionDate);
      expect(c.history.dates.every((d) => d <= c.decisionDate)).toBe(true);
      expect(c.history.asset.at(-1)).toBe(PRICE_SCALE);
      expect(c.history.benchmark.at(-1)).toBe(PRICE_SCALE);
    }
    await expect(loadMarketStage("lantern-a", "entry", false)).rejects.toBeInstanceOf(MarketLockedError);
    await expect(loadResearchCase("lantern-a", false)).rejects.toBeInstanceOf(MarketLockedError);
    expect(requested).toEqual(["manifest.json"]);
    const quote = await loadMarketStage("lantern-a", "entry", true);
    expect(quote).toMatchObject({ date: "20251104", price: 994131, step: "entry" });
    expect(requested).toEqual(["manifest.json", "stages/lantern-a/entry.json"]);
    await expect(loadMarketStage("lantern-a", "entry", false)).rejects.toBeInstanceOf(MarketLockedError);
    expect(requested).toHaveLength(2);
  });

  it("a failed stage request can be retried without substituting an old price", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      return calls === 1 ? new Response("", { status: 503 }) : new Response(JSON.stringify(read("stages/lantern-a/t1-exec.json")), { status: 200 });
    }));
    await expect(loadMarketStage("lantern-a", "t1-exec", true)).rejects.toThrow();
    const quote = await loadMarketStage("lantern-a", "t1-exec", true);
    expect(quote.price).toBe(901017);
    expect(quote.date).toBe("20251202");
    expect(calls).toBe(2);
  });

  it("publishes verifiable derived case endpoints and matching file hashes", () => {
    const hashes = read<{ files: Record<string, string> }>("integrity.json").files;
    expect(Object.keys(hashes)).toHaveLength(34);
    for (const [path, sha] of Object.entries(hashes)) expect(createHash("sha256").update(readFileSync(join(dir, path))).digest("hex")).toBe(sha);
    expect(read("stages/lantern-a/t1.json")).toMatchObject({ date: "20251201", price: 903365 });
    expect(read("stages/lantern-a/t1-exec.json")).toMatchObject({ date: "20251202", price: 901017 });
    expect(read("stages/lantern-c/exit-after-t2-exec.json")).toMatchObject({ date: "20250225", price: 1226852 });
    expect(read("stages/lantern-c/final-exec.json")).toMatchObject({ date: "20250324", price: 1012731 });
  });
});
