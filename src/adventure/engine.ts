import { CAMP_STOCK, CARDS, ENEMIES, PRICES, REWARDS, ROUTES, STARTER_DECK } from './content';
import { centsForShares, requireCents, reserveEntry, rewardCash, settleEntry, settleSale, sharesForPercent, spendCash } from './ledger';
import type { ActionAvailability, BattleState, CardId, CardInstance, CreateRunOptions, DecisionSnapshot, EnemyId, GameEvent, Intent, MarketQuote, MarketRequest, MarketStage, NodeId, Run, RunAction, RunSnapshot, RunStatus } from './types';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const must = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const nextId = (run: Run): string => `e${run.history.length + 1}`;

function event(run: Run, type: GameEvent['type'], action: string, message: string, data: GameEvent['data'] = {}, snapshot?: DecisionSnapshot): void {
  run.history.push({ id: nextId(run), node: run.node, type, action, message, data, ...(snapshot ? { snapshot } : {}) });
}

export function snapshotRun(run: Run): RunSnapshot {
  const { checkpoints: _checkpoints, ...snapshot } = run;
  return clone(snapshot);
}

/** Restore a saved pre-decision state, discard every later action, and label the result as a simulation. */
export function forkRun(run: Run, checkpointId: string): Run {
  const index = run.checkpoints.findIndex((checkpoint) => checkpoint.id === checkpointId);
  if (index < 0) throw new Error('没有找到该决策快照。');
  const checkpoint = run.checkpoints[index];
  if (!checkpoint) throw new Error('没有找到该决策快照。');
  return { ...clone(checkpoint.snapshot), source: 'fork', id: `${checkpoint.snapshot.id}-fork-${checkpointId}`, checkpoints: clone(run.checkpoints.slice(0, index)) };
}

/** Snapshot restoration is deliberately explicit: loading a saved state is not a liquidation or return. */
export function restoreRun(snapshot: RunSnapshot, checkpoints: Run['checkpoints'] = []): Run {
  return { ...clone(snapshot), checkpoints: clone(checkpoints) };
}

function logChoice(run: Run, action: RunAction['type'], message: string, data: GameEvent['data'] = {}): void {
  const state = decisionSnapshot(run);
  const canFork = ['submit-entry', 'submit-redemption', 'buy-archive', 'open-archive', 'choose-route', 'choose-reward', 'buy-card', 'return-home'].includes(action);
  if (canFork) {
    const id = `d${run.checkpoints.length + 1}`;
    run.checkpoints.push({ id, action, snapshot: snapshotRun(run) });
    event(run, 'choice', action, message, { checkpointId: id, ...data }, state);
  } else event(run, 'choice', action, message, data, state);
}

function mixSeed(seed: number, node: NodeId): number {
  let value = (seed >>> 0) ^ 0x9e3779b9;
  for (const c of node) value = Math.imul(value ^ c.charCodeAt(0), 16777619) >>> 0;
  return value || 0x6d2b79f5;
}

function random(battle: BattleState): number {
  let x = battle.rngState >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  battle.rngState = x >>> 0 || 0x6d2b79f5;
  return battle.rngState / 0x100000000;
}

function shuffle(battle: BattleState, pile: string[]): void {
  for (let i = pile.length - 1; i > 0; i--) {
    const j = Math.floor(random(battle) * (i + 1));
    const a = pile[i]; const b = pile[j];
    if (a !== undefined && b !== undefined) { pile[i] = b; pile[j] = a; }
  }
}

function cardByInstance(run: Run, id: string): CardInstance {
  const card = run.deck.find((item) => item.instanceId === id);
  if (!card) throw new Error('找不到这张牌。');
  return card;
}

export function getCard(run: Run, instanceId: string): CardInstance | undefined {
  return run.deck.find((card) => card.instanceId === instanceId);
}

function draw(run: Run, count: number): void {
  const battle = run.battle;
  if (!battle) throw new Error('当前不在战斗中。');
  for (let i = 0; i < count; i++) {
    if (battle.drawPile.length === 0) {
      if (battle.discardPile.length === 0) break;
      battle.drawPile = battle.discardPile.splice(0);
      shuffle(battle, battle.drawPile);
      battle.log.push('弃牌堆洗回抽牌堆。');
    }
    const id = battle.drawPile.pop();
    if (id === undefined) break;
    if (battle.hand.length >= 8) {
      battle.discardPile.push(id);
      battle.log.push(`手牌已满，${CARDS[cardByInstance(run, id).cardId].name}进入弃牌堆。`);
    } else battle.hand.push(id);
  }
}

