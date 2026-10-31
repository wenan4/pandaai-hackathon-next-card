// 任务 A「同一起点，再比一次」、画像更新、任务 B「换一段数据，还成立吗？」
import { ASSIST_COPY, OBS_COPY, STATUS_COPY } from "../../config/copy";
import { AVAILABLE_TOPICS } from "../../config/engine";
import type { TaskAData, TaskBData } from "../../data/cases";
import { compareToBenchmark, maxDrawdown, periodReturn } from "../../engine/metrics";
import { answerKey, type TaskBAnswer } from "../../engine/taskB";
import type { AssistLevel } from "../../engine/types";
import { emit, go, update, type State, type TaskAUI, type TaskBUI } from "../../state/store";
import { lineChart } from "../chart";
import { footer, label, topbar } from "../components";
import { fmtDate, fmtPct, h } from "../dom";
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

function assistBar(task: "A" | "B", current: AssistLevel): HTMLElement {
  const pick = (level: AssistLevel) =>
    update((s) => {
      const t = task === "A" ? s.taskA : s.taskB;
      if (!t) return;
      t.assist = level;
      emit(s, `task${task}`, "in_task", "assist_switch", { task, level });
    });
  return h(
    "div",
    { class: "seg", role: "group", "aria-label": "协助档位" },
    (["guide", "hint", "self"] as AssistLevel[]).map((l) => h("button", { "aria-pressed": String(current === l), onclick: () => pick(l) }, ASSIST_COPY[l].label)),
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
    assistBar("A", t.assist),
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


/** 最近一次提交的是任务 B 时，画像更新页讲任务 B；否则讲任务 A。 */
function lastTask(s: State): "A" | "B" {
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i]!;
    if (e.type === "task_step" && e.payload.phase === "submit") return e.payload.task;
  }
  return s.taskB?.submitted ? "B" : "A";
}

/** taskB 为空时只会走任务 A 分支：任务 B 提交后，调用方保证数据已加载。 */
export function updatedScreen(s: State, taskB: TaskBData | null): HTMLElement {
  const { profile, progress, plan } = currentProfile(s);
  if (lastTask(s) === "B" && s.taskB?.submitted && taskB) return taskBDoneScreen(s, taskB);
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
    planCard(plan, profile, s),
    h("button", { class: "btn-line", onclick: () => go("basis") }, "查看全部依据"), footer());
}

// ───────────────────────── 任务 B ─────────────────────────

const ANSWER_OPTS: [TaskBAnswer, string][] = [
  ["both_segments", "两段都达到"],
  ["only_display", "只有展示段达到"],
  ["only_test", "只有检验段达到"],
  ["no_observed_advantage", "两段都没达到"],
  ["insufficient_evidence", "样本不够，暂不判断"],
];
const WHY_OPTS: [string, string][] = [
  ["delta_low", "两段的差值都不到阈值"],
  ["delta_high", "两段的差值都达到阈值"],
  ["delta_one", "只有一段的差值达到阈值"],
  ["samples", "有一组样本少于最少样本数"],
  ["mean_higher", "信号组的平均收益更高"],
];
const WHY_OF: Record<TaskBAnswer, string> = {
  both_segments: "delta_high",
  only_display: "delta_one",
  only_test: "delta_one",
  no_observed_advantage: "delta_low",
  insufficient_evidence: "samples",
};
const SEG_NAME = { display: "展示段", test: "检验段" } as const;
const B_HINT = {
  hint: "先看每组样本是否都够最少样本数，再看两段的差值是否达到阈值。主指标是收益为正的比例，不是平均收益。",
  guide: "1. 四组样本数是否都不少于最少样本数？不够就暂不判断\n2. 展示段：信号组比例 − 基准组比例，是否达到阈值？\n3. 检验段同样算一次\n4. 按两段各自是否达到，选对应的结论",
};

