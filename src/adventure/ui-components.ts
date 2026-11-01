import { h, type Child } from "../ui/dom";
import { CARDS } from "./content";
import type { CardId, CardInstance, Run } from "./types";

export const coins = (cents: number): string => (cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
export const dateText = (date: string): string => /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}` : date;
export const percent = (value: number): string => `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
export const button = (label: string, click: () => void, variant = "", disabled = false, key?: string): HTMLButtonElement => h("button", { type: "button", class: `button ${variant}`.trim(), disabled, "data-focus-key": key, onclick: click }, label);
export const pill = (label: string, variant = ""): HTMLElement => h("span", { class: `pill ${variant}` }, label);
export const panel = (title: string, subtitle: string | null, ...children: Child[]): HTMLElement => h("section", { class: "panel stack" }, h("div", { class: "panel-head" }, h("div", null, h("h2", null, title), subtitle && h("p", { class: "hint" }, subtitle))), ...children);
export const note = (content: Child, error = false): HTMLElement => h("div", { class: `notice${error ? " error" : ""}` }, content);
export const metric = (label: string, value: string): HTMLElement => h("div", { class: "metric" }, h("span", null, label), h("b", null, value));
export const details = (label: string, ...content: Child[]): HTMLDetailsElement => h("details", null, h("summary", null, label), ...content);

const symbols: Record<CardId, string> = { C01: "击", C02: "盾", C03: "序", C04: "火", C05: "芽", C06: "步", C07: "刃", C08: "烬", C09: "雷", C10: "垒", C11: "育", C12: "树", C13: "望", C14: "候" };
export function cardFace(card: CardInstance | { cardId: CardId; upgraded: boolean }, options: { onClick?: () => void; selected?: boolean; disabled?: boolean; label?: string; key?: string } = {}): HTMLElement {
  const def = CARDS[card.cardId];
  const cost = card.upgraded ? def.upgradedCost : def.cost;
  return h("button", { type: "button", class: `game-card${options.selected ? " selected" : ""}`, disabled: options.disabled, "aria-pressed": options.selected === undefined ? undefined : String(options.selected), "aria-label": `${def.name}${card.upgraded ? "，已升级" : ""}，费用 ${cost}。${card.upgraded ? def.upgradedDescription : def.description}`, "data-focus-key": options.key, onclick: options.onClick },
    h("span", { class: "card-cost" }, cost), h("span", { class: "card-symbol", "aria-hidden": "true" }, symbols[card.cardId]), h("span", { class: "card-name" }, `${def.name}${card.upgraded ? "+" : ""}`),
    h("span", { class: "card-description" }, card.upgraded ? def.upgradedDescription : def.description), h("span", { class: "card-foot" }, options.label ?? (def.retain ? "保留至打出" : def.exhaust ? "本场消耗" : "点击查看")));
}
export function deckSummary(run: Run): HTMLElement {
  const groups = new Map<string, number>();
  for (const card of run.deck) { const name = `${CARDS[card.cardId].name}${card.upgraded ? "+" : ""}`; groups.set(name, (groups.get(name) ?? 0) + 1); }
  return h("p", { class: "hint" }, [...groups].map(([name, count]) => `${name} ×${count}`).join(" · "));
}
export function moneyPanel(run: Run): HTMLElement {
  const row = (label: string, value: string): HTMLElement => h("div", { class: "ledger-row" }, h("span", null, label), h("strong", null, value));
  return h("div", { class: "ledger" }, row("可用金币", coins(run.wallet.cashCents)), row("待执行金额", coins(run.wallet.reservedCents)), row("投资当前价值", run.market.referenceValueCents === null ? "尚未揭晓" : coins(run.market.referenceValueCents)));
}
export function moneyHistory(run: Run): HTMLElement {
  return h("div", { class: "timeline" }, run.wallet.ledger.map((entry) => h("div", { class: "timeline-item" }, h("strong", null, entry.description), h("p", null, `${entry.cashDeltaCents > 0 ? "+" : ""}${coins(entry.cashDeltaCents)} 金币 · 之后可用 ${coins(entry.cashAfterCents)}`))));
}
export function chart(values: number[], comparison?: number[], label = "历史走势"): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", "0 0 500 130"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", label); svg.setAttribute("width", "100%"); svg.setAttribute("height", "130");
  const all = [...values, ...(comparison ?? [])]; const lo = Math.min(...all); const hi = Math.max(...all); const range = Math.max(1, hi - lo);
  for (const [i, series] of [values, ...(comparison ? [comparison] : [])].entries()) {
    const line = document.createElementNS(ns, "polyline");
    line.setAttribute("fill", "none"); line.setAttribute("stroke", i ? "#d4aa6f" : "#74a180"); line.setAttribute("stroke-width", "3"); line.setAttribute("stroke-linejoin", "round"); line.setAttribute("stroke-linecap", "round");
    line.setAttribute("points", series.map((v, index) => `${8 + index / Math.max(1, series.length - 1) * 484},${120 - (v - lo) / range * 108}`).join(" ")); svg.append(line);
  }
  return svg;
}
