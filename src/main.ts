import "@fontsource/zcool-qingke-huangyou/chinese-simplified-400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./style.css";
import { loadTaskA, loadTaskB, loadVisible, type TaskAData, type TaskBData, type VisibleRound } from "./data/cases";
import { isJudgeMode, mountPanel } from "./panel";
import { getState, NOTICE_VERSION, subscribe, type State } from "./state/store";
import { footer } from "./ui/components";
import { h } from "./ui/dom";
import { dataScreen, noticeScreen, privacyScreen, startScreen } from "./ui/screens/info";
import { basisScreen, profileScreen, shareScreen } from "./ui/screens/profile";
import { roundScreen } from "./ui/screens/round";
import { taskAScreen, taskBScreen, updatedScreen } from "./ui/screens/tasks";

const app = document.querySelector<HTMLDivElement>("#app")!;

function screenFor(s: State, visible: VisibleRound[], taskA: TaskAData, taskB: TaskBData): HTMLElement {
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
      return s.taskA || s.taskB ? updatedScreen(s, taskB) : startScreen(s);
    case "taskB":
      return s.taskB ? taskBScreen(s, taskB) : startScreen(s);
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
  let taskB: TaskBData;
  try {
    [visible, taskA, taskB] = await Promise.all([loadVisible(), loadTaskA(), loadTaskB()]);
  } catch {
    app.replaceChildren(h("main", { class: "screen" }, h("p", { style: "margin-top:40px" }, "数据加载失败，请检查网络后刷新。"), footer()));
    return;
  }
  const render = () => app.replaceChildren(screenFor(getState(), visible, taskA, taskB));
  subscribe(render);
  render();
}

void main();
