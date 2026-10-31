import { ROUNDS } from "../config/rounds";
import type { State } from "../state/store";
import { h } from "./dom";

/** Derive collection from locked rounds; opening the toolbar adds no evidence. */
export function methodCards(s: Pick<State, "rounds">) {
  return ROUNDS.map((r, i) => ({ ...r.method_card, acquired: s.rounds[i]?.locked === true }));
}
export function methodToolbar(s: State): HTMLElement {
  return h("section", { class: "panel stack", "aria-label": "方法卡工具栏" },
    h("h2", {class: "small"}, "我的方法卡"),
    h("p", {class: "xs muted"}, "揭晓时获得的方法，用来帮助你完成下一关；查看说明不会改变已有记录。"),
    h("div", {class: "method-tools"}, methodCards(s).map(card => card.acquired
      ? h("details", {class: "method-tool"}, h("summary", null, card.name, h("span", {class:"xs"}, " · 已获得")), h("p", {class:"xs text-2"}, card.line))
      : h("div", {class: "method-tool muted"}, card.name, h("span", {class:"xs"}, " · 尚未获得")))));
}
