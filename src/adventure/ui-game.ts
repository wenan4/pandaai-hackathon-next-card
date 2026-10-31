import { h, type Child } from "../ui/dom";
import "./battle-preview.css";
import "./ui-piles.css";
import { availableActions, canPlayCard } from "./engine";
import { battleZones, turnEnergySummary } from "./battle-information";
import { describeCardPlayPreview, describeCompactCardPlayPreview, previewCardPlay } from "./card-preview";
import { CARDS, ENEMIES, PRICES, ROUTES } from "./content";
import type { MarketInitialCase } from "./market";
import type { CardInstance, Run, RunAction } from "./types";
import type { PileKind } from "./ui-piles";
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
  entryCents: number;
  reserveCents: number;
  marketLoading: boolean;
  marketError: string | null;
  battleFeedback: string;
  tutorialStep: number;
  action: (action: RunAction) => void;
  selectCard: (id: string | null) => void;
  selectRetain: (id: string) => void;
  selectUpgrade: (id: string) => void;
  setEntry: (cents: number, render?: boolean) => void;
  setReserve: (cents: number) => void;
  retryMarket: () => void;
  extraCamp: () => Child;
  openReport: () => void;
  openTask: (task: "d1" | "d2") => void;
  openPile: (pile: PileKind) => void;
  archiveShown: (caseId: string) => void;
  nextTutorial: () => void;
  skipTutorial: () => void;
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
function sidebar(run: Run): HTMLElement {
  const current = nodes.indexOf(run.node);
  return h("aside", { class: "side-column" }, h("section", { class: "panel stack" }, h("div", { class: "eyebrow" }, "YOUR JOURNEY"), h("h3", null, "这段旅程"), h("div", { class: "progress-path", "aria-label": `当前位于${nodeNames[run.node]}` }, nodes.map((node, index) => h("span", { class: index === current ? "current" : index < current ? "done" : "" }, nodeLabels[node]))),
    h("hr", { class: "divider" }), moneyPanel(run), details("查看金币往来", moneyHistory(run))),
    h("section", { class: "panel stack" }, h("div", { class: "panel-head" }, h("div", null, h("h3", null, "随行牌组"), h("p", { class: "hint" }, `${run.deck.length} 张牌 · 奖励会直接加入牌组`))), deckSummary(run), details("卡牌小词典", h("p", { class: "hint" }, "过载：下一回合少恢复对应能量，仅持续一回合。成长：增加本场容量，从下一回合起生效。消耗：本场暂时移出，下一场回来。保留：牌会留在手中。"))));
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
  const intent = enemy.intent.kind === "attack" ? `攻击 ${enemy.intent.amount}` : `获得 ${enemy.intent.amount} 护盾`;
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
  const box = h("div", { class: "stack" },
    h("section", { class: "battle-board", "aria-label": `第 ${b.turn} 回合，${def.name}准备${intent}` },
      h("div", { class: "battle-player" }, h("div", { class: "avatar player", "aria-hidden": "true" }, h("picture", null, h("source", { srcset: `${import.meta.env.BASE_URL}art/adventure/traveler.webp`, type: "image/webp" }), h("img", { src: `${import.meta.env.BASE_URL}art/adventure/traveler.png`, alt: "", width: "1024", height: "1536" }))), h("div", { class: "combat-label" }, h("strong", null, "旅行者"), `生命 ${run.hp} / ${run.maxHp} · 护盾 ${b.shield}`), h("div", { class: "health-bar" }, h("i", { style: `width:${Math.max(0, run.hp / run.maxHp * 100)}%` }))),
      h("div", { class: "intent" }, h("small", null, "对方下一步"), h("strong", null, intent), enemy.attackBonus ? h("div", { class: "tiny" }, `攻击加成 +${enemy.attackBonus}`) : null),
      h("div", { class: "battle-enemy" }, h("div", { class: "avatar enemy", "aria-hidden": "true", style: `background-image:url('${import.meta.env.BASE_URL}art/adventure/${art}.webp')` }), h("div", { class: "combat-label" }, h("strong", null, def.name), `生命 ${enemy.hp} / ${enemy.maxHp} · 护盾 ${enemy.shield}`), h("div", { class: "health-bar" }, h("i", { style: `width:${Math.max(0, enemy.hp / enemy.maxHp * 100)}%` })))),
    h("div", { class: `combat-feedback${ctx.battleFeedback ? " flash" : ""}` },
      lesson ? h("div", { class: "tutorial-guide" }, h("div", { class: "tutorial-copy", "aria-live": "polite" }, h("strong", null, `${ctx.tutorialStep + 1} / 4 · ${lesson[0]}`), h("span", null, lesson[1])), h("div", { class: "tutorial-actions" }, button("跳过提示", ctx.skipTutorial, "small ghost", false, "tutorial-skip"), button(ctx.tutorialStep === 3 ? "知道了" : "下一条", ctx.nextTutorial, "small secondary", false, "tutorial-next"))) : null,
      h("p", { class: "combat-feedback-line", role: "status", "aria-live": "polite" }, ctx.battleFeedback || (lesson ? "" : `第 ${b.turn} 回合 · 看清意图，再选择手牌`))),
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
      details("战斗规则与最近动作", h("p", { class: "hint" }, "护盾在下一玩家回合开始时清除。敌人在第 10 次行动起每次攻击加成再增加 2，城门教学战除外。完成击败后，未结算过载会清除。"), h("div", { class: "timeline" }, b.log.slice(-6).reverse().map((line) => h("div", { class: "timeline-item" }, h("p", null, line)))))),
    h("div", { class: "battle-dock", "aria-label": "战斗操作" }, h("div", { class: "dock-info" }, h("strong", null, selected ? `已选 ${CARDS[selected.cardId].name}${selected.upgraded ? "+" : ""}` : "选择一张手牌"), selected ? previewBlock(true) : h("span", null, "查看效果后打出，也可结束回合")), retainSelect(true), h("div", { class: "dock-buttons" }, button("打出", play, "small", !selected || !!reason, "play-card-mobile"), button("结束回合", () => ctx.action({ type: "end-turn" }), "small gold", false, "end-turn-mobile"))));
  return box;
}
function rewardView(ctx: GameViewContext): HTMLElement {
  const { run } = ctx; const reward = run.reward!;
  const ideas = run.node === "N1" ? h("div", { class: "reward-ideas" }, h("div", null, h("strong", null, "连刃 + 余烬"), h("p", null, "营地可用 25 金币买余烬。先打余烬再打连刃，三段伤害合计从 9 变成 15。")), h("div", null, h("strong", null, "培育 → 大牌"), h("p", null, "培育增加空容量；下回合容量达到 4，能量足够时可尝试营地里的参天一击。"))) : null;
  return panel("把新牌带上旅程", `胜利获得 ${coins(reward.coinsCents)} 金币。选择一张加入牌组，或保持牌组精简。`, ctx.battleFeedback ? note(ctx.battleFeedback) : null, ideas, h("div", { class: "hand" }, reward.choices.map((id) => cardFace({ cardId: id, upgraded: false }, { label: "选择并加入牌组", onClick: () => ctx.action({ type: "choose-reward", cardId: id }), key: `reward-${id}` }))),
    note("新牌会立即加入你的牌组，下一场战斗就有机会抽到。"), h("div", { class: "button-row" }, button("这次不拿牌", () => ctx.action({ type: "choose-reward", cardId: null }), "secondary", false, "skip-reward")));
}
function selectUpgrade(ctx: GameViewContext, baseOnly = false): { field: HTMLElement; selected: CardInstance | undefined } {
  const candidates = ctx.run.deck.filter((card) => !card.upgraded && (!baseOnly || Number(card.cardId.slice(1)) <= 6));
  const selected = candidates.find((card) => card.instanceId === ctx.selectedUpgrade) ?? candidates[0];
  return { selected, field: h("label", { class: "field" }, "选择要升级的牌", h("select", { value: selected?.instanceId ?? "", disabled: !candidates.length, "data-focus-key": "upgrade-select", onchange: (event: Event) => ctx.selectUpgrade((event.currentTarget as HTMLSelectElement).value) }, candidates.map((card, i) => h("option", { value: card.instanceId, selected: card.instanceId === selected?.instanceId }, `${CARDS[card.cardId].name} · 第 ${i + 1} 张`))), selected ? h("span", { class: "hint" }, `升级前：${CARDS[selected.cardId].description} 升级后：${CARDS[selected.cardId].upgradedDescription}${CARDS[selected.cardId].cost !== CARDS[selected.cardId].upgradedCost ? ` 费用 ${CARDS[selected.cardId].cost} → ${CARDS[selected.cardId].upgradedCost}` : ""}`) : h("span", { class: "hint" }, "没有可升级的牌。")) };
}
function item(title: string, description: string, action: HTMLElement, unavailable: string | null = null): HTMLElement {
  return h("div", { class: "item" }, h("div", null, h("strong", null, title), h("p", null, description)), h("div", { class: "item-actions" }, action, unavailable ? h("small", null, unavailable) : null));
}
function shop(ctx: GameViewContext, roadside = false): HTMLElement {
  const { run } = ctx; const upgrade = selectUpgrade(ctx); const cash = run.wallet.cashCents;
  const healingShortfall = shortfall(cash, PRICES.healCents); const upgradeShortfall = shortfall(cash, PRICES.upgradeCents);
  const supplyOpen = can(run, "purchase-attempted");
  const canHeal = supplyOpen && run.hp < run.maxHp;
  const canUpgrade = supplyOpen && !!upgrade.selected;
  return h("section", { class: "panel stack" }, h("div", { class: "panel-head" }, h("div", null, h("h2", null, roadside ? "路边补给" : "营地商店"), h("p", { class: "hint" }, roadside ? "这里只接受可用金币，不能回收契约。也可以直接出发。" : "金币只在购买时扣除；不足的商品仍会显示。"))),
    h("div", { class: "item-list" }, item("热茶与补给", "恢复 10 生命 · 10 金币", button(healingShortfall ? "尝试补充" : "补充生命", () => ctx.action(healingShortfall ? { type: "purchase-attempted", purchase: "heal" } : { type: "heal" }), "small secondary", !canHeal, "heal"), healingShortfall ?? (run.hp >= run.maxHp ? "生命已满" : !supplyOpen ? "先完成当前结算" : null)),
      item("整理装备", "升级一张牌 · 20 金币", button(upgradeShortfall ? "尝试升级" : "确认升级", () => { if (upgrade.selected) ctx.action(upgradeShortfall ? { type: "purchase-attempted", purchase: "upgrade-card", cardInstanceId: upgrade.selected.instanceId } : { type: "upgrade-card", cardInstanceId: upgrade.selected.instanceId }); }, "small secondary", !canUpgrade, "upgrade"), upgradeShortfall ?? (!supplyOpen ? "先完成当前结算" : null))),
    upgrade.field,
    !roadside && run.camp ? h("div", { class: "item-list" }, run.camp.stock.map((cardId) => {
      const purchased = run.camp!.purchased.includes(cardId); const missing = shortfall(cash, PRICES.cardCents);
      return item(CARDS[cardId].name, `${CARDS[cardId].description} · 25 金币`, button(purchased ? "已购买" : missing ? "尝试购买" : "购买", () => ctx.action(missing ? { type: "purchase-attempted", purchase: "buy-card", cardId } : { type: "buy-card", cardId }), "small secondary", purchased || !supplyOpen, `buy-${cardId}`), purchased ? null : missing ?? (!supplyOpen ? "先完成当前结算" : null));
    }), item("历史档案", "更长历史与同期对照 · 4 金币", button(run.archiveOwned ? "已拥有" : cash < PRICES.archiveCents ? "尝试购买" : "购买档案", () => ctx.action(cash < PRICES.archiveCents ? { type: "purchase-attempted", purchase: "buy-archive" } : { type: "buy-archive" }), "small secondary", run.archiveOwned || !supplyOpen, "archive"), !run.archiveOwned ? shortfall(cash, PRICES.archiveCents) : null)) : null,
    !roadside && run.archiveOwned ? archiveView(ctx) : null);
}
function archiveView(ctx: GameViewContext): HTMLElement {
  const c = ctx.initialCase?.caseId === ctx.run.caseId ? ctx.initialCase : null;
  if (!c) return ctx.initialCaseError ? h("div", { class: "stack" }, note(`历史档案暂时无法加载：${ctx.initialCaseError}`, true), button("重试加载档案", ctx.retryInitialCase, "small secondary", ctx.initialCaseLoading)) : h("p", { class: "hint", role: "status" }, "正在加载本局已固定案例的历史档案……");
  const a = c.history.asset; const b = c.history.benchmark;
  const view = details("翻开已购买的历史档案", h("p", { class: "hint" }, `截至 ${dateText(c.decisionDate)} 的资料；绿色为案例资产，金色为${c.benchmark}。两条线各自从同一起点比较，不包含未来行情。`), chart(a, b, "案例资产与同期基准的历史走势"), h("div", { class: "metric-grid" }, metric("案例这一段", `${((a.at(-1)! / a[0]! - 1) * 100).toFixed(1)}%`), metric("同期基准", `${((b.at(-1)! / b[0]! - 1) * 100).toFixed(1)}%`)));
  view.addEventListener("toggle", () => { if (!view.open) return; ctx.archiveShown(ctx.run.caseId); if (!ctx.run.history.some((event) => event.action === "open-archive")) ctx.action({ type: "open-archive" }); });
  return view;
}
function entryPanel(ctx: GameViewContext): HTMLElement {
  const { run } = ctx; const committed = run.market.entryCommitted;
  if (committed) return h("section", { class: "panel stack" }, h("h2", null, "随行契约"), note("参与选择已提交。未来报价将在旅程前进后分段揭晓。"));
  const cash = run.wallet.cashCents; const initial = Math.min(cash, Math.max(0, ctx.entryCents));
  const input = h("input", { type: "number", min: "0", max: String(cash / 100), step: "0.01", value: String(initial / 100), "data-focus-key": "entry-amount", "aria-describedby": "entry-preview" });
  const preview = h("p", { class: "notice", id: "entry-preview" }, `提交后暂不可用 ${coins(initial)} 金币；剩余可用 ${coins(cash - initial)} 金币。`);
  const submit = button(initial ? `确认参与 ${coins(initial)} 金币` : "不参与，保留金币", () => ctx.action({ type: "submit-entry", amountCents: Math.max(0, Math.min(cash, Math.round((Number(input.value) || 0) * 100))) }), "gold", !can(run, "submit-entry"), "entry-submit");
  input.addEventListener("input", () => { const amount = Math.max(0, Math.min(cash, Math.round((Number(input.value) || 0) * 100))); ctx.setEntry(amount); preview.textContent = `提交后暂不可用 ${coins(amount)} 金币；剩余可用 ${coins(cash - amount)} 金币。`; submit.textContent = amount ? `确认参与 ${coins(amount)} 金币` : "不参与，保留金币"; });
  return h("section", { class: "panel stack" }, h("div", { class: "panel-head" }, h("div", null, h("h2", null, "随行契约"), h("p", { class: "hint" }, "可以不参与，也可以自行决定金额。")), pill("可选", "gold")),
    h("p", { class: "hint" }, "用旅途金币参与一段历史派生的价格变化。价值可能上涨也可能下降，不保证本金；下一营地可选择继续或回收，回收到下一报价执行后才可消费。"),
    h("div", { class: "selection-row" }, [0, 25, 50, 75].map((pct) => button(`${pct}%`, () => ctx.setEntry(Math.floor(cash * pct / 100), true), "small secondary"))),
    h("label", { class: "field" }, "参与金额（金币）", input), preview,
    submit,
    details("了解时间与价格", h("p", { class: "hint" }, "此刻只展示历史到起点收盘；提交后资金先预留，在下一可用交易日开盘按报价换成份额。后续显示的是份额参考价值，不是现金。价格采用同口径历史派生数据，不代表未来表现。")));
}
function redemptionPanel(ctx: GameViewContext): HTMLElement {
  const { run } = ctx; const decision = run.camp!.decision;
  if (decision === "settled") return h("section", { class: "panel stack" }, h("h2", null, "契约已结算"), moneyPanel(run), note("本次回收若有到账，已经计入可用金币。"));
  if (decision === "awaiting-execution") return h("section", { class: "panel stack" }, h("h2", null, "等待下一报价"), note("选择已经锁定；成交前预估价值不能用于购买。"));
  return h("section", { class: "panel stack" }, h("div", { class: "panel-head" }, h("div", null, h("h2", null, "契约来到这一站"), h("p", { class: "hint" }, "先选择份额安排，再按下一报价执行。"))), moneyPanel(run), run.market.lastQuote ? h("p", { class: "fineprint" }, `截至 ${dateText(run.market.lastQuote.date)} 的参考价值。执行价可能不同。`) : null,
    note("回收只作用于当前份额，不等于立刻增加现金。选择继续也会走到同一执行时间。"),
    h("div", { class: "choice-grid" }, button("继续持有", () => ctx.action({ type: "submit-redemption", percent: 0 }), "secondary", !can(run, "submit-redemption"), "redeem-0"), button("回收一半份额", () => ctx.action({ type: "submit-redemption", percent: 50 }), "secondary", !can(run, "submit-redemption"), "redeem-50"), button("全部回收", () => ctx.action({ type: "submit-redemption", percent: 100 }), "secondary", !can(run, "submit-redemption"), "redeem-100")));
}
function freeRest(ctx: GameViewContext): HTMLElement | null {
  const { run } = ctx; if (!run.camp || run.camp.node === "N2") return null;
  const upgrade = selectUpgrade(ctx, true); const used = run.camp.freeChoiceUsed;
  return h("section", { class: "panel stack soft" }, h("div", { class: "panel-head" }, h("div", null, h("h2", null, "一次免费的整备"), h("p", { class: "hint" }, used ? "本营地的免费整备已使用。" : "休息恢复 6 生命，或免费升级一张牌；二选一。")), pill("免费")),
    !used ? h("div", { class: "stack" }, upgrade.field, h("div", { class: "button-row" }, button("休息，恢复 6 生命", () => ctx.action({ type: "free-rest" }), "secondary", !can(run, "free-rest"), "free-rest"), button("免费升级所选牌", () => { if (upgrade.selected) ctx.action({ type: "free-upgrade", cardInstanceId: upgrade.selected.instanceId }); }, "secondary", !upgrade.selected || !can(run, "free-upgrade"), "free-upgrade"))) : null);
}
function campView(ctx: GameViewContext): HTMLElement {
  const { run } = ctx; const camp = run.camp!;
  const proceed = camp.node === "N6" ? "前往守灯者" : "继续前往岔路";
  const reserveInput = h("input", { type: "number", min: "0", max: String(run.wallet.cashCents / 100), step: "0.01", value: String(ctx.reserveCents / 100), "data-focus-key": "reserve-amount" });
  reserveInput.addEventListener("input", () => ctx.setReserve(Math.max(0, Math.round((Number(reserveInput.value) || 0) * 100))));
  return h("div", { class: "stack" }, h("section", { class: "panel soft stack" }, h("span", { class: "eyebrow" }, "A LITTLE REST"), h("h2", null, camp.node === "N2" ? "歇歇脚，再决定接下来的路" : "在营火旁整理行囊"), h("p", { class: "hint" }, camp.node === "N2" ? "前方岔路有一处路边补给：10 金币可治疗，20 金币可升级；那里不能回收契约。" : camp.node === "N4" ? "前方岔路还有一次路边补给，准备好后可以出发。" : "这是出发挑战守灯者前最后一次营地整备，也可以带着发现提前返程。")),
    camp.node === "N2" || camp.node === "N4" ? h("section", { class: "panel camp-explore" }, h("div", { class: "camp-explore-copy" }, h("span", { class: "eyebrow" }, "A SMALL DISCOVERY"), h("h3", null, "本局线索 · 试一小步"), h("p", { class: "hint" }, "可选：看看已有线索，或用一个短练习比较另一种安排。随时回到营地。")), h("div", { class: "button-row" }, button("查看当前线索", ctx.openReport, "small secondary"), button("试试资金安排", () => ctx.openTask("d1"), "small secondary"), button("试试历史比较", () => ctx.openTask("d2"), "small secondary"))) : null,
    camp.node === "N2" ? shop(ctx) : redemptionPanel(ctx),
    camp.node === "N2" ? entryPanel(ctx) : shop(ctx), freeRest(ctx),
    h("section", { class: "panel stack" }, h("h3", null, "留一份给路上的自己"), h("p", { class: "hint" }, "可选：记下希望留给补给的金额。它只是自己的计划，之后可以改变。"), h("div", { class: "row" }, reserveInput, button("记录计划", () => ctx.action({ type: "set-supply-plan", amountCents: Math.max(0, Math.round((Number(reserveInput.value) || 0) * 100)) }), "small secondary", !can(run, "set-supply-plan"))), run.supplyPlanCents !== null ? h("p", { class: "hint" }, `当前计划：留 ${coins(run.supplyPlanCents)} 金币。`) : null),
    ctx.extraCamp(),
    h("div", { class: "button-row" }, button(proceed, () => ctx.action({ type: "continue" }), "", !can(run, "continue"), "camp-continue"), camp.node === "N6" ? button("带着收获提前返程", () => ctx.action({ type: "return-home" }), "secondary", !can(run, "return-home"), "return-home") : null),
    !can(run, "continue") ? h("p", { class: "hint" }, camp.node === "N2" ? "请先确认契约参与金额；选择 0 也可以。" : "请先完成本营地的契约安排和结算。") : null);
}
function routeView(ctx: GameViewContext): HTMLElement {
  const { run } = ctx; const routes = ROUTES[run.node as "N3" | "N5"];
  return h("div", { class: "stack" }, shop(ctx, true), panel("选择接下来的路", "两条路消耗相同的旅程时间；选择最想挑战的对手。", h("div", { class: "route-grid" }, routes.map((route, index) => h("article", { class: "route-card" }, h("div", { class: "route-symbol" }, index === 0 ? "Ⅰ" : "Ⅱ"), h("h3", null, route.name), h("p", { class: "hint" }, route.description), pill(`胜利奖励 ${coins(route.rewardCents)} 金币`, "gold"), button("选择这条路", () => ctx.action({ type: "choose-route", enemyId: route.enemyId }), "secondary", !can(run, "choose-route"), `route-${route.enemyId}`))))));
}
function marketView(ctx: GameViewContext): HTMLElement {
  return panel(ctx.marketError ? "这段旅程暂时停在这里" : "翻到旅程的下一页", ctx.marketError ? "报价未加载成功。已提交的选择和当前进度都保留着。" : "正在按旅程顺序加载这一阶段的报价……", ctx.marketError ? note(ctx.marketError, true) : h("div", { class: "notice", role: "status" }, "稍等片刻，已经锁定的订单不会重复提交。"), ctx.marketError ? button("重新加载", ctx.retryMarket, "", ctx.marketLoading, "retry-market") : null);
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
  return h("div", { class: "app-shell journey-shell" }, journeyHeader(run), h("div", { class: "page-grid" }, h("main", { class: "main-column", id: "main-content" }, main), sidebar(run)));
}
export { nodeNames };
