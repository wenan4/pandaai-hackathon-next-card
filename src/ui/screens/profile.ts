// 人物卡、依据页、分享卡：全部由引擎输出渲染，组件里不做规则判断。
import { ASSIST_COPY, CARD_COPY, OBS_COPY, REACTION_COPY, SPECIES_COPY, UNKNOWN_YET, VERDICT_COPY } from "../../config/copy";
import { AVAILABLE_TOPICS, ENGINE_CONFIG } from "../../config/engine";
import { ROUNDS } from "../../config/rounds";
import { evaluate } from "../../engine/evaluate";
import { recommend } from "../../engine/recommend";
import { collectRound } from "../../engine/rounds";
import type { ObsId, ObsInstance, Plan, Profile } from "../../engine/types";
import { go, update, type State } from "../../state/store";
import { footer, label, statusPill, topbar } from "../components";
import { h } from "../dom";
import { icon } from "../icons";

const OBS: ObsId[] = ["O1", "O2", "O3", "O4"];
const TOPIC_NAME = { cheetah: "猎豹题：放量上涨之后", elephant: "大象题", fox: "狐狸题" } as const;

export function currentProfile(s: State) {
  const { profile, progress } = evaluate(s.events, ENGINE_CONFIG);
  return { profile, progress, plan: recommend(profile, progress, AVAILABLE_TOPICS) };
}

export function startTask(s: State, plan: Plan, profile: Profile): void {
  s.profileBeforeTask = profile;
  if (plan.task === "A") {
    s.taskA = { reason: plan.reason, guessFirst: plan.guess_first, steps: plan.steps, stepIndex: 0, assist: plan.assist, aligned: false, exposures: [], readings: false, windowExtended: false, done: false };
    s.back = s.screen;
    s.screen = "taskA";
  } else {
    s.taskB = { reason: plan.reason, guessFirst: plan.guess_first, locked: false, testOpened: false, submitted: false };
    s.back = s.screen;
    s.screen = "taskB";
  }
  window.scrollTo(0, 0);
}

export function planCard(plan: Plan, profile: Profile): HTMLElement {
  const title = plan.task === "A" ? `任务 A · 同一起点，再比一次（步骤 ${plan.steps.join("、")}）` : `任务 B · ${plan.topic ? TOPIC_NAME[plan.topic] : "选一个主题"}`;
  return h(
    "section",
    { class: "paper stack", style: "gap:8px" },
    h("div", { class: "row wrap", style: "gap:6px" }, h("span", { class: "xs bold", style: "color:var(--leo-ink)" }, "下一关"), h("span", { class: "chip", style: "background:var(--paper-2);color:var(--ink-2)" }, plan.route)),
    h("span", { style: "font-size:17px;font-weight:700" }, title),
    h("p", { class: "small", style: "color:var(--ink-2)" }, plan.reason),
    h(
      "p",
      { class: "xs muted" },
      `协助：${ASSIST_COPY[plan.assist].label}（${profile.help_preference.source === "user" ? "你选过的档位" : "按本局帮助使用推断，可随时改"}）`,
      plan.guess_first ? " · 先猜后验" : "",
    ),
    h("button", { class: "btn", style: "background:var(--ink);color:var(--paper)", onclick: () => update((s) => startTask(s, plan, profile)) }, plan.task === "B" ? "查看任务 B（数据准备中）" : "开始下一关", icon("arrow", 18, 2)),
  );
}

