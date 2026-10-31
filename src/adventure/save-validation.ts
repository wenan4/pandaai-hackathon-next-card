import { CARDS, ENEMIES } from './content';
import type { Run } from './types';

type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const string = (value: unknown): value is string => typeof value === 'string';
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const nonnegative = (value: unknown): value is number => integer(value) && value >= 0;
const positive = (value: unknown): value is number => integer(value) && value > 0;
const bool = (value: unknown): value is boolean => typeof value === 'boolean';
const array = (value: unknown, predicate: (item: unknown) => boolean): boolean => Array.isArray(value) && value.every(predicate);
const optional = (value: unknown, predicate: (item: unknown) => boolean): boolean => value === undefined || predicate(value);
const nullable = (value: unknown, predicate: (item: unknown) => boolean): boolean => value === null || predicate(value);
const member = (value: unknown, values: readonly string[]): boolean => typeof value === 'string' && values.includes(value);
const nodes = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8'];
const phases = ['battle', 'reward', 'camp', 'route', 'market', 'ended'];
const stages = ['entry', 't1', 't1-exec', 't2', 't2-exec', 't3', 'final-exec', 'exit-after-entry', 'exit-after-t1-exec', 'exit-after-t2-exec'];
const actions = ['play-card', 'end-turn', 'choose-reward', 'buy-card', 'heal', 'upgrade-card', 'free-rest', 'free-upgrade', 'buy-archive', 'open-archive', 'purchase-attempted', 'set-supply-plan', 'submit-entry', 'submit-redemption', 'continue', 'choose-route', 'return-home', 'apply-quote'];
const node = (value: unknown): boolean => member(value, nodes);
const phase = (value: unknown): boolean => member(value, phases);
const stage = (value: unknown): boolean => member(value, stages);
const cardId = (value: unknown): boolean => text(value) && Object.prototype.hasOwnProperty.call(CARDS, value);
const enemyId = (value: unknown): boolean => text(value) && Object.prototype.hasOwnProperty.call(ENEMIES, value);
const shares = (value: unknown): boolean => typeof value === 'string' && /^\d+$/.test(value);
const caseId = text;

