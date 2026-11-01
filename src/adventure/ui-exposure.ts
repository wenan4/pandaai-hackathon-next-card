import type { FundingExposure, HelpPreference } from "./research";
import { isFundingExposure } from "./profile-validation";

export interface FundingExposureArchive { version: 1; createdAt: number; entries: FundingExposure[] }
export type FundingExposureArchiveRead =
  | { status: "empty" }
  | { status: "valid"; archive: FundingExposureArchive }
  | { status: "expired" }
  | { status: "unsupported" }
  | { status: "invalid" };
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
/** A damaged or unknown archive is not an empty or expired archive. */
export function readFundingExposureArchive(raw: string | null, now: number, retentionMs: number): FundingExposureArchiveRead {
  if (raw === null) return { status: "empty" };
  if (!Number.isFinite(now) || !Number.isFinite(retentionMs) || retentionMs <= 0) return { status: "invalid" };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { status: "invalid" };
    const archive = parsed as Partial<FundingExposureArchive>;
    if (archive.version !== 1) return typeof archive.version === "number" && Number.isInteger(archive.version) ? { status: "unsupported" } : { status: "invalid" };
    if (typeof archive.createdAt !== "number" || !Number.isFinite(archive.createdAt) || archive.createdAt < 0 || archive.createdAt > now
      || !Array.isArray(archive.entries) || !archive.entries.every(isFundingExposure)) return { status: "invalid" };
    if (now - archive.createdAt >= retentionMs) return { status: "expired" };
    return { status: "valid", archive: { version: 1, createdAt: archive.createdAt, entries: mergeFundingExposures(archive.entries) } };
  } catch { return { status: "invalid" }; }
}

/** Compatibility adapter; recovery screens should use the discriminated result. */
export function parseFundingExposureArchive(raw: string | null, now: number, retentionMs: number): FundingExposureArchive | null {
  const result = readFundingExposureArchive(raw, now, retentionMs);
  return result.status === "valid" ? result.archive : null;
}
