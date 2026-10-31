import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UNKNOWN_YET } from "../config/copy";
import { AVAILABLE_TOPICS, ENGINE_CONFIG } from "../config/engine";
import { ROUNDS } from "../config/rounds";
import { PRESETS } from "../panel/presets";
import { eventsFromSpecs } from "./paths";
import { structuredResult } from "./result";

// docs/examples 里的样例由引擎生成，不手写：GEN_EXAMPLES=1 npx vitest run src/engine/result.test.ts 重新生成
const dir = new URL("../../docs/examples/", import.meta.url);
const EXAMPLES = ["yi", "jia", "bing"];

describe("结构化结果导出（YOU-169）", () => {
  for (const id of EXAMPLES) {
    it(`模拟路径 ${id} 的样例与引擎输出一致`, () => {
      const p = PRESETS.find((x) => x.id === id)!;
      const result = structuredResult(eventsFromSpecs(p.specs, ROUNDS, "example"), ENGINE_CONFIG, AVAILABLE_TOPICS, { kind: "simulated_path", path_id: p.name }, UNKNOWN_YET);
      const text = JSON.stringify(result, null, 2) + "\n";
      const file = new URL(`result.${id}.json`, dir);
      if (process.env.GEN_EXAMPLES === "1") {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, text);
      }
      expect(existsSync(file)).toBe(true);
      // Windows 上 core.autocrlf 会把样例检出成 CRLF，只比较内容
      expect(readFileSync(file, "utf8").replace(/\r\n/g, "\n")).toBe(text);
    });
  }

  it("导出保留契约要求的匿名会话编号，不包含原始事件", () => {
    const p = PRESETS[0]!;
    const text = JSON.stringify(structuredResult(eventsFromSpecs(p.specs, ROUNDS, "secret-session-id"), ENGINE_CONFIG, AVAILABLE_TOPICS, { kind: "real_session" }, UNKNOWN_YET));
    expect(JSON.parse(text).provenance.session_id).toBe("secret-session-id");
    expect(JSON.parse(text)).not.toHaveProperty("events");
  });
});