function card(value: unknown): boolean {
  return object(value) && text(value.instanceId) && cardId(value.cardId) && bool(value.upgraded);
}
function deck(value: unknown): value is RecordValue[] {
  if (!array(value, card)) return false;
  const cards = value as RecordValue[];
  return new Set(cards.map((item) => item.instanceId)).size === cards.length;
}
function quote(value: unknown, expectedCase: unknown): boolean {
  return object(value) && value.caseId === expectedCase && stage(value.step)
    && typeof value.date === 'string' && (/^\d{8}$/.test(value.date) || /^\d{4}-\d{2}-\d{2}$/.test(value.date)) && positive(value.price);
}
function order(value: unknown): boolean {
  if (!object(value) || !text(value.id)) return false;
  return value.kind === 'entry' ? nonnegative(value.amountCents)
    : value.kind === 'sell' && shares(value.shareUnits) && bool(value.automatic);
}
function market(value: unknown, expectedCase: unknown): boolean {
  return object(value) && bool(value.entryCommitted) && nullable(value.referenceValueCents, nonnegative)
    && nullable(value.order, order) && nullable(value.lastQuote, (item) => quote(item, expectedCase))
    && nullable(value.pending, (item) => object(item) && item.caseId === expectedCase && stage(item.stage) && item.unlocked === true);
}
function wallet(value: unknown): boolean {
  if (!object(value) || !nonnegative(value.cashCents) || !nonnegative(value.reservedCents) || !shares(value.shareUnits)
    || !nonnegative(value.costBasisCents) || !nonnegative(value.investedCents) || !nonnegative(value.proceedsCents)
    || !integer(value.realizedPnlCents)) return false;
  return array(value.ledger, (item) => object(item) && text(item.id) && node(item.node)
    && member(item.kind, ['opening', 'battle-reward', 'purchase', 'entry-reserve', 'redemption'])
    && integer(item.cashDeltaCents) && nonnegative(item.cashAfterCents) && string(item.description));
}
function battle(value: unknown, cards: RecordValue[]): boolean {
  if (!object(value) || !object(value.enemy) || !enemyId(value.enemy.id) || !nonnegative(value.enemy.hp)
    || !positive(value.enemy.maxHp) || !nonnegative(value.enemy.shield) || !nonnegative(value.enemy.attackBonus)
    || !object(value.enemy.intent) || !member(value.enemy.intent.kind, ['attack', 'shield']) || !nonnegative(value.enemy.intent.amount)
    || !positive(value.turn) || !nonnegative(value.energy) || !positive(value.capacity) || !nonnegative(value.overloadNext)
    || !nonnegative(value.shield) || !nonnegative(value.attackBonus) || !nonnegative(value.rngState) || value.rngState > 0xffffffff
    || !array(value.log, string)) return false;
  const ids = new Set(cards.map((item) => item.instanceId));
  const zones = [value.hand, value.drawPile, value.discardPile, value.exhaustPile];
  if (!zones.every((zone) => array(zone, (id) => text(id) && ids.has(id)))
    || !array(value.retainedOnce, (id) => text(id) && ids.has(id))) return false;
  const placed = (zones as string[][]).flat();
  return placed.length === ids.size && new Set(placed).size === ids.size;
}
function camp(value: unknown): boolean {
  return object(value) && member(value.node, ['N2', 'N4', 'N6']) && array(value.stock, cardId) && array(value.purchased, cardId)
    && bool(value.freeChoiceUsed) && member(value.decision, ['not-submitted', 'awaiting-execution', 'settled']);
}
function reward(value: unknown): boolean {
  return object(value) && array(value.choices, cardId) && nonnegative(value.coinsCents);
}
function route(value: unknown): boolean {
  return object(value) && enemyId(value.enemyId) && string(value.name) && string(value.description) && nonnegative(value.rewardCents);
}
function actionAvailability(value: unknown): boolean {
  return object(value) && member(value.type, actions) && bool(value.enabled) && optional(value.reason, string);
}
function decision(value: unknown, expectedCase: unknown): boolean {
  if (!object(value) || !node(value.node) || !phase(value.phase) || !nonnegative(value.hp) || !positive(value.maxHp)
    || !nonnegative(value.shield) || !nonnegative(value.cashCents) || !nonnegative(value.reservedCents) || !shares(value.shareUnits)
    || !nonnegative(value.costBasisCents) || !nullable(value.referenceValueCents, nonnegative) || !deck(value.deck)
    || !array(value.shop, cardId) || !array(value.rewardChoices, cardId) || !object(value.prices)
    || !nonnegative(value.prices.healCents) || !nonnegative(value.prices.upgradeCents)
    || !nonnegative(value.prices.cardCents) || !nonnegative(value.prices.archiveCents) || !array(value.routes, route)
    || !bool(value.archiveOwned) || !nullable(value.lastQuote, (item) => quote(item, expectedCase)) || !nullable(value.order, order)
    || !array(value.available, actionAvailability) || !nullable(value.supplyPlanCents, nonnegative)) return false;
  return true;
}
function gameEvent(value: unknown, expectedCase: unknown): boolean {
  if (!object(value) || !text(value.id) || !node(value.node) || !member(value.type, ['battle', 'choice', 'market', 'system'])
    || !text(value.action) || !string(value.message) || !object(value.data)) return false;
  const validDatum = (item: unknown): boolean => item === null || string(item) || bool(item) || (typeof item === 'number' && Number.isFinite(item));
  // The research timeline uses these exact observed values as an actual price.
  if (value.type === 'market' && value.action === 'apply-quote'
    && (!stage(value.data.stage) || !positive(value.data.price) || typeof value.data.date !== 'string'
      || !(/^\d{8}$/.test(value.data.date) || /^\d{4}-\d{2}-\d{2}$/.test(value.data.date)))) return false;
  return Object.values(value.data).every(validDatum) && optional(value.snapshot, (item) => decision(item, expectedCase));
}