function intentFor(enemyId: EnemyId, turn: number): Intent {
  const definition = ENEMIES[enemyId];
  const base = definition.cycle[(turn - 1) % definition.cycle.length];
  if (!base) throw new Error('敌人行动配置缺失。');
  const attackBonus = enemyId !== 'gatekeeper' && turn >= 10 ? (turn - 9) * 2 : 0;
  return { kind: base.kind, amount: base.amount + (base.kind === 'attack' ? attackBonus : 0) };
}

function startBattle(run: Run, enemyId: EnemyId): void {
  const enemy = ENEMIES[enemyId];
  const battle: BattleState = {
    enemy: { id: enemyId, hp: enemy.maxHp, maxHp: enemy.maxHp, shield: 0, intent: intentFor(enemyId, 1), attackBonus: 0 },
    turn: 1, energy: 3, capacity: 3, overloadNext: 0, shield: 0, attackBonus: 0,
    hand: [], drawPile: run.deck.map((card) => card.instanceId), discardPile: [], exhaustPile: [], retainedOnce: [],
    rngState: mixSeed(run.seed, run.node), log: ['回合 1 开始：能量 3，容量 3。'],
  };
  shuffle(battle, battle.drawPile);
  run.phase = 'battle'; run.battle = battle; run.camp = null; run.reward = null;
  draw(run, 5);
  event(run, 'battle', 'battle-start', `遭遇${enemy.name}。`, { enemyId, hp: enemy.maxHp });
}

function addCard(run: Run, cardId: CardId): void {
  run.deck.push({ instanceId: `card-${run.nextCardNumber++}`, cardId, upgraded: false });
}

export function createRun(options: CreateRunOptions = {}): Run {
  const seed = options.seed ?? 104;
  must(Number.isSafeInteger(seed), '种子必须是整数。');
  const caseId = options.caseId ?? 'lantern-a';
  const run: Run = {
    version: '0.4.1', id: `run-${seed}-${caseId}`, seed, source: options.source ?? 'real', observationEnabled: options.observationEnabled ?? true,
    caseId, node: 'N1', phase: 'battle', status: 'active', hp: 42, maxHp: 42, deck: [],
    wallet: { cashCents: 6000, reservedCents: 0, shareUnits: '0', costBasisCents: 0, investedCents: 0, proceedsCents: 0, realizedPnlCents: 0,
      ledger: [{ id: 'opening', node: 'N1', kind: 'opening', cashDeltaCents: 6000, cashAfterCents: 6000, description: '出发时携带的金币' }] },
    market: { pending: null, order: null, lastQuote: null, entryCommitted: false, referenceValueCents: null },
    battle: null, reward: null, camp: null, archiveOwned: false, supplyPlanCents: null, nextCardNumber: 1, history: [], checkpoints: [], processedActionIds: [],
  };
  for (const card of STARTER_DECK) addCard(run, card);
  startBattle(run, 'gatekeeper');
  return run;
}

export function pendingMarketStep(run: Run): MarketRequest | null {
  return run.market.pending ? clone(run.market.pending) : null;
}

export function routeOptions(run: Run) {
  return run.node === 'N3' || run.node === 'N5' ? clone(ROUTES[run.node]) : [];
}

export function previewEntry(run: Run, amountCents: number): { amountCents: number; cashAfterCents: number | null; affordable: boolean; reason?: string } {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) return { amountCents, cashAfterCents: null, affordable: false, reason: '金额必须是非负整数分。' };
  const affordable = amountCents <= run.wallet.cashCents;
  return { amountCents, cashAfterCents: affordable ? run.wallet.cashCents - amountCents : null, affordable, ...(affordable ? {} : { reason: '可用金币不足。' }) };
}

export function previewRedemption(run: Run, percent: 0 | 50 | 100): { shareUnits: string; remainingShareUnits: string; estimateCents: number | null } {
  const shareUnits = sharesForPercent(run.wallet.shareUnits, percent);
  return { shareUnits, remainingShareUnits: (BigInt(run.wallet.shareUnits) - BigInt(shareUnits)).toString(), estimateCents: run.market.lastQuote ? centsForShares(shareUnits, run.market.lastQuote.price) : null };
}

