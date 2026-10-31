// 任务 A「同一起点，再比一次」、画像更新、任务 B「换一段数据，还成立吗？」
import { ASSIST_COPY, OBS_COPY, STATUS_COPY } from "../../config/copy";
import type { TaskAData } from "../../data/cases";
import { compareToBenchmark, maxDrawdown, periodReturn } from "../../engine/metrics";
import type { AssistLevel, ObsId } from "../../engine/types";
import { emit, go, update, type State, type TaskAUI } from "../../state/store";
import { lineChart } from "../chart";
import { footer, label, statusPill, topbar } from "../components";
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
      if (!s.taskA || s.taskA.assist === level) return;
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
      if (!x.answer) return;
      const correct = x.answer === (step === 1 ? step1Answer(d) : step2Answer(d));
      emit(st, "taskA", "in_task", "task_step", { task: "A", step, phase: "submit", answer: x.answer, correct, aligned: step === 1 ? x.aligned : undefined });
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
    const showReadings = () =>
      update((st) => {
        const x = st.taskA!;
        if (x.readings) return;
        x.readings = true;
        emit(st, "taskA", "in_task", "assist_exposure", { task: "A", step: 2, content_id: "A2-readings", kind: "demo" });
      });
    body = [
      h("p", { class: "small text-2" }, `把窗口从 60 个交易日拉长到约 3 年，核对：${d.step2.claim}`),
      h(
        "section",
        { class: "paper stack" },
        h("span", { class: "xs muted" }, "D 近 3 年，起点 = 100"),
        lineChart({ series: [{ values: d.step2.series, color: "var(--ele-ink)" }], baseline: 100, height: 150, label: "D 近 3 年走势" }),
        t.readings
          ? h("div", { class: "grid2" }, h("div", null, h("div", { class: "xs muted" }, "累计涨跌"), h("div", { class: "mono bold" }, fmtPct(r))), h("div", null, h("div", { class: "xs muted" }, "最大回撤"), h("div", { class: "mono bold" }, `${(m * 100).toFixed(1)}%`)))
          : h("button", { class: "btn-text", style: "align-self:flex-start;padding:0;color:var(--ele-ink)", onclick: showReadings }, "显示读数（记为看过示范）"),
      ),
    ];
  }

  const opts = step === 1 ? STEP1_OPTS : STEP2_OPTS;
  const canSubmit = !!t.answer && (step !== 1 || t.aligned) && !fb;
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
    hintBox(t, step),
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
      ? h("button", { class: "btn", onclick: next }, lastStep ? "完成任务 A" : "下一步", icon("arrow", 18, 2))
      : needGuess
        ? null
        : h("button", { class: "btn", disabled: !canSubmit, onclick: submit }, "提交"),
    footer(),
  );
}

const OBS: ObsId[] = ["O1", "O2", "O3", "O4"];

