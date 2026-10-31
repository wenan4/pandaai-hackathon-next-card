import { describe, expect, it } from "vitest";
import { mergeFundingExposures, parseFundingExposureArchive, readFundingExposureArchive } from "./ui-exposure";

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
  it("distinguishes empty, valid and exactly expired records without moving their retention start", () => {
    const entry = { questionKey: "q", help: "hint", answerExposed: true, priorExposure: false };
    const legacy = { caseId: "lantern-a", help: "step", answerExposed: false, priorExposure: true };
    const raw = JSON.stringify({ version: 1, createdAt: 1000, entries: [entry, legacy] });
    expect(readFundingExposureArchive(null, 1050, 100)).toEqual({ status: "empty" });
    expect(readFundingExposureArchive(raw, 1099, 100)).toEqual({ status: "valid", archive: { version: 1, createdAt: 1000, entries: [entry, legacy] } });
    expect(readFundingExposureArchive(raw, 1100, 100)).toEqual({ status: "expired" });
  });
  it("never treats unknown versions, damaged entries or uncertain timestamps as empty or expired", () => {
    const entry = { questionKey: "q", help: "hint", answerExposed: true, priorExposure: false };
    expect(readFundingExposureArchive(JSON.stringify({ version: 2, createdAt: 1, entries: [entry] }), 1100, 100)).toEqual({ status: "unsupported" });
    for (const invalid of [
      "", "{broken", "[]", "{}",
      JSON.stringify({ version: 1, createdAt: 1, entries: [entry, { ...entry, answerExposed: "yes" }] }),
      JSON.stringify({ version: 1, createdAt: 1, entries: [{ ...entry, help: "other" }] }),
      JSON.stringify({ version: 1, createdAt: 1, entries: [{ ...entry, questionKey: "" }] }),
      JSON.stringify({ version: 1, createdAt: 1200, entries: [entry] }),
    ]) expect(readFundingExposureArchive(invalid, 1100, 100)).toEqual({ status: "invalid" });
  });
});
