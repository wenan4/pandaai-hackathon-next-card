import type { FundingExposure, HelpPreference } from "./research";

export interface FundingExposureArchive { version: 1; createdAt: number; entries: FundingExposure[] }
const ranks: Record<HelpPreference, number> = { self: 0, hint: 1, step: 2 };

/** Only exposure metadata is retained: no answer, amount, feeling, or profile result. */
export function mergeFundingExposures(...groups: FundingExposure[][]): FundingExposure[] {
  const merged = new Map<string, FundingExposure>();
  for (const item of groups.flat()) {
    const identity = item.questionKey ? `q:${item.questionKey}` : item.caseId ? `legacy:${item.caseId}` : "";
    if (!identity || !(item.help in ranks)) continue;
    const previous = merged.get(identity);
    merged.set(identity, { ...(item.questionKey ? { questionKey: item.questionKey } : { caseId: item.caseId }), help: previous && ranks[previous.help] > ranks[item.help] ? previous.help : item.help, answerExposed: !!previous?.answerExposed || !!item.answerExposed, priorExposure: !!previous?.priorExposure || !!item.priorExposure });
  }
  return [...merged.values()];
}
export function parseFundingExposureArchive(raw: string | null, now: number, retentionMs: number): FundingExposureArchive | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const archive = parsed as Partial<FundingExposureArchive>;
    if (archive.version !== 1 || typeof archive.createdAt !== "number" || !Number.isFinite(archive.createdAt) || now - archive.createdAt >= retentionMs || !Array.isArray(archive.entries)) return null;
    const entries = archive.entries.filter((entry): entry is FundingExposure => !!entry && typeof entry === "object" && ((typeof entry.questionKey === "string" && !!entry.questionKey) || (typeof entry.caseId === "string" && !!entry.caseId)) && ["self", "hint", "step"].includes(entry.help) && typeof entry.answerExposed === "boolean" && typeof entry.priorExposure === "boolean");
    return { version: 1, createdAt: archive.createdAt, entries: mergeFundingExposures(entries) };
  } catch { return null; }
}