export function canPlayCard(run: Run, cardInstanceId: string): { enabled: boolean; reason?: string; cost?: number; energyAfter?: number; capacityAfter?: number; overloadAfter?: number } {
  const battle = run.battle;
  if (run.phase !== 'battle' || !battle) return { enabled: false, reason: '当前不在战斗中。' };
  const card = getCard(run, cardInstanceId);
  if (!card || !battle.hand.includes(cardInstanceId)) return { enabled: false, reason: '这张牌不在手牌中。' };
  const def = CARDS[card.cardId];
  const cost = card.upgraded ? def.upgradedCost : def.cost;
  if (cost > battle.energy) return { enabled: false, reason: '当前能量不足。', cost };
  if (battle.overloadNext + def.overload > battle.capacity) return { enabled: false, reason: '待结算过载不能超过当前容量。', cost };
  if (card.cardId === 'C05' && battle.capacity >= 6) return { enabled: false, reason: '容量已达上限，这张牌无法再成长。', cost };
  return { enabled: true, cost, energyAfter: battle.energy - cost + (card.cardId === 'C04' ? card.upgraded ? 3 : 2 : 0), capacityAfter: Math.min(6, battle.capacity + (card.cardId === 'C05' || card.cardId === 'C11' ? 1 : 0)), overloadAfter: battle.overloadNext + def.overload };
}

export function availableActions(run: Run): ActionAvailability[] {
  const campReady = run.phase === 'camp' && !!run.camp && (run.node === 'N2' || run.camp.decision === 'settled');
  const supply = campReady || run.phase === 'route';
  const upgradable = run.deck.some((card) => !card.upgraded);
  const cheapBase = run.deck.some((card) => !card.upgraded && Number(card.cardId.slice(1)) <= 6);
  const canFree = campReady && run.node !== 'N2' && !run.camp?.freeChoiceUsed;
  const entries: ActionAvailability[] = [
    { type: 'play-card', enabled: run.phase === 'battle' && !!run.battle?.hand.some((id) => canPlayCard(run, id).enabled) },
    { type: 'end-turn', enabled: run.phase === 'battle' },
    { type: 'choose-reward', enabled: run.phase === 'reward' },
    { type: 'buy-card', enabled: campReady && !!run.camp?.stock.some((id) => !run.camp?.purchased.includes(id)) && run.wallet.cashCents >= PRICES.cardCents },
    { type: 'heal', enabled: supply && run.hp < run.maxHp && run.wallet.cashCents >= PRICES.healCents },
    { type: 'upgrade-card', enabled: supply && upgradable && run.wallet.cashCents >= PRICES.upgradeCents },
    { type: 'free-rest', enabled: !!canFree },
    { type: 'free-upgrade', enabled: !!canFree && cheapBase },
    { type: 'buy-archive', enabled: campReady && !run.archiveOwned && run.wallet.cashCents >= PRICES.archiveCents },
    { type: 'open-archive', enabled: run.phase === 'camp' && run.archiveOwned },
    { type: 'purchase-attempted', enabled: supply },
    { type: 'set-supply-plan', enabled: run.phase === 'camp' },
    { type: 'submit-entry', enabled: run.phase === 'camp' && run.node === 'N2' && !run.market.entryCommitted },
    { type: 'submit-redemption', enabled: run.phase === 'camp' && (run.node === 'N4' || run.node === 'N6') && run.camp?.decision === 'not-submitted' },
    { type: 'continue', enabled: run.phase === 'camp' && (run.node === 'N2' ? run.market.entryCommitted : run.camp?.decision === 'settled') },
    { type: 'choose-route', enabled: run.phase === 'route' },
    { type: 'return-home', enabled: run.phase === 'camp' && run.node === 'N6' },
    { type: 'apply-quote', enabled: run.phase === 'market' && !!run.market.pending },
  ];
  return entries.map((item) => item.enabled ? item : { ...item, reason: item.reason ?? '当前局面不满足操作条件。' });
}

export function decisionSnapshot(run: Run): DecisionSnapshot {
  return {
    node: run.node, phase: run.phase, hp: run.hp, maxHp: run.maxHp, shield: run.battle?.shield ?? 0,
    cashCents: run.wallet.cashCents, reservedCents: run.wallet.reservedCents, shareUnits: run.wallet.shareUnits,
    costBasisCents: run.wallet.costBasisCents, referenceValueCents: run.market.referenceValueCents,
    deck: clone(run.deck), shop: run.camp ? run.camp.stock.filter((id) => !run.camp?.purchased.includes(id)) : [], rewardChoices: clone(run.reward?.choices ?? []),
    prices: { ...PRICES }, routes: routeOptions(run), archiveOwned: run.archiveOwned, lastQuote: clone(run.market.lastQuote),
    order: clone(run.market.order), available: availableActions(run), supplyPlanCents: run.supplyPlanCents,
  };
}

