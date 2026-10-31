// 一轮：听说法 → 第一反应 → 翻牌 → 最终判断 + 你的下一步 → 追问 → 锁定 → 揭晓
import { ACTION_COPY, FOLLOWUP_COPY, JUDGEMENT_COPY, REACTION_COPY, VERDICT_COPY } from "../../config/copy";
import { ENGINE_CONFIG } from "../../config/engine";
import { ROUNDS } from "../../config/rounds";
import { loadReveal, type DataHeader, type RevealRound, type VisibleRound } from "../../data/cases";
import { roundJudgement } from "../../engine/evaluate";
import { followupFor, MAX_FLIPS } from "../../engine/rounds";
import { settle, settleRound, START_TOKENS } from "../../engine/settle";
import type { Action, Card, Reaction, RoundConfig, Verdict } from "../../engine/types";
import { emit, getState, go, update, type RoundUI, type State } from "../../state/store";
import { cardFace, cardTile, footer, mainChart, parrotSays, topbar } from "../components";
import { fmtDate, fmtNum, fmtPct, h } from "../dom";
import { icon } from "../icons";

const CARDS: Card[] = ["fox", "elephant", "leopard"];
const revealCache = new Map<string, { header: DataHeader; round: RevealRound }>();
const pending = new Set<string>();
const revealErrors = new Set<string>();

/** 已锁定的轮次才去请求揭晓数据；请求完成后重绘。 */
function ensureReveal(roundId: string, locked: boolean): { header: DataHeader; round: RevealRound } | undefined {
  const hit = revealCache.get(roundId);
  if (hit || !locked || pending.has(roundId) || revealErrors.has(roundId)) return hit;
  pending.add(roundId);
  loadReveal(roundId, locked)
    .then((r) => revealCache.set(roundId, r))
    .catch(() => revealErrors.add(roundId))
    .finally(() => {
      pending.delete(roundId);
      update(() => {});
    });
  return undefined;
}

export function revealedSources(): { round_id: string; header: DataHeader; round: RevealRound }[] {
  return [...revealCache.entries()].map(([round_id, v]) => ({ round_id, ...v }));
}

function evidenceSentence(cfg: RoundConfig, d: VisibleRound): string {
  if (cfg.key_card === "fox") {
    const f = d.cards.fox;
    return `同一段 60 个交易日里，${d.label} ${fmtPct(f.asset_return)}，${f.benchmark_name} ${fmtPct(f.benchmark_return)}。`;
  }
  if (cfg.key_card === "elephant") {
    const e = d.cards.elephant;
    return `${d.label} 近 3 年累计 ${fmtPct(e.cum_return)}，最大回撤 ${(e.max_drawdown * 100).toFixed(1)}%。`;
  }
  return "这句话说的是 20 个交易日后的价格。揭晓前能看到的牌，既不能支持它，也不能否定它。";
}

function reactionSection(ui: RoundUI, rid: string): HTMLElement {
  const pick = (r: Reaction) =>
    update((s) => {
      const u = s.rounds[s.round]!;
      if (u.initial) return;
      u.initial = r;
      u.phase = "flip";
      emit(s, rid, "pre_reveal", "initial_reaction", { reaction: r });
    });
  return h(
    "section",
    { class: "stack" },
    h("h2", null, "还没看证据，你对这句话的第一判断？"),
    h(
      "div",
      { class: "grid3" },
      (["supports", "refutes", "unsure"] as Reaction[]).map((r) =>
        h("button", { class: "opt", "aria-pressed": String(ui.initial === r), disabled: ui.initial !== undefined, onclick: () => pick(r) }, REACTION_COPY[r]),
      ),
    ),
    h("p", { class: "xs muted" }, "这是对这句话的第一判断，不是交易选择。"),
  );
}

