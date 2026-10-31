type StartupPhase = "entry" | "ui" | "style" | "legacy-data" | "render";
interface StartupBridge {
  begin: (phase: StartupPhase) => void;
  fail: (phase: StartupPhase) => void;
  ready: () => void;
}
declare global { interface Window { __nextCardStartup?: StartupBridge } }
export {};

async function start(): Promise<void> {
  const shell = window.__nextCardStartup;
  try {
    const legacy = new URLSearchParams(window.location.search).get("legacy") === "1";
    shell?.begin("ui");
    if (legacy) {
      const entry = await import("./legacy");
      shell?.begin("legacy-data");
      const result = await entry.startup;
      if (!result.ok) { shell?.fail(result.stage); return; }
    } else {
      await import("./adventure/ui");
    }
    shell?.begin("render");
    if (!document.getElementById("app")?.firstElementChild) { shell?.fail("render"); return; }
    shell?.ready();
  } catch {
    // The fallback exposes only a fixed stage, never the exception or stored data.
    shell?.fail("ui");
  }
}

void start();
