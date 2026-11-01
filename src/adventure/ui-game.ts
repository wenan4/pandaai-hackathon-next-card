import { h, type Child } from "../ui/dom";
import "./battle-preview.css";
import "./ui-piles.css";
import "./game-feedback.css";
import { availableActions, canPlayCard } from "./engine";
import { battleZones, turnEnergySummary } from "./battle-information";
import { intentText, routeEnemySummary } from "./ui-enemy";
import { describeCardPlayPreview, describeCompactCardPlayPreview, previewCardPlay } from "./card-preview";
import { CARDS, ENEMIES, PRICES, ROUTES } from "./content";
import type { MarketInitialCase } from "./market";
import type { CardId, CardInstance, Run, RunAction } from "./types";
import type { PileKind } from "./ui-piles";
import type { GuideTopic } from "./ui-guide";
import { outcomeFeedback, type ActionFeedback } from "./game-feedback";
import { button, cardFace, chart, coins, dateText, deckSummary, details, metric, moneyHistory, moneyPanel, note, panel, pill } from "./ui-components";

export interface GameViewContext {
  run: Run;
  initialCase: MarketInitialCase | null;
  initialCaseError: string | null;
  initialCaseLoading: boolean;
  retryInitialCase: () => void;
  selectedCard: string | null;
  selectedRetain: string | null;
  selectedUpgrade: string | null;
  selectedReward: CardId | null;
  entryCents: number;
  reserveCents: number;
  marketLoading: boolean;
  marketError: string | null;
  battleFeedback: string;
  gameFeedback: GameReceipt | null;
  tutorialStep: number;
  action: (action: RunAction) => void;
  selectCard: (id: string | null) => void;
  selectRetain: (id: string) => void;
  selectUpgrade: (id: string) => void;
  selectReward: (id: CardId | null) => void;
  setEntry: (cents: number, render?: boolean) => void;
  setReserve: (cents: number) => void;
  retryMarket: () => void;
  extraCamp: () => Child;
  openReport: () => void;
  openTask: (task: "d1" | "d2") => void;
  openPile: (pile: PileKind) => void;
  openEnemyPlan: () => void;
  archiveShown: (view: HTMLDetailsElement, displayedRun: Run) => boolean;
  nextTutorial: () => void;
  skipTutorial: () => void;
  page?: string;
  selectPage?: (page: string) => void;
  openDetails?: (title: string, body: Child) => void;
  openGuide?: (topic?: GuideTopic) => void;
}

export interface GameReceipt {
  area: "journey" | "shop" | "free";
  result: ActionFeedback;
}

const nodeNames: Record<Run["node"], string> = { N1: "城门初遇", N2: "第一处营地", N3: "岔路 · 第一站", N4: "林间营地", N5: "岔路 · 第二站", N6: "最后的营地", N7: "守灯者的挑战", N8: "归途" };
const nodeLabels: Record<Run["node"], string> = { N1: "城门", N2: "营地", N3: "岔路", N4: "营地", N5: "岔路", N6: "营地", N7: "灯塔", N8: "归途" };
const nodes: Run["node"][] = ["N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8"];
const can = (run: Run, type: RunAction["type"]): boolean => availableActions(run).find((a) => a.type === type)?.enabled ?? false;
const shortfall = (cash: number, price: number): string | null => cash < price ? `还差 ${coins(price - cash)} 金币` : null;

