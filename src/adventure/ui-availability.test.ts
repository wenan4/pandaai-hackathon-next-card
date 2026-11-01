import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCalibrationDemo } from "./calibration-demo";
import { createRun, reduceRun } from "./engine";
import { loadMarketInitial, loadMarketStage, resetMarketCacheForTest, type ResearchMarketCase } from "./market";
import { emptyResearchProfile, recommendationPlan, showHistoryEvidence, startHistory, type ResearchProfile } from "./research";
import { hasSeenRelatedCase } from "./ui-case";
import { taskAvailability } from "./ui-availability";

beforeEach(() => {
  resetMarketCacheForTest();
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
    try { return new Response(await readFile(`public${path}`), { status: 200, headers: { "Content-Type": "application/json" } }); }
    catch { return new Response("not found", { status: 404 }); }
  });
});
afterEach(() => { vi.unstubAllGlobals(); resetMarketCacheForTest(); });

describe("resource availability", () => {
  it("matches the D1 workbench: missing transaction or purchase uses an example, actual purchase uses the journey", async () => {
    const profile = emptyResearchProfile();
    expect(taskAvailability(createRun(), profile, null).funding).toBe("example");
    let run = await makeCalibrationDemo();
    expect(taskAvailability(run, profile, null).funding).toBe("example");
    run = reduceRun(run, { type: "submit-redemption", percent: 0 });
    run = reduceRun(run, { type: "apply-quote", quote: await loadMarketStage(run.caseId, "t1-exec", true) });
    run = reduceRun(run, { type: "buy-archive" });
    expect(taskAvailability(run, profile, null).funding).toBe("journey");
  });
  it("uses actual seen status and excludes the active case and its overlapping window", async () => {
    const run = await makeCalibrationDemo(); const manifest = await loadMarketInitial(); const profile = emptyResearchProfile();
    const known = new Set(["lantern-a", "lantern-b"]);
    expect(taskAvailability(run, profile, manifest, (id) => hasSeenRelatedCase(known, id)).history).toBe("review");
    known.delete("lantern-b");
    expect(taskAvailability(run, profile, manifest, (id) => hasSeenRelatedCase(known, id)).history).toBe("unseen");
    const onlyRelated = { ...manifest, cases: manifest.cases.filter((item) => item.caseId === "lantern-c" || item.caseId === "lantern-d") };
    expect(taskAvailability(run, profile, onlyRelated, () => false).history).toBe("unavailable");
    expect(taskAvailability(run, profile, null).history).toBe("unavailable");
  });
  it("prioritizes continuing a locked task even after its primary case is shown or the directory is unavailable", async () => {
    const run = await makeCalibrationDemo();
    const primary = JSON.parse(await readFile("public/data/adventure/research/lantern-a.json", "utf8")) as ResearchMarketCase;
    const schedule = { startingCashCents: 7200, participationCents: 2000, t1: 0 as const, t2: 0 as const };
    let profile = startHistory(emptyResearchProfile(), { id: "pending", caseId: primary.caseId, questionVersion: "d2-v1", schedule, initialClaim: "unknown", priorExposure: false });
    profile = showHistoryEvidence(profile, "pending", primary);
    const availability = taskAvailability(run, profile, null, () => true);
    expect(availability.history).toBe("pending");
    expect(recommendationPlan(profile, availability).offers.D2).toContain("继续已锁定的历史研究");
    expect(profile.research_process[0]?.priorExposure).toBe(false);
  });
  it("never consults a disabled profile's old observations and performs no data fetch", async () => {
    const run = await makeCalibrationDemo(); const manifest = await loadMarketInitial();
    const disabled = new Proxy({ enabled: false } as ResearchProfile, { get: (target, property) => { if (property === "enabled") return target.enabled; throw new Error(`old profile field read: ${String(property)}`); } });
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    const availability = taskAvailability(run, disabled, manifest, () => false);
    expect(availability.history).toBe("unseen");
    expect(recommendationPlan(disabled, availability).observed_steps).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
