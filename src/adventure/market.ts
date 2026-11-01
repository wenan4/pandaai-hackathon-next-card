/** Derived Panda Data snapshots. Requests are deliberately separated by stage.
 * This prevents accidental future-data use in the UI; static files are not secret.
 */
export const PRICE_SCALE = 1_000_000;
export type MarketStage = "entry" | "t1" | "t1-exec" | "t2" | "t2-exec" | "t3" | "final-exec"
  | "exit-after-entry" | "exit-after-t1-exec" | "exit-after-t2-exec";
export type ExecutionStage = "entry" | "t1-exec" | "t2-exec" | "final-exec";

/** Cases C and D reuse overlapping dates of the same instrument. Treat either
 * as already exposed when the other is known; this is intentionally conservative.
 * A fresh array is returned each time so callers cannot mutate the relation.
 */
export function relatedCaseIds(caseId: string): string[] {
  return caseId === "lantern-c" || caseId === "lantern-d" ? ["lantern-c", "lantern-d"] : [caseId];
}

export interface MarketSeries {
  dates: string[];
  asset: number[];
  benchmark: number[];
}
export interface MarketCaseSummary {
  caseId: string;
  title: string;
  symbol: string;
  name: string;
  decisionDate: string;
  benchmark: string;
  priceScale: number;
  t0Close: number;
}
export interface MarketInitialCase extends MarketCaseSummary { history: MarketSeries }
export interface MarketManifest {
  schema: string;
  generatedAt: string;
  dataAsOf: string;
  source: string;
  apis: string[];
  adjustment: string;
  limitations: string[];
  selection: string;
  cases: MarketCaseSummary[];
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
const initialCases = new Map<string, Promise<MarketInitialCase>>();
const quotes = new Map<string, Promise<MarketQuote>>();
const rejectedQuotes = new Set<string>();
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
function onlyKeys(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}data/adventure/${path}`, init);
  if (!response.ok) throw new MarketDataError(`无法加载市场数据（${response.status}），可重试`);
  return await response.json() as T;
}

/** Metadata only. The per-case history is fetched after the run's case is fixed. */
export function loadMarketInitial(): Promise<MarketManifest> {
  initial ??= fetchJson<MarketManifest>("manifest.v2.json").then((data) => {
    if (data.schema !== "adventure-market-v2" || !onlyKeys(data, ["schema", "generatedAt", "dataAsOf", "source", "apis", "adjustment", "limitations", "selection", "cases"]) || !Array.isArray(data.cases) || data.cases.length < 2 || new Set(data.cases.map((c) => c.caseId)).size !== data.cases.length) throw new MarketDataError("案例目录不完整");
    for (const c of data.cases) {
      safeCaseId(c.caseId);
      if (!validDate(c.decisionDate) || c.priceScale !== PRICE_SCALE || c.t0Close !== PRICE_SCALE
        || !onlyKeys(c, ["caseId", "title", "symbol", "name", "decisionDate", "benchmark", "priceScale", "t0Close"])) throw new MarketDataError("案例目录包含意外行情或元数据无效");
    }
    return data;
  }).catch((error: unknown) => { initial = undefined; throw error; });
  return initial;
}

/** Only call after fixing the case for this run; contains no dates after T0. */
export function loadMarketInitialCase(caseId: string, locked: boolean): Promise<MarketInitialCase> {
  if (!locked) return Promise.reject(new MarketLockedError("请先固定本局案例"));
  safeCaseId(caseId);
  let pending = initialCases.get(caseId);
  if (!pending) {
    pending = loadMarketInitial().then((manifest) => {
      const summary = manifest.cases.find((item) => item.caseId === caseId);
      if (!summary) throw new MarketDataError("案例不在当前数据目录中");
      return fetchJson<MarketInitialCase>(`initial/${caseId}.json`).then((c) => ({ c, summary }));
    }).then(({ c, summary }) => {
      if (c.caseId !== caseId || !validDate(c.decisionDate) || c.priceScale !== PRICE_SCALE || c.t0Close !== PRICE_SCALE
        || c.decisionDate !== summary.decisionDate || c.symbol !== summary.symbol || c.benchmark !== summary.benchmark
        || !onlyKeys(c, ["caseId", "title", "symbol", "name", "decisionDate", "benchmark", "priceScale", "t0Close", "history"])
        || !validSeries(c.history, c.decisionDate) || c.history.dates.at(-1) !== c.decisionDate
        || !onlyKeys(c.history, ["dates", "asset", "benchmark"])
        || c.history.asset.at(-1) !== PRICE_SCALE || c.history.benchmark.at(-1) !== PRICE_SCALE) throw new MarketDataError("起始历史数据无效");
      return c;
    }).catch((error: unknown) => { initialCases.delete(caseId); throw error; });
    initialCases.set(caseId, pending);
  }
  return pending;
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
    pending = fetchJson<MarketQuote>(`stages/${key}.json`, rejectedQuotes.has(key) ? { cache: "no-store" } : undefined).then((quote) => {
      if (quote.caseId !== caseId || quote.step !== stage || !validDate(quote.date) || !positiveInteger(quote.price)) throw new MarketDataError("阶段报价无效");
      const closing = stage === "t1" || stage === "t2" || stage === "t3";
      if (closing && (!quote.segment || !validSeries(quote.segment, quote.date) || quote.segment.dates.at(-1) !== quote.date || quote.segment.asset.at(-1) !== quote.price)) throw new MarketDataError("阶段历史片段无效");
      if (!closing && quote.segment) throw new MarketDataError("执行价文件不应包含历史片段");
      rejectedQuotes.delete(key);
      return quote;
    }).catch((error: unknown) => { quotes.delete(key); throw error; });
    quotes.set(key, pending);
  }
  return pending;
}

/** Discard only a quote rejected by the reducer; retry the same locked stage from the source. */
export function discardRejectedMarketStage(caseId: string, stage: MarketStage): void {
  const key = `${caseId}/${stage}`;
  quotes.delete(key);
  rejectedQuotes.add(key);
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
export function resetMarketCacheForTest(): void { initial = undefined; initialCases.clear(); quotes.clear(); rejectedQuotes.clear(); research.clear(); }