export function profileScreen(s: State): HTMLElement {
  const { profile, plan } = currentProfile(s);
  const sp = SPECIES_COPY[profile.style.species];
  const c = profile.style.counts;
  const preliminary = !s.taskA?.done && !s.taskB?.submitted;
  return h(
    "main",
    { class: "screen" },
    topbar({ title: "本局的你", onBack: () => go("start"), right: h("button", { class: "icon-btn", "aria-label": "分享卡", onclick: () => go("share") }, icon("share", 22, 2)) }),
    preliminary ? h("p", { class: "xs muted" }, "初步卡片：第一幕 3 轮。只出现过一次的观察会标出来，多玩几关会更准。") : null,
    h(
      "section",
      { class: "paper row", style: "gap:16px;padding:18px" },
      h(
        "div",
        { style: "flex:none;width:84px;height:84px;border-radius:42px;background:var(--fox-tint);display:flex;align-items:center;justify-content:center;color:var(--ink)" },
        icon(profile.style.species === "mixed" || profile.style.species === "unknown" ? "help" : profile.style.species, 48, 1.6),
      ),
      h(
        "div",
        { class: "stack", style: "gap:2px" },
        h("span", { class: "xs muted" }, "本局交易物种"),
        h("span", { class: "display", style: "font-size:30px;line-height:1.1" }, sp.name),
        h("span", { class: "bold" }, sp.method),
        h("span", { class: "xs", style: "color:var(--ink-2)" }, `可计入的首翻：狐狸 ${c.fox} · 大象 ${c.elephant} · 猎豹 ${c.leopard}`),
        h("span", { class: "xs muted" }, "倾向是习惯，不分高低"),
      ),
    ),
    h(
      "p",
      { class: "small text-2" },
      profile.style.species === "mixed" || profile.style.species === "unknown" ? `${sp.helps}${sp.watch}` : `这种查法可以帮你${sp.helps}仍需留意：${sp.watch}`,
    ),
    h(
      "section",
      { class: "stack" },
      h("div", { class: "row", style: "justify-content:space-between" }, h("h2", null, "本局观察"), h("span", { class: "xs muted" }, "只看怎么用证据，不看赚赔")),
      h(
        "ul",
        { class: "list panel", style: "padding:0" },
        OBS.map((id) => {
          const o = profile.observations[id];
          return h(
            "li",
            { class: "row" },
            h("span", { class: "xs muted bold", style: "width:24px" }, id),
            h("div", { class: "grow stack", style: "gap:0" }, h("span", null, OBS_COPY[id]), h("span", { class: "xs muted" }, o.summary)),
            statusPill(o.status),
          );
        }),
      ),
    ),
    h(
      "section",
      { class: "panel row" },
      h("span", { style: "color:var(--ele)" }, icon("help", 22)),
      h("div", { class: "stack", style: "gap:0" }, h("span", { class: "xs muted" }, "帮助偏好"), h("span", { class: "small" }, `${ASSIST_COPY[profile.help_preference.level].label}：本局展开解释 ${profile.help_preference.explain_count} 次`)),
    ),
    h("section", { class: "panel stack" }, h("h2", null, "还不知道"), h("ul", { class: "small text-2", style: "margin:0;padding-left:18px" }, UNKNOWN_YET.map((x) => h("li", null, x)))),
    h("details", { class: "panel" }, h("summary", { class: "small" }, "换成交易语言来看"), h("p", { class: "small muted", style: "margin-top:6px" }, "更新中：第二幕会补上这一部分。")),
    planCard(plan, profile),
    h("button", { class: "btn-line", onclick: () => go("basis") }, "看每条观察的依据"),
    footer(),
  );
}

const ALTERNATIVES: Record<string, string> = {
  a: "也可能只是习惯先看这张牌；需要在另一个情境里再看到一次。",
  b: "可能是没读懂这张牌，也可能更相信说法本身。",
  c: "明确表示图表没看懂，理解暂待确认。",
  e: "看过关键牌但还未下结论，可能更谨慎或仍在理解。",
  f: "自述知道还需要查看对应证据，不等于已经核验。",
  g: "没翻这一轮的关键牌：结论碰巧对上不算查证。",
  t: "任务中提交的答案与数据一致。",
  r: "提交与数据不一致：只做记录，不贴标签。",
};
const O3_ALT: Record<string, string> = {
  "O3-a": "选了证据不足；还要看在可以判断的轮次里会不会明确下结论。",
  "O3-b": "没有查看量价牌就选择证据不足，尚未展示核验依据。",
  "O3-d": "看了近期量价后对未来下了判断，可能把一次放量当成了信号。",
};
const O4_ALT: Record<string, string> = {
  "O4-a": "第一判断和最终判断不同，改的方向和证据一致；也可能第一判断是随手点的。",
  "O4-c": "看到了相反的关键证据但没有调整；也可能对证据另有理解。",
};

function describe(s: State, inst: ObsInstance): string {
  if (inst.context.startsWith("taskA")) return `任务 A 步骤 ${inst.context.slice(-1)}：提交了答案`;
  const cfg = ROUNDS.find((r) => r.round_id === inst.context);
  if (!cfg) return inst.context;
  const rec = collectRound(s.events, cfg);
  const flips = rec.flips.length ? rec.flips.map((c) => `「${CARD_COPY[c].title}」`).join("、") : "没有翻牌";
  const initial = rec.initial ? `第一判断「${REACTION_COPY[rec.initial]}」→ ` : "";
  return `${initial}翻开 ${flips} → 最终「${rec.final ? VERDICT_COPY[rec.final].label : "—"}」`;
}

function alternative(inst: ObsInstance): string {
  return O3_ALT[inst.rule] ?? O4_ALT[inst.rule] ?? ALTERNATIVES[inst.rule.slice(-1)] ?? "";
}

