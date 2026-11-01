import { relatedCaseIds } from "./market";
import type { Run } from "./types";

/** A submitted order is not a quote. Legacy applied quotes remain conservative evidence. */
export function hasAppliedNonEntryQuote(run: Pick<Run, "history">): boolean {
  return run.history.some((event) => event.type === "market" && event.action === "apply-quote"
    && typeof event.data?.stage === "string" && event.data.stage !== "entry");
}

/** Case windows that overlap are treated as already seen together. */
export function hasSeenRelatedCase(seen: ReadonlySet<string>, caseId: string): boolean {
  return relatedCaseIds(caseId).some((related) => seen.has(related));
}
export function casesAreRelated(first: string, second: string): boolean {
  return relatedCaseIds(first).includes(second);
}
function randomUint32(): number {
  const word = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(word)[0]!;
  return Math.floor(Math.random() * 0x1_0000_0000);
}
export function independentBattleSeed(): number { return randomUint32(); }
/** Uniformly draw from unseen cases; only replay from the whole pool once all are seen. */
export function chooseAdventureCase(ids: string[], seen: ReadonlySet<string>, draw = randomUint32): { caseId: string; priorExposure: boolean } {
  if (!ids.length) throw new Error("案例目录为空，请重新加载。");
  const unseen = ids.filter((id) => !hasSeenRelatedCase(seen, id));
  const candidates = unseen.length ? unseen : ids;
  const limit = Math.floor(0x1_0000_0000 / candidates.length) * candidates.length;
  let value: number;
  do { value = draw(); } while (!Number.isInteger(value) || value < 0 || value >= limit);
  const caseId = candidates[value % candidates.length]!;
  return { caseId, priorExposure: hasSeenRelatedCase(seen, caseId) };
}
