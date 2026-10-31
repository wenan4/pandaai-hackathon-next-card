// 评委面板（?judge=1）：预设路径或当前体验记录 → 字段编辑 → 分叉重算 → 前后差异并列。
// 所有结果都来自同一套 evaluate / recommend / settle，面板里没有规则的第二份实现。
import { ACTION_COPY, CARD_COPY, FOLLOWUP_COPY, OBS_COPY, STATUS_COPY, UNKNOWN_YET, VERDICT_COPY } from "../config/copy";
import { AVAILABLE_TOPICS, ENGINE_CONFIG } from "../config/engine";
import { ROUNDS } from "../config/rounds";
import { evaluate } from "../engine/evaluate";
import { eventsFromSpecs, type RoundSpec } from "../engine/paths";
import { recommend } from "../engine/recommend";
import { structuredResult, type Provenance } from "../engine/result";
import { collectRound, followupFor } from "../engine/rounds";
import { flipOutcomes, settle } from "../engine/settle";
import type { Action, Card, GameEvent, ObsId, Verdict } from "../engine/types";
import { getState } from "../state/store";
import { label } from "../ui/components";
import { downloadJson, h } from "../ui/dom";
import { PRESETS } from "./presets";
import { runChecks, type CheckResult } from "./checks";
import { forkEvents } from "./replay";

export function isJudgeMode(search: string = location.search): boolean {
  return new URLSearchParams(search).get("judge") === "1";
}

const OBS: ObsId[] = ["O1", "O2", "O3", "O4"];
type Outcomes = Record<string, number | null>;

interface PanelState {
  baseline: string;
  editRound: string;
  draft: RoundSpec | null;
  fork: RoundSpec[] | null;
  error: string | null;
  checks: CheckResult[] | null;
  /** 每次“应用改动”前的分叉，用于逐步撤销 */
  history: (RoundSpec[] | null)[];
}

const ps: PanelState = { baseline: "yi", editRound: "R1", draft: null, fork: null, error: null, checks: null, history: [] };
let outcomes: Outcomes = {};
let rerender: () => void = () => {};

/** 当前体验记录 → 字段（只取已完成的轮次） */
export function specsFromEvents(events: readonly GameEvent[]): RoundSpec[] {
  return ROUNDS.map((cfg) => ({ cfg, rec: collectRound(events, cfg) }))
    .filter(({ rec }) => rec.final && rec.action)
    .map(({ cfg, rec }) => ({
      round_id: cfg.round_id,
      initial: rec.initial,
      flips: rec.flips,
      explains: rec.explains.map((x) => ({ card: x.card, kind: x.kind })),
      final: rec.final!,
      action: rec.action!,
      followupAnswer: rec.followup?.answer ?? null,
    }));
}

function baselineSpecs(): { specs: RoundSpec[]; flip: string[]; simulated: boolean } {
  if (ps.baseline === "live") return { specs: specsFromEvents(getState().events), flip: [], simulated: false };
  const p = PRESETS.find((x) => x.id === ps.baseline)!;
  return { specs: p.specs, flip: p.flipOutcomes ?? [], simulated: true };
}

function compute(specs: RoundSpec[], flip: string[], fork = false) {
  const events = ps.baseline === "live"
    ? fork ? forkEvents(getState().events, specs, ROUNDS) : getState().events
    : eventsFromSpecs(specs, ROUNDS, "judge");
  const { profile, progress } = evaluate(events, ENGINE_CONFIG);
  const plan = recommend(profile, progress, AVAILABLE_TOPICS);
  const chips = settle(
    specs.map((s) => ({ round_id: s.round_id, action: s.action })),
    flipOutcomes(outcomes, flip),
  );
  return { events, profile, progress, plan, chips };
}

function select(name: string, value: string, opts: [string, string][], onChange: (v: string) => void): HTMLElement {
  return h(
    "label",
    { class: "stack xs muted", style: "gap:4px" },
    name,
    h(
      "select",
      {
        style: "min-height:40px;border-radius:10px;background:var(--surface);color:var(--text);border:1px solid var(--line);padding:0 8px;font-size:14px",
        onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value),
      },
      opts.map(([v, l]) => h("option", { value: v, selected: v === value }, l)),
    ),
  );
}

const CARD_OPTS: [string, string][] = [["", "不翻"], ...(["fox", "elephant", "leopard"] as Card[]).map((c) => [c, `${CARD_COPY[c].animal} · ${CARD_COPY[c].title}`] as [string, string])];

