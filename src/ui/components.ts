import { BENCHMARK_NAME } from "../config/rounds";
import { CARD_COPY, LABELS, STATUS_COPY, type LabelKind } from "../config/copy";
import { DISCLAIMER } from "../config/constants";
import type { VisibleRound } from "../data/cases";
import type { Card, ObsStatus } from "../engine/types";
import { lineChart, volumeBars, type Series } from "./chart";
import { fmtPct, h, type Child } from "./dom";
import { icon, type IconName } from "./icons";

export function footer(): HTMLElement {
  return h("footer", { class: "footer" }, DISCLAIMER);
}

export function topbar(opts: { title: string; onBack?: () => void; progress?: number; right?: Child }): HTMLElement {
  return h(
    "div",
    { class: "topbar" },
    opts.onBack
      ? h("button", { class: "icon-btn", "aria-label": "返回", onclick: opts.onBack, style: "margin-left:-10px" }, icon("back", 22, 2))
      : null,
    h(
      "div",
      { class: "grow stack", style: "gap:6px" },
      h("span", { class: "small text-2" }, opts.title),
      opts.progress !== undefined
        ? h("div", { class: "progress", "aria-hidden": "true" }, [0, 1, 2].map((i) => h("span", { class: i <= opts.progress! ? "on" : "" })))
        : null,
    ),
    opts.right ?? null,
  );
}

export function statusPill(status: ObsStatus, extra?: string): HTMLElement {
  return h("span", { class: `status ${status}` }, icon(status as IconName, 14, 2), STATUS_COPY[status], extra ? ` · ${extra}` : null);
}

export function label(kind: LabelKind, text?: string): HTMLElement {
  return h("span", { class: `tag ${kind}` }, text ?? LABELS[kind]);
}

export function parrotSays(text: string, small = false): HTMLElement {
  return h(
    "div",
    { class: "row", style: "align-items:flex-start" },
    h("div", { class: "parrot" }, icon("parrot", 24)),
    h(
      "div",
      { class: "grow stack", style: "gap:4px" },
      h("span", { class: "xs muted" }, "小道消息鹦鹉说："),
      h("p", { class: "claim", style: small ? "font-size:15px" : "" }, text),
    ),
  );
}

export function cardTile(card: Card, state: { up: boolean; disabled: boolean; locked: boolean; onFlip: () => void }): HTMLElement {
  const c = CARD_COPY[card];
  const status = state.up ? "已翻开" : state.locked ? "没翻" : state.disabled ? "已用完" : "点一下翻开";
  return h(
    "button",
    {
      class: `tile ${card}${state.up ? " up" : ""}`,
      disabled: state.up || state.disabled,
      "aria-label": `${state.up ? "已翻开" : "翻开"}${c.animal}牌：${c.title}`,
      onclick: state.onFlip,
    },
    icon(card, 30),
    h("span", { class: "name" }, `${c.animal} · ${c.title}`),
    h("span", { class: "xs", style: "opacity:.85" }, status),
  );
}

function stat(k: string, v: string, color?: string): HTMLElement {
  return h("div", { class: "stat stack", style: "gap:0" }, h("span", { class: "k", style: color ? `color:${color}` : "" }, k), h("span", { class: "v", style: color ? `color:${color}` : "" }, v));
}

/** 牌面。explain 为该牌的解释文案；onExplain 在第一次展开时调用（记录 explain_open，不消耗翻牌次数）。 */
/** R6：本标的过去一年里每次同类放量上涨，以及之后 N 个交易日收盘比当天高还是低。只给相对日期。 */
function signalHistory(sig: NonNullable<VisibleRound["cards"]["leopard"]["signals"]>): HTMLElement {
  return h(
    "div",
    { class: "stack", style: "gap:4px;padding-top:8px;border-top:1px dashed var(--paper-2)" },
    h("span", { class: "xs bold", style: "color:var(--ink)" }, `过去一年的同类放量上涨（共 ${sig.items.length} 次）`),
    h("span", { class: "xs", style: "color:var(--ink-2)" }, `${sig.definition}；每次之后 ${sig.horizon} 个交易日的观察都已在今天之前结束。`),
    h(
      "table",
      { class: "btable" },
      h("thead", null, h("tr", null, h("th", null, "出现在"), h("th", null, "量比"), h("th", null, "当天"), h("th", null, `之后 ${sig.horizon} 日`))),
      h("tbody", null, sig.items.map((x) =>
        h("tr", null, h("td", null, `约 ${-x.offset} 个交易日前`), h("td", { class: "mono" }, `${x.vol_ratio.toFixed(1)} 倍`), h("td", { class: "mono" }, fmtPct(x.day_return)), h("td", { class: "mono" }, fmtPct(x.forward_return))))),
    ),
  );
}