export function journeyHeader(run: Run): HTMLElement {
  return h("div", { class: "journey-strip" }, h("div", { class: "journey-title" }, h("span", { class: "journey-number" }, `旅程 ${nodes.indexOf(run.node) + 1} / 8`), h("h1", null, nodeNames[run.node])),
    h("div", { class: "resource-row" }, h("div", { class: "resource" }, h("em", null, "生命"), h("b", null, `${run.hp}/${run.maxHp}`)), h("div", { class: "resource" }, h("em", null, "可用"), h("b", null, `${coins(run.wallet.cashCents)} 金币`)), run.source !== "real" && pill("模拟", "gold")));
}
function journeyOverview(run: Run): HTMLElement {
  const current = nodes.indexOf(run.node);
  return h("div", { class: "stack" }, h("div", { class: "progress-path", "aria-label": `当前位于${nodeNames[run.node]}` }, nodes.map((node, index) => h("span", { class: index === current ? "current" : index < current ? "done" : "" }, nodeLabels[node]))), moneyPanel(run), details("查看金币往来", moneyHistory(run)));
}
function screenTabs(ctx: GameViewContext, pages: { id: string; label: string; body: Child }[], initial: string): HTMLElement {
  const selected = pages.some((page) => page.id === ctx.page) ? ctx.page! : initial;
  return h("div", { class: "screen-tabs" }, h("nav", { class: "screen-tabbar", "aria-label": "切换当前页面", "data-scroll-key": "screen-tabs" }, pages.map((page) => h("button", { type: "button", class: `screen-tab${page.id === selected ? " selected" : ""}`, "aria-pressed": String(page.id === selected), "data-focus-key": `page-${page.id}`, onclick: () => ctx.selectPage?.(page.id) }, page.label))),
    ...pages.map((page) => h("section", { class: "screen-tabpage", "aria-label": page.label, hidden: page.id !== selected, inert: page.id !== selected }, page.body)));
}
function receipt(ctx: GameViewContext, area: GameReceipt["area"]): HTMLElement | null {
  if (ctx.gameFeedback?.area !== area) return null;
  const { title, detail } = ctx.gameFeedback.result;
  return h("div", { class: "game-receipt", "data-game-receipt": area, role: "status", "aria-live": "polite" }, h("strong", null, title), h("p", null, detail));
}
function battleView(ctx: GameViewContext): HTMLElement {
  const { run } = ctx; const b = run.battle!; const enemy = b.enemy; const def = ENEMIES[enemy.id];
  const selected = run.deck.find((card) => card.instanceId === ctx.selectedCard && b.hand.includes(card.instanceId));
  const otherCards = b.hand.map((id) => run.deck.find((card) => card.instanceId === id)).filter((card): card is CardInstance => !!card && card.instanceId !== selected?.instanceId);
  const isRetain = selected?.cardId === "C14";
  const retained = otherCards.find((card) => card.instanceId === ctx.selectedRetain) ?? otherCards[0];
  const preview = selected ? previewCardPlay(run, selected.instanceId, isRetain ? retained?.instanceId : undefined) : null;
  const reason = preview && !preview.enabled ? preview.reason : null;
  const hand = b.hand.map((id) => run.deck.find((card) => card.instanceId === id)).filter((card): card is CardInstance => !!card);
  const zones = battleZones(run);
  const energy = turnEnergySummary(run);
  const borrowedThisTurn = run.history.some((event) => event.type === "battle" && event.node === run.node && event.action === "play-card" && event.data.cardId === "C04" && event.data.turn === b.turn);
  const showEnergySummary = energy && (energy.overloadSettled || b.overloadNext > 0 || energy.capacity !== b.capacity || borrowedThisTurn);
  const pileButton = (pile: "draw" | "discard" | "exhaust", label: string): HTMLElement => {
    const total = zones?.[pile].total ?? null;
    return h("button", { type: "button", class: "battle-pile-button", "data-focus-key": `pile-${pile}`, "aria-label": `查看${label}，${total === null ? "数量未知" : `${total} 张`}`, onclick: () => ctx.openPile(pile) }, label, h("b", null, total === null ? "?" : total));
  };
  const handCard = (card: CardInstance, index: number): HTMLElement => {
    const temporary = b.retainedOnce?.includes(card.instanceId) ?? false;
    const permanent = CARDS[card.cardId].retain;
    const label = permanent && temporary ? "保留至打出 · 本次也保留" : permanent ? "保留至打出" : temporary ? "本次结束后保留" : undefined;
    const face = cardFace(card, { selected: selected?.instanceId === card.instanceId, onClick: () => ctx.selectCard(card.instanceId), key: `card-${card.instanceId}`, label });
    if (label) {
      const id = `hand-retain-${index}`;
      const description = permanent && temporary ? "此牌会保留至打出，本回合结束也获得了一次保留。" : permanent ? "此牌会留在手中，直到打出。" : "此牌在本回合结束后保留一次；之后除非再次获得保留，否则会弃置。";
      face.setAttribute("data-retain", permanent ? "permanent" : "once"); face.setAttribute("aria-describedby", id);
      face.append(h("span", { id, class: "pile-sr-only" }, description));
    }
    return face;
  };
  const intent = intentText(enemy.intent);
  const art = enemy.id === "moss" ? "moss" : enemy.id === "clock" ? "clock" : "guardian";
  const playable = hand.filter((card) => canPlayCard(run, card.instanceId).enabled);
  const hasAttack = playable.some((card) => CARDS[card.cardId].attack);
  const drawNames = [...new Set(playable.filter((card) => card.cardId === "C03" || card.cardId === "C06").map((card) => CARDS[card.cardId].name))];
  const canShield = playable.some((card) => card.cardId === "C02" || card.cardId === "C06");
  const noAttackOptions = [drawNames.length ? `用${drawNames.join("或")}找牌` : "", canShield ? "先防护" : ""].filter(Boolean);
  const noAttackTip = `眼下没有可打的攻击牌；${noAttackOptions.length ? `可以${noAttackOptions.join("，或")}` : "可以先打其他可用牌"}，也可以结束回合。`;
  const lessons = [
    ["先看意图", `中间会提前显示对方准备攻击还是获得护盾。${hasAttack ? "" : noAttackTip}`],
    ["选择手牌", hasAttack ? "点一张牌查看效果；手机上可左右滑动手牌。" : noAttackTip],
    ["确认打出", "再点“打出”，留意这张牌需要多少能量。"],
    ["结束回合", "结束后对方行动；下回合恢复能量，未保留手牌进入弃牌堆，之后还能再抽到。"],
  ] as const;
  const lesson = run.source === "real" && run.node === "N1" ? lessons[ctx.tutorialStep] : undefined;
  const play = (): void => { if (selected) ctx.action({ type: "play-card", cardInstanceId: selected.instanceId, ...(isRetain && retained ? { retainCardId: retained.instanceId } : {}) }); };
  const retainSelect = (mobile = false): HTMLElement | null => isRetain && otherCards.length ? h("label", { class: "field retain-field" }, "保留另一张牌一回合", h("select", { value: retained?.instanceId, "data-focus-key": mobile ? "retain-select-mobile" : "retain-select-desktop", onchange: (event: Event) => ctx.selectRetain((event.currentTarget as HTMLSelectElement).value) }, otherCards.map((card) => h("option", { value: card.instanceId, selected: card.instanceId === retained?.instanceId }, `${CARDS[card.cardId].name}${card.upgraded ? "+" : ""}`)))) : null;
  const previewBlock = (mobile = false): HTMLElement | null => preview ? h("div", { class: `card-play-preview${mobile ? " compact" : ""}`, role: "note", "aria-label": "出牌效果预览", ...(mobile ? { tabindex: "0" } : {}) }, h("strong", null, "打出后预览"), h("ul", null, (mobile ? describeCompactCardPlayPreview(preview) : describeCardPlayPreview(preview)).map((line) => h("li", null, line)))) : null;
  const box = h("div", { class: "stack battle-stage" },
    h("section", { class: "battle-board", "aria-label": `第 ${b.turn} 回合，${def.name}本回合结束时准备${intent}` },
      h("div", { class: "battle-player" }, h("div", { class: "avatar player", "aria-hidden": "true" }, h("picture", null, h("source", { srcset: `${import.meta.env.BASE_URL}art/adventure/traveler.webp`, type: "image/webp" }), h("img", { src: `${import.meta.env.BASE_URL}art/adventure/traveler.png`, alt: "", width: "1024", height: "1536" }))), h("div", { class: "combat-label" }, h("strong", null, "旅行者"), `生命 ${run.hp} / ${run.maxHp} · 护盾 ${b.shield}`), h("div", { class: "health-bar" }, h("i", { style: `width:${Math.max(0, run.hp / run.maxHp * 100)}%` }))),
      h("div", { class: "intent" }, h("small", null, "本回合结束"), h("strong", null, intent), enemy.attackBonus ? h("div", { class: "tiny" }, `攻击加成 +${enemy.attackBonus}`) : null, h("button", { type: "button", class: "intent-plan-button", "data-focus-key": "enemy-plan", "aria-label": `查看${def.name}的行动节奏`, onclick: ctx.openEnemyPlan }, "查看节奏")),
      h("div", { class: "battle-enemy" }, h("div", { class: "avatar enemy", "aria-hidden": "true", style: `background-image:url('${import.meta.env.BASE_URL}art/adventure/${art}.webp')` }), h("div", { class: "combat-label" }, h("strong", null, def.name), `生命 ${enemy.hp} / ${enemy.maxHp} · 护盾 ${enemy.shield}`), h("div", { class: "health-bar" }, h("i", { style: `width:${Math.max(0, enemy.hp / enemy.maxHp * 100)}%` })))),
    h("div", { class: `combat-feedback${ctx.battleFeedback ? " flash" : ""}` },
      run.node === "N1" ? button(lesson ? "新手教学 · 点这里学会玩" : "重看新手教学", () => ctx.openGuide?.("battle"), "small secondary", false, "tutorial-open") : null,
      h("p", { class: "combat-feedback-line", role: "status", "aria-live": "polite" }, ctx.battleFeedback || (run.node === "N1" ? "" : `第 ${b.turn} 回合 · 看意图 → 选牌 → 打出`))),
    h("div", { class: "battle-status" }, h("div", { class: "battle-stat" }, h("span", null, "现在可用能量"), h("b", null, b.energy)), h("div", { class: "battle-stat" }, h("span", null, "本场容量"), h("b", null, `${b.capacity} / 6`)), h("div", { class: "battle-stat" }, h("span", null, "下回合锁定"), h("b", null, b.overloadNext))),
    showEnergySummary ? h("p", { class: "battle-energy-summary" }, `本回合开始恢复 ${energy.restoredEnergy}/${energy.capacity}${energy.overloadSettled ? `，已结算过载 ${energy.locked}` : "，上回合无过载"}。`) : null,
    h("section", { class: "panel stack battle-hand-panel" }, h("div", { class: "panel-head" }, h("div", null, h("div", { class: "eyebrow" }, `TURN ${String(b.turn).padStart(2, "0")}`), h("h2", null, "选择一张手牌"), h("p", { class: "hint" }, "先看对方意图，再选择卡牌。点击卡牌查看效果。"))),
      h("div", { class: "battle-pile-counts", role: "group", "aria-label": "查看战斗牌区" }, pileButton("draw", "抽牌堆"), pileButton("discard", "弃牌堆"), pileButton("exhaust", "消耗区")),
      h("p", { class: "hand-swipe-hint" }, "左右滑动查看全部手牌"),
      h("div", { class: "hand", "data-scroll-key": "battle-hand", tabindex: "0", "aria-label": "手牌，可左右滚动" }, hand.map(handCard)),
      selected ? h("div", { class: "notice battle-selection" }, h("strong", null, `${CARDS[selected.cardId].name}${selected.upgraded ? "+" : ""} · ${selected.upgraded ? CARDS[selected.cardId].upgradedCost : CARDS[selected.cardId].cost} 能量`), h("p", null, selected.upgraded ? CARDS[selected.cardId].upgradedDescription : CARDS[selected.cardId].description),
        retainSelect(),
        previewBlock(),
        h("div", { class: "button-row", style: "margin-top:10px" }, button("打出这张牌", play, "small", !!reason, "play-card"), button("收起", () => ctx.selectCard(null), "small ghost"))) : null,
      h("div", { class: "combat-actions" }, h("span", { class: "hint" }, `第 ${b.turn} 回合 · ${def.blurb}`), button("结束回合", () => ctx.action({ type: "end-turn" }), "gold", false, "end-turn")),
      button("最近动作", () => ctx.openDetails?.("战斗记录", h("div", { class: "timeline" }, b.log.slice(-6).reverse().map((line) => h("p", null, line)))), "small ghost")),
    h("div", { class: "battle-dock", "aria-label": "战斗操作" }, h("div", { class: "dock-info" }, h("strong", null, selected ? `已选 ${CARDS[selected.cardId].name}${selected.upgraded ? "+" : ""}` : "选择一张手牌"), selected ? previewBlock(true) : h("span", null, "查看效果后打出，也可结束回合")), retainSelect(true), h("div", { class: "dock-buttons" }, button("打出", play, "small", !selected || !!reason, "play-card-mobile"), button("结束回合", () => ctx.action({ type: "end-turn" }), "small gold", false, "end-turn-mobile"))));
  return box;
}
function rewardView(ctx: GameViewContext): HTMLElement {
  const { run } = ctx; const reward = run.reward!;
  const selected = ctx.selectedReward && reward.choices.includes(ctx.selectedReward) ? ctx.selectedReward : null;
  const ideas = run.node === "N1" ? h("div", { class: "reward-ideas" }, h("div", null, h("strong", null, "连刃 + 余烬"), h("p", null, "营地可用 25 金币买余烬。先打余烬再打连刃，三段伤害合计从 9 变成 15。")), h("div", null, h("strong", null, "培育 → 大牌"), h("p", null, "培育增加空容量；下回合容量达到 4，能量足够时可尝试营地里的参天一击。"))) : null;
  return panel("把新牌带上旅程", `胜利获得 ${coins(reward.coinsCents)} 金币。先选择并比较卡牌，再确认加入，或选择不拿牌。`, ctx.battleFeedback ? note(ctx.battleFeedback) : null,
    h("p", { class: "reward-swipe-hint" }, "左右滑动可比较全部奖励牌。"),
    h("div", { class: "hand reward-choices", "data-scroll-key": "reward-choices", tabindex: "0", "aria-label": "奖励牌，可左右滚动比较" }, reward.choices.map((id) => cardFace({ cardId: id, upgraded: false }, { selected: selected === id, label: selected === id ? "已选 · 待确认" : "点击查看", onClick: () => ctx.selectReward(selected === id ? null : id), key: `reward-${id}` }))),
    h("div", { class: "reward-selection", role: "status", "aria-live": "polite" }, selected ? h("p", null, h("strong", null, `已选 ${CARDS[selected].name}，尚未加入牌组。`), ` ${CARDS[selected].description}`) : h("p", null, "尚未选择奖励牌。点击卡牌查看，不会立即加入。")),
    h("div", { class: "button-row reward-actions" }, button(selected ? `确认加入 ${CARDS[selected].name}` : "确认加入所选牌", () => { if (selected) ctx.action({ type: "choose-reward", cardId: selected }); }, "", !selected, "confirm-reward"), selected ? button("取消选择", () => ctx.selectReward(null), "secondary", false, "cancel-reward") : null, button("这次不拿牌", () => ctx.action({ type: "choose-reward", cardId: null }), "secondary", false, "skip-reward")),
    ideas ? button("新牌怎么配合？", () => ctx.openDetails?.("试试这两种组合", ideas), "small ghost") : null);
}
function selectUpgrade(ctx: GameViewContext, baseOnly = false): { field: HTMLElement; selected: CardInstance | undefined } {
  const candidates = ctx.run.deck.filter((card) => !card.upgraded && (!baseOnly || Number(card.cardId.slice(1)) <= 6));
  const selected = candidates.find((card) => card.instanceId === ctx.selectedUpgrade) ?? candidates[0];
  return { selected, field: h("label", { class: "field" }, "选择要升级的牌", h("select", { value: selected?.instanceId ?? "", disabled: !candidates.length, "data-focus-key": baseOnly ? "free-upgrade-select" : "upgrade-select", onchange: (event: Event) => ctx.selectUpgrade((event.currentTarget as HTMLSelectElement).value) }, candidates.map((card) => {
    const sameName = ctx.run.deck.filter((item) => item.cardId === card.cardId);
    const ordinal = sameName.findIndex((item) => item.instanceId === card.instanceId) + 1;
    return h("option", { value: card.instanceId, selected: card.instanceId === selected?.instanceId }, `${CARDS[card.cardId].name} · 第 ${ordinal} 张`);
  })), selected ? h("span", { class: "hint" }, `升级前：${CARDS[selected.cardId].description} 升级后：${CARDS[selected.cardId].upgradedDescription}${CARDS[selected.cardId].cost !== CARDS[selected.cardId].upgradedCost ? ` 费用 ${CARDS[selected.cardId].cost} → ${CARDS[selected.cardId].upgradedCost}` : ""}`) : h("span", { class: "hint" }, "没有可升级的牌。")) };
}
function item(title: string, description: string, action: HTMLElement, unavailable: string | null = null): HTMLElement {
  return h("div", { class: "item" }, h("div", null, h("strong", null, title), h("p", null, description)), h("div", { class: "item-actions" }, action, unavailable ? h("small", null, unavailable) : null));
}
function shop(ctx: GameViewContext, roadside = false, section: "supplies" | "cards" | "archive" = "supplies"): HTMLElement {
  const { run } = ctx; const upgrade = selectUpgrade(ctx); const cash = run.wallet.cashCents;
  const healingShortfall = shortfall(cash, PRICES.healCents); const upgradeShortfall = shortfall(cash, PRICES.upgradeCents);
  const supplyOpen = can(run, "purchase-attempted");
  const canHeal = supplyOpen && run.hp < run.maxHp;
  const canUpgrade = supplyOpen && !!upgrade.selected;
  return h("section", { class: `panel stack shop-${section}` }, h("div", { class: "panel-head" }, h("div", null, h("h2", null, roadside ? "路边补给" : section === "cards" ? "买一张新牌" : section === "archive" ? "历史档案 · 决定前多看一步" : "补给与升级"), h("p", { class: "hint" }, roadside ? "补生命或升级一张牌，也可以直接选路。" : `现在可用 ${coins(cash)} 金币${run.supplyPlanCents !== null ? ` · 计划留 ${coins(run.supplyPlanCents)} 给补给` : ""}`))),
    receipt(ctx, "shop"),
    section === "supplies" ? h("div", { class: "item-list" }, item("热茶与补给", `恢复 ${Math.min(10, run.maxHp - run.hp)} 生命 · 10 金币`, button(healingShortfall ? "尝试补充" : "补充生命", () => ctx.action(healingShortfall ? { type: "purchase-attempted", purchase: "heal" } : { type: "heal" }), "small secondary", !canHeal, "heal"), healingShortfall ?? (run.hp >= run.maxHp ? "生命已满" : !supplyOpen ? "先完成金币安排" : null)),
      item("整理装备", "升级一张牌 · 20 金币", button(upgradeShortfall ? "尝试升级" : "确认升级", () => { if (upgrade.selected) ctx.action(upgradeShortfall ? { type: "purchase-attempted", purchase: "upgrade-card", cardInstanceId: upgrade.selected.instanceId } : { type: "upgrade-card", cardInstanceId: upgrade.selected.instanceId }); }, "small secondary", !canUpgrade, "upgrade"), upgradeShortfall ?? (!supplyOpen ? "先完成当前结算" : null))) : null,
    section === "supplies" ? upgrade.field : null,
    !roadside && run.camp && section === "cards" ? h("div", { class: "shop-card-rail", "data-scroll-key": "shop-cards", "aria-label": "左右滑动查看商品" }, run.camp.stock.map((cardId) => {
      const purchased = run.camp!.purchased.includes(cardId); const missing = shortfall(cash, PRICES.cardCents);
      return h("article", { class: "shop-card-offer" }, cardFace({ cardId, upgraded: false }, { disabled: true, label: "购买后加入牌组" }), button(purchased ? "已购买" : missing ? "尝试购买" : "购买 · 25 金币", () => ctx.action(missing ? { type: "purchase-attempted", purchase: "buy-card", cardId } : { type: "buy-card", cardId }), "small secondary", purchased || !supplyOpen, `buy-${cardId}`), h("p", { class: "fineprint" }, purchased ? "已加入牌组" : missing ?? `购买后剩 ${coins(cash - PRICES.cardCents)} 金币`));
    })) : null,
    section === "cards" ? h("p", { class: "fineprint" }, "左右滑动比较卡牌；每件本营地限购一次。") : null,
    !roadside && section === "archive" ? h("div", { class: "stack" }, !run.archiveOwned ? h("p", { class: "hint" }, "花 4 金币查看更长的历史走势和同期市场对照，帮助你决定要不要参与、投入多少。购买后在这里翻开。") : null, !run.archiveOwned ? h("p", { class: "fineprint" }, "只包含起点以前的资料，不会揭晓下一段价格。") : null, !run.archiveOwned ? button(cash < PRICES.archiveCents ? "尝试购买档案" : "购买档案 · 4 金币", () => ctx.action(cash < PRICES.archiveCents ? { type: "purchase-attempted", purchase: "buy-archive" } : { type: "buy-archive" }), "secondary", !supplyOpen, "archive") : archiveView(ctx)) : null);
}
function archiveView(ctx: GameViewContext): HTMLElement {
  const c = ctx.initialCase?.caseId === ctx.run.caseId ? ctx.initialCase : null;
  if (!c) return ctx.initialCaseError ? h("div", { class: "stack" }, note(`历史档案暂时无法加载：${ctx.initialCaseError}`, true), button("重试加载档案", ctx.retryInitialCase, "small secondary", ctx.initialCaseLoading)) : h("p", { class: "hint", role: "status" }, "正在加载本局已固定案例的历史档案……");
  const a = c.history.asset; const b = c.history.benchmark;
  const view = details("翻开已购买的历史档案", h("p", { class: "hint" }, `截至 ${dateText(c.decisionDate)} 的资料；绿色为案例资产，金色为${c.benchmark}。两条线各自从同一起点比较，不包含未来行情。`), chart(a, b, "案例资产与同期基准的历史走势"), h("div", { class: "metric-grid" }, metric("案例这一段", `${((a.at(-1)! / a[0]! - 1) * 100).toFixed(1)}%`), metric("同期基准", `${((b.at(-1)! / b[0]! - 1) * 100).toFixed(1)}%`)));
  view.setAttribute("data-archive-view", "true");
  view.addEventListener("toggle", () => { if (!ctx.archiveShown(view, ctx.run)) return; if (!ctx.run.history.some((event) => event.action === "open-archive")) ctx.action({ type: "open-archive" }); });
  return view;
}
function entryPanel(ctx: GameViewContext): HTMLElement {
  const { run } = ctx;
  if (run.market.entryCommitted) return panel("金币安排好了", `投资预留 ${coins(run.wallet.reservedCents)} 金币，当前还有 ${coins(run.wallet.cashCents)} 可用于消费。`, h("p", { class: "hint" }, "下一站会揭晓价格变化。现在可以去买牌、补给，或直接出发。"), h("div", { class: "button-row" }, button("去买牌", () => ctx.selectPage?.("cards"), "secondary"), button("补给与升级", () => ctx.selectPage?.("supplies"), "secondary")), button("记录一下预期（可选）", () => ctx.selectPage?.("thoughts"), "small ghost", !run.observationEnabled || run.wallet.reservedCents === 0));
  const cash = run.wallet.cashCents; const initial = Math.min(cash, Math.max(0, ctx.entryCents));
  const input = h("input", { type: "number", min: "0", max: String(cash / 100), step: "0.01", value: String(initial / 100), "data-focus-key": "entry-amount", "aria-describedby": "entry-preview" });
  const preview = h("p", { class: "notice", id: "entry-preview" }, `用于投资 ${coins(initial)} · 留在手中 ${coins(cash - initial)} 金币`);
  const submit = button(initial ? `确认参与 ${coins(initial)} 金币` : "不参与，保留金币", () => ctx.action({ type: "submit-entry", amountCents: Math.max(0, Math.min(cash, Math.round((Number(input.value) || 0) * 100))) }), "gold", !can(run, "submit-entry"), "entry-submit");
  input.addEventListener("input", () => { const amount = Math.max(0, Math.min(cash, Math.round((Number(input.value) || 0) * 100))); ctx.setEntry(amount); preview.textContent = `用于投资 ${coins(amount)} · 留在手中 ${coins(cash - amount)} 金币`; submit.textContent = amount ? `确认参与 ${coins(amount)} 金币` : "不参与，保留金币"; });
  return panel("随行投资 · 金币怎样分配？", "拿一部分金币随价格涨跌，下一营地再决定是否取回。也可以选择 0，把金币都留在手中。",
    h("p", { class: "hint" }, "同一份金币：买牌 25、升级 20、补生命 10。先想好留多少给旅途。"),
    h("div", { class: "selection-row" }, [0, 25, 50, 75].map((pct) => button(`${pct}%`, () => ctx.setEntry(Math.floor(cash * pct / 100), true), "small secondary"))),
    h("label", { class: "field" }, "参与金额（金币）", input), preview, submit,
    h("div", { class: "button-row" }, button("先看看历史档案", () => ctx.selectPage?.("archive"), "small ghost"), button("这笔投资怎么玩？", () => ctx.openGuide?.("money"), "small ghost")));
}
function redemptionPanel(ctx: GameViewContext): HTMLElement {
  const { run } = ctx; const decision = run.camp!.decision;
  const settled = run.wallet.ledger.filter((entry) => entry.node === run.node && entry.kind === "redemption").at(-1);
  const value = run.market.referenceValueCents;
  const choice = run.history.filter((event) => event.node === run.node && event.action === "submit-redemption").at(-1);
  const sold = typeof choice?.data.shareUnits === "string" && /[1-9]/.test(choice.data.shareUnits);
  const change = value === null ? null : value - run.wallet.costBasisCents;
  const cash = run.wallet.cashCents;
  const buying = [cash >= PRICES.cardCents ? "买牌" : "", cash >= PRICES.upgradeCents ? "升级" : "", cash >= PRICES.healCents ? "补生命" : ""].filter(Boolean);
  const spending = h("p", { class: "hint" }, buying.length ? `手中金币足够${buying.join("、")}；按需要选择。` : `手中 ${coins(cash)} 金币，补生命需 10、升级需 20、买牌需 25。`);
  if (decision === "settled") return panel("这一站安排好了", settled && sold ? `本次回收到账 ${coins(settled.cashDeltaCents)} 金币。现在可用 ${coins(cash)}。` : `本次没有回收份额，当前可用 ${coins(cash)} 金币。`, moneyPanel(run), spending, button("去挑选补给", () => ctx.selectPage?.("supplies"), "secondary"));
  if (decision === "awaiting-execution") return panel("正在办理回收", "按下一次报价执行，完成后直接显示到账金额。");
  return panel("随行投资 · 这一站的变化", value === null ? "正在等待本阶段价格。" : `剩余份额价值 ${coins(value)} 金币${change === null ? "" : `，相对其投入${change >= 0 ? "增加" : "减少"} ${coins(Math.abs(change))}${run.wallet.costBasisCents > 0 ? `（${(change / run.wallet.costBasisCents * 100).toFixed(1)}%）` : ""}`}。`,
    moneyPanel(run), spending, h("p", { class: "fineprint" }, "选择回收后，下一次报价会决定实际到账金额。"),
    h("div", { class: "choice-grid" }, button("继续持有", () => ctx.action({ type: "submit-redemption", percent: 0 }), "secondary", !can(run, "submit-redemption"), "redeem-0"), button("回收一半份额", () => ctx.action({ type: "submit-redemption", percent: 50 }), "secondary", !can(run, "submit-redemption"), "redeem-50"), button("全部回收", () => ctx.action({ type: "submit-redemption", percent: 100 }), "secondary", !can(run, "submit-redemption"), "redeem-100")));
}
function freeRest(ctx: GameViewContext): HTMLElement | null {
  const { run } = ctx; if (!run.camp || run.camp.node === "N2") return null;
  const upgrade = selectUpgrade(ctx, true); const used = run.camp.freeChoiceUsed;
  const healed = Math.min(6, Math.max(0, run.maxHp - run.hp));
  const alternatives = [upgrade.selected && can(run, "free-upgrade") ? "免费升级基础牌" : "", can(run, "continue") ? "直接出发" : "", can(run, "return-home") ? "提前返程" : ""].filter(Boolean);
  const fullHealth = `生命已满，暂不能休息${alternatives.length ? `；你可以${alternatives.join("，或")}` : run.camp.decision !== "settled" ? "；请先完成契约安排与结算" : ""}。`;
  return h("section", { class: "panel stack soft" }, h("div", { class: "panel-head" }, h("div", null, h("h2", null, "一次免费的整备"), h("p", { class: "hint" }, used ? "本营地的免费整备已使用。" : "休息最多恢复 6 生命，或免费升级一张基础牌；二选一。")), pill("免费")),
    receipt(ctx, "free"),
    !used ? h("div", { class: "stack" }, healed === 0 ? h("p", { class: "hint" }, fullHealth) : null, upgrade.field, h("div", { class: "button-row" }, button(`休息，恢复 ${healed} 生命`, () => ctx.action({ type: "free-rest" }), "secondary", healed === 0 || !can(run, "free-rest"), "free-rest"), button("免费升级所选牌", () => { if (upgrade.selected) ctx.action({ type: "free-upgrade", cardInstanceId: upgrade.selected.instanceId }); }, "secondary", !upgrade.selected || !can(run, "free-upgrade"), "free-upgrade"))) : null);
}
function campView(ctx: GameViewContext): HTMLElement {
  const { run } = ctx; const camp = run.camp!;
  const proceed = camp.node === "N6" ? "前往守灯者" : "继续前往岔路";
  const reserveInput = h("input", { type: "number", min: "0", max: String(run.wallet.cashCents / 100), step: "0.01", value: String(ctx.reserveCents / 100), "data-focus-key": "reserve-amount" });
  reserveInput.addEventListener("input", () => ctx.setReserve(Math.max(0, Math.round((Number(reserveInput.value) || 0) * 100))));
  const extras = ctx.extraCamp();
  const pages = [
    { id: "allocation", label: "① 安排", body: camp.node === "N2" ? entryPanel(ctx) : redemptionPanel(ctx) },
    { id: "cards", label: "买牌", body: shop(ctx, false, "cards") },
    { id: "supplies", label: "补给升级", body: shop(ctx) },
    ...(camp.node !== "N2" ? [{ id: "free", label: "免费整备", body: freeRest(ctx) }] : []),
    { id: "archive", label: "档案", body: shop(ctx, false, "archive") },
    { id: "budget", label: "预算", body: panel("补给预算", "给之后的路边补给留多少？只作备忘，不扣钱、不锁钱。", h("p", { class: "hint" }, "路边补生命需要 10 金币，升级需要 20 金币。消费后低于计划时会提醒你。"), h("label", { class: "field" }, "希望留出的金币", reserveInput), button("记录计划", () => ctx.action({ type: "set-supply-plan", amountCents: Math.max(0, Math.round((Number(reserveInput.value) || 0) * 100)) }), "secondary", !can(run, "set-supply-plan")), run.supplyPlanCents !== null ? note(`当前计划：留 ${coins(run.supplyPlanCents)} 金币。可随时修改。`) : null) },
    { id: "insight", label: "我的线索", body: panel("这一路，我怎样作选择", "回看资金安排与信息使用，也可以做一个短练习。", button("我的交易风格 · 本局画像", ctx.openReport, "gold"), button("试试资金安排", () => ctx.openTask("d1"), "secondary"), button("试试历史比较", () => ctx.openTask("d2"), "secondary")) },
    ...(extras ? [{ id: "thoughts", label: "预期与感受", body: extras }] : []),
  ];
  return h("div", { class: "camp-stage" }, screenTabs(ctx, pages, "allocation"),
    h("div", { class: "stage-actions" }, !can(run, "continue") ? h("p", { class: "fineprint" }, camp.node === "N2" ? "先完成金币安排；选 0 也能继续。" : "先完成这一站的持有或回收安排。") : h("p", { class: "fineprint" }, "准备好了就出发，也可以先买牌或补给。"),
      h("div", { class: "button-row" }, button(proceed, () => ctx.action({ type: "continue" }), "", !can(run, "continue"), "camp-continue"), camp.node === "N6" ? button("提前返程", () => ctx.action({ type: "return-home" }), "secondary", !can(run, "return-home"), "return-home") : null)));
}
function routeView(ctx: GameViewContext): HTMLElement {
  const { run } = ctx; const routes = ROUTES[run.node as "N3" | "N5"];
  return screenTabs(ctx, [
    { id: "routes", label: "选路 · 左右比较", body: panel("选择接下来的路", "先看对手特点和奖励；也可切换到路边补给。", h("div", { class: "route-grid", "data-scroll-key": "routes" }, routes.map((route, index) => h("article", { class: "route-card" }, h("div", { class: "route-symbol" }, index === 0 ? "Ⅰ" : "Ⅱ"), h("h3", null, route.name), h("p", { class: "hint" }, route.description), routeEnemySummary(route.enemyId), pill(`胜利奖励 ${coins(route.rewardCents)} 金币`, "gold"), button("选择这条路", () => ctx.action({ type: "choose-route", enemyId: route.enemyId }), "secondary", !can(run, "choose-route"), `route-${route.enemyId}`))))) },
    { id: "supplies", label: "路边补给", body: shop(ctx, true) },
  ], "routes");
}
function marketView(ctx: GameViewContext): HTMLElement {
  const quoteError = ctx.marketError?.replace(/[。.!！]+$/, "");
  if (ctx.run.status !== "active") {
    const outcome = outcomeFeedback(ctx.run);
    const preserved = ctx.run.market.order ? "结局和已锁定的订单保持不变，重试不会重复提交订单。" : "结局和当前进度保持不变。";
    return panel(outcome.title, outcome.summary,
      outcome.lastOpponent ? h("p", { class: "hint" }, `最近面对：${outcome.lastOpponent}。`) : null,
      outcome.defeatBlow ? h("p", { class: "hint" }, outcome.defeatBlow) : null,
      outcome.settlementText ? h("div", { class: "notice", role: "status" }, outcome.settlementText) : null,
      ctx.marketError ? note(`报价未能完成处理：${quoteError}。${preserved}`, true) : h("p", { class: "hint" }, ctx.run.market.order ? "正在加载所需报价，已锁定的订单不会重复提交。" : "正在加载所需报价，当前进度已保留。"),
      ctx.marketError ? button("重新加载", ctx.retryMarket, "", ctx.marketLoading, "retry-market") : null);
  }
  return panel(ctx.marketError ? "这段旅程暂时停在这里" : "翻到旅程的下一页", ctx.marketError ? "报价未能完成处理。已提交的选择和当前进度都保留着。" : "正在按旅程顺序加载这一阶段的报价……", ctx.marketError ? note(ctx.marketError, true) : h("div", { class: "notice", role: "status" }, ctx.run.market.order ? "稍等片刻，已经锁定的订单不会重复提交。" : "稍等片刻，当前进度已保留。"), ctx.marketError ? button("重新加载", ctx.retryMarket, "", ctx.marketLoading, "retry-market") : null);
}
export function gameView(ctx: GameViewContext): HTMLElement {
  const { run } = ctx;
  let main: HTMLElement;
  switch (run.phase) {
    case "battle": main = battleView(ctx); break;
    case "reward": main = rewardView(ctx); break;
    case "camp": main = campView(ctx); break;
    case "route": main = routeView(ctx); break;
    case "market": main = marketView(ctx); break;
    case "ended": main = h("div"); break;
  }
  return h("div", { class: `app-shell journey-shell phase-${run.phase}` }, journeyHeader(run),
    h("nav", { class: "journey-tools", "aria-label": "旅程工具" }, button("地图与金币", () => ctx.openDetails?.("旅程与金币", journeyOverview(run)), "small ghost"), button(`牌组 · ${run.deck.length} 张`, () => ctx.openDetails?.("随行牌组", h("div", { class: "stack" }, deckSummary(run), h("div", { class: "deck-card-rail" }, [...new Map(run.deck.map((card) => [`${card.cardId}-${card.upgraded}`, card])).values()].map((card) => cardFace(card, { disabled: true }))))), "small ghost"), button("我的交易风格", ctx.openReport, "small ghost")),
    h("div", { class: "page-grid" }, h("main", { class: "main-column", id: "main-content" }, receipt(ctx, "journey"), main)));
}
export { nodeNames };