export function updatedScreen(s: State): HTMLElement {
  const { profile, plan } = currentProfile(s);
  const before = s.profileBeforeTask;
  const changed = OBS.filter((id) => before && (before.observations[id].status !== profile.observations[id].status || before.observations[id].summary !== profile.observations[id].summary));
  const unchanged = OBS.filter((id) => !changed.includes(id));
  const lastSubmit = [...s.events].reverse().find((e) => e.type === "task_step" && e.payload.phase === "submit");
  const lastTask = lastSubmit?.type === "task_step" ? lastSubmit.payload.task : "A";
  return h(
    "main",
    { class: "screen" },
    h(
      "div",
      { class: "row", style: "margin-top:8px" },
      h("div", { style: "flex:none;width:52px;height:52px;border-radius:26px;background:var(--ok);color:var(--bg);display:flex;align-items:center;justify-content:center" }, icon("check", 26, 2.6)),
      h("div", { class: "stack", style: "gap:0" }, h("h1", { class: "display", style: "font-size:28px" }, `任务 ${lastTask} 完成`), h("span", { class: "small text-2" }, "画像根据这一关更新了")),
    ),
    h(
      "section",
      { class: "stack" },
      h("h2", null, "有变化的"),
      changed.length
        ? changed.map((id) => {
            const b = before!.observations[id];
            const a = profile.observations[id];
            const fresh = a.instances.filter((i) => i.context.startsWith("task"));
            return h(
              "div",
              { class: "panel ok-frame stack" },
              h("div", { class: "row" }, h("span", { class: "xs muted bold" }, id), h("span", { class: "grow bold" }, OBS_COPY[id])),
              h("div", { class: "row wrap", style: "gap:6px" }, h("span", { class: "xs muted", style: "text-decoration:line-through" }, `${STATUS_COPY[b.status]} · ${b.summary}`), icon("arrow", 16, 2), statusPill(a.status, a.summary)),
              h("p", { class: "small text-2" }, fresh.some((i) => i.assisted) ? "任务里做到了，但提交前看过提示或示范，记为“在帮助下”，不和独立完成混在一起。" : "任务里独立做到了，和局内那一次合在一起看。"),
            );
          })
        : h("p", { class: "panel small text-2" }, "这一关没有改变能力观察：提交与数据不一致只做记录，不贴标签。"),
    ),
    h(
      "section",
      { class: "stack" },
      h("h2", null, "没变的"),
      h("ul", { class: "list panel sunken", style: "padding:0" }, unchanged.map((id) => h("li", { class: "row small" }, h("span", { class: "xs muted bold", style: "width:24px" }, id), h("span", { class: "grow text-2" }, OBS_COPY[id]), statusPill(profile.observations[id].status)))),
    ),
    !s.taskB ? planCard(plan, profile) : h("button", { class: "btn", onclick: () => go("profile") }, "回到人物卡"),
    footer(),
  );
}

const BRANCHES: [string, string, string][] = [
  ["insufficient_evidence", "数据不足", "样本没到门槛，先不下结论"],
  ["both_segments", "两段都成立", "两段里信号组都高出门槛"],
  ["segment_difference_display", "只在展示段成立", "换一段数据就不灵了"],
  ["segment_difference_test", "只在检验段成立", "前一段没看到，后一段才出现"],
  ["no_observed_advantage", "没看到优势", "两段都没高出门槛"],
];