const pp = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)} 个百分点`);
const pct1 = (v: number | null) => (v === null ? "暂不计算" : `${(v * 100).toFixed(1)}%`);

function segmentCard(d: TaskBData, seg: "display" | "test"): HTMLElement {
  const x = d[seg];
  const row = (name: string, g: TaskBData["display"]["signal_group"]) =>
    h("tr", null, h("th", { scope: "row" }, name), h("td", { class: "mono" }, `${g.n_records}`), h("td", { class: "mono" }, pct1(g.primary_metric)), h("td", { class: "mono" }, g.mean_return === null ? "—" : fmtPct(g.mean_return)));
  const meanDiff = x.signal_group.mean_return !== null && x.baseline_group.mean_return !== null ? x.signal_group.mean_return - x.baseline_group.mean_return : null;
  // 只有两者方向严格相反才提示；任一为 0 不算相反
  const disagree = x.delta !== null && meanDiff !== null && Math.sign(x.delta) * Math.sign(meanDiff) < 0;
  return h(
    "section",
    { class: "paper stack", style: "gap:6px" },
    h("div", { class: "row wrap", style: "gap:6px" }, h("h2", { class: "grow", style: "color:var(--ink)" }, SEG_NAME[seg]), h("span", { class: "xs", style: "color:var(--ink-2)" }, `${fmtDate(x.range.from)} – ${fmtDate(x.range.to)}`)),
    h(
      "table",
      { class: "btable" },
      h("thead", null, h("tr", null, h("th", null, ""), h("th", null, "样本"), h("th", null, "收益为正"), h("th", null, "平均收益"))),
      h("tbody", null, row("信号组", x.signal_group), row("基准组", x.baseline_group)),
    ),
    h("p", { class: "small", style: "color:var(--ink)" }, `差值（信号组 − 基准组）：`, h("b", { class: "mono" }, pp(x.delta)), x.meets_threshold === null ? "" : x.meets_threshold ? " · 达到阈值" : " · 未达到阈值"),
    disagree
      ? h("p", { class: "xs", style: "color:var(--ink-2)" }, x.delta! < 0 ? "信号组平均收益更高，但收益为正的比例没有更高：平均数可能被少数大涨样本拉高，更高的平均不代表更常赚到。" : "信号组收益为正更常见，但平均收益更低：更常发生不代表平均收益更高。")
      : null,
    h("p", { class: "xs", style: "color:var(--ink-2)" }, `信号组覆盖 ${x.signal_group.n_symbols} 只股票，基准组 ${x.baseline_group.n_symbols} 只；不重叠规则去掉信号组 ${x.signal_group.excluded["overlap"] ?? 0} 条。`),
  );
}

function ruleCard(d: TaskBData, locked: boolean): HTMLElement {
  const hd = d.header;
  const rows: [string, string][] = [
    ["题目", hd.question],
    ["信号", hd.signal.definition],
    ["执行", `${hd.execution.entry}进，${hd.execution.exit}出，不计费用和滑点`],
    ["主指标", hd.primary_metric.label],
    ["基准组", hd.baseline_rule],
    ["股票池", `${hd.pool.description}，共 ${hd.pool.size} 只`],
    ["分段", `展示段 ${fmtDate(hd.segments.display.from)}–${fmtDate(hd.segments.display.to)}；检验段 ${fmtDate(hd.segments.test.from)}–${fmtDate(hd.segments.test.to)}`],
    ["阈值", `每组至少 ${hd.thresholds.min_samples} 条；信号组比基准组高出至少 ${(hd.thresholds.advantage_margin * 100).toFixed(0)} 个百分点才算达到`],
  ];
  return h(
    "section",
    { class: "panel stack" },
    h("div", { class: "row" }, h("h2", { class: "grow" }, "预先定好的规则"), locked ? h("span", { class: "chip" }, icon("lock", 14, 2), "已锁定，不能再改") : label("real")),
    h("dl", { class: "kv" }, rows.map(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
  );
}

export function taskBScreen(s: State, d: TaskBData): HTMLElement {
  const t = s.taskB!;
  const assist = t.assist ?? "hint";
  const exposures = t.exposures ?? [];
  const fb = t.feedback;
  const expected = answerKey(d.verdict);
  const needGuess = t.guessFirst && !t.guess;
  const set = (fn: (x: TaskBUI) => void) => update((st) => st.taskB && fn(st.taskB));

  const guess = (v: string) =>
    update((st) => {
      const x = st.taskB!;
      if (x.guess) return;
      x.guess = v;
      emit(st, "taskB", "in_task", "task_step", { task: "B", step: 1, phase: "guess", answer: v, correct: null });
    });
  const lock = () =>
    update((st) => {
      const x = st.taskB!;
      if (x.locked) return;
      x.locked = true;
      emit(st, "taskB", "in_task", "task_step", { task: "B", step: 1, phase: "submit", answer: "rules_locked", correct: null });
    });
  const openTest = () =>
    update((st) => {
      const x = st.taskB!;
      if (!x.locked || x.testOpened) return;
      x.testOpened = true;
      emit(st, "taskB", "in_task", "task_step", { task: "B", step: 2, phase: "submit", answer: "test_opened", correct: null });
    });
  const showHint = () =>
    update((st) => {
      const x = st.taskB!;
      const level = x.assist ?? "hint";
      if (level === "self") return;
      const id = `B3-${level}`;
      x.exposures ??= [];
      if (x.exposures.includes(id)) return;
      x.exposures.push(id);
      emit(st, "taskB", "in_task", "assist_exposure", { task: "B", step: 3, content_id: id, kind: level === "guide" ? "demo" : "hint" });
    });
  const submit = () =>
    update((st) => {
      const x = st.taskB!;
      if (!x.answer || !x.why || x.feedback || !x.testOpened) return;
      const correct = x.answer === expected && x.why === WHY_OF[expected];
      emit(st, "taskB", "in_task", "task_step", { task: "B", step: 3, phase: "submit", answer: `${x.answer}|${x.why}`, correct });
      emit(st, "taskB", "in_task", "assist_exposure", { task: "B", step: 3, content_id: "B3-feedback", kind: "feedback" });
      x.feedback = { answer: x.answer, why: x.why, correct };
    });
  const finish = () =>
    update((st) => {
      const x = st.taskB!;
      if (!x.feedback?.correct) return;
      x.submitted = true;
      st.back = st.screen;
      st.screen = "updated";
      window.scrollTo(0, 0);
    });
  const retry = () =>
    set((x) => {
      x.feedback = undefined;
      x.answer = undefined;
      x.why = undefined;
    });

  const hintId = `B3-${assist}`;
  const hint =
    assist === "self" || !t.testOpened
      ? null
      : exposures.includes(hintId)
        ? h("div", { class: "panel row", style: "align-items:flex-start" }, h("span", { style: "color:var(--ele);margin-top:2px" }, icon("bulb", 16, 2)), h("span", { class: "small", style: "white-space:pre-line" }, B_HINT[assist]))
        : h("button", { class: "btn-line", onclick: showHint }, icon("bulb", 18), assist === "guide" ? "带我做这一步" : "看一句提示");

  const explain = (["display", "test"] as const)
    .map((seg) => `${SEG_NAME[seg]}：信号组 ${pct1(d[seg].signal_group.primary_metric)}，基准组 ${pct1(d[seg].baseline_group.primary_metric)}，差 ${pp(d[seg].delta)}`)
    .join("；");

  return h(
    "main",
    { class: "screen" },
    topbar({ title: "下一关 · 任务 B", onBack: () => go("profile") }),
    h("h1", { class: "display" }, "换一段数据，还成立吗？"),
    h("p", { class: "small text-2" }, `为什么是这关：${t.reason}`),
    h("p", { class: "xs muted" }, `主题：猎豹题 · 放量上涨之后（${AVAILABLE_TOPICS.length === 1 ? "其他主题尚未开放" : "可在人物卡换题"}）`),
    assistBar("B", assist),
    ruleCard(d, t.locked),
    needGuess
      ? h("section", { class: "stack" }, h("h2", null, "先猜一下（之后可以改）"), h("p", { class: "small text-2" }, `放量上涨之后的 ${d.header.execution.horizon_days} 个交易日，收益为正的比例会比一般情况高出至少 ${(d.header.thresholds.advantage_margin * 100).toFixed(0)} 个百分点吗？`),
          options([["higher", "会"], ["not_higher", "不会"], ["unsure", "说不准"]], undefined, false, guess))
      : null,
    !needGuess && !t.locked
      ? h("section", { class: "stack" }, h("p", { class: "xs muted" }, "锁定后才能看展示段；规则锁定后不能看着数据再改。"), h("button", { class: "btn", onclick: lock }, icon("lock", 18, 2), "锁定规则，查看展示段"))
      : null,
    t.locked ? segmentCard(d, "display") : null,
    t.locked && !t.testOpened
      ? h("section", { class: "stack" }, h("p", { class: "xs muted" }, "检验段在这之前没有给你看过，用的是同样的规则。"), h("button", { class: "btn-line", onclick: openTest }, "打开检验段"))
      : null,
    t.testOpened ? segmentCard(d, "test") : null,
    t.testOpened
      ? h(
          "section",
          { class: "stack" },
          h("h2", null, t.guessFirst && t.guess ? "看完两段，这两段数据分别支持什么观察？" : "这两段数据分别支持什么观察？"),
          h("p", { class: "xs muted" }, "只针对这两段样本，不回答这条规则以后灵不灵。"),
          h("div", { class: "stack", style: "gap:6px" }, ANSWER_OPTS.map(([v, l]) => h("button", { class: "opt", "aria-pressed": String(t.answer === v), disabled: !!fb, onclick: () => set((x) => (x.answer = v)) }, l))),
          h("h2", { style: "margin-top:6px" }, "依据哪一条数字？"),
          h("div", { class: "stack", style: "gap:6px" }, WHY_OPTS.map(([v, l]) => h("button", { class: "opt", style: "font-weight:400", "aria-pressed": String(t.why === v), disabled: !!fb, onclick: () => set((x) => (x.why = v)) }, l))),
        )
      : null,
    hint,
    fb
      ? h(
          "div",
          { class: "panel stack", style: `border-color:${fb.correct ? "var(--ok)" : "var(--leo)"}` },
          h("span", { class: "small bold", style: `color:${fb.correct ? "var(--ok)" : "var(--leo)"}` }, fb.correct ? "和数据一致" : "和数据对不上"),
          h("p", { class: "small" }, `${explain}。阈值是 ${(d.header.thresholds.advantage_margin * 100).toFixed(0)} 个百分点。`),
          fb.why === "mean_higher" ? h("p", { class: "small text-2" }, "这道题的主指标是收益为正的比例；平均收益只作参考，不能替代主指标。") : null,
          fb.correct ? null : h("button", { class: "btn-text", style: "align-self:flex-start;padding:0", onclick: retry }, "再试一次（之后的作答记为有帮助）"),
        )
      : null,
    t.testOpened
      ? h("details", { class: "panel" }, h("summary", { class: "small" }, "这个结论的局限"), h("ul", { class: "small text-2", style: "margin:6px 0 0;padding-left:18px" }, d.header.limitations.map((l) => h("li", null, l))))
      : null,
    fb?.correct
      ? h("button", { class: "btn", onclick: finish }, "完成任务 B", icon("arrow", 18, 2))
      : t.testOpened
        ? h("button", { class: "btn", disabled: !t.answer || !t.why || !!fb, onclick: submit }, "提交")
        : null,
    footer(),
  );
}

function taskBDoneScreen(s: State, d: TaskBData): HTMLElement {
  const { profile } = currentProfile(s);
  const done = profile.task_observations.O5.find((i) => i.outcome === "consistent");
  const v = d.verdict;
  const verdictText = {
    insufficient_evidence: "样本不够，暂不判断",
    both_segments: "两段都观察到信号组的优势达到阈值",
    segment_difference: `只有${SEG_NAME[v.only_segment ?? "display"]}达到阈值`,
    no_observed_advantage: "两段都没有观察到达到阈值的优势",
  }[v.result];
  return h(
    "main",
    { class: "screen" },
    h("h1", { class: "display" }, "任务 B 完成"),
    h("p", { class: "small text-2" }, "任务中的新情境单独记录，不改写第一幕的观察。"),
    h(
      "section",
      { class: "panel stack" },
      h("div", { class: "row" }, h("span", { class: "xs muted bold", style: "width:24px" }, "O5"), h("h2", { class: "grow" }, "在给定规则下比较两段样本")),
      h("p", null, done ? (done.assisted ? "本次在帮助下完成" : "本次独立完成") : "本次未完成"),
      h("p", { class: "xs muted" }, "这只说明你能按给定规则读两段样本，不代表会自己设计回测。"),
    ),
    h("section", { class: "panel stack" }, h("h2", null, "这两段数据支持的观察"), h("p", { class: "small" }, `${verdictText}。`), h("p", { class: "xs muted" }, "只描述这两段样本，不回答这条规则以后是否有效。")),
    h(
      "section",
      { class: "panel stack" },
      h("div", { class: "row" }, h("h2", { class: "grow" }, "在 PandaAI 继续"), label("sample", "示例·未接入")),
      h("ul", { class: "small text-2", style: "margin:0;padding-left:18px" },
        h("li", null, "用 Panda Data 的日线接口换一组股票池或分段，按同样的锁定规则再比一次"),
        h("li", null, "QuantSkills 里关于样本外验证的方法说明（拟参考，未集成）")),
    ),
    h("button", { class: "btn", onclick: () => go("profile") }, "回到人物卡"),
    h("button", { class: "btn-line", onclick: () => go("basis") }, "查看全部依据"),
    footer(),
  );
}
