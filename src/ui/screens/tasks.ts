// 任务 A「同一起点，再比一次」、画像更新、任务 B「换一段数据，还成立吗？」
import { ASSIST_COPY, OBS_COPY, STATUS_COPY } from "../../config/copy";
import type { TaskAData } from "../../data/cases";
import { compareToBenchmark, maxDrawdown, periodReturn } from "../../engine/metrics";
import type { AssistLevel } from "../../engine/types";
import { emit, go, update, type State, type TaskAUI } from "../../state/store";
import { lineChart } from "../chart";
import { footer, label, topbar } from "../components";
import { fmtPct, h } from "../dom";
import { icon } from "../icons";
import { currentProfile, planCard } from "./profile";

const HINTS: Record<number, Record<"hint" | "guide", string>> = {
  1: {
    hint: "起点不一样时，谁画得高不代表谁涨得多。先把两条线放到同一起点再比。",
    guide: "1. 点「放到同一起点」\n2. 看最后一天，两条线各在 100 的上面还是下面\n3. 比较两者各涨跌了多少",
  },
  2: {
    hint: "“总体上涨”看最后一天是不是在起点上方；“最大回撤”看之前最高点往下最深跌了多少。",
    guide: "1. 看最后一天是否高于起点 100\n2. 找到之前的最高点和它之后的最低点\n3. 算两者相差的比例，和 15% 比较",
  },
};

function step1Answer(d: TaskAData): string {
  return compareToBenchmark(d.step1.aligned.asset, d.step1.aligned.benchmark);
}

function step2Answer(d: TaskAData): string {
  const r = periodReturn(d.step2.series);
  const m = maxDrawdown(d.step2.series);
  if (r === null || m === null) return "insufficient";
  return r > 0 && m < 0.15 ? "supports" : "refutes";
}

const STEP1_OPTS: [string, string][] = [["outperform", "跑赢了"], ["underperform", "没跑赢"], ["insufficient", "数据不足"]];
const STEP2_OPTS: [string, string][] = [["supports", "符合"], ["refutes", "不符合"], ["insufficient", "现有数据不足"]];

function assistBar(t: TaskAUI): HTMLElement {
  const pick = (level: AssistLevel) =>
    update((s) => {
      if (!s.taskA) return;
      s.taskA.assist = level;
      emit(s, "taskA", "in_task", "assist_switch", { task: "A", level });
    });
  return h(
    "div",
    { class: "seg", role: "group", "aria-label": "协助档位" },
    (["guide", "hint", "self"] as AssistLevel[]).map((l) => h("button", { "aria-pressed": String(t.assist === l), onclick: () => pick(l) }, ASSIST_COPY[l].label)),
  );
}

function hintBox(t: TaskAUI, step: number): HTMLElement | null {
  if (t.assist === "self") return null;
  const level = t.assist;
  const id = `A${step}-${level}`;
  const seen = t.exposures.includes(id);
  if (!seen) {
    const show = () =>
      update((s) => {
        if (!s.taskA || s.taskA.exposures.includes(id)) return;
        s.taskA.exposures.push(id);
        emit(s, "taskA", "in_task", "assist_exposure", { task: "A", step, content_id: id, kind: level === "guide" ? "demo" : "hint" });
      });
    return h("button", { class: "btn-line", onclick: show }, icon("bulb", 18), level === "guide" ? "带我做这一步" : "看一句提示");
  }
  return h(
    "div",
    { class: "panel row", style: "align-items:flex-start" },
    h("span", { style: "color:var(--ele);margin-top:2px" }, icon("bulb", 16, 2)),
    h("span", { class: "small", style: "white-space:pre-line" }, HINTS[step]![level]),
  );
}

function options(opts: [string, string][], selected: string | undefined, disabled: boolean, onPick: (v: string) => void): HTMLElement {
  return h("div", { class: "grid3" }, opts.map(([v, l]) => h("button", { class: "opt", style: "font-size:15px", "aria-pressed": String(selected === v), disabled, onclick: () => onPick(v) }, l)));
}