function openCamp(run: Run, node: 'N2' | 'N4' | 'N6'): void {
  run.node = node; run.phase = 'camp'; run.battle = null; run.reward = null;
  run.camp = { node, stock: [...CAMP_STOCK[node]], purchased: [], freeChoiceUsed: false, decision: 'not-submitted' };
  event(run, 'system', 'camp-arrival', `抵达${node === 'N2' ? '第一营地' : node === 'N4' ? '中途营地' : '最后营地'}。`);
}

function requestQuote(run: Run, stage: MarketStage): void {
  run.market.pending = { caseId: run.caseId, stage, unlocked: true };
  run.phase = 'market';
}

function endImmediately(run: Run): void {
  run.node = 'N8'; run.phase = 'ended'; run.battle = null; run.camp = null; run.reward = null;
  run.market.order = null; run.market.pending = null;
  event(run, 'system', 'end', run.status === 'cleared' ? '你取回了灯火。' : run.status === 'returned' ? '你带着旅程中的发现返程。' : '这次冒险结束了。', { status: run.status });
}

function finish(run: Run, status: Exclude<RunStatus, 'active'>, stage: MarketStage): void {
  run.status = status;
  run.battle = null; run.reward = null;
  if (BigInt(run.wallet.shareUnits) === 0n) { endImmediately(run); return; }
  run.market.order = { id: `auto-${run.history.length + 1}`, kind: 'sell', shareUnits: run.wallet.shareUnits, automatic: true };
  event(run, 'market', 'auto-liquidation', '结束时自动回收剩余份额，等待下一可用开盘价；这不是主动回收选择。', { stage });
  requestQuote(run, stage);
}

function victory(run: Run): void {
  const battle = run.battle;
  if (!battle) throw new Error('战斗状态缺失。');
  const enemy = ENEMIES[battle.enemy.id];
  event(run, 'battle', 'victory', `击败${enemy.name}。`, { enemyId: enemy.id, turns: battle.turn });
  run.battle = null;
  if (run.node === 'N7') {
    // The historical segment completes on victory, not merely on entering the battle.
    run.status = 'cleared';
    requestQuote(run, 't3');
    return;
  }
  must(run.node === 'N1' || run.node === 'N3' || run.node === 'N5', '无法在此节点结算奖励。');
  rewardCash(run.wallet, enemy.rewardCents, nextId(run), run.node, `${enemy.name}战斗奖励`);
  run.reward = { choices: [...REWARDS[run.node as 'N1' | 'N3' | 'N5']], coinsCents: enemy.rewardCents };
  run.phase = 'reward';
}

function dealHit(run: Run, base: number): number {
  const battle = run.battle;
  if (!battle) throw new Error('战斗状态缺失。');
  const amount = base + battle.attackBonus;
  const absorbed = Math.min(battle.enemy.shield, amount);
  battle.enemy.shield -= absorbed;
  const damage = amount - absorbed;
  battle.enemy.hp = Math.max(0, battle.enemy.hp - damage);
  battle.log.push(`造成 ${amount} 点伤害${absorbed ? `（护盾吸收 ${absorbed}）` : ''}。`);
  return damage;
}

