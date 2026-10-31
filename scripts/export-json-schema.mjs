// 由 contracts/ 里的 TypeScript(zod) 定义导出 JSON Schema，写到 contracts/schema/。
// TS 类型为准：不要手改 schema 文件；contracts.test.ts 会检查它们没有落后于 TS。
//
//   node scripts/export-json-schema.mjs           重新生成
//   node scripts/export-json-schema.mjs --check   只检查是否与 TS 一致（不写文件）
//
// JSON Schema 表达不了 superRefine 里的跨字段规则（如 O4 的 N/M 与规则编号、ready_for_B = S1 && S2），
// 这些规则只在 zod 校验器里生效。非 TS 的使用方（数据脚本）要校验这些规则，请用 TS 校验器。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "contracts", "schema");
const check = process.argv.includes("--check");

const server = await createServer({
  root,
  logLevel: "silent",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, watch: null },
});

const stale = [];
try {
  const { JSON_SCHEMA_TARGETS, renderJsonSchema } = await server.ssrLoadModule("/contracts/json-schema.ts");
  if (!check) mkdirSync(outDir, { recursive: true });
  for (const target of JSON_SCHEMA_TARGETS) {
    const text = renderJsonSchema(target);
    const path = join(outDir, target.file);
    if (check) {
      const current = existsSync(path) ? readFileSync(path, "utf-8").replace(/\r\n/g, "\n") : null;
      if (current !== text) stale.push(target.file);
    } else {
      writeFileSync(path, text, "utf-8");
      console.log(`wrote contracts/schema/${target.file}`);
    }
  }
} finally {
  await server.close();
}

if (check && stale.length > 0) {
  console.error(`JSON Schema 落后于 TypeScript 定义：${stale.join("、")}\n运行 node scripts/export-json-schema.mjs 重新生成。`);
  process.exit(1);
}
if (check) console.log("JSON Schema 与 TypeScript 定义一致");
