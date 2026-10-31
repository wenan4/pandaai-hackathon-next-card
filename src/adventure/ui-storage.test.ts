import { describe, expect, it } from "vitest";
import { createRun } from "./engine";
import { emptyResearchProfile } from "./research";
import { adventureBackup, clearAdventureStorage, FUNDING_EXPOSURE_KEY, inspectAdventureStorage, replaceAdventureStorage, RETENTION_MS, SAVE_KEY, SEEN_KEY, type StorageSnapshot } from "./ui-storage";

class MemoryStorage {
  values = new Map<string, string>();
  writes: string[] = [];
  fail: (operation: "get" | "set" | "remove", key: string, value?: string) => boolean = () => false;
  getItem(key: string): string | null { if (this.fail("get", key)) throw new Error("unavailable"); return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { if (this.fail("set", key, value)) throw new Error("unavailable"); this.writes.push(`set:${key}`); this.values.set(key, value); }
  removeItem(key: string): void { if (this.fail("remove", key)) throw new Error("unavailable"); this.writes.push(`remove:${key}`); this.values.delete(key); }
}
const now = 1_800_000_000_000;
const validSave = (): string => JSON.stringify({ schema: "nextcard-adventure-save-v1", savedAt: now, observationStartedAt: now, run: createRun({ seed: 104 }), profile: emptyResearchProfile() });
const snapshot = (storage: MemoryStorage): StorageSnapshot => ({ save: storage.getItem(SAVE_KEY), seen: storage.getItem(SEEN_KEY), exposure: storage.getItem(FUNDING_EXPOSURE_KEY) });

describe("local adventure recovery", () => {
  it("distinguishes empty, valid and genuinely expired records without changing them", () => {
    const storage = new MemoryStorage();
    expect(inspectAdventureStorage(storage, now).kind).toBe("ready");
    storage.values.set(SAVE_KEY, validSave());
    storage.values.set(SEEN_KEY, JSON.stringify(["lantern-a"]));
    storage.values.set(FUNDING_EXPOSURE_KEY, JSON.stringify({ version: 1, createdAt: now - RETENTION_MS, entries: [] }));
    const result = inspectAdventureStorage(storage, now);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") { expect(result.save?.run.node).toBe("N1"); expect(result.archiveExpired).toBe(true); expect(result.seen.has("lantern-a")).toBe(true); }
    expect(storage.writes).toEqual([]);
  });

  it("keeps corrupt and unknown versions distinct and exports their original strings", () => {
    const storage = new MemoryStorage(); const main = "{ broken!"; const archive = '{"version":99,"unknown":true}';
    storage.values.set(SAVE_KEY, main); storage.values.set(SEEN_KEY, '["lantern-a"]'); storage.values.set(FUNDING_EXPOSURE_KEY, archive);
    const result = inspectAdventureStorage(storage, now);
    expect(result.kind).toBe("recovery");
    if (result.kind === "recovery") {
      expect(result.issues).toEqual(expect.arrayContaining(["save-invalid", "exposure-unsupported"]));
      expect(JSON.parse(adventureBackup(result.snapshot))).toEqual({ [SAVE_KEY]: main, [SEEN_KEY]: '["lantern-a"]', [FUNDING_EXPOSURE_KEY]: archive });
    }
    expect(storage.writes).toEqual([]);
  });

  it("protects an otherwise valid run when its exposure or seen data cannot be trusted", () => {
    const storage = new MemoryStorage(); storage.values.set(SAVE_KEY, validSave()); storage.values.set(FUNDING_EXPOSURE_KEY, "{");
    let result = inspectAdventureStorage(storage, now);
    expect(result.kind).toBe("recovery");
    if (result.kind === "recovery") { expect(result.summary?.run.node).toBe("N1"); expect(result.issues).toContain("exposure-invalid"); }
    storage.values.delete(FUNDING_EXPOSURE_KEY); storage.values.set(SEEN_KEY, '["lantern-a",3]');
    result = inspectAdventureStorage(storage, now);
    expect(result.kind).toBe("recovery");
    if (result.kind === "recovery") expect(result.issues).toContain("seen-invalid");
    expect(storage.writes).toEqual([]);
  });

  it("never mistakes inaccessible storage for an empty record", () => {
    const storage = new MemoryStorage(); storage.fail = (op) => op === "get";
    expect(inspectAdventureStorage(storage, now)).toEqual({ kind: "unavailable" });
    expect(storage.writes).toEqual([]);
  });

  it("replaces only after the captured records are unchanged and leaves legacy storage alone", () => {
    const storage = new MemoryStorage(); storage.values.set(SAVE_KEY, "old"); storage.values.set(SEEN_KEY, "seen"); storage.values.set(FUNDING_EXPOSURE_KEY, "exposure"); storage.values.set("nextcard:v1", "legacy");
    const before = snapshot(storage); storage.values.set(SEEN_KEY, "changed elsewhere");
    expect(replaceAdventureStorage(storage, before, "new")).toBe("changed");
    expect(storage.writes).toEqual([]); expect(storage.values.get(SAVE_KEY)).toBe("old");
    const updated = snapshot(storage);
    expect(replaceAdventureStorage(storage, updated, "new")).toBe("saved");
    expect(storage.values.get(SAVE_KEY)).toBe("new"); expect(storage.values.has(SEEN_KEY)).toBe(false); expect(storage.values.has(FUNDING_EXPOSURE_KEY)).toBe(false); expect(storage.values.get("nextcard:v1")).toBe("legacy");
  });

  it("restores the original keys after a later failure and signals an unsuccessful rollback", () => {
    const storage = new MemoryStorage(); storage.values.set(SAVE_KEY, "old"); storage.values.set(SEEN_KEY, "seen"); storage.values.set(FUNDING_EXPOSURE_KEY, "exposure");
    const before = snapshot(storage);
    storage.fail = (op, key) => op === "remove" && key === FUNDING_EXPOSURE_KEY;
    expect(replaceAdventureStorage(storage, before, "new")).toBe("failed-restored");
    expect(snapshot(storage)).toEqual(before);
    storage.fail = (op, key, value) => (op === "remove" && key === FUNDING_EXPOSURE_KEY) || (op === "set" && key === SAVE_KEY && value === "old");
    expect(replaceAdventureStorage(storage, before, "new")).toBe("failed-uncertain");
    expect(storage.values.get(SAVE_KEY)).toBe("new");
    expect(JSON.parse(adventureBackup(before))[SAVE_KEY]).toBe("old");
  });
  it("does not leave a partial deletion when explicit clearing fails and rollback succeeds", () => {
    const storage = new MemoryStorage(); storage.values.set(SAVE_KEY, "old"); storage.values.set(SEEN_KEY, "seen"); storage.values.set(FUNDING_EXPOSURE_KEY, "exposure"); storage.values.set("nextcard:v1", "legacy");
    const before = snapshot(storage);
    storage.fail = (operation, key) => operation === "remove" && key === SEEN_KEY;
    expect(clearAdventureStorage(storage, before)).toBe("failed-restored");
    expect(snapshot(storage)).toEqual(before); expect(storage.values.get("nextcard:v1")).toBe("legacy");
    storage.fail = () => false;
    expect(clearAdventureStorage(storage, before)).toBe("saved");
    expect(snapshot(storage)).toEqual({ save: null, seen: null, exposure: null }); expect(storage.values.get("nextcard:v1")).toBe("legacy");
  });
});
