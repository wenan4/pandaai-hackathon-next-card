import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetForTest, loadReveal, loadVisible, RevealLockedError, requestedReveals } from "./cases";

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

  it("每轮揭晓文件只含这一轮", () => {
    const combined = JSON.parse(read("cases_reveal.json"));
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
    expect(read("cases_visible.json")).not.toMatch(/(?<!\d)(19|20)\d{2}-?(0[1-9]|1[0-2])-?(0[1-9]|[12]\d|3[01])(?!\d)/);
  });
});