// These relationships are prerequisites of executeQuote, not a replay of the
// ledger: do not recalculate money or replace an incomplete pending order.
function settlement(value: RecordValue): boolean {
  const market = value.market as RecordValue;
  const wallet = value.wallet as RecordValue;
  const order = market.order as RecordValue | null;
  if (order?.kind === 'entry' && (order.amountCents as number) > (wallet.reservedCents as number)) return false;
  if (order?.kind === 'sell' && BigInt(order.shareUnits as string) > BigInt(wallet.shareUnits as string)) return false;
  if (value.phase !== 'market') return true;

  const pending = market.pending as RecordValue;
  if (!order) {
    return (member(pending.stage, ['t1', 't2']) && value.status === 'active')
      || (pending.stage === 't3' && value.status === 'cleared');
  }
  if (order.kind === 'entry') return pending.stage === 'entry' && value.status === 'active';
  if (!member(pending.stage, ['t1-exec', 't2-exec', 'final-exec', 'exit-after-entry', 'exit-after-t1-exec', 'exit-after-t2-exec'])) return false;
  return value.status !== 'active' || (object(value.camp) && value.camp.node === value.node);
}

function runFields(value: unknown, withCheckpoints: boolean): boolean {
  if (!object(value) || value.version !== '0.4.1' || value.source !== 'real' || !text(value.id) || !integer(value.seed)
    || !bool(value.observationEnabled) || !caseId(value.caseId) || !node(value.node) || !phase(value.phase)
    || !member(value.status, ['active', 'cleared', 'returned', 'defeated']) || !nonnegative(value.hp) || !positive(value.maxHp)
    || !deck(value.deck) || !wallet(value.wallet) || !market(value.market, value.caseId)
    || !nullable(value.battle, (item) => battle(item, value.deck as RecordValue[]))
    || !nullable(value.camp, camp) || !nullable(value.reward, reward) || !bool(value.archiveOwned)
    || !nullable(value.supplyPlanCents, nonnegative) || !positive(value.nextCardNumber)
    || !array(value.history, (item) => gameEvent(item, value.caseId)) || !array(value.processedActionIds, text)) return false;
  // The reducer issues the next IDs from these counters; accepting a damaged
  // counter or history would create duplicates and misorder economic events.
  if ((value.deck as RecordValue[]).some((item) => {
    const serial = /^card-(0|[1-9]\d*)$/.exec(item.instanceId as string);
    return serial && BigInt(serial[1]!) >= BigInt(value.nextCardNumber as number);
  }) || !(value.history as RecordValue[]).every((item, index) => item.id === `e${index + 1}`)) return false;
  if (value.phase === 'battle' && !object(value.battle)) return false;
  if (value.phase === 'camp' && (!object(value.camp) || value.camp.node !== value.node)) return false;
  if (value.phase === 'reward' && !object(value.reward)) return false;
  if (value.phase === 'route' && !member(value.node, ['N3', 'N5'])) return false;
  if (!object(value.market) || (value.phase === 'market') !== (value.market.pending !== null)) return false;
  if ((value.phase === 'ended' && value.status === 'active')
    || (value.status !== 'active' && value.phase !== 'ended' && value.phase !== 'market') || !settlement(value)) return false;
  if (withCheckpoints) {
    if (!array(value.checkpoints, (item) => object(item) && text(item.id) && member(item.action, actions)
      && object(item.snapshot) && item.snapshot.id === value.id && item.snapshot.caseId === value.caseId && runFields(item.snapshot, false))) return false;
    const checkpoints = value.checkpoints as RecordValue[];
    if (new Set(checkpoints.map((item) => item.id)).size !== checkpoints.length) return false;
  }
  return true;
}

/** Validate stored structure and references only; never replay or repair a run. */
export function validateRun(value: unknown): value is Run { return runFields(value, true); }
