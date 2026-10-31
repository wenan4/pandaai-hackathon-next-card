import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRun, reduceRun } from "./engine";
import { emptyResearchProfile, setResearchGoal } from "./research";
import { FUNDING_EXPOSURE_KEY, RETENTION_MS, SAVE_KEY, SEEN_KEY } from "./ui-storage";
import type { CardId, Run } from "./types";

class FakeNode {
  children: (FakeNode | string)[] = [];
  parent: FakeNode | null = null;
  append(...items: (FakeNode | string)[]): void { for (const item of items) { if (item instanceof FakeNode) item.parent = this; this.children.push(item); } }
  replaceChildren(...items: (FakeNode | string)[]): void { this.children = []; this.append(...items); }
  get textContent(): string { return this.children.map((child) => typeof child === "string" ? child : child.textContent).join(""); }
  querySelectorAll(): FakeElement[] { return []; }
  querySelector(): FakeElement | null { return null; }
}
class FakeElement extends FakeNode {
  attributes: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  isConnected = true;
  inert = false;
  dataset: Record<string, string> = {};
  href = ""; download = "";
  constructor(readonly tag: string) { super(); }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  addEventListener(name: string, callback: () => void): void { this.listeners[name] = callback; }
  fire(name: string): void { this.listeners[name]?.(); }
  click(): void { this.fire("click"); }
  closest(): null { return null; }
  contains(): boolean { return false; }
  focus(): void { /* no layout in this harness */ }
}
function find(node: FakeNode, match: (item: FakeElement) => boolean): FakeElement | undefined {
  if (node instanceof FakeElement && match(node)) return node;
  for (const child of node.children) if (child instanceof FakeNode) { const result = find(child, match); if (result) return result; }
  return undefined;
}
function button(node: FakeNode, label: string): FakeElement {
  const result = find(node, (item) => item.tag === "button" && item.textContent === label);
  if (!result) throw new Error(`button missing: ${label}`);
  return result;
}
class MemoryStorage {
  values = new Map<string, string>();
  writes: string[] = [];
  fail: (operation: "get" | "set" | "remove", key: string, value?: string) => boolean = () => false;
  getItem(key: string): string | null { if (this.fail("get", key)) throw new Error("unavailable"); return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { if (this.fail("set", key, value)) throw new Error("unavailable"); this.writes.push(`set:${key}`); this.values.set(key, value); }
  removeItem(key: string): void { if (this.fail("remove", key)) throw new Error("unavailable"); this.writes.push(`remove:${key}`); this.values.delete(key); }
}
const manifest = JSON.parse(readFileSync("public/data/adventure/manifest.v2.json", "utf8")) as unknown;
const save = (startedAt = Date.now(), observed = true): string => JSON.stringify({ schema: "nextcard-adventure-save-v1", savedAt: Date.now(), observationStartedAt: startedAt, run: createRun({ seed: 104, observationEnabled: observed }), profile: observed ? setResearchGoal(emptyResearchProfile(), "goal", "funding") : emptyResearchProfile(false) });
function pendingUnknownCase(): Run {
  let run = createRun({ seed: 104, caseId: "future-case-2027", observationEnabled: false });
  const play = (cardId: CardId): void => { const card = run.deck.find((item) => item.cardId === cardId && run.battle?.hand.includes(item.instanceId)); if (!card) throw new Error("missing seeded card"); run = reduceRun(run, { type: "play-card", cardInstanceId: card.instanceId }); };
  for (const card of ["C02", "C03", "C01"] as CardId[]) play(card);
  run = reduceRun(run, { type: "end-turn" });
  for (const card of ["C01", "C04", "C02", "C02"] as CardId[]) play(card);
  run = reduceRun(run, { type: "end-turn" }); play("C02"); run = reduceRun(run, { type: "end-turn" }); play("C01");
  run = reduceRun(run, { type: "choose-reward", cardId: null }); run = reduceRun(run, { type: "submit-entry", amountCents: 0 });
  return reduceRun(run, { type: "continue" });
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.doUnmock("./market"); vi.resetModules(); vi.unstubAllGlobals(); });
async function boot(storage: MemoryStorage) {
  const root = new FakeElement("app"); const downloads: Blob[] = [];
  const NativeURL = globalThis.URL;
  vi.stubGlobal("Node", FakeNode);
  vi.stubGlobal("document", { activeElement: null, querySelector: (selector: string) => selector === "#app" ? root : null, createElement: (tag: string) => new FakeElement(tag) });
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage, scrollY: 0, scrollTo: vi.fn(), setTimeout: vi.fn(() => 0), clearTimeout: vi.fn() });
  vi.stubGlobal("URL", class extends NativeURL { static createObjectURL(blob: Blob): string { downloads.push(blob); return "blob:local"; } static revokeObjectURL(): void { /* no real object URL */ } });
  vi.doMock("./market", async (importOriginal) => ({ ...(await importOriginal<typeof import("./market")>()), loadMarketInitial: async () => manifest, loadMarketInitialCase: () => new Promise(() => {}) }));
  await import("./ui");
  await vi.waitFor(() => expect(root.textContent).not.toContain("正在加载案例目录"));
  return { root, downloads };
}

