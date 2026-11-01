import { loadMarketInitialCase, loadMarketStage, type MarketInitialCase, type MarketSeries, type MarketStage } from "./market";
import type { Run } from "./types";

type ClosingStage = "t1" | "t2" | "t3";
const closing: ClosingStage[] = ["t1", "t2", "t3"];
export interface ArchiveSnapshot extends MarketInitialCase {
  throughDate: string;
  revealedSegments: number;
}
function revealed(run: Run): { stage: ClosingStage; date: string; price: number }[] {
  return closing.flatMap((stage) => {
    const event = run.history.find((item) => item.type === "market" && item.action === "apply-quote" && item.data.stage === stage);
    if (!event || typeof event.data.date !== "string" || !/^(\d{8}|\d{4}-\d{2}-\d{2})$/.test(event.data.date) || typeof event.data.price !== "number" || !Number.isSafeInteger(event.data.price) || event.data.price <= 0) return [];
    return [{ stage, date: event.data.date.replaceAll("-", ""), price: event.data.price }];
  });
}
export function archiveKey(run: Run): string {
  return `${run.id}:${run.caseId}:${revealed(run).map((item) => `${item.stage}-${item.date}-${item.price}`).join("/")}`;
}

/** Rebuild only the paid archive's already-applied closing segments, including after reload. */
export async function loadArchiveSnapshot(run: Run): Promise<ArchiveSnapshot> {
  if (!run.archiveOwned) throw new Error("请先解锁历史档案。");
  const observed = revealed(run);
  if (observed.some((item, index) => item.stage !== closing[index])) throw new Error("缺少前一段已揭晓记录，暂时无法完整更新档案。");
  const initial = await loadMarketInitialCase(run.caseId, true);
  const segments = await Promise.all(observed.map(async (known) => {
    const quote = await loadMarketStage(run.caseId, known.stage as MarketStage, true);
    if (quote.date !== known.date || quote.price !== known.price || !quote.segment) throw new Error("档案资料与本局已揭晓记录不一致，请重试。");
    return quote.segment;
  }));
  const points = new Map<string, [number, number]>();
  for (const series of [initial.history, ...segments]) {
    series.dates.forEach((date, i) => {
      const pair: [number, number] = [series.asset[i]!, series.benchmark[i]!];
      const previous = points.get(date);
      if (previous && (previous[0] !== pair[0] || previous[1] !== pair[1])) throw new Error("相邻历史片段未能衔接，请重试。");
      points.set(date, pair);
    });
  }
  const rows = [...points.entries()].sort(([a], [b]) => a.localeCompare(b));
  const history: MarketSeries = { dates: rows.map(([date]) => date), asset: rows.map(([, pair]) => pair[0]), benchmark: rows.map(([, pair]) => pair[1]) };
  return { ...initial, history, throughDate: history.dates.at(-1)!, revealedSegments: observed.length };
}