function flipSection(ui: RoundUI, cfg: RoundConfig, d: VisibleRound): HTMLElement {
  const full = ui.flips.length >= MAX_FLIPS;
  const flip = (card: Card) =>
    update((s) => {
      const u = s.rounds[s.round]!;
      if (u.locked || u.flips.includes(card) || u.flips.length >= MAX_FLIPS) return;
      u.flips.push(card);
      emit(s, cfg.round_id, "pre_reveal", "card_flip", { card });
    });
  const explain = (card: Card) =>
    update((s) => {
      const u = s.rounds[s.round]!;
      if (u.explained.includes(card)) return;
      u.explained.push(card);
      const x = cfg.explain[card];
      emit(s, cfg.round_id, "pre_reveal", "explain_open", { card, content_id: x.content_id, kind: x.kind });
    });
  return h(
    "section",
    { class: "stack" },
    h("div", { class: "row", style: "justify-content:space-between" }, h("h2", null, "可以翻的牌"), h("span", { class: "xs muted" }, `最多 ${MAX_FLIPS} 张，也可以不翻`)),
    h("div", { class: "grid3" }, CARDS.map((c) => cardTile(c, { up: ui.flips.includes(c), disabled: ui.locked || (full && !ui.flips.includes(c)), locked: ui.locked, onFlip: () => flip(c) }))),
    h("p", { class: "xs muted" }, `已翻 `, h("span", { class: "mono" }, ui.flips.length), ` / ${MAX_FLIPS} 张`),
    ui.flips.map((c) => cardFace(c, d, { label: d.label, explain: cfg.explain[c].text, explained: ui.explained.includes(c), onExplain: () => explain(c) })),
    ui.phase === "flip" ? h("button", { class: "btn", onclick: () => update((s) => void (s.rounds[s.round]!.phase = "judge")) }, "做判断") : null,
  );
}

function judgeSection(ui: RoundUI, cfg: RoundConfig): HTMLElement {
  const set = (fn: (u: RoundUI) => void) => update((s) => fn(s.rounds[s.round]!));
  const lock = () =>
    update((s) => {
      const u = s.rounds[s.round]!;
      if (!u.final || !u.action || u.locked) return;
      const q = followupFor({ final: u.final, flips: u.flips, action: u.action }, cfg);
      if (q) {
        u.followup = q;
        u.phase = "followup";
      } else {
        commit(s, u, cfg, null);
      }
    });
  return h(
    "section",
    { class: "stack" },
    h("h2", null, "最终判断：鹦鹉这句话……"),
    (["supports", "refutes", "insufficient"] as Verdict[]).map((v) =>
      h(
        "button",
        { class: "opt opt-row", "aria-pressed": String(ui.final === v), onclick: () => set((u) => (u.final = v)) },
        h("span", { class: "dot" }),
        h("span", null, h("span", { class: "t" }, VERDICT_COPY[v].label), h("span", { class: "d" }, VERDICT_COPY[v].desc)),
      ),
    ),
    h("label", { class: "xs muted", for: "note" }, "写一句理由（可选，只作自述，不影响能力观察）"),
    h("input", {
      id: "note",
      type: "text",
      value: ui.note,
      maxlength: 60,
      placeholder: "比如：同期的基准涨得更多",
      style: "min-height:44px;border-radius:12px;border:1px solid var(--line);background:var(--surface);color:var(--text);padding:0 12px;font-size:15px",
      onchange: (e: Event) => {
        const v = (e.target as HTMLInputElement).value;
        getState().rounds[getState().round]!.note = v;
      },
    }),
    h(
      "div",
      { class: "stack", style: "gap:6px;margin-top:6px" },
      h("span", { class: "small text-2" }, "你的下一步"),
      h(
        "div",
        { class: "seg", role: "group", "aria-label": "你的下一步" },
        (["follow", "pass", "wait"] as Action[]).map((a) => h("button", { "aria-pressed": String(ui.action === a), onclick: () => set((u) => (u.action = a)) }, ACTION_COPY[a])),
      ),
      h("span", { class: "xs muted" }, "认可一个说法，不代表必须跟。"),
    ),
    h("button", { class: "btn", disabled: !ui.final || !ui.action, onclick: lock, style: "margin-top:6px" }, icon("lock", 18, 2), "锁定并揭晓"),
    h("p", { class: "xs muted", style: "text-align:center" }, "锁定后不能再改。"),
  );
}

function commit(s: State, u: RoundUI, cfg: RoundConfig, answer: string | null): void {
  const rid = cfg.round_id;
  emit(s, rid, "pre_reveal", "final_assessment", { verdict: u.final! });
  emit(s, rid, "pre_reveal", "decision", { action: u.action! });
  if (u.followup) emit(s, rid, "pre_reveal", "followup_answer", { question: u.followup, answer });
  if (u.note.trim()) emit(s, rid, "pre_reveal", "self_note", { text: u.note.trim() });
  u.locked = true;
  u.phase = "revealed";
}