function editor(specs: RoundSpec[]): HTMLElement {
  const current = (ps.fork ?? specs).find((s) => s.round_id === ps.editRound);
  if (!current) return h("p", { class: "small muted" }, "这条记录里还没有完成的轮次。");
  const d = ps.draft && ps.draft.round_id === ps.editRound ? ps.draft : { ...current };
  const setDraft = (patch: Partial<RoundSpec>) => {
    ps.draft = { ...d, ...patch };
    rerender();
  };
  const cfg = ROUNDS.find((r) => r.round_id === d.round_id)!;
  const q = followupFor({ final: d.final, flips: d.flips, action: d.action }, cfg);
  const apply = () => {
    if (d.flips[0] === undefined && d.flips[1] !== undefined) ps.error = "没有首翻就不能有次翻。";
    else if (d.flips[0] && d.flips[0] === d.flips[1]) ps.error = "同一张牌不能翻两次。";
    else {
      ps.error = null;
      ps.history.push(ps.fork);
      ps.fork = (ps.fork ?? specs).map((s) => (s.round_id === d.round_id ? { ...d, followupAnswer: q ? (FOLLOWUP_COPY[q].options.includes(d.followupAnswer ?? "") ? d.followupAnswer : null) : undefined } : s));
      ps.draft = null;
      // 检查结果属于改动前的分叉，清掉以免张冠李戴
      ps.checks = null;
    }
    rerender();
  };
  return h(
    "div",
    { class: "stack" },
    h("div", { class: "row wrap" }, ROUNDS.map((r) => h("button", { class: "opt", style: "min-height:40px;font-size:14px", "aria-pressed": String(ps.editRound === r.round_id), onclick: () => ((ps.editRound = r.round_id), (ps.draft = null), rerender()) }, r.round_id))),
    h(
      "div",
      { class: "grid2" },
      select("首翻", d.flips[0] ?? "", CARD_OPTS, (v) => setDraft({ flips: v ? [v as Card, d.flips[1] as Card].filter(Boolean) as Card[] : [] })),
      select("次翻", d.flips[1] ?? "", CARD_OPTS, (v) => {
        if (v && !d.flips[0]) { ps.error = "请先选择首翻，再选择次翻。"; rerender(); return; }
        ps.error = null;
        setDraft({ flips: [d.flips[0] as Card, v as Card].filter(Boolean) as Card[] });
      }),
      select("最终判断", d.final, (["supports", "refutes", "insufficient"] as Verdict[]).map((v) => [v, VERDICT_COPY[v].label]), (v) => setDraft({ final: v as Verdict, followupAnswer: null })),
      select("行动", d.action, (["follow", "pass", "wait"] as Action[]).map((a) => [a, ACTION_COPY[a]]), (v) => setDraft({ action: v as Action, followupAnswer: null })),
    ),
    q
      ? select(`追问：${FOLLOWUP_COPY[q].question}（必须选择或明确跳过）`, d.followupAnswer ?? "", [["", "跳过"], ...FOLLOWUP_COPY[q].options.map((o) => [o, o] as [string, string])], (v) => setDraft({ followupAnswer: v || null }))
      : h("p", { class: "xs muted" }, "这组字段不触发追问。"),
    ps.error ? h("p", { class: "small", style: "color:var(--leo)" }, ps.error) : null,
    h("div", { class: "row" }, h("button", { class: "btn", style: "min-height:44px;font-size:15px", onclick: apply }, "应用改动（建立分叉）"), h("button", { class: "btn-line", style: "min-height:44px", disabled: !ps.history.length, onclick: () => ((ps.fork = ps.history.pop() ?? null), (ps.draft = null), (ps.error = null), (ps.checks = null), rerender()) }, `撤销${ps.history.length ? `（${ps.history.length}）` : ""}`), h("button", { class: "btn-line", style: "min-height:44px", onclick: () => ((ps.fork = null), (ps.history = []), (ps.draft = null), (ps.error = null), (ps.checks = null), rerender()) }, "恢复基线")),
  );
}

type Result = ReturnType<typeof compute>;

