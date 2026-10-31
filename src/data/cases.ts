// Runtime-validated data; reveal and task B remain lazy, after their unlock boundary.
import { CasesVisibleSchema, CasesRevealSchema, TaskADataSchema, TaskBDataSchema } from "../../contracts/data";
import type { CasesVisible, CasesReveal, TaskAData, TaskBData } from "../../contracts/data";
export type { TaskAData, TaskBData };
export type VisibleRound = CasesVisible["rounds"][number];
export type RevealRound = CasesReveal["rounds"][number];
export type RevealSource = RevealRound["source"];
export type DataHeader = CasesReveal["header"] | TaskAData["header"];

const base = import.meta.env.BASE_URL;
const fetchJson = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${base}data/${path}`);
  if (!res.ok) throw new Error(`加载 ${path} 失败：${res.status}`);
  return (await res.json()) as T;
};

let visible: Promise<VisibleRound[]> | null = null;
const reveals = new Map<string, Promise<{ header: DataHeader; round: RevealRound }>>();

export function loadVisible(): Promise<VisibleRound[]> {
  visible ??= fetchJson<unknown>("cases_visible.json").then((d) => CasesVisibleSchema.parse(d).rounds);
  return visible;
}

export class RevealLockedError extends Error {}

/** 只有这一轮的判断、行动、追问都锁定后才允许请求它的揭晓数据。 */
export function loadReveal(roundId: string, locked: boolean): Promise<{ header: DataHeader; round: RevealRound }> {
  if (!locked) return Promise.reject(new RevealLockedError(`${roundId} 尚未锁定，不能加载揭晓数据`));
  let p = reveals.get(roundId);
  if (!p) {
    p = fetchJson<unknown>(`cases_reveal_${roundId}.json`)
      .then(d => { const parsed = CasesRevealSchema.parse(d); const round = parsed.rounds.find(r => r.round_id === roundId); if (!round) throw new Error("揭晓轮次不匹配"); return {header: parsed.header, round}; })
      .catch((error: unknown) => { reveals.delete(roundId); throw error; });
    reveals.set(roundId, p);
  }
  return p;
}

/** 已经请求过揭晓数据的轮次（供测试检查隔离）。 */
export function requestedReveals(): string[] {
  return [...reveals.keys()];
}

export function loadTaskA(): Promise<TaskAData> {
  return fetchJson<unknown>("taskA.json").then(d => TaskADataSchema.parse(d));
}

/** 任务 B 只有汇总统计，不含逐条样本；M1 只发布猎豹题。 */
export function loadTaskB(topic = "cheetah"): Promise<TaskBData> {
  return fetchJson<unknown>(`taskB_${topic}.json`).then(d => TaskBDataSchema.parse(d));
}

export function _resetForTest(): void {
  visible = null;
  reveals.clear();
}