function followupSheet(ui: RoundUI, cfg: RoundConfig): HTMLElement {
  const q = FOLLOWUP_COPY[ui.followup!];
  const answer = (a: string | null) =>
    update((s) => {
      const u = s.rounds[s.round]!;
      if (u.phase === "followup") commit(s, u, cfg, a);
    });
  return h(
    "div",
    { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": q.question },
    h(
      "div",
      null,
      h("h2", null, q.question),
      h("p", { class: "xs muted" }, "选一个最接近的，也可以跳过。选哪个都不会影响揭晓。"),
      h("div", { class: "grid2" }, q.options.map((o) => h("button", { class: "opt", style: "font-weight:500", onclick: () => answer(o) }, o))),
      h("button", { class: "btn-text", onclick: () => answer(null) }, "跳过"),
    ),
  );
}

function revealSection(s: State, ui: RoundUI, cfg: RoundConfig, d: VisibleRound): HTMLElement {
  const data = ensureReveal(cfg.round_id, ui.locked);
  // 余额需要此前各轮的揭晓数据（都已锁定，可以加载）
  s.rounds.forEach((u, i) => {
    if (u.locked) ensureReveal(ROUNDS[i]!.round_id, true);
  });
  if (!data) return h("section", { class: "panel stack" }, h("p", { class: "text-2" }, revealErrors.has(cfg.round_id) ? "揭晓数据加载失败，已保留你的选择。" : "正在揭晓……"), revealErrors.has(cfg.round_id) ? h("button", { class: "btn", onclick: () => { revealErrors.delete(cfg.round_id); update(() => {}); } }, "重试加载") : null);

  const judgement = roundJudgement(s.events, cfg, ENGINE_CONFIG)!;
  const ret = data.round.after.return_open_t1_to_close_t20;
  const mine = settleRound(cfg.round_id, ui.action ?? null, ret);
  const lockedRounds = ROUNDS.map((r, i) => ({ r, u: s.rounds[i]! })).filter(({ u }) => u.locked);
  const balance = settle(
    lockedRounds.map(({ r, u }) => ({ round_id: r.round_id, action: u.action ?? null })),
    Object.fromEntries(lockedRounds.map(({ r }) => [r.round_id, revealCache.get(r.round_id)?.round.after.return_open_t1_to_close_t20 ?? null])),
  ).balance;
  const good = judgement === "consistent" || judgement === "future_reserved";
  const crossNote =
    mine.delta > 0 && !good
      ? "这笔代币赚了，但这一轮的判断还缺少对应的依据。"
      : mine.delta < 0 && good
        ? "代币亏了，但这一轮的判断有依据。赚赔看的是后来的走势，不是判断。"
        : null;
  const unflipped = CARDS.filter((c) => !ui.flips.includes(c));
  const src = data.round.source;
  const last = s.round === ROUNDS.length - 1;

  return h(
    "section",
    { class: "stack", style: "gap:14px" },
    h("div", { class: "panel sunken on-dark stack" }, h("span", { class: "xs muted" }, `${d.label} 的走势：决策前 60 个交易日 + 决策后 20 个交易日`), mainChart(d, data.round.after.close)),
    h(
      "div",
      { class: `panel stack${good ? " ok-frame" : ""}`, style: "gap:10px" },
      h(
        "div",
        { class: "row", style: "justify-content:space-between" },
        h("span", { class: "small bold", style: "color:var(--ok);letter-spacing:.06em" }, "判断线 · 进画像"),
        h("span", { class: "chip", style: good ? "background:var(--ok);color:var(--bg);font-weight:700" : "" }, JUDGEMENT_COPY[judgement]),
      ),
      h(
        "div",
        { class: "grid2" },
        h("div", { class: "panel sunken stack", style: "gap:0;padding:10px 12px" }, h("span", { class: "xs muted" }, "证据结论"), h("span", { class: "bold", style: "font-size:19px" }, VERDICT_COPY[cfg.verdict].label)),
        h("div", { class: "panel sunken stack", style: "gap:0;padding:10px 12px" }, h("span", { class: "xs muted" }, "你的判断"), h("span", { class: "bold", style: "font-size:19px" }, VERDICT_COPY[ui.final!].label)),
      ),
      h("p", { class: "small" }, evidenceSentence(cfg, d)),
      ui.initial && ui.initial !== "unsure" && REACTION_COPY[ui.initial] !== VERDICT_COPY[ui.final!].label
        ? h("p", { class: "xs text-2" }, `你的第一判断是「${REACTION_COPY[ui.initial]}」，看完牌后改成了「${VERDICT_COPY[ui.final!].label}」。`)
        : null,
    ),
    unflipped.length
      ? h(
          "details",
          { class: "panel" },
          h("summary", { class: "small" }, `你没翻的${unflipped.length === 1 ? "那张牌" : "牌"}写着……`),
          h(
            "div",
            { class: "stack", style: "margin-top:8px" },
            h("p", { class: "xs muted" }, "补全的牌只是让你看到全貌，不会改写本轮判断。"),
            unflipped.map((c) => cardFace(c, d, { label: d.label, explain: "", explained: false })),
          ),
        )
      : null,
    h(
      "div",
      { class: "panel sunken stack", style: "gap:6px;padding:12px 14px" },
      h("div", { class: "row", style: "justify-content:space-between" }, h("span", { class: "xs muted" }, "代币线 · 不进画像"), h("span", { class: "xs muted mono" }, `余额 ${balance.toFixed(2)}（起始 ${START_TOKENS}）`)),
      h(
        "p",
        { class: "small text-2" },
        `后来 20 个交易日（次日开盘到第 20 天收盘）：${fmtPct(ret)}。`,
        ui.action === "follow" ? `你跟了，投入 30，变动 ${fmtNum(mine.delta)}。` : `你选了「${ACTION_COPY[ui.action!]}」，代币不变；假如跟了：${fmtNum(mine.hypothetical)}。`,
      ),
      crossNote ? h("p", { class: "xs muted" }, crossNote) : null,
    ),
    h(
      "div",
      { class: "paper row", style: "gap:12px" },
      h("div", { style: "flex:none;width:44px;height:44px;border-radius:12px;background:var(--fox-tint);color:var(--fox-ink);display:flex;align-items:center;justify-content:center" }, icon("bookmark", 22)),
      h("div", { class: "grow stack", style: "gap:2px" }, h("span", { class: "xs bold", style: "color:var(--fox-ink)" }, `获得方法卡 · ${cfg.method_card.name}`), h("span", { class: "small" }, cfg.method_card.line), h("span", { class: "xs muted" }, "方法卡是下一关的工具，局内不能使用。")),
    ),
    h(
      "details",
      { class: "panel sunken" },
      h("summary", { class: "small" }, `看看 ${d.label} 是哪只标的`),
      h(
        "div",
        { class: "stack small text-2", style: "margin-top:6px;gap:4px" },
        h("p", null, `${src.symbol} ${src.name}，决策日 ${fmtDate(src.decision_date)}。`),
        h("p", null, `同期对照窗口 ${fmtDate(src.windows.fox[0])} 至 ${fmtDate(src.windows.fox[1])}；揭晓窗口 ${fmtDate(src.windows.after[0])} 至 ${fmtDate(src.windows.after[1])}。`),
        h("p", { class: "xs muted" }, src.hindsight_disclosure),
        h("button", { class: "btn-text", style: "align-self:flex-start;padding:0", onclick: () => go("data") }, "完整数据说明"),
      ),
    ),
    h(
      "button",
      {
        class: "btn",
        onclick: () =>
          last
            ? go("profile")
            : update((st) => {
                st.round += 1;
                window.scrollTo(0, 0);
              }),
      },
      last ? "看本局的人物卡" : "下一轮",
      icon("arrow", 18, 2),
    ),
  );
}

export function roundScreen(s: State, visible: VisibleRound[]): HTMLElement {
  const cfg = ROUNDS[s.round]!;
  const ui = s.rounds[s.round]!;
  const d = visible.find((v) => v.round_id === cfg.round_id)!;
  return h(
    "main",
    { class: "screen" },
    topbar({ title: `第 ${s.round + 1} 轮 / ${ROUNDS.length}`, progress: s.round, onBack: () => go("start") }),
    parrotSays(cfg.claim),
    ui.phase !== "revealed"
      ? h("div", { class: "panel sunken on-dark stack" }, h("span", { class: "xs muted" }, `主图：${d.label} 决策前 60 个交易日（起点 = 100）`), mainChart(d))
      : null,
    reactionSection(ui, cfg.round_id),
    ui.phase !== "claim" ? flipSection(ui, cfg, d) : null,
    ui.phase === "judge" || ui.phase === "followup" ? judgeSection(ui, cfg) : null,
    ui.phase === "followup" ? followupSheet(ui, cfg) : null,
    ui.phase === "revealed" ? revealSection(s, ui, cfg, d) : null,
    footer(),
  );
}

