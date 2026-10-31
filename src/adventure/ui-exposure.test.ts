import { describe, expect, it } from "vitest";
import { mergeFundingExposures, parseFundingExposureArchive } from "./ui-exposure";

describe("cross-run question exposure", () => {
  it("keeps the strongest exposure for the same question without affecting a different question", () => {
    const first = { questionKey: "question-a", help: "hint" as const, answerExposed: false, priorExposure: false };
    const later = { questionKey: "question-a", help: "self" as const, answerExposed: true, priorExposure: false };
    const other = { questionKey: "question-b", help: "self" as const, answerExposed: false, priorExposure: false };
    expect(mergeFundingExposures([first], [later, other])).toEqual([{ questionKey: "question-a", help: "hint", answerExposed: true, priorExposure: false }, other]);
  });
  it("drops expired or malformed exposure archives", () => {
    const raw = JSON.stringify({ version: 1, createdAt: 1000, entries: [{ questionKey: "q", help: "hint", answerExposed: true, priorExposure: false }] });
    expect(parseFundingExposureArchive(raw, 1050, 100)?.entries).toHaveLength(1);
    expect(parseFundingExposureArchive(raw, 1100, 100)).toBeNull();
    expect(parseFundingExposureArchive("{broken", 1050, 100)).toBeNull();
  });
});
