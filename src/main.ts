import "@fontsource/zcool-qingke-huangyou/chinese-simplified-400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./style.css";
import { AVAILABLE_TOPICS } from "./config/engine";
import { loadTaskA, loadTaskB, loadVisible, type TaskAData, type TaskBData, type VisibleRound } from "./data/cases";
import type { TopicId } from "./engine/types";
import { isJudgeMode, mountPanel } from "./panel";
import { getState, go, NOTICE_VERSION, subscribe, type State } from "./state/store";
import { footer } from "./ui/components";
import { h } from "./ui/dom";
import { dataScreen, noticeScreen, privacyScreen, startScreen } from "./ui/screens/info";
import { basisScreen, profileScreen, shareScreen } from "./ui/screens/profile";
import { roundScreen } from "./ui/screens/round";
import { taskAScreen, taskBScreen, updatedScreen } from "./ui/screens/tasks";

const app = document.querySelector<HTMLDivElement>("#app")!;

// 任务 B 的三个主题都是多只股票的汇总统计，等已开始的轮次全部锁定后才按需加载，揭晓前不持有；
// 加载失败只影响任务 B 相关页面，不挡住整局游戏
const taskB: Partial<Record<TopicId, TaskBData>> = {};
const taskBLoad: Partial<Record<TopicId, "loading" | "failed">> = {};
let render: () => void = () => {};

const taskBTopic = (s: State): TopicId => s.taskB?.topic ?? "cheetah";

function ensureTaskB(s: State): void {
  if (!s.rounds.every((r) => r.locked)) return;
  const wanted = s.screen === "data" ? AVAILABLE_TOPICS : s.taskB && (s.screen === "taskB" || s.screen === "updated") ? [taskBTopic(s)] : [];
  for (const topic of wanted) {
    if (taskB[topic] || taskBLoad[topic]) continue;
    taskBLoad[topic] = "loading";
    loadTaskB(topic).then(
      (d) => ((taskB[topic] = d), delete taskBLoad[topic], render()),
      () => ((taskBLoad[topic] = "failed"), render()),
    );
  }
}

function taskBPending(topic: TopicId): HTMLElement {
  const failed = taskBLoad[topic] === "failed";
  return h(
    "main",
    { class: "screen" },
    h("p", { style: "margin-top:40px" }, failed ? "任务 B 的数据加载失败，请检查网络。" : "正在加载任务 B 的数据……"),
    failed ? h("button", { class: "btn", onclick: () => (delete taskBLoad[topic], render()) }, "重新加载") : null,
    h("button", { class: "btn-line", onclick: () => go("profile") }, "回到人物卡"),
    footer(),
  );
}

function screenFor(s: State, visible: VisibleRound[], taskA: TaskAData): HTMLElement {
  // 首次进入必须先看开局告知
  if (s.notice_version !== NOTICE_VERSION && s.screen !== "privacy") return noticeScreen();
  const roundsDone = s.rounds.every((r) => r.locked);
  switch (s.screen) {
    case "round":
      return roundScreen(s, visible);
    case "profile":
      return roundsDone ? profileScreen(s) : startScreen(s);
    case "basis":
      return roundsDone ? basisScreen(s) : startScreen(s);
    case "share":
      return roundsDone ? shareScreen(s) : startScreen(s);
    case "taskA":
      return s.taskA ? taskAScreen(s, taskA) : startScreen(s);
    case "updated": {
      if (!s.taskA && !s.taskB) return startScreen(s);
      // 任务 B 的完成页要读任务 B 数据
      const d = taskB[taskBTopic(s)] ?? null;
      return s.taskB?.submitted && !d ? taskBPending(taskBTopic(s)) : updatedScreen(s, d);
    }
    case "taskB": {
      if (!s.taskB) return startScreen(s);
      const d = taskB[taskBTopic(s)];
      return d ? taskBScreen(s, d) : taskBPending(taskBTopic(s));
    }
    case "privacy":
      return privacyScreen(s);
    case "data":
      return dataScreen(s, taskA, taskB);
    case "notice":
    case "start":
    default:
      return startScreen(s);
  }
}

async function main(): Promise<void> {
  if (isJudgeMode()) return mountPanel(app);
  let visible: VisibleRound[];
  let taskA: TaskAData;
  try {
    [visible, taskA] = await Promise.all([loadVisible(), loadTaskA()]);
  } catch {
    app.replaceChildren(h("main", { class: "screen" }, h("p", { style: "margin-top:40px" }, "数据加载失败，请检查网络后刷新。"), footer()));
    return;
  }
  render = () => {
    const s = getState();
    ensureTaskB(s);
    app.replaceChildren(screenFor(s, visible, taskA));
  };
  subscribe(render);
  render();
}

void main();
