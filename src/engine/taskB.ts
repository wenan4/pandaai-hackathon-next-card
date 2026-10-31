// 任务 B 的结论判定。与 scripts/pd_common/taskb.py 是同一份规则，两边共用 fixtures/taskB_verdict_cases.json。
// 先检查数据，再检查阈值：任一段任一组样本少于 min_samples 或缺主指标 → insufficient_evidence；
// 否则信号组主指标比基准组高出至少 advantage_margin（刚好等于也算）的分段算“达到”。

export type TaskBResult = "insufficient_evidence" | "both_segments" | "segment_difference" | "no_observed_advantage";
export type Segment = "display" | "test";
export interface TaskBVerdict {
  result: TaskBResult;
  only_segment?: Segment;
}
interface GroupLike {
  n_records: number;
  primary_metric: number | null;
}
export type SegmentsLike = Record<Segment, { signal_group: GroupLike; baseline_group: GroupLike }>;
export interface Thresholds {
  min_samples: number;
  advantage_margin: number;
}

// 主指标保留 6 位小数，差值比较留一点余量，避免 0.6 - 0.55 这类浮点误差把“刚好等于”判成未达到
const EPS = 1e-9;
const SEGMENTS: Segment[] = ["display", "test"];

export function comparison(signal: number | null, baseline: number | null, margin: number): { delta: number | null; meets: boolean | null } {
  if (signal === null || baseline === null) return { delta: null, meets: null };
  const delta = Math.round((signal - baseline) * 1e6) / 1e6;
  return { delta, meets: delta >= margin - EPS };
}

export function verdict(data: SegmentsLike, t: Thresholds): TaskBVerdict {
  for (const seg of SEGMENTS) {
    for (const g of [data[seg].signal_group, data[seg].baseline_group]) {
      if (g.primary_metric === null || g.n_records < t.min_samples) return { result: "insufficient_evidence" };
    }
  }
  const meets = (seg: Segment) =>
    comparison(data[seg].signal_group.primary_metric, data[seg].baseline_group.primary_metric, t.advantage_margin).meets === true;
  const d = meets("display");
  const s = meets("test");
  if (d && s) return { result: "both_segments" };
  if (d || s) return { result: "segment_difference", only_segment: d ? "display" : "test" };
  return { result: "no_observed_advantage" };
}

/** 作答选项用的扁平键：segment_difference 按哪一段达到拆成两项，共五个分支。 */
export type TaskBAnswer = "insufficient_evidence" | "both_segments" | "only_display" | "only_test" | "no_observed_advantage";
export function answerKey(v: TaskBVerdict): TaskBAnswer {
  if (v.result !== "segment_difference") return v.result;
  return v.only_segment === "display" ? "only_display" : "only_test";
}
