import "./ui-piles.css";
import { h } from "../ui/dom";
import { battleZones, type BattleZoneSummary, type BattleZones } from "./battle-information";
import { CARDS } from "./content";
import type { Run } from "./types";

export type PileKind = keyof BattleZones;
const pileNames: Record<PileKind, string> = { hand: "手牌", draw: "抽牌堆", discard: "弃牌堆", exhaust: "消耗区", deck: "完整牌组" };
const pileOrder: PileKind[] = ["hand", "draw", "discard", "exhaust", "deck"];
const countText = (zone: BattleZoneSummary): string => zone.total === null ? "数量未知" : `${zone.total} 张`;
const pileNotes: Record<PileKind, string> = { hand: "保留牌在回合结束时留在手中。", draw: "需要继续抽牌且抽牌堆为空时，才会把弃牌洗回。", discard: "需要继续抽牌且抽牌堆为空时，才会把弃牌洗回。", exhaust: "消耗牌本场不再抽到，下一场战斗回到牌组。", deck: "完整牌组包含本场各区域中的牌。" };

function cardList(kind: PileKind, zone: BattleZoneSummary): HTMLElement {
  const warning = !zone.complete ? h("p", { class: "pile-warning" }, kind === "draw" ? "当前抽牌堆组成无法确认，不会猜测或显示摸牌顺序。" : "部分牌无法确认，以下只显示可确认的牌。") : null;
  return h("div", { class: "pile-content" }, h("div", { class: "pile-heading" }, h("h3", null, pileNames[kind]), h("span", null, countText(zone))), h("p", { class: "pile-intro" }, pileNotes[kind]), warning,
    zone.groups.length ? h("ul", { class: "pile-card-list", tabindex: "0", "aria-label": `${pileNames[kind]}组成，可滚动` }, zone.groups.map((group) => {
      const def = CARDS[group.cardId];
      const retain = kind !== "hand" ? null : [group.retainedPermanent ? `保留至打出 ${group.retainedPermanent} 张` : "", group.retainedOnce ? `本次结束后保留 ${group.retainedOnce} 张` : ""].filter(Boolean).join("；");
      return h("li", { class: "pile-card" }, h("div", { class: "pile-card-copy" }, h("div", { class: "pile-card-title" }, h("strong", null, `${def.name}${group.upgraded ? "+" : ""}`), h("span", { class: "pile-card-cost" }, `${group.upgraded ? def.upgradedCost : def.cost} 能量`)), h("p", null, group.upgraded ? def.upgradedDescription : def.description), retain ? h("p", { class: "pile-retain" }, retain, group.retainedPermanent && group.retainedOnce ? "（可能是同一张）" : null) : null), h("span", { class: "pile-card-count", "aria-label": `${group.count} 张` }, `×${group.count}`));
    })) : zone.complete ? h("p", { class: "pile-empty" }, "这里暂时没有牌。") : null);
}

/** Read-only snapshot. The only mutable state is which grouping is currently visible. */
export function pileView(run: Run, initialPile: PileKind): HTMLElement {
  const zones = battleZones(run);
  if (!zones) return h("div", { class: "pile-view" }, h("p", { class: "pile-warning" }, "当前没有可查看的战斗牌区。"));
  const content = h("div", { class: "pile-content-host", "aria-live": "polite" });
  const tabs = new Map<PileKind, HTMLButtonElement>();
  const select = (kind: PileKind): void => {
    for (const [value, tab] of tabs) { tab.setAttribute("aria-pressed", String(value === kind)); tab.setAttribute("class", `pile-tab${value === kind ? " selected" : ""}`); }
    content.replaceChildren(cardList(kind, zones[kind]));
  };
  const controls = h("div", { class: "pile-tabs", role: "group", "aria-label": "选择要查看的牌区" }, pileOrder.map((kind) => {
    const tab = h("button", { type: "button", class: "pile-tab", "data-focus-key": `pile-view-${kind}`, "aria-pressed": "false", onclick: () => select(kind) }, pileNames[kind]);
    tabs.set(kind, tab); return tab;
  }));
  select(pileOrder.includes(initialPile) ? initialPile : "hand");
  return h("div", { class: "pile-view" }, h("p", { class: "pile-intro" }, "这里只查看组成，不能出牌；按卡牌与升级分组，不显示抽牌顺序。"), controls, content);
}