function diffRows(a: Result, b: Result | null): HTMLElement {
  const rows: [string, string, string][] = [
    ...OBS.map((id) => [`${id} ${OBS_COPY[id]}`, `${STATUS_COPY[a.profile.observations[id].status]} · ${a.profile.observations[id].summary}`, b ? `${STATUS_COPY[b.profile.observations[id].status]} · ${b.profile.observations[id].summary}` : ""] as [string, string, string]),
    ["物种", a.profile.style.species, b?.profile.style.species ?? ""],
    ["K / ready_for_B", `${a.progress.K} / ${a.progress.ready_for_B}`, b ? `${b.progress.K} / ${b.progress.ready_for_B}` : ""],
    ["推荐", `${a.plan.route} · 任务 ${a.plan.task}${a.plan.task === "A" ? ` 步骤 ${a.plan.steps.join("、")}` : ""}${a.plan.guess_first ? " · 先猜后验" : ""}`, b ? `${b.plan.route} · 任务 ${b.plan.task}${b.plan.task === "A" ? ` 步骤 ${b.plan.steps.join("、")}` : ""}${b.plan.guess_first ? " · 先猜后验" : ""}` : ""],
    ["代币余额", a.chips.balance.toFixed(2), b ? b.chips.balance.toFixed(2) : ""],
  ];
  return h(
    "div",
    { style: "overflow-x:auto" },
    h(
      "table",
      { class: "small", style: "width:100%;min-width:440px" },
      h("thead", null, h("tr", { class: "muted", style: "text-align:left" }, h("th", { style: "padding:6px" }, "项目"), h("th", { style: "padding:6px" }, "基线"), h("th", { style: "padding:6px" }, "分叉后"))),
      h(
        "tbody",
        null,
        rows.map(([k, x, y]) =>
          h("tr", { style: "border-top:1px solid var(--line)" }, h("td", { style: "padding:6px", class: "muted" }, k), h("td", { style: "padding:6px" }, x), h("td", { style: `padding:6px;${y && y !== x ? "color:var(--leo);font-weight:700" : ""}` }, y || "—")),
        ),
      ),
    ),
  );
}

function whyUnchanged(a: Result, b: Result, base: RoundSpec[], fork: RoundSpec[]): string | null {
  if (JSON.stringify(a.profile) !== JSON.stringify(b.profile)) return null;
  const onlyAction = base.every((s, i) => {
    const f = fork[i]!;
    return JSON.stringify({ ...s, action: null, followupAnswer: null }) === JSON.stringify({ ...f, action: null, followupAnswer: null });
  });
  return onlyAction ? "画像没有变化：交易行动不参与能力推断，代币结算与画像隔离。" : "画像没有变化：这次改动没有触及影响任何一项观察的事件。";
}