export function basisScreen(s: State): HTMLElement {
  const { profile } = currentProfile(s);
  return h(
    "main",
    { class: "screen" },
    topbar({ title: `每条观察的依据 · 规则 ${profile.rules_version}`, onBack: () => go("profile") }),
    OBS.map((id) => {
      const o = profile.observations[id];
      return h(
        "article",
        { class: `panel stack${o.status === "uncertain" ? " dashed" : ""}`, style: "gap:8px" },
        h("div", { class: "row" }, h("span", { class: "xs muted bold" }, id), h("span", { class: "grow bold" }, OBS_COPY[id]), statusPill(o.status, o.summary)),
        o.instances.length === 0
          ? h("p", { class: "small muted" }, id === "O4" ? "本局没有出现需要修正第一判断的情境。" : "本局没有可以对应这项观察的事件。")
          : o.instances.map((inst) =>
              h(
                "div",
                { class: "stack", style: "gap:2px;padding-top:6px;border-top:1px solid var(--line)" },
                h("div", { class: "row wrap", style: "gap:6px" }, h("span", { class: "chip mono" }, inst.context.startsWith("taskA") ? "任务 A" : inst.context), h("span", { class: "xs muted bold" }, `规则 ${inst.rule}`), inst.assisted ? h("span", { class: "xs", style: "color:var(--ele)" }, "提交前看过提示，记为在帮助下") : null),
                h("p", { class: "small" }, describe(s, inst)),
                h("p", { class: "xs muted" }, `其他可能：${alternative(inst)}`),
              ),
            ),
        o.understanding_unclear ? h("p", { class: "xs", style: "color:var(--leo)" }, "追问里你选了“图没看懂”：这项先记为理解待确认，不算没查证。") : null,
        id === "O1" || id === "O2" ? profile.task_observations[id].map((inst) => h("p", { class: "small text-2" }, `${describe(s, inst)} · ${inst.outcome === "consistent" ? inst.assisted ? "在帮助下完成" : "独立完成" : "与数据尚未对应"}。这是任务中的新情境，不改写局内观察。`)) : null,
      );
    }),
    h(
      "article",
      { class: "paper stack" },
      h("div", { class: "row" }, h("span", { class: "grow bold" }, `本局倾向：${SPECIES_COPY[profile.style.species].name}`), h("span", { class: "chip", style: "background:var(--paper-2);color:var(--ink-2)" }, "偏好，不是能力")),
      h(
        "div",
        { class: "grid3" },
        profile.style.first_flips.map((f) =>
          h(
            "div",
            { style: `border-radius:10px;padding:8px;text-align:center;background:${f.counted ? "var(--paper-2)" : "transparent"};border:1px ${f.counted ? "solid" : "dashed"} var(--paper-2)` },
            h("div", { class: "xs muted mono" }, `${f.round_id} 首翻`),
            h("div", { class: "small bold" }, CARD_COPY[f.card].animal),
            h("div", { class: "xs muted" }, f.counted ? "计入" : "点名牌，不计"),
          ),
        ),
      ),
      h("p", { class: "xs", style: "color:var(--ink-2)" }, "按每轮第一张翻的牌统计。说法直接点名的那张牌不计入，因为那是说法引导你去翻的。某种牌至少 2 次且最多才算物种；平局记为混合倾向。"),
    ),
    footer(),
  );
}

export function shareScreen(s: State): HTMLElement {
  const { profile } = currentProfile(s);
  const sp = SPECIES_COPY[profile.style.species];
  const shown = profile.style.species !== "mixed" && profile.style.species !== "unknown";
  const helps = shown ? `这种查法可以帮助${sp.helps}` : sp.helps;
  const watch = shown ? `仍需留意：${sp.watch}` : sp.watch;
  const text = `我在《下一张牌》里的本局交易物种：${sp.name} · ${sp.method}。${helps}${watch}（只代表这一局）`;
  return h(
    "main",
    { class: "screen" },
    topbar({ title: "分享卡预览", onBack: () => go("profile") }),
    h(
      "section",
      { class: "paper stack", style: "gap:10px;padding:22px" },
      h("span", { class: "xs muted" }, "下一张牌 · 本局交易物种"),
      h("span", { class: "display", style: "font-size:36px;line-height:1.1" }, sp.name),
      h("span", { class: "bold" }, sp.method),
      h("p", { class: "small", style: "color:var(--ink-2)" }, helps),
      h("p", { class: "small", style: "color:var(--ink-2)" }, watch),
      h("span", { class: "xs muted" }, "只代表这一局 · 虚拟代币、研究练习"),
    ),
    h("p", { class: "xs muted" }, "分享卡只包含物种和限定说明，不包含你的任何选择、观察或行动记录。默认不公开。"),
    h(
      "button",
      {
        class: "btn-line",
        onclick: async (e: Event) => {
          const btn = e.currentTarget as HTMLButtonElement;
          try {
            await navigator.clipboard.writeText(text);
            btn.textContent = "已复制（只含物种和限定说明）";
          } catch {
            btn.textContent = "复制失败，可以长按卡片文字手动复制";
          }
        },
      },
      "复制分享文字",
    ),
    label("todo", "导出图片（P1）"),
    footer(),
  );
}
