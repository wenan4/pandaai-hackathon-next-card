// 游戏状态与本地存储。只存在本机 localStorage，不上传。
import { CONTENT_VERSION } from "../config/constants";
import type { Action, AssistLevel, Card, FollowupId, GameEvent, Profile, Reaction, Stage, Verdict } from "../engine/types";

export const STORAGE_KEY = "nextcard:v1";
export const NOTICE_VERSION = "notice-v1";

export type Screen = "notice" | "start" | "round" | "profile" | "basis" | "share" | "taskA" | "updated" | "taskB" | "privacy" | "data";
export type RoundPhase = "claim" | "flip" | "judge" | "followup" | "revealed";

export interface RoundUI {
  phase: RoundPhase;
  initial?: Reaction;
  flips: Card[];
  explained: Card[];
  final?: Verdict;
  action?: Action;
  note: string;
  followup?: FollowupId | null;
  locked: boolean;
}

export interface TaskAUI {
  reason: string;
  guessFirst: boolean;
  steps: number[];
  stepIndex: number;
  assist: AssistLevel;
  aligned: boolean;
  guess?: string;
  answer?: string;
  feedback?: { step: number; answer: string; correct: boolean };
  exposures: string[];
  readings: boolean;
  done: boolean;
}

export interface TaskBUI {
  reason: string;
  guessFirst: boolean;
  locked: boolean;
  guess?: string;
  testOpened: boolean;
  answer?: string;
  submitted: boolean;
}

export interface State {
  v: 1;
  session_id: string;
  notice_version?: string;
  screen: Screen;
  back?: Screen;
  round: number;
  rounds: RoundUI[];
  events: GameEvent[];
  seq: number;
  taskA: TaskAUI | null;
  taskB: TaskBUI | null;
  /** 进入任务前的画像，用于“画像更新”页对比 */
  profileBeforeTask?: Profile;
}

const newRound = (): RoundUI => ({ phase: "claim", flips: [], explained: [], note: "", locked: false });

function newSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s-${Date.now().toString(36)}`;
  }
}

export function freshState(noticeVersion?: string): State {
  return {
    v: 1,
    session_id: newSessionId(),
    notice_version: noticeVersion,
    screen: noticeVersion === NOTICE_VERSION ? "start" : "notice",
    round: 0,
    rounds: [newRound(), newRound(), newRound()],
    events: [],
    seq: 0,
    taskA: null,
    taskB: null,
  };
}

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as State;
      if (s.v === 1 && Array.isArray(s.events) && Array.isArray(s.rounds)) return s;
    }
  } catch {
    // 隐私模式或存储被禁用：照常游戏，只是不能续玩
  }
  return freshState();
}

let state: State = load();
const listeners = new Set<() => void>();

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 同上
  }
}

export function getState(): State {
  return state;
}

export function update(fn: (s: State) => void): void {
  fn(state);
  save();
  for (const l of listeners) l();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

type PayloadOf<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>["payload"];

/** 产生一个事件并写入状态（调用方负责在 update 里调用）。 */
export function emit<T extends GameEvent["type"]>(s: State, round_id: string, stage: Stage, type: T, payload: PayloadOf<T>): void {
  s.seq += 1;
  s.events.push({
    event_id: `e${String(s.seq).padStart(4, "0")}`,
    session_id: s.session_id,
    content_version: CONTENT_VERSION,
    stage,
    round_id,
    type,
    payload,
  } as GameEvent);
}

/** 清除本游戏在本机存储的全部内容，回到开局告知。 */
export function clearAll(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith("nextcard:")) localStorage.removeItem(k);
    }
  } catch {
    // 同上
  }
  state = freshState();
  for (const l of listeners) l();
}

export function go(screen: Screen): void {
  update((s) => {
    s.back = s.screen;
    s.screen = screen;
  });
  window.scrollTo(0, 0);
}