function playCard(run: Run, action: Extract<RunAction, { type: 'play-card' }>): void {
  const battle = run.battle;
  if (!battle) throw new Error('当前不在战斗中。');
  const allowed = canPlayCard(run, action.cardInstanceId);
  must(allowed.enabled, allowed.reason ?? '不能打出这张牌。');
  const card = cardByInstance(run, action.cardInstanceId);
  const def = CARDS[card.cardId];
  if (card.cardId === 'C14') {
    const others = battle.hand.filter((id) => id !== action.cardInstanceId);
    if (others.length) must(!!action.retainCardId && others.includes(action.retainCardId), '请选择另一张手牌保留。');
    else must(!action.retainCardId, '当前没有其他手牌可保留。');
  } else must(!action.retainCardId, '此牌不需要指定保留目标。');
  const cost = card.upgraded ? def.upgradedCost : def.cost;
  battle.energy -= cost; battle.overloadNext += def.overload;
  battle.hand.splice(battle.hand.indexOf(action.cardInstanceId), 1);
  battle.log.push(`打出${def.name}，消耗 ${cost} 能量${def.overload ? `，下回合锁定 ${def.overload}` : ''}。`);
  let damage = 0;
  let hitCount = 0;
  let damagePerHit = 0;
  const hit = (base: number): void => {
    hitCount++;
    damagePerHit = base + battle.attackBonus;
    damage += dealHit(run, base);
  };
  switch (card.cardId) {
    case 'C01': hit(card.upgraded ? 9 : 6); break;
    case 'C02': battle.shield += card.upgraded ? 9 : 6; break;
    case 'C03': draw(run, card.upgraded ? 3 : 2); break;
    case 'C04': battle.energy += card.upgraded ? 3 : 2; break;
    case 'C05': battle.capacity++; break;
    case 'C06': battle.shield += card.upgraded ? 6 : 4; draw(run, 1); break;
    case 'C07': for (let i = 0; i < 3 && battle.enemy.hp > 0; i++) hit(card.upgraded ? 4 : 3); break;
    case 'C08': battle.attackBonus += card.upgraded ? 3 : 2; break;
    case 'C09': hit(card.upgraded ? 16 : 12); break;
    case 'C10': battle.shield += card.upgraded ? 18 : 14; break;
    case 'C11': battle.shield += card.upgraded ? 8 : 5; battle.capacity = Math.min(6, battle.capacity + 1); break;
    case 'C12': hit(card.upgraded ? 34 : 26); break;
    case 'C13': battle.shield += card.upgraded ? 18 : 14; hit(card.upgraded ? 18 : 14); break;
    case 'C14': if (action.retainCardId) battle.retainedOnce.push(action.retainCardId); draw(run, card.upgraded ? 2 : 1); break;
  }
  (def.exhaust ? battle.exhaustPile : battle.discardPile).push(action.cardInstanceId);
  // Public post-action facts are captured before a victory clears the battle.
  // They describe this action only; no drawn card, pile order or RNG is recorded.
  event(run, 'battle', 'play-card', `打出${def.name}。`, {
    cardId: card.cardId, cardInstanceId: card.instanceId, turn: battle.turn, damage,
    energy: battle.energy, capacity: battle.capacity, overloadNext: battle.overloadNext,
    playerShieldAfter: battle.shield, enemyHpAfter: battle.enemy.hp, enemyShieldAfter: battle.enemy.shield,
    attackBonusAfter: battle.attackBonus, hitCount, damagePerHit,
    maxHitCount: def.attack ? card.cardId === 'C07' ? 3 : 1 : 0,
  });
  if (battle.enemy.hp <= 0) victory(run);
}

function endTurn(run: Run): void {
  const battle = run.battle;
  if (run.phase !== 'battle' || !battle) throw new Error('当前不在战斗中。');
  battle.enemy.shield = 0;
  const intent = battle.enemy.intent;
  if (intent.kind === 'attack') {
    const absorbed = Math.min(battle.shield, intent.amount);
    battle.shield -= absorbed;
    const damage = intent.amount - absorbed;
    run.hp = Math.max(0, run.hp - damage);
    battle.log.push(`敌人攻击 ${intent.amount}，护盾吸收 ${absorbed}，损失 ${damage} 生命。`);
    event(run, 'battle', 'enemy-attack', '敌人执行攻击。', { amount: intent.amount, absorbed, damage, hp: run.hp, turn: battle.turn });
  } else {
    battle.enemy.shield = intent.amount;
    battle.log.push(`敌人获得 ${intent.amount} 护盾。`);
    event(run, 'battle', 'enemy-shield', '敌人获得护盾。', { amount: intent.amount, turn: battle.turn });
  }
  if (run.hp <= 0) {
    const stage: MarketStage = run.node === 'N3' ? 'exit-after-entry' : run.node === 'N5' ? 'exit-after-t1-exec' : 'exit-after-t2-exec';
    event(run, 'battle', 'defeat', '生命归零，结束这次冒险。');
    finish(run, 'defeated', stage);
    return;
  }
  const kept: string[] = [];
  for (const id of battle.hand) {
    const card = cardByInstance(run, id);
    if (CARDS[card.cardId].retain || battle.retainedOnce.includes(id)) kept.push(id);
    else battle.discardPile.push(id);
  }
  battle.hand = kept;
  battle.retainedOnce = [];
  battle.energy = 0;
  battle.turn++;
  battle.shield = 0;
  const locked = battle.overloadNext;
  battle.energy = Math.max(0, battle.capacity - locked);
  battle.overloadNext = 0; battle.attackBonus = 0;
  draw(run, 5);
  battle.enemy.attackBonus = battle.enemy.id !== 'gatekeeper' && battle.turn >= 10 ? (battle.turn - 9) * 2 : 0;
  battle.enemy.intent = intentFor(battle.enemy.id, battle.turn);
  battle.log.push(`回合 ${battle.turn} 开始：容量 ${battle.capacity}，锁定 ${locked}，可用 ${battle.energy}。`);
  event(run, 'battle', 'turn-start', '新回合开始。', { turn: battle.turn, capacity: battle.capacity, locked, energy: battle.energy });
}

