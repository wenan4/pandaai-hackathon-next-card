/** Derived Panda Data snapshots. Requests are deliberately separated by stage.
 * This prevents accidental future-data use in the UI; static files are not secret.
 */
export const PRICE_SCALE = 1_000_000;
export type MarketStage = "entry" | "t1" | "t1-exec" | "t2" | "t2-exec" | "t3" | "final-exec"
  | "exit-after-entry" | "exit-after-t1-exec" | "exit-after-t2-exec";
export type ExecutionStage = "entry" | "t1-exec" | "t2-exec" | "final-exec";

export interface MarketSeries {
  dates: string[];
  asset: number[];
  benchmark: number[];
}
export interface MarketInitialCase {
  caseId: string;
  title: string;
  symbol: string;
  name: string;
  decisionDate: string;
  benchmark: string;
  history: MarketSeries;
  priceScale: number;
  t0Close: number;
}
export interface MarketManifest {
  schema: string;
  generatedAt: string;
  dataAsOf: string;
  source: string;
  apis: string[];
  adjustment: string;
  limitations: string[];
  selection: string;
  cases: MarketInitialCase[];
}
export interface MarketQuote {
  caseId: string;
  step: MarketStage;
  date: string;
  /** Integer, T0 asset close = PRICE_SCALE. */
  price: number;
  /** Only present for a just-revealed close, not for execution quotes. */
  segment?: MarketSeries;
}
export interface ResearchMarketCase {
  caseId: string;
  title: string;
  decisionDate: string;
  benchmarkName: string;
  priceScale: number;
  dates: string[];
  assetClose: number[];
  benchmarkClose: number[];
  execution: { step: ExecutionStage; date: string; price: number; benchmarkPrice: number }[];
}

const stages: readonly MarketStage[] = ["entry", "t1", "t1-exec", "t2", "t2-exec", "t3", "final-exec", "exit-after-entry", "exit-after-t1-exec", "exit-after-t2-exec"];
const base = import.meta.env.BASE_URL;
let initial: Promise<MarketManifest> | undefined;
const quotes = new Map<string, Promise<MarketQuote>>();
const research = new Map<string, Promise<ResearchMarketCase>>();

export class MarketLockedError extends Error {}
export class MarketDataError extends Error {}

function safeCaseId(caseId: string): void {
  if (!/^lantern-[a-z]$/.test(caseId)) throw new MarketDataError("无效的案例编号");
}
function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{8}$/.test(value);
}
function validSeries(series: MarketSeries, endDate: string): boolean {
  return Array.isArray(series?.dates) && series.dates.length >= 2
    && series.dates.length === series.asset?.length && series.dates.length === series.benchmark?.length
    && series.dates.every((d, i) => validDate(d) && d <= endDate && (i === 0 || d > series.dates[i - 1]!))
    && series.asset.every(positiveInteger) && series.benchmark.every(positiveInteger);
}
async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${base}data/adventure/${path}`);
  if (!response.ok) throw new MarketDataError(`无法加载市场数据（${response.status}），可重试`);
  return await response.json() as T;
}

/** Contains past information through each case's T0 only. */
export function loadMarketInitial(): Promise<MarketManifest> {
  initial ??= fetchJson<MarketManifest>("manifest.json").then((data) => {
    if (data.schema !== "adventure-market-v1" || !Array.isArray(data.cases) || data.cases.length < 2) throw new MarketDataError("案例目录不完整");
    for (const c of data.cases) {
      safeCaseId(c.caseId);
      if (!validDate(c.decisionDate) || c.priceScale !== PRICE_SCALE || c.t0Close !== PRICE_SCALE
        || !validSeries(c.history, c.decisionDate) || c.history.dates.at(-1) !== c.decisionDate) throw new MarketDataError("起始历史数据无效");
    }
    return data;
  }).catch((error: unknown) => { initial = undefined; throw error; });
  return initial;
}

/** unlocked means the corresponding order is locked or the battle time was advanced.
 * Every call checks the flag even when the result was previously requested.
 */
export function loadMarketStage(caseId: string, stage: MarketStage, unlocked: boolean): Promise<MarketQuote> {
  if (!unlocked) return Promise.reject(new MarketLockedError("尚未到此时间点或订单尚未锁定"));
  safeCaseId(caseId);
  if (!stages.includes(stage)) return Promise.reject(new MarketDataError("无效报价阶段"));
  const key = `${caseId}/${stage}`;
  let pending = quotes.get(key);
  if (!pending) {
    pending = fetchJson<MarketQuote>(`stages/${key}.json`).then((quote) => {
      if (quote.caseId !== caseId || quote.step !== stage || !validDate(quote.date) || !positiveInteger(quote.price)) throw new MarketDataError("阶段报价无效");
      const closing = stage === "t1" || stage === "t2" || stage === "t3";
      if (closing && (!quote.segment || !validSeries(quote.segment, quote.date) || quote.segment.dates.at(-1) !== quote.date || quote.segment.asset.at(-1) !== quote.price)) throw new MarketDataError("阶段历史片段无效");
      if (!closing && quote.segment) throw new MarketDataError("执行价文件不应包含历史片段");
      return quote;
    }).catch((error: unknown) => { quotes.delete(key); throw error; });
    quotes.set(key, pending);
  }
  return pending;
}

/** The fixed schedule and initial hypothesis must already be locked. */
export function loadResearchCase(caseId: string, locked: boolean): Promise<ResearchMarketCase> {
  if (!locked) return Promise.reject(new MarketLockedError("请先锁定待核查判断和固定日程"));
  safeCaseId(caseId);
  let pending = research.get(caseId);
  if (!pending) {
    pending = fetchJson<ResearchMarketCase>(`research/${caseId}.json`).then((data) => {
      const s: MarketSeries = { dates: data.dates, asset: data.assetClose, benchmark: data.benchmarkClose };
      const expected: ExecutionStage[] = ["entry", "t1-exec", "t2-exec", "final-exec"];
      if (data.caseId !== caseId || data.priceScale !== PRICE_SCALE || !validDate(data.decisionDate)
        || !validSeries(s, data.dates?.at(-1) ?? "") || data.dates[0] !== data.decisionDate || data.dates.length !== 61
        || data.execution?.length !== 4 || !data.execution.every((x, i) => x.step === expected[i] && validDate(x.date) && positiveInteger(x.price) && positiveInteger(x.benchmarkPrice))) throw new MarketDataError("研究数据不完整");
      return data;
    }).catch((error: unknown) => { research.delete(caseId); throw error; });
    research.set(caseId, pending);
  }
  return pending;
}

/** Test helper, not used to alter the saved observation/exposure history. */
export function resetMarketCacheForTest(): void { initial = undefined; quotes.clear(); research.clear(); }
