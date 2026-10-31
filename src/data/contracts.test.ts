import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CasesRevealSchema, CasesVisibleSchema, DATA_SCHEMA_ID, TaskADataSchema, TaskBDataSchema } from "../../contracts";

// 所有发布到 public/data 的文件都必须通过 YOU-145 契约，并使用冻结后的 schema 标记（不再是 draft）
const dir = new URL("../../public/data/", import.meta.url);
const load = (name: string) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
const SCHEMAS: [RegExp, { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] } } }][] = [
  [/^cases(_act2)?_visible\.json$/, CasesVisibleSchema],
  [/^cases(_act2)?_reveal(_R\d)?\.json$/, CasesRevealSchema],
  [/^taskA\.json$/, TaskADataSchema],
  [/^taskB_\w+\.json$/, TaskBDataSchema],
];

describe("public/data 通过契约校验", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  it("每个数据文件都有对应的契约", () => {
    expect(files.filter((f) => !SCHEMAS.some(([re]) => re.test(f)))).toEqual([]);
  });
  for (const f of files) {
    it(f, () => {
      const doc = load(f);
      const schema = SCHEMAS.find(([re]) => re.test(f))![1];
      const parsed = schema.safeParse(doc);
      expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
      expect(doc.header.schema).toBe(DATA_SCHEMA_ID);
    });
  }
  it("taskA 写了生成时间", () => {
    expect(load("taskA.json").header.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
