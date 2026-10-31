import { CARDS } from './content';
import type { CardId, CardInstance, GameEvent, Run } from './types';

export interface BattleCardGroup {
  cardId: CardId;
  upgraded: boolean;
  count: number;
  /** Counts apply to hand only and can overlap for the same card. */
  retainedPermanent: number;
  retainedOnce: number;
}

export interface BattleZoneSummary {
  /** The publicly visible number of entries; null means it cannot be read. */
  total: number | null;
  /** False means one or more entries could not be resolved reliably. */
  complete: boolean;
  groups: BattleCardGroup[];
}

export interface BattleZones {
  deck: BattleZoneSummary;
  hand: BattleZoneSummary;
  draw: BattleZoneSummary;
  discard: BattleZoneSummary;
  exhaust: BattleZoneSummary;
}

export interface TurnEnergySummary {
  turn: number;
  capacity: number;
  locked: number;
  restoredEnergy: number;
  overloadSettled: boolean;
}

function validCard(card: CardInstance): boolean {
  return !!card && typeof card.instanceId === 'string' && card.instanceId.length > 0
    && typeof card.cardId === 'string' && Object.prototype.hasOwnProperty.call(CARDS, card.cardId)
    && typeof card.upgraded === 'boolean';
}

function grouped(cards: CardInstance[], hand: boolean, retainedOnce: ReadonlySet<string>): BattleCardGroup[] {
  const groups = new Map<string, BattleCardGroup>();
  for (const card of cards) {
    const key = `${card.cardId}:${card.upgraded ? '1' : '0'}`;
    const item = groups.get(key) ?? { cardId: card.cardId, upgraded: card.upgraded, count: 0, retainedPermanent: 0, retainedOnce: 0 };
    item.count++;
    if (hand && CARDS[card.cardId].retain) item.retainedPermanent++;
    if (hand && retainedOnce.has(card.instanceId)) item.retainedOnce++;
    groups.set(key, item);
  }
  return [...groups.values()].sort((a, b) => a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : Number(a.upgraded) - Number(b.upgraded));
}

/**
 * A read-only inventory of public information. The draw pile is the known
 * deck minus hand/discard/exhaust, never a serialization of draw order.
 * Corrupt or incomplete partitions do not produce a guessed draw composition.
 */
export function battleZones(run: Run): BattleZones | null {
  const battle = run.battle;
  if (run.phase !== 'battle' || !battle) return null;

  const rawDeck = Array.isArray(run.deck) ? run.deck : null;
  const rawHand = Array.isArray(battle.hand) ? battle.hand : null;
  const rawDraw = Array.isArray(battle.drawPile) ? battle.drawPile : null;
  const rawDiscard = Array.isArray(battle.discardPile) ? battle.discardPile : null;
  const rawExhaust = Array.isArray(battle.exhaustPile) ? battle.exhaustPile : null;
  const rawZones = [rawHand, rawDraw, rawDiscard, rawExhaust];
  const retainedOnce = new Set(Array.isArray(battle.retainedOnce) ? battle.retainedOnce : []);

  const deckCounts = new Map<string, number>();
  for (const card of rawDeck ?? []) {
    if (card && typeof card.instanceId === 'string' && card.instanceId.length > 0) deckCounts.set(card.instanceId, (deckCounts.get(card.instanceId) ?? 0) + 1);
  }
  const byId = new Map<string, CardInstance>();
  for (const card of rawDeck ?? []) if (validCard(card) && deckCounts.get(card.instanceId) === 1) byId.set(card.instanceId, card);
  const deckComplete = !!rawDeck && byId.size === rawDeck.length;
  const referenceCounts = new Map<string, number>();
  for (const zone of rawZones) for (const id of zone ?? []) if (typeof id === 'string') referenceCounts.set(id, (referenceCounts.get(id) ?? 0) + 1);
  const resolves = (id: unknown): id is string => typeof id === 'string' && byId.has(id) && referenceCounts.get(id) === 1;
  const summary = (zone: string[] | null, hand: boolean): BattleZoneSummary => {
    const cards = (zone ?? []).filter(resolves).map((id) => byId.get(id)!);
    return { total: zone?.length ?? null, complete: zone !== null && cards.length === zone.length, groups: grouped(cards, hand, retainedOnce) };
  };
  const hand = summary(rawHand, true);
  const discard = summary(rawDiscard, false);
  const exhaust = summary(rawExhaust, false);
  const drawReferencesComplete = rawDraw !== null && rawDraw.every(resolves);
  const partitionComplete = deckComplete && hand.complete && discard.complete && exhaust.complete && drawReferencesComplete
    && referenceCounts.size === byId.size && [...byId.keys()].every((id) => referenceCounts.get(id) === 1);

  let draw: BattleZoneSummary = { total: rawDraw?.length ?? null, complete: false, groups: [] };
  if (partitionComplete) {
    const visible = new Set([...(rawHand ?? []), ...(rawDiscard ?? []), ...(rawExhaust ?? [])]);
    const inferred = [...byId.values()].filter((card) => !visible.has(card.instanceId));
    draw = { total: rawDraw!.length, complete: true, groups: grouped(inferred, false, retainedOnce) };
  }
  return {
    deck: { total: rawDeck?.length ?? null, complete: deckComplete, groups: grouped([...byId.values()], false, retainedOnce) },
    hand, draw, discard, exhaust,
  };
}

function nonnegativeInteger(event: GameEvent, key: string): number | null {
  const value = event.data?.[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Do not infer a start-of-turn recovery from current energy or another battle. */
export function turnEnergySummary(run: Run): TurnEnergySummary | null {
  if (run.phase !== 'battle' || !run.battle || !Array.isArray(run.history)) return null;
  let start = -1;
  for (let i = run.history.length - 1; i >= 0; i--) {
    const event = run.history[i];
    if (event?.type === 'battle' && event.action === 'battle-start') { start = i; break; }
  }
  if (start < 0 || run.history[start]?.node !== run.node) return null;
  let latest: GameEvent | undefined;
  for (let i = run.history.length - 1; i > start; i--) {
    const event = run.history[i];
    if (event?.type === 'battle' && event.node === run.node && event.action === 'turn-start') { latest = event; break; }
  }
  if (!latest) return null;
  const turn = nonnegativeInteger(latest, 'turn');
  const capacity = nonnegativeInteger(latest, 'capacity');
  const locked = nonnegativeInteger(latest, 'locked');
  const restoredEnergy = nonnegativeInteger(latest, 'energy');
  if (turn === null || turn !== run.battle.turn || capacity === null || capacity === 0 || locked === null || restoredEnergy === null
    || locked > capacity || restoredEnergy !== capacity - locked) return null;
  return { turn, capacity, locked, restoredEnergy, overloadSettled: locked > 0 };
}