describe("recovery screen and storage protection", () => {
  it("does not describe unreadable observations as cleared or active in recovery settings", async () => {
    const storage = new MemoryStorage(); const raw = save();
    storage.values.set(SAVE_KEY, raw); storage.values.set(FUNDING_EXPOSURE_KEY, "{broken");
    const { root } = await boot(storage);
    button(root, "设置").fire("click");
    expect(root.textContent).toContain("本地记录尚未恢复，当前不生成观察。");
    expect(root.textContent).not.toContain("撤销观察并删除观察记录");
    expect(root.textContent).not.toContain("观察已撤销");
    expect(storage.values.get(SAVE_KEY)).toBe(raw); expect(storage.writes).toEqual([]);
  });

  it("preserves corrupt raw data until confirmation, with an explicitly requested local backup", async () => {
    const storage = new MemoryStorage(); storage.values.set(SAVE_KEY, "{broken"); storage.values.set(SEEN_KEY, '["lantern-a"]'); storage.values.set(FUNDING_EXPOSURE_KEY, '{"version":88}'); storage.values.set("nextcard:v1", "legacy");
    const { root, downloads } = await boot(storage);
    expect(root.textContent).toContain("本地记录需要处理"); expect(storage.writes).toEqual([]);
    await vi.waitFor(() => expect(button(root, "清除现有冒险与观察，开始新旅程").attributes.disabled).toBeUndefined());
    expect(downloads).toHaveLength(0); button(root, "下载本地备份").fire("click");
    expect(JSON.parse(await downloads[0]!.text())).toEqual({ [SAVE_KEY]: "{broken", [SEEN_KEY]: '["lantern-a"]', [FUNDING_EXPOSURE_KEY]: '{"version":88}' });
    expect(root.textContent).toContain("已发起本地备份下载"); expect(storage.writes).toEqual([]);
    button(root, "清除现有冒险与观察，开始新旅程").fire("click"); expect(storage.writes).toEqual([]);
    button(root, "保留现有记录").fire("click"); expect(storage.writes).toEqual([]);
    button(root, "清除现有冒险与观察，开始新旅程").fire("click"); button(root, "确认清除并开始").fire("click");
    expect(JSON.parse(storage.values.get(SAVE_KEY)!).run.phase).toBe("battle");
    expect(storage.values.has(SEEN_KEY)).toBe(false); expect(storage.values.has(FUNDING_EXPOSURE_KEY)).toBe(false); expect(storage.values.get("nextcard:v1")).toBe("legacy");
  });

  it("does not discard the old snapshot if a confirmed replacement cannot be saved", async () => {
    const storage = new MemoryStorage(); storage.values.set(SAVE_KEY, "{broken"); storage.values.set(FUNDING_EXPOSURE_KEY, "{bad");
    storage.fail = (operation, key) => operation === "set" && key === SAVE_KEY;
    const { root } = await boot(storage);
    await vi.waitFor(() => expect(button(root, "清除后只玩游戏").attributes.disabled).toBeUndefined());
    button(root, "清除后只玩游戏").fire("click"); button(root, "确认清除并开始").fire("click");
    expect(root.textContent).toContain("未能保存新旅程"); expect(root.textContent).toContain("本地记录需要处理");
    expect(storage.values.get(SAVE_KEY)).toBe("{broken"); expect(storage.values.get(FUNDING_EXPOSURE_KEY)).toBe("{bad"); expect(storage.writes).toEqual([]);
  });

  it("retains the original backup in memory when a later write and rollback both fail", async () => {
    const storage = new MemoryStorage(); storage.values.set(SAVE_KEY, "{broken"); storage.values.set(SEEN_KEY, '["lantern-a"]'); storage.values.set(FUNDING_EXPOSURE_KEY, "{bad");
    storage.fail = (operation, key, value) => (operation === "remove" && key === FUNDING_EXPOSURE_KEY) || (operation === "set" && key === SAVE_KEY && value === "{broken");
    const { root, downloads } = await boot(storage);
    await vi.waitFor(() => expect(button(root, "清除后只玩游戏").attributes.disabled).toBeUndefined());
    button(root, "清除后只玩游戏").fire("click"); button(root, "确认清除并开始").fire("click");
    expect(root.textContent).toContain("未能完全恢复"); expect(root.textContent).toContain("部分本机内容可能已变化");
    expect(root.textContent).not.toContain("可辨认的旧旅程");
    button(root, "重试读取本地记录").fire("click");
    expect(root.textContent).toContain("仍可下载此前读取的备份");
    button(root, "下载本地备份").fire("click");
    expect(JSON.parse(await downloads[0]!.text())).toEqual({ [SAVE_KEY]: "{broken", [SEEN_KEY]: '["lantern-a"]', [FUNDING_EXPOSURE_KEY]: "{bad" });
  });

  it("retries an incomplete save without replacing it and can resume once it becomes valid", async () => {
    const storage = new MemoryStorage();
    const broken = JSON.stringify({ schema: "nextcard-adventure-save-v1", savedAt: Date.now(), observationStartedAt: Date.now(), run: { version: "0.4.1", source: "real", phase: "battle", node: "N1", battle: { turn: 1 } }, profile: { version: "research-v1", enabled: false } });
    storage.values.set(SAVE_KEY, broken);
    const { root } = await boot(storage);
    expect(root.textContent).toContain("本地记录需要处理"); expect(storage.values.get(SAVE_KEY)).toBe(broken); expect(storage.writes).toEqual([]);
    const repaired = save(Date.now(), false); storage.values.set(SAVE_KEY, repaired);
    button(root, "重试读取本地记录").fire("click");
    expect(root.textContent).toContain("继续上次旅程"); expect(root.textContent).not.toContain("本地记录需要处理");
    expect(storage.values.get(SAVE_KEY)).toBe(repaired); expect(storage.writes).toEqual([]);
  });

  it("keeps an unknown-case pending order retryable even when its quote loader throws synchronously", async () => {
    const storage = new MemoryStorage(); const run = pendingUnknownCase();
    const raw = JSON.stringify({ schema: "nextcard-adventure-save-v1", savedAt: Date.now(), observationStartedAt: Date.now(), run, profile: emptyResearchProfile(false) }); storage.values.set(SAVE_KEY, raw);
    const { root } = await boot(storage);
    button(root, "继续上次旅程").fire("click");
    await vi.waitFor(() => expect(root.textContent).toContain("这段旅程暂时停在这里"));
    expect(root.textContent).toContain("无效的案例编号"); expect(button(root, "重新加载")).toBeDefined();
    expect(storage.values.get(SAVE_KEY)).toBe(raw); expect(storage.writes).toEqual([]);
    button(root, "重新加载").fire("click");
    await vi.waitFor(() => expect(root.textContent).toContain("这段旅程暂时停在这里"));
    expect(storage.values.get(SAVE_KEY)).toBe(raw);
  });

  it("blocks writes when storage cannot be read and offers no incomplete backup", async () => {
    const storage = new MemoryStorage(); storage.fail = (operation) => operation === "get";
    const { root } = await boot(storage);
    expect(root.textContent).toContain("无法读取本地记录");
    expect(button(root, "下载本地备份").attributes.disabled).toBe("");
    expect(button(root, "清除后只玩游戏").attributes.disabled).toBe(""); expect(storage.writes).toEqual([]);
    button(root, "设置").fire("click"); button(root, "清除全部本地记录").fire("click"); button(root, "确认清除").fire("click");
    expect(root.textContent).toContain("未开始清除"); expect(storage.writes).toEqual([]);
  });

  it("keeps a valid main record read-only when an auxiliary archive is invalid", async () => {
    const storage = new MemoryStorage(); const raw = save(); storage.values.set(SAVE_KEY, raw); storage.values.set(FUNDING_EXPOSURE_KEY, "{");
    const { root } = await boot(storage);
    expect(root.textContent).toContain("可辨认的旧旅程"); expect(root.textContent).toContain("研究提示或答案的记录无法核验");
    expect(storage.values.get(SAVE_KEY)).toBe(raw); expect(storage.values.get(FUNDING_EXPOSURE_KEY)).toBe("{"); expect(storage.writes).toEqual([]);
  });

  it("expires a verified main observation while preserving an unreadable auxiliary archive", async () => {
    const storage = new MemoryStorage(); const raw = save(Date.now() - RETENTION_MS - 1000); const original = JSON.parse(raw);
    storage.values.set(SAVE_KEY, raw); storage.values.set(FUNDING_EXPOSURE_KEY, "{broken");
    const { root, downloads } = await boot(storage);
    const cleaned = JSON.parse(storage.values.get(SAVE_KEY)!);
    expect(cleaned.profile.enabled).toBe(false); expect(cleaned.profile.stated_interest).toEqual([]); expect(cleaned.run.observationEnabled).toBe(false);
    expect(cleaned.run.id).toBe(original.run.id); expect(cleaned.run.hp).toBe(original.run.hp);
    expect(storage.values.get(FUNDING_EXPOSURE_KEY)).toBe("{broken"); expect(root.textContent).toContain("本地记录需要处理");
    button(root, "下载本地备份").fire("click");
    const backup = JSON.parse(await downloads[0]!.text());
    expect(JSON.parse(backup[SAVE_KEY]).profile.stated_interest).toEqual([]); expect(backup[FUNDING_EXPOSURE_KEY]).toBe("{broken");
  });

  it("expires a verified auxiliary archive without changing a damaged main record", async () => {
    const storage = new MemoryStorage(); storage.values.set(SAVE_KEY, "{broken");
    storage.values.set(FUNDING_EXPOSURE_KEY, JSON.stringify({ version: 1, createdAt: Date.now() - RETENTION_MS - 1000, entries: [] }));
    const { root, downloads } = await boot(storage);
    expect(storage.values.get(SAVE_KEY)).toBe("{broken"); expect(storage.values.has(FUNDING_EXPOSURE_KEY)).toBe(false);
    expect(root.textContent).toContain("本地记录需要处理"); button(root, "下载本地备份").fire("click");
    const backup = JSON.parse(await downloads[0]!.text()); expect(backup[SAVE_KEY]).toBe("{broken"); expect(backup[FUNDING_EXPOSURE_KEY]).toBeNull();
  });

  it("never exports an already cleaned expired main profile when clearing an expired auxiliary key fails", async () => {
    const storage = new MemoryStorage(); storage.values.set(SAVE_KEY, save(Date.now() - RETENTION_MS - 1000));
    const archive = JSON.stringify({ version: 1, createdAt: Date.now() - RETENTION_MS - 1000, entries: [] }); storage.values.set(FUNDING_EXPOSURE_KEY, archive);
    storage.fail = (operation, key) => operation === "remove" && key === FUNDING_EXPOSURE_KEY;
    const { root, downloads } = await boot(storage);
    expect(root.textContent).toContain("部分过期观察仍未清理"); expect(storage.values.get(FUNDING_EXPOSURE_KEY)).toBe(archive);
    expect(JSON.parse(storage.values.get(SAVE_KEY)!).profile.stated_interest).toEqual([]);
    button(root, "下载本地备份").fire("click"); const backup = JSON.parse(await downloads[0]!.text());
    expect(JSON.parse(backup[SAVE_KEY]).profile.stated_interest).toEqual([]); expect(backup[FUNDING_EXPOSURE_KEY]).toBe(archive);
  });

  it("still clears a separately expired archive when writing the cleaned main save is denied", async () => {
    const storage = new MemoryStorage(); const oldSave = save(Date.now() - RETENTION_MS - 1000); storage.values.set(SAVE_KEY, oldSave);
    storage.values.set(FUNDING_EXPOSURE_KEY, JSON.stringify({ version: 1, createdAt: Date.now() - RETENTION_MS - 1000, entries: [] }));
    storage.fail = (operation, key) => operation === "set" && key === SAVE_KEY;
    const { root, downloads } = await boot(storage);
    expect(root.textContent).toContain("部分过期观察仍未清理"); expect(storage.values.get(SAVE_KEY)).toBe(oldSave);
    expect(storage.values.has(FUNDING_EXPOSURE_KEY)).toBe(false);
    button(root, "下载本地备份").fire("click"); const backup = JSON.parse(await downloads[0]!.text());
    expect(backup[SAVE_KEY]).toBe(oldSave); expect(backup[FUNDING_EXPOSURE_KEY]).toBeNull();
  });

  it("rolls back a partial explicit clear and keeps the old-version storage untouched", async () => {
    const storage = new MemoryStorage(); storage.values.set(SAVE_KEY, "{broken"); storage.values.set(SEEN_KEY, '["lantern-a"]'); storage.values.set(FUNDING_EXPOSURE_KEY, "{bad"); storage.values.set("nextcard:v1", "legacy");
    storage.fail = (operation, key) => operation === "remove" && key === SEEN_KEY;
    const { root } = await boot(storage);
    button(root, "设置").fire("click"); button(root, "清除全部本地记录").fire("click"); button(root, "确认清除").fire("click");
    expect(root.textContent).toContain("未能完成清除，原记录已保留");
    expect(storage.values.get(SAVE_KEY)).toBe("{broken"); expect(storage.values.get(SEEN_KEY)).toBe('["lantern-a"]'); expect(storage.values.get(FUNDING_EXPOSURE_KEY)).toBe("{bad"); expect(storage.values.get("nextcard:v1")).toBe("legacy");
  });

  it("removes only verified expired observations while preserving the run and old-version key", async () => {
    const storage = new MemoryStorage(); storage.values.set(SAVE_KEY, save(Date.now() - RETENTION_MS - 1000));
    storage.values.set(FUNDING_EXPOSURE_KEY, JSON.stringify({ version: 1, createdAt: Date.now(), entries: [] }));
    storage.values.set(SEEN_KEY, '["lantern-a"]'); storage.values.set("nextcard:v1", "legacy");
    const { root } = await boot(storage);
    expect(root.textContent).not.toContain("本地记录需要处理");
    const restored = JSON.parse(storage.values.get(SAVE_KEY)!);
    expect(restored.profile.enabled).toBe(false); expect(restored.profile.stated_interest).toEqual([]); expect(restored.run.observationEnabled).toBe(false); expect(restored.run.node).toBe("N1");
    expect(storage.values.has(FUNDING_EXPOSURE_KEY)).toBe(false); expect(storage.values.get(SEEN_KEY)).toBe('["lantern-a"]'); expect(storage.values.get("nextcard:v1")).toBe("legacy");
  });
});
