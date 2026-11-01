import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRun, pendingMarketStep, reduceRun } from "./engine";
import type { MarketManifest } from "./market";
import { emptyResearchProfile } from "./research";
import type { CardId, MarketQuote, Run } from "./types";
import { casesAreRelated, chooseAdventureCase, hasAppliedNonEntryQuote, hasSeenRelatedCase } from "./ui-case";
import { researchCaseChoices } from "./ui-research-cases";

function deliver(run: Run): Run {
  const request = pendingMarketStep(run)!;
  const quote = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "adventure", "stages", request.caseId, `${request.stage}.json`), "utf8")) as MarketQuote;
  return reduceRun(run, { type: "apply-quote", quote });
}
/** Reach the first route and lose with shares through ordinary reducer actions. */
function firstDefeat(caseId = "lantern-a"): Run {
  let run = createRun({ seed: 104, caseId });
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
  run = reduceRun(run, { type: "continue" }); run = deliver(run);
  run = reduceRun(run, { type: "choose-route", enemyId: "pursuer" });
  while (run.status === "active") run = reduceRun(run, { type: "end-turn" });
  return run;
}

describe("case selection and overlapping exposure", () => {
  const ids = ["lantern-a", "lantern-b", "lantern-c", "lantern-d"];
  it("excludes both overlapping windows if either has been seen", () => {
    const seen = new Set(["lantern-c"]);
    expect(hasSeenRelatedCase(seen, "lantern-d")).toBe(true);
    expect(casesAreRelated("lantern-d", "lantern-c")).toBe(true);
    expect(chooseAdventureCase(ids, seen, () => 0)).toEqual({ caseId: "lantern-a", priorExposure: false });
    expect(chooseAdventureCase(ids, seen, () => 1)).toEqual({ caseId: "lantern-b", priorExposure: false });
  });
  it("marks replays as already seen when no unseen case remains", () => {
    const seen = new Set(["lantern-a", "lantern-b", "lantern-c"]);
    expect(chooseAdventureCase(ids, seen, () => 3)).toEqual({ caseId: "lantern-d", priorExposure: true });
  });
  it("rejects an out-of-range random draw before selecting", () => {
    const draws = [0xffff_ffff, 2];
    expect(chooseAdventureCase(ids.slice(0, 3), new Set(), () => draws.shift()!)).toEqual({ caseId: "lantern-c", priorExposure: false });
  });
  it("treats an actually applied execution quote as evidence, but not a pending order", () => {
    const pending = firstDefeat();
    expect(pending.market.pending?.stage).toBe("exit-after-entry");
    expect(pending.history.some((event) => event.action === "auto-liquidation")).toBe(true);
    expect(hasAppliedNonEntryQuote(pending)).toBe(false); // Only entry has executed.
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "adventure", "manifest.v2.json"), "utf8")) as MarketManifest;
    const seen = (run: Run): boolean | undefined => researchCaseChoices(manifest.cases, run, emptyResearchProfile()).find((choice) => choice.summary.caseId === run.caseId)?.seen;
    expect(seen(pending)).toBeUndefined(); // The current case stays unavailable until the sale settles.
    const settled = deliver(pending);
    expect(hasAppliedNonEntryQuote(settled)).toBe(true);
    expect(seen(settled)).toBe(true);
  });
  it("keeps the current case and its overlapping case out of D2 until settlement", () => {
    const pending = firstDefeat("lantern-c");
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "adventure", "manifest.v2.json"), "utf8")) as MarketManifest;
    const choices = researchCaseChoices(manifest.cases, pending, emptyResearchProfile());
    expect(choices.some((item) => item.summary.caseId === "lantern-c" || item.summary.caseId === "lantern-d")).toBe(false);
    const settled = deliver(pending);
    const known = researchCaseChoices(manifest.cases, settled, emptyResearchProfile());
    expect(known.filter((item) => item.summary.caseId === "lantern-c" || item.summary.caseId === "lantern-d").every((item) => item.seen)).toBe(true);
  });
});
