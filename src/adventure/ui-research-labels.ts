/** Translate stored stage identifiers for display; the saved events remain unchanged. */
export function researchStageLabel(stage: string): string {
  const labels: Record<string, string> = {
    entry: "参与执行时", t1: "第一检查点的参考报价", t2: "第二检查点的参考报价", t3: "旅程终点的参考报价",
    "t1-exec": "第一段回收时", "t2-exec": "第二段回收时", "final-exec": "旅程结束后回收时",
    "exit-after-entry": "旅程结束后回收时", "exit-after-t1-exec": "旅程结束后回收时", "exit-after-t2-exec": "旅程结束后回收时",
  };
  return labels[stage] ?? "未识别的已记录节点";
}

export function fundingRowLabel(label: string | undefined): string | undefined {
  const match = label?.match(/^(实际执行|历史参考)：([^（]+)(（自动回收）)?$/);
  return match ? `${researchStageLabel(match[2]!)}${match[3] ?? ""}` : label;
}
