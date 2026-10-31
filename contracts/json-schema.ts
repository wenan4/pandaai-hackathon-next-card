// 导出 JSON Schema 的唯一入口：scripts/export-json-schema.mjs 写文件，contracts.test.ts 检查文件没有落后。
import { z } from "zod";
import {
  CasesRevealSchema,
  CasesVisibleSchema,
  EventLogSchema,
  RoundsConfigSchema,
  StructuredResultSchema,
  TaskADataSchema,
  TaskBDataSchema,
} from "./index";

export const JSON_SCHEMA_TARGETS = [
  { file: "events.schema.json", title: "事件序列（PRD v0.3 §4.1）", schema: EventLogSchema },
  { file: "rounds.schema.json", title: "关卡配置（PRD v0.3 §3）", schema: RoundsConfigSchema },
  { file: "result.schema.json", title: "结构化输出（PRD v0.3 §6）", schema: StructuredResultSchema },
  { file: "cases_visible.schema.json", title: "cases_visible：决策时可见部分", schema: CasesVisibleSchema },
  { file: "cases_reveal.schema.json", title: "cases_reveal：揭晓后部分", schema: CasesRevealSchema },
  { file: "taskA.schema.json", title: "任务 A 数据文件", schema: TaskADataSchema },
  { file: "taskB.schema.json", title: "任务 B 数据文件", schema: TaskBDataSchema },
] as const;

/** 文件内容（LF 换行，末尾带换行）。 */
export function renderJsonSchema(target: (typeof JSON_SCHEMA_TARGETS)[number]): string {
  const json = z.toJSONSchema(target.schema, { target: "draft-2020-12", unrepresentable: "any", io: "input" });
  return JSON.stringify({ title: target.title, ...json }, null, 2) + "\n";
}