export function renderPanel(): HTMLElement {
  const { specs, flip, simulated } = baselineSpecs();
  const a = compute(specs, flip);
  const b = ps.fork ? compute(ps.fork, flip, true) : null;
  const why = b && ps.fork ? whyUnchanged(a, b, specs, ps.fork) : null;
  const shown = b ?? a;
  const live = getState().events.some((e) => e.type === "final_assessment");
  // 改过字段的分叉是反事实，导出时标成 judge_fork，不冒充原路径或本机真实体验
  const baseName = simulated ? PRESETS.find((p) => p.id === ps.baseline)?.name : "当前体验记录";
  const provenance: Omit<Provenance, "event_count"> = b ? { kind: "judge_fork", fork_of: baseName } : simulated ? { kind: "simulated_path", path_id: baseName } : { kind: "user_session" };
  return h(
    "main",
    { class: "screen" },
    h(
      "header",
      { class: "row wrap", style: "gap:10px 14px" },
      h("span", { class: "display", style: "font-size:28px" }, "下一张牌 · 评委面板"),
      h("span", { class: "chip mono" }, `rules ${ENGINE_CONFIG.rules_version}`),
      simulated ? label("simulated") : label("real", "当前体验记录"),
      h("span", { class: "xs muted" }, "这是评委面板：结果由规则引擎实时重算，不是预录。"),
    ),
    h(
      "section",
      { class: "row wrap" },
      [...PRESETS.map((p) => [p.id, `${p.name} · ${p.desc}`] as [string, string]), ...(live ? [["live", "当前体验记录"] as [string, string]] : [])].map(([id, text]) =>
        h("button", { class: "opt", style: "min-height:40px;font-size:13px;font-weight:500", "aria-pressed": String(ps.baseline === id), onclick: () => ((ps.baseline = id), (ps.fork = null), (ps.history = []), (ps.draft = null), (ps.checks = null), rerender()) }, text),
      ),
    ),
    h(
      "div",
      { class: "row wrap", style: "align-items:flex-start;gap:16px" },
      h("section", { class: "panel stack", style: "flex:1 1 320px;min-width:0" }, h("h2", null, "字段编辑"), editor(specs)),
      h(
        "section",
        { class: "panel stack", style: "flex:999 1 480px;min-width:0" },
        h("h2", null, "前后差异"),
        diffRows(a, b),
        why ? h("p", { class: "small", style: "color:var(--ok)" }, why) : null,
        h("h2", { style: "margin-top:8px" }, "推荐理由"),
        h("p", { class: "small text-2" }, shown.plan.reason),
      ),
    ),
    h(
      "div",
      { class: "row wrap", style: "align-items:flex-start;gap:16px" },
      h(
        "section",
        { class: "panel stack", style: "flex:1 1 420px;min-width:0" },
        h("h2", null, b ? "事件日志（分叉后）" : "事件日志"),
        h(
          "div",
          { style: "overflow-x:auto;max-height:360px;overflow-y:auto" },
          h(
            "table",
            { class: "small", style: "width:100%;min-width:420px" },
            h("tbody", null, shown.events.map((e) => h("tr", { style: "border-top:1px solid var(--line)" }, h("td", { class: "mono muted", style: "padding:4px 6px" }, e.round_id), h("td", { class: "mono", style: "padding:4px 6px;color:var(--ele)" }, e.type), h("td", { style: "padding:4px 6px" }, JSON.stringify(e.payload))))),
          ),
        ),
        h("h2", { style: "margin-top:8px" }, "规则命中"),
        h("ul", { class: "small text-2", style: "margin:0;padding-left:18px" }, OBS.flatMap((id) => shown.profile.observations[id].instances.map((i) => h("li", null, `${id} · ${i.context} · 规则 ${i.rule} · ${i.outcome}${i.assisted ? " · 在帮助下" : ""}`)))),
      ),
      h(
        "section",
        { class: "panel stack", style: "flex:1 1 420px;min-width:0" },
        h("div", { class: "row" }, h("h2", { class: "grow" }, "profile / progress JSON"), h("button", { class: "btn-line", style: "width:auto;min-height:36px;font-size:13px", onclick: () => downloadJson("next-card-result", structuredResult(shown.events, ENGINE_CONFIG, AVAILABLE_TOPICS, provenance, UNKNOWN_YET)) }, "导出结构化结果")),
        h("pre", { class: "xs mono", style: "max-height:420px;overflow:auto;margin:0;color:var(--text-2)" }, JSON.stringify({ profile: shown.profile, progress: shown.progress }, null, 2)),
      ),
    ),
    h(
      "section",
      { class: "panel stack" },
      h("div", { class: "row wrap" }, h("h2", { class: "grow" }, "反例检查（PRD §9 · 9 项）"), label("simulated", "检查场景为模拟"), h("button", { class: "btn", style: "width:auto;min-height:40px;font-size:14px", onclick: () => ((ps.checks = runChecks(compute(ps.fork ?? specs, flip, ps.fork !== null).events, ps.fork ?? specs, outcomes)), rerender()) }, "一键依次运行")),
      h("p", { class: "xs muted" }, `以当前${ps.fork ? "分叉" : "基线"}为起点，每项只改一个变量，再用同一个 evaluate / recommend 重算。失败会直接显示为未通过。`),
      ps.checks
        ? h("ol", { class: "list", style: "padding:0" }, ps.checks.map((c) =>
            h("li", { class: "stack", style: "gap:2px;padding:8px 0;border-top:1px solid var(--line)" },
              h("div", { class: "row" }, h("span", { class: "bold", style: `color:${c.pass ? "var(--ok)" : "var(--leo)"};min-width:52px` }, c.pass ? "通过" : "未通过"), h("span", { class: "grow bold small" }, `${c.id}. ${c.name}`)),
              h("span", { class: "xs muted" }, `预期：${c.expected}`),
              h("span", { class: "xs", style: `color:${c.pass ? "var(--text-2)" : "var(--leo)"}` }, `实际：${c.actual}`))))
        : h("p", { class: "small muted" }, "点“一键依次运行”显示 9 项检查的预期、实际和结果。"),
    ),
  );
}

export async function mountPanel(root: HTMLElement): Promise<void> {
  root.classList.add("wide");
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/cases_reveal.json`);
    const d = (await res.json()) as { rounds: { round_id: string; after: { return_open_t1_to_close_t20: number } }[] };
    outcomes = Object.fromEntries(d.rounds.map((r) => [r.round_id, r.after.return_open_t1_to_close_t20]));
  } catch {
    outcomes = {};
  }
  rerender = () => root.replaceChildren(renderPanel());
  rerender();
}