function ensureSupply(run: Run): void {
  must(run.phase === 'route' || (run.phase === 'camp' && (run.node === 'N2' || run.camp?.decision === 'settled')), '等待回收执行后才能使用营地商店。');
}

function executeQuote(run: Run, quote: MarketQuote): void {
  const request = run.market.pending;
  if (!request) {
    const last = run.market.lastQuote;
    if (last && last.caseId === quote.caseId && last.step === quote.step && last.date === quote.date && last.price === quote.price) return;
    throw new Error('当前没有等待此报价的操作。');
  }
  must(run.phase === 'market' && quote.caseId === request.caseId && quote.step === request.stage, '报价与当前等待的阶段不符。');
  must(Number.isSafeInteger(quote.price) && quote.price > 0 && (/^\d{8}$/.test(quote.date) || /^\d{4}-\d{2}-\d{2}$/.test(quote.date)), '报价日期或价格无效。');
  if (run.market.lastQuote) must(quote.date.replaceAll('-', '') > run.market.lastQuote.date.replaceAll('-', ''), '报价必须晚于已推进的时间点。');
  run.market.pending = null;
  run.market.lastQuote = clone(quote);
  const order = run.market.order;
  let proceedsCents = 0;
  if (order?.kind === 'entry') {
    must(quote.step === 'entry', '买入单只能按入场开盘价执行。');
    const units = settleEntry(run.wallet, order.amountCents, quote.price);
    event(run, 'market', 'apply-quote', '预留金额按实际开盘价换为契约份额。', { stage: quote.step, price: quote.price, date: quote.date, amountCents: order.amountCents, shareUnits: units, proceedsCents });
    run.market.order = null; run.market.referenceValueCents = centsForShares(run.wallet.shareUnits, quote.price);
    run.node = 'N3'; run.phase = 'route'; run.camp = null;
    return;
  }
  if (order?.kind === 'sell') {
    const settled = settleSale(run.wallet, order.shareUnits, quote.price, nextId(run), run.node);
    proceedsCents = settled.proceedsCents;
    event(run, 'market', 'apply-quote', order.automatic ? '结束后的自动回收已按实际开盘价到账。' : '回收按实际开盘价到账。', { stage: quote.step, price: quote.price, date: quote.date, proceedsCents, pnlCents: settled.pnlCents, automatic: order.automatic, shareUnits: order.shareUnits });
    run.market.order = null; run.market.referenceValueCents = centsForShares(run.wallet.shareUnits, quote.price);
    if (run.status !== 'active') { endImmediately(run); return; }
    if (!run.camp) throw new Error('营地状态缺失。');
    run.camp.decision = 'settled'; run.phase = 'camp';
    return;
  }
  event(run, 'market', 'apply-quote', '抵达新的历史时点，展示截至收盘的参考价值。', { stage: quote.step, price: quote.price, date: quote.date, proceedsCents });
  run.market.referenceValueCents = centsForShares(run.wallet.shareUnits, quote.price);
  if (quote.step === 't1') openCamp(run, 'N4');
  else if (quote.step === 't2') openCamp(run, 'N6');
  else if (quote.step === 't3' && run.status === 'cleared') finish(run, 'cleared', 'final-exec');
  else throw new Error('当前报价缺少对应操作。');
}

