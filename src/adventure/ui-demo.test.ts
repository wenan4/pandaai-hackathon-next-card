import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it, vi } from "vitest";
import { makeDemoPath } from "./ui-demo";

// Exercise both visible judge paths using the same staged files used by the browser.
describe("judge demonstration paths", () => {
  afterAll(() => vi.unstubAllGlobals());
  it("generates distinct economic evidence through legal reducer actions", async () => {
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const address = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
      try { return new Response(await readFile(`public${address}`), { status: 200, headers: { "Content-Type": "application/json" } }); }
      catch { return new Response("not found", { status: 404 }); }
    });
    const a = await makeDemoPath("A", "lantern-a");
    const b = await makeDemoPath("B", "lantern-a");
    expect(a.status).toBe("cleared"); expect(b.status).toBe("cleared");
    expect(a.source).toBe("demo"); expect(b.source).toBe("demo");
    expect(a.history.some((e) => e.action === "open-archive")).toBe(true);
    expect(b.history.some((e) => e.action === "purchase-attempted")).toBe(true);
    expect(b.history.some((e) => e.action === "submit-redemption" && e.node === "N4")).toBe(true);
  });
});
