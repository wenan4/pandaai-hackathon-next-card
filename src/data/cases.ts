// 数据加载与“揭晓前不得持有未来数据”的隔离。
// 揭晓前只加载 cases_visible.json（只有 T 日及以前、相对日期、无代码名称）；
// 第 n 轮的揭晓数据只在这一轮锁定后才请求，且只请求这一轮的文件。

export interface VisibleRound {
  round_id: string;
  label: string;
  claim: string;
  cards: {
    fox: { asset: number[]; benchmark: number[]; benchmark_name: string; asset_return: number; benchmark_return: number };
    elephant: { series: number[]; cum_return: number; max_drawdown: number };
    leopard: { close: number[]; day_return: (number | null)[]; volume_ratio: (number | null)[] };
  };
}

export interface RevealSource {
  symbol: string;
  name: string;
  decision_date: string;
  windows: Record<"fox" | "elephant" | "leopard" | "after", [string, string]>;
  benchmark: string;
  claim: string;
  evidence_verdict: string;
  checks: Record<string, unknown>;
  selection: string;
  hindsight_disclosure: string;
  sector_index?: string;
}

export interface RevealRound {
  round_id: string;
  after: {
    close: number[];
    open_t1: number;
    close_t20: number;
    return_close_t_to_close_t20: number;
    return_open_t1_to_close_t20: number;
    t1_open_at_limit_up: boolean;
  };
  source: RevealSource;
}

export type DataHeader = Record<string, unknown> & {
  data_as_of?: string;
  apis?: string[];
  adjustment?: string;
  dividends?: string;
  volume?: string;
  normalization?: string;
  timing?: Record<string, string>;
  pool?: string;
  benchmark?: string;
  exclusions?: string[];
  selection?: string;
  public_scope?: string;
  industry_note?: string;
  script_version?: string;
};

export interface TaskAData {
  header: DataHeader;
  label: string;
  step1: {
    benchmark_name: string;
    unaligned: { asset: number[]; benchmark: number[] };
    aligned: { asset: number[]; benchmark: number[] };
    asset_return: number;
    benchmark_return: number;
  };
  step2: { claim: string; series: number[]; cum_return: number; max_drawdown: number };
  source: { symbol: string; name: string; decision_date: string; windows: Record<string, [string, string]> };
}

const base = import.meta.env.BASE_URL;
const fetchJson = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${base}data/${path}`);
  if (!res.ok) throw new Error(`加载 ${path} 失败：${res.status}`);
  return (await res.json()) as T;
};

let visible: Promise<VisibleRound[]> | null = null;
const reveals = new Map<string, Promise<{ header: DataHeader; round: RevealRound }>>();

export function loadVisible(): Promise<VisibleRound[]> {
  visible ??= fetchJson<{ rounds: VisibleRound[] }>("cases_visible.json").then((d) => d.rounds);
  return visible;
}

export class RevealLockedError extends Error {}

/** 只有这一轮的判断、行动、追问都锁定后才允许请求它的揭晓数据。 */
export function loadReveal(roundId: string, locked: boolean): Promise<{ header: DataHeader; round: RevealRound }> {
  if (!locked) return Promise.reject(new RevealLockedError(`${roundId} 尚未锁定，不能加载揭晓数据`));
  let p = reveals.get(roundId);
  if (!p) {
    p = fetchJson<{ header: DataHeader; rounds: RevealRound[] }>(`cases_reveal_${roundId}.json`).then((d) => ({ header: d.header, round: d.rounds[0]! }));
    reveals.set(roundId, p);
  }
  return p;
}

/** 已经请求过揭晓数据的轮次（供测试检查隔离）。 */
export function requestedReveals(): string[] {
  return [...reveals.keys()];
}

export function loadTaskA(): Promise<TaskAData> {
  return fetchJson<TaskAData>("taskA.json");
}

export function _resetForTest(): void {
  visible = null;
  reveals.clear();
}