export function taskAScreen(s: State, d: TaskAData): HTMLElement {
  const t = s.taskA!;
  const step = t.steps[t.stepIndex]!;
  const lastStep = t.stepIndex === t.steps.length - 1;
  const set = (fn: (x: TaskAUI) => void) => update((st) => st.taskA && fn(st.taskA));
  const fb = t.feedback?.step === step ? t.feedback : undefined;

  const submit = () =>
    update((st) => {
      const x = st.taskA!;
      if (!x.answer || x.feedback?.step === step || (step === 1 ? !x.aligned : !x.windowExtended)) return;
      const correct = x.answer === (step === 1 ? step1Answer(d) : step2Answer(d));
      emit(st, "taskA", "in_task", "task_step", { task: "A", step, phase: "submit", answer: x.answer, correct, aligned: step === 1 ? x.aligned : undefined, window_extended: step === 2 ? x.windowExtended : undefined });
      emit(st, "taskA", "in_task", "assist_exposure", { task: "A", step, content_id: `A${step}-feedback`, kind: "feedback" });
      x.feedback = { step, answer: x.answer, correct };
    });
  const guess = (v: string) =>
    update((st) => {
      const x = st.taskA!;
      if (x.guess) return;
      x.guess = v;
      x.answer = v;
      emit(st, "taskA", "in_task", "task_step", { task: "A", step, phase: "guess", answer: v, correct: null });
    });
  const next = () =>
    update((st) => {
      const x = st.taskA!;
      if (!x.feedback?.correct || x.feedback.step !== step) return;
      if (lastStep) {
        x.done = true;
        st.back = st.screen;
        st.screen = "updated";
      } else {
        x.stepIndex += 1;
        x.aligned = false;
        x.guess = undefined;
        x.answer = undefined;
        x.readings = false;
        x.windowExtended = false;
        x.feedback = undefined;
      }
      window.scrollTo(0, 0);
    });
  const retry = () =>
    set((x) => {
      x.feedback = undefined;
      x.answer = undefined;
    });

  const needGuess = t.guessFirst && !t.guess;
  let body: (HTMLElement | null)[];
  if (step === 1) {
    const lines = t.aligned ? d.step1.aligned : d.step1.unaligned;
    body = [
      h("p", { class: "small text-2" }, `这 60 个交易日，D 跑赢${d.step1.benchmark_name}了吗？`),
      h(
        "section",
        { class: "paper stack" },
        h("div", { class: "legend" }, h("span", null, h("i", { style: "background:var(--ink)" }), "D"), h("span", { style: "color:var(--fox-ink)" }, h("i", { style: "background:var(--fox-ink)" }), d.step1.benchmark_name)),
        lineChart({
          series: [
            { values: lines.benchmark, color: "var(--fox-ink)" },
            { values: lines.asset, color: "var(--ink)" },
          ],
          baseline: t.aligned ? 100 : undefined,
          height: 150,
          label: t.aligned ? `D 与${d.step1.benchmark_name}对齐到同一起点` : `D 与${d.step1.benchmark_name}，起点不同的两条线`,
        }),
        t.aligned
          ? h("p", { class: "xs muted" }, "两条线都从 100 出发。")
          : h("p", { class: "xs muted" }, `起点不同：D 从 ${lines.asset[0]!.toFixed(1)} 开始，${d.step1.benchmark_name}从 ${lines.benchmark[0]!.toFixed(1)} 开始。`),
        needGuess
          ? null
          : h("button", { class: "btn-line", style: "border-color:var(--ink);color:var(--ink)", disabled: !!fb, onclick: () => set((x) => (x.aligned = !x.aligned)) }, t.aligned ? "恢复原来的起点" : "把两条线放到同一起点"),
      ),
    ];
  } else {
    const r = periodReturn(d.step2.series)!;
    const m = maxDrawdown(d.step2.series)!;
    body = [
      h("p", { class: "small text-2" }, `把窗口从 60 个交易日拉长到约 3 年，核对：${d.step2.claim}`),
      needGuess || !t.windowExtended ? h("button", { class: "btn-line", disabled: needGuess, onclick: () => set((x) => (x.windowExtended = true)) }, needGuess ? "先猜一下，再打开长窗口" : "把窗口拉长到近 3 年") : h(
        "section",
        { class: "paper stack" },
        h("span", { class: "xs muted" }, "D 近 3 年，起点 = 100"),
        lineChart({ series: [{ values: d.step2.series, color: "var(--ele-ink)" }], baseline: 100, height: 150, label: "D 近 3 年走势" }),
        h("div", { class: "grid2" }, h("div", null, h("div", { class: "xs muted" }, "累计涨跌"), h("div", { class: "mono bold" }, fmtPct(r))), h("div", null, h("div", { class: "xs muted" }, "最大回撤"), h("div", { class: "mono bold" }, `${(m * 100).toFixed(1)}%`))),
        h("p", { class: "xs muted" }, "累计涨跌是最后一天相对起点的变化；最大回撤是从此前最高点往下跌的最大比例。数字是题目数据，查看它们不算使用答案提示。"),
      ),
    ];
  }

  const opts = step === 1 ? STEP1_OPTS : STEP2_OPTS;
  const canSubmit = !!t.answer && (step === 1 ? t.aligned : t.windowExtended) && !fb && !needGuess;
  const explain =
    step === 1
      ? `对齐后看最后一天：D ${fmtPct(d.step1.asset_return)}，${d.step1.benchmark_name} ${fmtPct(d.step1.benchmark_return)}。`
      : `3 年累计 ${fmtPct(periodReturn(d.step2.series)!)}，最大回撤 ${(maxDrawdown(d.step2.series)! * 100).toFixed(1)}%。`;

  return h(
    "main",
    { class: "screen" },
    topbar({ title: `下一关 · 任务 A · 步骤 ${t.stepIndex + 1} / ${t.steps.length}`, onBack: () => go("profile") }),
    h("h1", { class: "display" }, step === 1 ? "同一起点，再比一次" : "拉长窗口，再看一次"),
    t.stepIndex === 0 ? h("p", { class: "small text-2" }, `为什么是这关：${t.reason}`) : null,
    assistBar(t),
    body,
    needGuess ? null : hintBox(t, step),
    h(
      "section",
      { class: "stack" },
      needGuess ? h("h2", null, "先猜一下（之后可以改）") : t.guessFirst && t.guess && !fb ? h("h2", null, "看完数据，要改答案吗？") : h("h2", null, "你的答案"),
      options(opts, t.answer, !!fb, (v) => (needGuess ? guess(v) : set((x) => (x.answer = v)))),
      step === 1 && !t.aligned && !needGuess && !fb ? h("p", { class: "xs muted" }, "先把两条线放到同一起点，才能提交。") : null,
    ),
    fb
      ? h(
          "div",
          { class: "panel stack", style: `border-color:${fb.correct ? "var(--ok)" : "var(--leo)"}` },
          h("span", { class: "small bold", style: `color:${fb.correct ? "var(--ok)" : "var(--leo)"}` }, fb.correct ? "和数据一致" : "和数据不一致"),
          h("p", { class: "small" }, explain),
          fb.correct ? null : h("button", { class: "btn-text", style: "align-self:flex-start;padding:0", onclick: retry }, "再试一次（之后的作答记为有帮助）"),
        )
      : null,
    h("div", { class: "grow" }),
    fb
      ? fb.correct ? h("button", { class: "btn", onclick: next }, lastStep ? "完成任务 A" : "下一步", icon("arrow", 18, 2)) : null
      : needGuess
        ? null
        : h("button", { class: "btn", disabled: !canSubmit, onclick: submit }, "提交"),
    footer(),
  );
}

