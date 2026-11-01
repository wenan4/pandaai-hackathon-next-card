import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadMarketInitial, loadMarketInitialCase, loadMarketStage, loadResearchCase, MarketLockedError, PRICE_SCALE, relatedCaseIds, resetMarketCacheForTest } from "./market";

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
    expect(initial.cases).toHaveLength(4);
    for (const c of initial.cases) {
      expect(c).not.toHaveProperty("history");
      expect(c.t0Close).toBe(PRICE_SCALE);
    }
    // D's past overlaps C's future, so no unselected historical series belong in this manifest.
    expect(JSON.stringify(initial)).not.toContain('997436');
    expect(JSON.stringify(initial)).not.toContain('869028');
    await expect(loadMarketInitialCase("lantern-d", false)).rejects.toBeInstanceOf(MarketLockedError);
    await expect(loadMarketStage("lantern-a", "entry", false)).rejects.toBeInstanceOf(MarketLockedError);
    await expect(loadResearchCase("lantern-a", false)).rejects.toBeInstanceOf(MarketLockedError);
    expect(requested).toEqual(["manifest.v2.json"]);
    const d = await loadMarketInitialCase("lantern-d", true);
    expect(d.decisionDate).toBe("20250207");
    expect(d.history.dates.at(-1)).toBe(d.decisionDate);
    expect(d.history.dates.every((day) => day <= d.decisionDate)).toBe(true);
    expect(d.history.asset.at(-1)).toBe(PRICE_SCALE);
    expect(d.history.benchmark.at(-1)).toBe(PRICE_SCALE);
    const quote = await loadMarketStage("lantern-a", "entry", true);
    expect(quote).toMatchObject({ date: "20251104", price: 994131, step: "entry" });
    expect(requested).toEqual(["manifest.v2.json", "initial/lantern-d.json", "stages/lantern-a/entry.json"]);
    await expect(loadMarketStage("lantern-a", "entry", false)).rejects.toBeInstanceOf(MarketLockedError);
    expect(requested).toHaveLength(3);
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
    const legacy = read<{ files: Record<string, string> }>("integrity.json").files;
    expect(Object.keys(legacy)).toHaveLength(34);
    for (const [path, sha] of Object.entries(legacy)) expect(createHash("sha256").update(readFileSync(join(dir, path))).digest("hex")).toBe(sha);
    const oldManifest = read<{ cases: { caseId: string }[] }>("manifest.json");
    expect(oldManifest.cases).toHaveLength(3);
    for (const oldCase of oldManifest.cases) expect(read(`initial/${oldCase.caseId}.json`)).toEqual(oldCase);
    const hashes = read<{ files: Record<string, string> }>("integrity.v2.json").files;
    expect(Object.keys(hashes)).toHaveLength(51);
    for (const [path, sha] of Object.entries(hashes)) expect(createHash("sha256").update(readFileSync(join(dir, path))).digest("hex")).toBe(sha);
    expect(read("stages/lantern-a/t1.json")).toMatchObject({ date: "20251201", price: 903365 });
    expect(read("stages/lantern-a/t1-exec.json")).toMatchObject({ date: "20251202", price: 901017 });
    expect(read("stages/lantern-c/exit-after-t2-exec.json")).toMatchObject({ date: "20250225", price: 1226852 });
    expect(read("stages/lantern-c/final-exec.json")).toMatchObject({ date: "20250324", price: 1012731 });
    expect(read("stages/lantern-d/entry.json")).toMatchObject({ date: "20250210", price: 997436 });
    expect(read("stages/lantern-d/t1.json")).toMatchObject({ date: "20250307", price: 869028, segment: { benchmark: expect.arrayContaining([1013181]) } });
    expect(read("stages/lantern-d/t1-exec.json")).toMatchObject({ date: "20250310", price: 866698 });
    expect(read("stages/lantern-d/exit-after-t2-exec.json")).toMatchObject({ date: "20250409", price: 687718 });
    expect(read("stages/lantern-d/final-exec.json")).toMatchObject({ date: "20250509", price: 783386 });
  });

  it("marks C and D as correlated without changing other case identities", () => {
    expect(relatedCaseIds("lantern-c")).toEqual(["lantern-c", "lantern-d"]);
    expect(relatedCaseIds("lantern-d")).toEqual(["lantern-c", "lantern-d"]);
    expect(relatedCaseIds("lantern-a")).toEqual(["lantern-a"]);
    relatedCaseIds("lantern-c").pop();
    expect(relatedCaseIds("lantern-d")).toEqual(["lantern-c", "lantern-d"]);
  });
});
