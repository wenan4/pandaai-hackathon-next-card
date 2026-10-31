import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetForTest, loadReveal, loadVisible, loadVisibleAct2, RevealLockedError, requestedReveals } from "./cases";

const read = (f: string) => readFileSync(new URL(`../../public/data/${f}`, import.meta.url), "utf8");

describe("揭晓前不得持有未来数据", () => {
  afterEach(() => {
    _resetForTest();
    vi.unstubAllGlobals();
  });

  it("未锁定时不发请求；锁定第 1 轮只请求第 1 轮的揭晓文件", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      const file = url.split("/").pop()!;
      return { ok: true, status: 200, json: async () => JSON.parse(read(file)) };
    });
    await loadVisible();
    await expect(loadReveal("R1", false)).rejects.toBeInstanceOf(RevealLockedError);
    expect(urls.some((u) => u.includes("reveal"))).toBe(false);
    const { round } = await loadReveal("R1", true);
    expect(round.round_id).toBe("R1");
    expect(requestedReveals()).toEqual(["R1"]);
    expect(urls.filter((u) => u.includes("reveal"))).toEqual([expect.stringContaining("cases_reveal_R1.json")]);
  });

  it("第一幕不请求第二幕的数据；第二幕开始后才请求它的可见文件，揭晓仍按轮", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => JSON.parse(read(url.split("/").pop()!)) };
    });
    await loadVisible();
    expect(urls.some((u) => u.includes("act2"))).toBe(false);
    const act2 = await loadVisibleAct2();
    expect(act2.map((r) => r.round_id)).toEqual(["R4", "R5", "R6"]);
    expect(urls.filter((u) => u.includes("reveal"))).toEqual([]);
    expect((await loadReveal("R4", true)).round.round_id).toBe("R4");
    expect(requestedReveals()).toEqual(["R4"]);
  });

  it("每轮揭晓文件只含这一轮", () => {
    const combined = JSON.parse(read("cases_reveal.json"));
    const combined2 = JSON.parse(read("cases_act2_reveal.json"));
    for (const r of ["R4", "R5", "R6"]) {
      const d = JSON.parse(read(`cases_reveal_${r}.json`));
      expect(d.rounds[0]).toEqual(combined2.rounds.find((x: { round_id: string }) => x.round_id === r));
    }
    for (const r of ["R1", "R2", "R3"]) {
      const d = JSON.parse(read(`cases_reveal_${r}.json`));
      expect(d.rounds.map((x: { round_id: string }) => x.round_id)).toEqual([r]);
      expect(d.rounds[0]).toEqual(combined.rounds.find((x: { round_id: string }) => x.round_id === r));
    }
  });

  it("揭晓请求失败后可以重新加载，不永久缓存失败", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => JSON.parse(read("cases_reveal_R1.json")) });
    vi.stubGlobal("fetch", fetcher);
    await expect(loadReveal("R1", true)).rejects.toThrow("503");
    expect((await loadReveal("R1", true)).round.round_id).toBe("R1");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("可见文件里没有任何日期", () => {
    for (const f of ["cases_visible.json", "cases_act2_visible.json"]) {
      expect(read(f), f).not.toMatch(/(?<!\d)(19|20)\d{2}-?(0[1-9]|1[0-2])-?(0[1-9]|[12]\d|3[01])(?!\d)/);
    }
  });
});
