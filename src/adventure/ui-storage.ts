import { parseAdventureSave, type AdventureSave, type AdventureSaveResult } from "./save-state";
import { readFundingExposureArchive, type FundingExposureArchive, type FundingExposureArchiveRead } from "./ui-exposure";

export const SAVE_KEY = "nextcard:adventure:v0.4";
export const SEEN_KEY = `${SAVE_KEY}:seen-cases`;
export const FUNDING_EXPOSURE_KEY = `${SAVE_KEY}:funding-exposure`;
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface StorageSnapshot { save: string | null; seen: string | null; exposure: string | null }
type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type RecoveryIssue = "save-invalid" | "save-unsupported" | "save-time" | "seen-invalid" | "exposure-invalid" | "exposure-unsupported";
export type StorageRead =
  | { kind: "unavailable" }
  | { kind: "recovery"; snapshot: StorageSnapshot; issues: RecoveryIssue[]; summary: AdventureSave | null; archive: FundingExposureArchive | null; archiveExpired: boolean }
  | { kind: "ready"; snapshot: StorageSnapshot; save: AdventureSave | null; seen: Set<string>; archive: FundingExposureArchive | null; archiveExpired: boolean };

function readSnapshot(storage: StorageReader): StorageSnapshot {
  return { save: storage.getItem(SAVE_KEY), seen: storage.getItem(SEEN_KEY), exposure: storage.getItem(FUNDING_EXPOSURE_KEY) };
}
function sameSnapshot(first: StorageSnapshot, second: StorageSnapshot): boolean {
  return first.save === second.save && first.seen === second.seen && first.exposure === second.exposure;
}

/** No writes: unknown records must remain available for explicit recovery. */
export function inspectAdventureStorage(storage: StorageReader, now = Date.now()): StorageRead {
  let snapshot: StorageSnapshot;
  try { snapshot = readSnapshot(storage); } catch { return { kind: "unavailable" }; }
  let parsed: AdventureSaveResult; let exposure: FundingExposureArchiveRead;
  try { parsed = parseAdventureSave(snapshot.save); } catch { parsed = { kind: "invalid", reason: "存档内容无法校验。" }; }
  try { exposure = readFundingExposureArchive(snapshot.exposure, now, RETENTION_MS); } catch { exposure = { status: "invalid" }; }
  const issues: RecoveryIssue[] = [];
  if (parsed.kind === "invalid") issues.push("save-invalid");
  if (parsed.kind === "unsupported") issues.push("save-unsupported");
  if (parsed.kind === "valid" && (parsed.value.savedAt > now || parsed.value.observationStartedAt > now)) issues.push("save-time");
  if (exposure.status === "invalid") issues.push("exposure-invalid");
  if (exposure.status === "unsupported") issues.push("exposure-unsupported");
  let seen: string[] = [];
  if (snapshot.seen !== null) {
    try {
      const value: unknown = JSON.parse(snapshot.seen);
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0)) issues.push("seen-invalid");
      else seen = value;
    } catch { issues.push("seen-invalid"); }
  }
  if (issues.length) return { kind: "recovery", snapshot, issues, summary: parsed.kind === "valid" ? parsed.value : null, archive: exposure.status === "valid" ? exposure.archive : null, archiveExpired: exposure.status === "expired" };
  return { kind: "ready", snapshot, save: parsed.kind === "valid" ? parsed.value : null, seen: new Set(seen), archive: exposure.status === "valid" ? exposure.archive : null, archiveExpired: exposure.status === "expired" };
}

/** All values are original localStorage strings; nothing is parsed into the backup. */
export function adventureBackup(snapshot: StorageSnapshot): string {
  return JSON.stringify({ [SAVE_KEY]: snapshot.save, [SEEN_KEY]: snapshot.seen, [FUNDING_EXPOSURE_KEY]: snapshot.exposure }, null, 2);
}

export type ReplaceOutcome = "saved" | "changed" | "failed-restored" | "failed-uncertain";
type Mutation = { key: string; old: string | null; value: string | null };
function commitMutations(storage: StorageWriter, snapshot: StorageSnapshot, mutations: Mutation[]): ReplaceOutcome {
  try { if (!sameSnapshot(readSnapshot(storage), snapshot)) return "changed"; } catch { return "failed-restored"; }
  const changed: { key: string; old: string | null }[] = [];
  try {
    for (const item of mutations) {
      if (item.value === null) storage.removeItem(item.key); else storage.setItem(item.key, item.value);
      changed.push({ key: item.key, old: item.old });
    }
    return "saved";
  } catch {
    for (const item of changed.reverse()) {
      try { if (item.old === null) storage.removeItem(item.key); else storage.setItem(item.key, item.old); } catch { /* attempt all keys */ }
    }
    try { return sameSnapshot(readSnapshot(storage), snapshot) ? "failed-restored" : "failed-uncertain"; } catch { return changed.length ? "failed-uncertain" : "failed-restored"; }
  }
}
/** Called only after explicit confirmation. localStorage is not a multi-key transaction. */
export function replaceAdventureStorage(storage: StorageWriter, snapshot: StorageSnapshot, newSave: string): ReplaceOutcome {
  return commitMutations(storage, snapshot, [
    { key: SAVE_KEY, old: snapshot.save, value: newSave },
    { key: SEEN_KEY, old: snapshot.seen, value: null },
    { key: FUNDING_EXPOSURE_KEY, old: snapshot.exposure, value: null },
  ]);
}
/** Explicit deletion shares the same snapshot check and best-effort rollback. */
export function clearAdventureStorage(storage: StorageWriter, snapshot: StorageSnapshot): ReplaceOutcome {
  return commitMutations(storage, snapshot, [
    { key: SAVE_KEY, old: snapshot.save, value: null },
    { key: SEEN_KEY, old: snapshot.seen, value: null },
    { key: FUNDING_EXPOSURE_KEY, old: snapshot.exposure, value: null },
  ]);
}
/** Successfully expired data must not be kept in a later backup if another key fails. */
export function expireAdventureStorage(storage: StorageWriter, snapshot: StorageSnapshot, cleanedSave: string | null, clearExposure: boolean): { status: ReplaceOutcome; snapshot: StorageSnapshot } {
  let current = { ...snapshot };
  let overall: ReplaceOutcome = "saved";
  if (cleanedSave !== null) {
    const status = commitMutations(storage, current, [{ key: SAVE_KEY, old: current.save, value: cleanedSave }]);
    if (status === "saved") current = { ...current, save: cleanedSave };
    else if (status === "failed-restored") overall = status;
    else return { status, snapshot: current };
  }
  if (clearExposure && current.exposure !== null) {
    const status = commitMutations(storage, current, [{ key: FUNDING_EXPOSURE_KEY, old: current.exposure, value: null }]);
    if (status !== "saved") return { status, snapshot: current };
    current = { ...current, exposure: null };
  }
  return { status: overall, snapshot: current };
}
