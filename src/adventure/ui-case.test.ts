import { describe, expect, it } from "vitest";
import { casesAreRelated, chooseAdventureCase, hasSeenRelatedCase } from "./ui-case";

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
});
