// 任务前后的画像对比（YOU-159）。纯函数，不读取筹码与交易结果。
// 任务前的画像从事件记录截取后重算，不依赖存档里的快照：同一份记录总能得到同一份对比。
import type { AssistLevel, GameEvent, ObsId, ObsInstance, ObsStatus, ProfileView } from "./types";

const OBS: ObsId[] = ["O1", "O2", "O3", "O4"];

/** 某个任务开始之前的事件：截到这个任务的第一条局内事件为止。 */
export function eventsBeforeTask(events: readonly GameEvent[], task: "A" | "B"): GameEvent[] {
  const at = events.findIndex((e) => e.stage === "in_task" && "task" in e.payload && e.payload.task === task);
  return at < 0 ? [...events] : events.slice(0, at);
}

/** 任务记录的状态：none 没有提交；recorded 只有对不上的提交；done / assisted 独立或在帮助下完成。 */
export type TaskStatus = "none" | "recorded" | "done" | "assisted";

export interface ObsChange {
  id: ObsId;
  before: ObsStatus;
  after: ObsStatus;
  /** 任务后新增的证据，就是这项变化的原因 */
  added: ObsInstance[];
}

export interface ProfileChanges {
  changed: ObsChange[];
  unchanged: ObsId[];
  /** 任务 B 自己的记录（O5） */
  O5: { before: TaskStatus; after: TaskStatus; added: ObsInstance[] };
  help: { before: AssistLevel; after: AssistLevel } | null;
}

const key = (i: ObsInstance) => `${i.rule}|${i.context}|${i.event_ids.join(",")}`;

function addedInstances(before: ObsInstance[], after: ObsInstance[]): ObsInstance[] {
  const seen = new Set(before.map(key));
  return after.filter((i) => !seen.has(key(i)));
}

function taskStatus(list: ObsInstance[]): TaskStatus {
  const done = list.find((i) => i.outcome === "consistent");
  if (done) return done.assisted ? "assisted" : "done";
  return list.length ? "recorded" : "none";
}

export function profileChanges(before: ProfileView, after: ProfileView): ProfileChanges {
  const changed: ObsChange[] = [];
  const unchanged: ObsId[] = [];
  for (const id of OBS) {
    const b = before.observations[id];
    const a = after.observations[id];
    const added = addedInstances(b.instances, a.instances);
    if (b.status !== a.status || added.length) changed.push({ id, before: b.status, after: a.status, added });
    else unchanged.push(id);
  }
  const O5 = { before: taskStatus(before.task_observations.O5), after: taskStatus(after.task_observations.O5), added: addedInstances(before.task_observations.O5, after.task_observations.O5) };
  const help = before.help_preference.level !== after.help_preference.level ? { before: before.help_preference.level, after: after.help_preference.level } : null;
  return { changed, unchanged, O5, help };
}
