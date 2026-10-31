import { ENGINE_CONFIG } from "./config/engine";
import { taskARules, taskBRules } from "./engine/taskRules";
import "@fontsource/zcool-qingke-huangyou/chinese-simplified-400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./style.css";
import { loadTaskA, loadTaskB, loadVisible, type TaskAData, type TaskBData, type VisibleRound } from "./data/cases";
import { isJudgeMode, mountPanel } from "./panel";
import { getState, go, NOTICE_VERSION, subscribe, type State } from "./state/store";
import { footer } from "./ui/components";
import { h } from "./ui/dom";
import { dataScreen, noticeScreen, privacyScreen, startScreen } from "./ui/screens/info";
import { basisScreen, profileScreen, shareScreen } from "./ui/screens/profile";
import { roundScreen } from "./ui/screens/round";
import { taskAScreen, taskBScreen, updatedScreen } from "./ui/screens/tasks";

const app = document.querySelector<HTMLDivElement>("#app")!;

// 任务 B 是“放量上涨之后”的统计，和第 3 轮同类，第一幕三轮全部锁定后才加载，揭晓前不持有；
// 加载失败只影响任务 B 相关页面，不挡住整局游戏
let taskB: TaskBData | null = null;
let taskBLoad: "idle" | "loading" | "failed" = "idle";
let render: () => void = () => {};

function ensureTaskB(s: State): void {
  if (taskB || taskBLoad !== "idle" || !s.rounds.every((r) => r.locked)) return;
  taskBLoad = "loading";
  loadTaskB().then(
    (d) => { taskB = d; ENGINE_CONFIG.tasks = { ...ENGINE_CONFIG.tasks, ...taskBRules(d) }; taskBLoad = "idle"; render(); },
    () => ((taskBLoad = "failed"), render()),
  );
}

function taskBPending(): HTMLElement {
  const failed = taskBLoad === "failed";
  return h(
    "main",
    { class: "screen" },
    h("p", { style: "margin-top:40px" }, failed ? "任务 B 的数据加载失败，请检查网络。" : "正在加载任务 B 的数据……"),
    failed ? h("button", { class: "btn", onclick: () => ((taskBLoad = "idle"), render()) }, "重新加载") : null,
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
    case "updated":
      if (!s.taskA && !s.taskB) return startScreen(s);
      // 任务 B 的完成页要读任务 B 数据
      return s.taskB?.submitted && !taskB ? taskBPending() : updatedScreen(s, taskB);
    case "taskB":
      if (!s.taskB) return startScreen(s);
      return taskB ? taskBScreen(s, taskB) : taskBPending();
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
  ENGINE_CONFIG.tasks = { ...ENGINE_CONFIG.tasks, ...taskARules(taskA) };
  render = () => {
    const s = getState();
    ensureTaskB(s);
    app.replaceChildren(screenFor(s, visible, taskA));
  };
  subscribe(render);
  render();
}

void main();