/** Deterministic, transactional reducer. Illegal actions throw without mutating the supplied run. */
export function reduceRun(previous: Run, action: RunAction): Run {
  if (action.actionId && previous.processedActionIds.includes(action.actionId)) return previous;
  const run = clone(previous);
  if (run.status !== 'active' && action.type !== 'apply-quote') throw new Error('这次冒险已结束。');
  switch (action.type) {
    case 'play-card': playCard(run, action); break;
    case 'end-turn': endTurn(run); break;
    case 'choose-reward': {
      must(run.phase === 'reward' && !!run.reward, '现在不能选择奖励。');
      if (action.cardId !== null) must(!!run.reward?.choices.includes(action.cardId), '这张牌不在奖励中。');
      logChoice(run, action.type, action.cardId ? `选择 ${CARDS[action.cardId].name} 加入牌组。` : '选择不拿牌。', { cardId: action.cardId });
      if (action.cardId) addCard(run, action.cardId);
      run.reward = null;
      if (run.node === 'N1') openCamp(run, 'N2');
      else if (run.node === 'N3') requestQuote(run, 't1');
      else if (run.node === 'N5') requestQuote(run, 't2');
      else throw new Error('当前没有后续营地。');
      break;
    }
    case 'buy-card': {
      ensureSupply(run); must(run.phase === 'camp' && !!run.camp, '只有营地出售卡牌。');
      must(!!run.camp?.stock.includes(action.cardId) && !run.camp?.purchased.includes(action.cardId), '这张牌没有在当前商店出售。');
      must(run.wallet.cashCents >= PRICES.cardCents, '可用金币不足。');
      logChoice(run, action.type, `购买 ${CARDS[action.cardId].name}。`, { cardId: action.cardId, amountCents: PRICES.cardCents });
      spendCash(run.wallet, PRICES.cardCents, nextId(run), run.node, `购买卡牌 ${CARDS[action.cardId].name}`);
      run.camp?.purchased.push(action.cardId); addCard(run, action.cardId); break;
    }
    case 'heal': {
      ensureSupply(run); must(run.hp < run.maxHp, '生命已经全满。');
      must(run.wallet.cashCents >= PRICES.healCents, '可用金币不足。');
      const healed = Math.min(10, run.maxHp - run.hp);
      logChoice(run, action.type, '购买生命补给。', { amountCents: PRICES.healCents, healed });
      spendCash(run.wallet, PRICES.healCents, nextId(run), run.node, '购买生命补给'); run.hp += healed; break;
    }
    case 'upgrade-card':
    case 'free-upgrade': {
      ensureSupply(run);
      const card = cardByInstance(run, action.cardInstanceId);
      must(!card.upgraded, '这张牌已经升级。');
      if (action.type === 'free-upgrade') {
        must(run.phase === 'camp' && run.node !== 'N2' && !!run.camp && !run.camp.freeChoiceUsed, '这里没有可用的免费整理。');
        must(Number(card.cardId.slice(1)) <= 6, '免费整理仅可升级基础牌。');
      } else must(run.wallet.cashCents >= PRICES.upgradeCents, '可用金币不足。');
      const amountCents = action.type === 'free-upgrade' ? 0 : PRICES.upgradeCents;
      logChoice(run, action.type, `升级 ${CARDS[card.cardId].name}。`, { cardId: card.cardId, cardInstanceId: card.instanceId, amountCents });
      if (amountCents) spendCash(run.wallet, amountCents, nextId(run), run.node, `升级卡牌 ${CARDS[card.cardId].name}`);
      else if (run.camp) run.camp.freeChoiceUsed = true;
      card.upgraded = true; break;
    }
    case 'free-rest': {
      ensureSupply(run); must(run.phase === 'camp' && run.node !== 'N2' && !!run.camp && !run.camp.freeChoiceUsed, '这里没有可用的免费休息。');
      const healed = Math.min(6, run.maxHp - run.hp);
      logChoice(run, action.type, '在营地免费休息。', { healed }); run.hp += healed;
      if (run.camp) run.camp.freeChoiceUsed = true; break;
    }
    case 'buy-archive': {
      ensureSupply(run); must(run.phase === 'camp' && !run.archiveOwned, '档案已拥有或当前不在营地。');
      must(run.wallet.cashCents >= PRICES.archiveCents, '可用金币不足。');
      logChoice(run, action.type, '购买历史档案。', { amountCents: PRICES.archiveCents });
      spendCash(run.wallet, PRICES.archiveCents, nextId(run), run.node, '购买历史档案'); run.archiveOwned = true; break;
    }
    case 'open-archive': {
      must(run.phase === 'camp' && run.archiveOwned, '需要先拥有档案，才能免费查看。');
      if (!run.history.some((item) => item.action === 'open-archive')) logChoice(run, action.type, '打开已拥有的历史档案。');
      break;
    }
    case 'purchase-attempted': {
      ensureSupply(run);
      const price = action.purchase === 'heal' ? PRICES.healCents : action.purchase === 'upgrade-card' ? PRICES.upgradeCents : action.purchase === 'buy-card' ? PRICES.cardCents : PRICES.archiveCents;
      must(run.wallet.cashCents < price, '可支付的购买应直接提交购买操作。');
      if (action.purchase === 'heal') must(run.hp < run.maxHp, '生命已经全满。');
      if (action.purchase === 'upgrade-card') {
        must(!!action.cardInstanceId && !cardByInstance(run, action.cardInstanceId).upgraded, '请选择可升级的牌。');
      }
      if (action.purchase === 'buy-card') must(run.phase === 'camp' && !!action.cardId && !!run.camp?.stock.includes(action.cardId) && !run.camp.purchased.includes(action.cardId), '此卡牌当前不可购买。');
      if (action.purchase === 'buy-archive') must(run.phase === 'camp' && !run.archiveOwned, '档案当前不可购买。');
      logChoice(run, action.type, '尝试购买时可用金币不足。', { purchase: action.purchase, cardId: action.cardId ?? null, cardInstanceId: action.cardInstanceId ?? null, priceCents: price, reason: 'insufficient-cash' });
      break;
    }
    case 'set-supply-plan': {
      must(run.phase === 'camp', '只有在营地可以标记补给计划。');
      if (action.amountCents !== null) requireCents(action.amountCents);
      logChoice(run, action.type, '调整本人标记的补给计划。', { amountCents: action.amountCents });
      run.supplyPlanCents = action.amountCents; break;
    }
    case 'submit-entry': {
      must(run.phase === 'camp' && run.node === 'N2' && !run.market.entryCommitted, '当前不能提交参与金额。');
      const preview = previewEntry(run, action.amountCents); must(preview.affordable, preview.reason ?? '金额无效。');
      logChoice(run, action.type, '提交契约参与金额。', { amountCents: action.amountCents });
      const id = `entry-${run.history.length}`;
      reserveEntry(run.wallet, action.amountCents, id, run.node);
      run.market.order = { id, kind: 'entry', amountCents: action.amountCents }; run.market.entryCommitted = true;
      if (run.camp) run.camp.decision = 'settled'; break;
    }
    case 'submit-redemption': {
      must(run.phase === 'camp' && (run.node === 'N4' || run.node === 'N6') && run.camp?.decision === 'not-submitted', '当前不能提交回收选择。');
      must([0, 50, 100].includes(action.percent), '回收比例无效。');
      const shareUnits = sharesForPercent(run.wallet.shareUnits, action.percent);
      logChoice(run, action.type, action.percent === 0 ? '选择继续持有。' : `提交回收 ${action.percent}% 的份额。`, { percent: action.percent, shareUnits });
      run.market.order = { id: `sell-${run.history.length}`, kind: 'sell', shareUnits, automatic: false };
      if (run.camp) run.camp.decision = 'awaiting-execution';
      requestQuote(run, run.node === 'N4' ? 't1-exec' : 't2-exec'); break;
    }
    case 'continue': {
      must(run.phase === 'camp' && !!run.camp, '当前不能离开营地。');
      if (run.node === 'N2') {
        must(run.market.entryCommitted && run.market.order?.kind === 'entry', '请先确认参与金额；也可以选择 0。');
        logChoice(run, action.type, '离开第一营地。'); requestQuote(run, 'entry');
      } else if (run.node === 'N4') {
        must(run.camp?.decision === 'settled', '请先提交选择并等待下一开盘价。');
        logChoice(run, action.type, '离开中途营地。'); run.node = 'N5'; run.phase = 'route'; run.camp = null;
      } else if (run.node === 'N6') {
        must(run.camp?.decision === 'settled', '请先提交选择并等待下一开盘价。');
        logChoice(run, action.type, '前往守灯者。'); run.node = 'N7'; run.camp = null; startBattle(run, 'keeper');
      } else throw new Error('当前不能离开营地。');
      break;
    }
    case 'choose-route': {
      must(run.phase === 'route' && (run.node === 'N3' || run.node === 'N5'), '当前不能选择路线。');
      must(routeOptions(run).some((item) => item.enemyId === action.enemyId), '这条路线不可选。');
      logChoice(run, action.type, `选择面对 ${ENEMIES[action.enemyId].name}。`, { enemyId: action.enemyId });
      startBattle(run, action.enemyId); break;
    }
    case 'return-home': {
      must(run.phase === 'camp' && run.node === 'N6' && !!run.camp, '只有最后营地可以提前返程。');
      const stage: MarketStage = run.camp?.decision === 'settled' ? 'exit-after-t2-exec' : 't2-exec';
      logChoice(run, action.type, '带着当前发现提前返程。'); finish(run, 'returned', stage); break;
    }
    case 'apply-quote': executeQuote(run, action.quote); break;
  }
  if (action.actionId) run.processedActionIds.push(action.actionId);
  return run;
}