export function taskBScreen(s: State): HTMLElement {
  const t = s.taskB!;
  const set = (fn: (x: NonNullable<State["taskB"]>) => void) => update((st) => st.taskB && fn(st.taskB));
  const lock = () =>
    update((st) => {
      const x = st.taskB!;
      if (x.locked) return;
      x.locked = true;
      emit(st, "taskB", "in_task", "topic_select", { topic: "cheetah", source: "only_available" });
    });
  const guess = (v: string) =>
    update((st) => {
      const x = st.taskB!;
      if (x.guess) return;
      x.guess = v;
      emit(st, "taskB", "in_task", "task_step", { task: "B", step: 2, phase: "guess", answer: v, correct: null });
    });
  const submit = () =>
    update((st) => {
      const x = st.taskB!;
      if (!x.answer || x.submitted) return;
      x.submitted = true;
      // 结论要等数据生成后核对，这里只记录作答
      emit(st, "taskB", "in_task", "task_step", { task: "B", step: 3, phase: "submit", answer: x.answer, correct: null });
    });

  return h(
    "main",
    { class: "screen" },
    topbar({ title: "下一关 · 任务 B · 猎豹题", onBack: () => go("profile") }),
    h("h1", { class: "display" }, "换一段数据，还成立吗？"),
    h("p", { class: "small text-2" }, t.reason),
    h("p", { class: "xs muted" }, "其他主题（大象题、狐狸题）尚未开放。"),
    h(
      "section",
      { class: "paper stack" },
      h("div", { class: "row" }, icon("lock", 18, 2), h("span", { class: "grow bold" }, t.locked ? "研究规则 · 已锁定" : "研究规则"), h("span", { class: "xs muted" }, "看结果前锁定，之后不能改")),
      h(
        "dl",
        { class: "kv" },
        [
          ["信号", "当天成交量 ≥ 之前 20 个交易日均量的 2 倍，且当天涨 ≥ 5%"],
          ["进出", "信号第二天开盘进入，第 20 个交易日收盘退出"],
          ["看什么", "20 天后上涨的比例（另附平均收益）"],
          ["对照组", "同一批股票、同样持有 20 天，但不按信号筛选"],
          ["门槛", "每组至少 30 次，信号组高出至少 5 个百分点"],
        ].map(([k, v]) => [h("dt", null, k), h("dd", null, v)]),
      ),
      t.locked ? null : h("button", { class: "btn", style: "background:var(--ink);color:var(--paper)", onclick: lock }, "锁定规则，看展示段"),
    ),
    t.locked
      ? h("section", { class: "panel stack" }, h("div", { class: "row" }, h("h2", { class: "grow" }, "展示段"), label("todo", "数据待生成")), h("p", { class: "small text-2" }, "信号组 / 对照组的样本数、上涨比例、平均收益和差值会显示在这里。样本不足时显示“暂不判断”，不显示 0%。"))
      : null,
    t.locked && t.guessFirst
      ? h(
          "section",
          { class: "stack" },
          h("h2", null, "打开检验段之前，先猜一下"),
          h("p", { class: "small text-2" }, "换一段时间，信号组还会比对照组好吗？"),
          options([["yes", "会"], ["no", "不会"], ["unsure", "说不准"]], t.guess, !!t.guess, guess),
        )
      : null,
    t.locked && (!t.guessFirst || t.guess)
      ? t.testOpened
        ? h("section", { class: "panel stack" }, h("div", { class: "row" }, h("h2", { class: "grow" }, "检验段"), label("todo", "数据待生成")), h("p", { class: "small text-2" }, "此前没有展示过的一段，指标与展示段相同，两段并排对比。"))
        : h("button", { class: "btn-line", onclick: () => set((x) => (x.testOpened = true)) }, "打开检验段")
      : null,
    t.testOpened
      ? h(
          "section",
          { class: "stack" },
          h("h2", null, "这两段数据分别支持什么观察？"),
          BRANCHES.map(([v, name, desc]) =>
            h(
              "button",
              { class: "opt opt-row", "aria-pressed": String(t.answer === v), disabled: t.submitted, onclick: () => set((x) => (x.answer = v)) },
              h("span", { class: "dot" }),
              h("span", null, h("span", { class: "t" }, name), h("span", { class: "d" }, desc)),
            ),
          ),
          h("p", { class: "xs muted" }, "结论只针对这次样本，不回答“这条规律永远靠不靠谱”。"),
          t.submitted ? null : h("button", { class: "btn", disabled: !t.answer, onclick: submit }, "提交"),
        )
      : null,
    t.submitted
      ? h(
          "section",
          { class: "stack" },
          h("p", { class: "panel small text-2" }, "已记录你的判断。数据生成后，这里会给出由数据决定的结论，哪一种都是有效答案。"),
          h("div", { class: "panel stack" }, h("h2", null, "这类检验的局限"), h("ul", { class: "small text-2", style: "margin:0;padding-left:18px" }, ["固定股票池会带来选择偏差", "结果窗口不重叠不等于彼此独立", "5 个百分点的门槛不是统计显著性", "没有计入费用、滑点和容量"].map((x) => h("li", null, x)))),
          h(
            "div",
            { class: "panel stack" },
            h("div", { class: "row" }, h("h2", { class: "grow" }, "在 PandaAI 继续"), label("sample", "示例 · 未接入")),
            h("p", { class: "small text-2" }, "用 Panda Data 查询同类信号的更多样本；QuantSkills 里有量化研究流程的参考技能。"),
          ),
          h("button", { class: "btn", onclick: () => go("updated") }, "看画像更新"),
        )
      : null,
    footer(),
  );
}