export function updatedScreen(s: State): HTMLElement {
  const { profile, progress, plan } = currentProfile(s);
  return h("main", { class: "screen" },
    h("h1", { class: "display" }, "任务 A 完成"),
    h("p", { class: "small text-2" }, "任务中的新情境单独记录，不改写第一幕的观察。"),
    ...(["O1", "O2"] as const).map((id, index) => {
      const completed = profile.task_observations[id].find((i) => i.outcome === "consistent");
      return h("section", { class: "panel stack" }, h("h2", null, OBS_COPY[id]),
        h("p", null, completed ? completed.assisted ? "本次在帮助下完成" : "本次独立完成" : "本次未完成"),
        h("p", { class: "xs muted" }, `第一幕记录：${STATUS_COPY[profile.observations[id].status]} · ${profile.observations[id].summary}`),
        h("p", { class: "small text-2" }, progress.taskA_steps_done.includes(index + 1) ? "已完成这个基础步骤，可以继续体验。" : "还需在新情境里完成这个步骤。"));
    }),
    h("p", { class: "panel small" }, `根据新证据修正判断：${profile.observations.O4.summary}`),
    planCard(plan, profile),
    h("button", { class: "btn-line", onclick: () => go("basis") }, "查看全部依据"), footer());
}

/** YOU-153 尚未提供两段可验证的数据；预览不产生提交或完成事件。 */
export function taskBScreen(s: State): HTMLElement {
  return h("main", { class: "screen" },
    topbar({ title: "下一关 · 任务 B", onBack: () => go("profile") }),
    h("h1", { class: "display" }, "换一段数据，还成立吗？"),
    h("p", { class: "small text-2" }, s.taskB!.reason),
    h("section", { class: "panel stack" }, label("todo", "尚未开放 · 数据准备中"),
      h("p", null, "这关将比较同一信号在展示段和检验段的表现。两段真实数据准备好后，才能锁定规则、查看样本并作出判断。"),
      h("p", { class: "small text-2" }, "当前没有可以作答的数据，不记录完成或能力证据。")),
    h("button", { class: "btn", onclick: () => go("profile") }, "回到人物卡"), footer());
}