export function cardFace(card: Card, data: VisibleRound, opts: { label: string; explain: string; explained: boolean; onExplain?: () => void; note?: string }): HTMLElement {
  const c = CARD_COPY[card];
  const title = h("div", { class: "face-title" }, icon(card, 18), `${c.title}`);
  let body: Child[];
  if (card === "fox") {
    const f = data.cards.fox;
    body = [
      h("div", { class: "legend" }, h("span", null, h("i", { style: "background:var(--ink)" }), opts.label), h("span", { style: "color:var(--fox-ink)" }, h("i", { style: "background:var(--fox-ink)" }), f.benchmark_name)),
      lineChart({
        series: [
          { values: f.benchmark, color: "var(--fox-ink)" },
          { values: f.asset, color: "var(--ink)" },
        ],
        baseline: 100,
        label: `${opts.label}与${f.benchmark_name}近 60 个交易日走势，同一起点 100。${opts.label} ${fmtPct(f.asset_return)}，${f.benchmark_name} ${fmtPct(f.benchmark_return)}`,
      }),
      h("div", { class: "grid2" }, stat(opts.label, fmtPct(f.asset_return)), stat(f.benchmark_name, fmtPct(f.benchmark_return), "var(--fox-ink)")),
      h("p", { class: "xs muted" }, "近 60 个交易日，两条线都从同一起点 100 出发"),
    ];
  } else if (card === "elephant") {
    const e = data.cards.elephant;
    body = [
      lineChart({ series: [{ values: e.series, color: "var(--ele-ink)" }], baseline: 100, height: 110, label: `${opts.label}近 3 年走势，累计 ${fmtPct(e.cum_return)}，最大回撤 ${(e.max_drawdown * 100).toFixed(1)}%` }),
      h("div", { class: "grid2" }, stat("3 年累计涨跌", fmtPct(e.cum_return)), stat("最大回撤", `${(e.max_drawdown * 100).toFixed(1)}%`)),
      h("p", { class: "xs muted" }, `${opts.label}近 3 年（约 730 个交易日），起点为 100`),
    ];
  } else {
    const l = data.cards.leopard;
    const last = l.volume_ratio[l.volume_ratio.length - 1];
    const lastRet = l.day_return[l.day_return.length - 1];
    body = [
      lineChart({ series: [{ values: l.close, color: "var(--ink)" }], height: 56, label: `${opts.label}近 20 个交易日收盘走势` }),
      volumeBars(l.volume_ratio, `${opts.label}近 20 个交易日量比，最近一天 ${last?.toFixed(2) ?? "无"} 倍`),
      h("div", { class: "grid2" }, stat("最近一天量比", last != null ? `${last.toFixed(2)} 倍` : "停牌"), stat("最近一天涨跌", lastRet != null ? fmtPct(lastRet) : "—")),
      l.signals ? signalHistory(l.signals) : null,
    ];
  }
  return h(
    "div",
    { class: `face ${card}` },
    title,
    body,
    opts.note ? h("p", { class: "xs muted" }, opts.note) : null,
    opts.onExplain
      ? h(
          "details",
          {
            open: opts.explained,
            ontoggle: (e: Event) => {
              if ((e.currentTarget as HTMLDetailsElement).open && !opts.explained) opts.onExplain!();
            },
          },
          h("summary", { class: "small", style: "color:var(--ele-ink)" }, "这张图怎么看（不占翻牌次数）"),
          h("p", { class: "explain" }, opts.explain),
        )
      : null,
  );
}

export function mainChart(data: VisibleRound, after?: number[]): SVGSVGElement {
  const asset = data.cards.fox.asset;
  const series: Series[] = [{ values: asset, color: "var(--text)" }];
  if (after) {
    // 揭晓：后续走势以 T 收盘 = 100 存储，换算到主图的刻度后接在后面
    const scale = asset[asset.length - 1]! / 100;
    series.push({ values: after.map((v) => v * scale), color: "var(--leo)", offset: asset.length - 1 });
  }
  return lineChart({
    series,
    baseline: 100,
    height: 110,
    points: asset.length + (after ? after.length - 1 : 0),
    shadeFrom: after ? asset.length - 1 : undefined,
    label: after ? `${data.label} 决策前 60 个交易日与决策后 20 个交易日走势` : `${data.label} 决策前 60 个交易日走势，起点为 100`,
  });
}

export const benchmarkName = BENCHMARK_NAME;
