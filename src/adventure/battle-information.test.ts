import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { battleZones, turnEnergySummary } from './battle-information';
import { createRun, reduceRun } from './engine';
import type { CardId, MarketQuote, Run } from './types';

function play(run: Run, cardId: CardId, retainCardId?: string): Run {
  const card = run.deck.find((item) => item.cardId === cardId && run.battle?.hand.includes(item.instanceId));
  if (!card) throw new Error(`没有可打出的 ${cardId}。`);
  return reduceRun(run, { type: 'play-card', cardInstanceId: card.instanceId, ...(retainCardId ? { retainCardId } : {}) });
}

function rig(cards: CardId[]): Run {
  const run = createRun({ seed: 104 });
  run.deck = cards.map((cardId, index) => ({ instanceId: `test-${index}`, cardId, upgraded: false }));
  run.battle!.hand = run.deck.map((card) => card.instanceId);
  run.battle!.drawPile = []; run.battle!.discardPile = []; run.battle!.exhaustPile = [];
  return run;
}

function groupCount(run: Run, zone: 'deck' | 'hand' | 'draw' | 'discard' | 'exhaust', cardId: CardId): number {
  return battleZones(run)![zone].groups.filter((group) => group.cardId === cardId).reduce((sum, group) => sum + group.count, 0);
}

describe('read-only battle information', () => {
  it('groups the public deck and zones in stable card/upgrade order', () => {
    const run = rig(['C02', 'C01', 'C02', 'C02', 'C01']);
    run.deck[0]!.upgraded = true; run.deck[4]!.upgraded = true;
    const zones = battleZones(run)!;
    expect(zones.deck).toMatchObject({ total: 5, complete: true });
    expect(zones.hand.groups.map(({ cardId, upgraded, count }) => ({ cardId, upgraded, count }))).toEqual([
      { cardId: 'C01', upgraded: false, count: 1 }, { cardId: 'C01', upgraded: true, count: 1 },
      { cardId: 'C02', upgraded: false, count: 2 }, { cardId: 'C02', upgraded: true, count: 1 },
    ]);
    expect(zones.draw).toEqual({ total: 0, complete: true, groups: [] });
    expect(zones.deck.groups.every((group) => group.retainedPermanent === 0 && group.retainedOnce === 0)).toBe(true);
  });

  it('reports the same inferred draw composition regardless of hidden order or RNG without modifying state', () => {
    const run = createRun({ seed: 104 });
    const reordered = structuredClone(run);
    reordered.battle!.drawPile.reverse(); reordered.battle!.rngState = 1234567;
    const before = JSON.stringify(run); const reorderedBefore = JSON.stringify(reordered);
    const a = battleZones(run); const b = battleZones(reordered);
    expect(a).toEqual(b);
    expect(a!.draw).toMatchObject({ total: 5, complete: true });
    const output = JSON.stringify(a);
    expect(output).not.toContain('card-');
    expect(output).not.toContain('instanceId');
    expect(output).not.toContain('rngState');
    expect(output).not.toContain('drawPile');
    expect(JSON.stringify(run)).toBe(before);
    expect(JSON.stringify(reordered)).toBe(reorderedBefore);
  });

  it('marks only current hand cards as permanent or one-turn retained', () => {
    let run = rig(['C14', 'C01', 'C12']);
    run = play(run, 'C14', 'test-1');
    let zones = battleZones(run)!;
    expect(zones.hand.groups.find((group) => group.cardId === 'C01')).toMatchObject({ retainedOnce: 1, retainedPermanent: 0 });
    expect(zones.hand.groups.find((group) => group.cardId === 'C12')).toMatchObject({ retainedPermanent: 1 });
    expect(zones.exhaust.groups.find((group) => group.cardId === 'C14')).toMatchObject({ retainedOnce: 0 });
    run = play(run, 'C01');
    expect(run.battle!.retainedOnce).toContain('test-1'); // Reducer clears the stale flag at turn end.
    zones = battleZones(run)!;
    expect(zones.discard.groups.find((group) => group.cardId === 'C01')).toMatchObject({ retainedOnce: 0, retainedPermanent: 0 });
    run = reduceRun(run, { type: 'end-turn' });
    zones = battleZones(run)!;
    expect(zones.hand.groups.find((group) => group.cardId === 'C12')).toMatchObject({ retainedPermanent: 1 });
    expect(zones.hand.groups.find((group) => group.cardId === 'C01')).toMatchObject({ retainedOnce: 0 });
  });

  it('keeps a one-turn retention separate from inherent retention', () => {
    let run = rig(['C14', 'C01', 'C12']);
    run = play(run, 'C14', 'test-1');
    run = reduceRun(run, { type: 'end-turn' });
    const hand = battleZones(run)!.hand.groups;
    expect(hand.find((group) => group.cardId === 'C01')).toMatchObject({ retainedOnce: 0, retainedPermanent: 0 });
    expect(hand.find((group) => group.cardId === 'C12')).toMatchObject({ retainedPermanent: 1 });
  });

  it('allows permanent and one-turn retention to overlap without counting extra cards', () => {
    let run = rig(['C14', 'C12']);
    run = play(run, 'C14', 'test-1');
    expect(battleZones(run)!.hand.groups.find((group) => group.cardId === 'C12')).toMatchObject({
      count: 1, retainedPermanent: 1, retainedOnce: 1,
    });
    run = reduceRun(run, { type: 'end-turn' });
    expect(battleZones(run)!.hand.groups.find((group) => group.cardId === 'C12')).toMatchObject({
      count: 1, retainedPermanent: 1, retainedOnce: 0,
    });
  });

  it('shows exhaust only during the current battle and restores the full deck at the next battle', () => {
    let run = createRun({ seed: 104 });
    for (const card of ['C02', 'C03', 'C01'] as CardId[]) run = play(run, card);
    run = reduceRun(run, { type: 'end-turn' });
    run = play(run, 'C01'); run = play(run, 'C04');
    expect(groupCount(run, 'exhaust', 'C04')).toBe(1);
    expect(groupCount(run, 'deck', 'C04')).toBe(1);
    expect(groupCount(run, 'draw', 'C04')).toBe(0);
    run = play(run, 'C02'); run = play(run, 'C02'); run = reduceRun(run, { type: 'end-turn' });
    run = play(run, 'C02'); run = reduceRun(run, { type: 'end-turn' });
    run = play(run, 'C01');
    expect(battleZones(run)).toBeNull();
    run = reduceRun(run, { type: 'choose-reward', cardId: null });
    run = reduceRun(run, { type: 'submit-entry', amountCents: 0 });
    run = reduceRun(run, { type: 'continue' });
    const entry = JSON.parse(readFileSync('public/data/adventure/stages/lantern-a/entry.json', 'utf8')) as MarketQuote;
    run = reduceRun(run, { type: 'apply-quote', quote: entry });
    run = reduceRun(run, { type: 'choose-route', enemyId: 'moss' });
    const zones = battleZones(run)!;
    expect(zones.exhaust).toEqual({ total: 0, complete: true, groups: [] });
    expect(groupCount(run, 'hand', 'C04') + groupCount(run, 'draw', 'C04')).toBe(1);
    expect(groupCount(run, 'deck', 'C04')).toBe(1);
  });

  it('does not invent draw cards when instances are missing, duplicated or in conflicting zones', () => {
    const unknown = createRun({ seed: 104 });
    unknown.battle!.hand[0] = 'missing-card';
    const one = battleZones(unknown)!;
    expect(one.hand.complete).toBe(false);
    expect(one.hand.total).toBe(5);
    expect(one.hand.groups.reduce((sum, group) => sum + group.count, 0)).toBe(4);
    expect(one.draw).toMatchObject({ complete: false, groups: [] });

    const duplicated = createRun({ seed: 104 });
    duplicated.battle!.drawPile.push(duplicated.battle!.hand[0]!);
    const two = battleZones(duplicated)!;
    expect(two.hand.complete).toBe(false);
    expect(two.draw).toMatchObject({ complete: false, groups: [] });

    const badDeck = createRun({ seed: 104 });
    badDeck.deck.push({ ...badDeck.deck[0]! });
    const three = battleZones(badDeck)!;
    expect(three.deck.complete).toBe(false);
    expect(three.deck.groups.reduce((sum, group) => sum + group.count, 0)).toBe(9);
    expect(three.draw).toMatchObject({ complete: false, groups: [] });

    const missingZone = createRun({ seed: 104 });
    missingZone.battle!.drawPile = null as unknown as string[];
    expect(battleZones(missingZone)!.draw).toEqual({ total: null, complete: false, groups: [] });
  });

  it('uses the actual current-battle turn-start record, not current energy after another action', () => {
    let run = createRun({ seed: 104 });
    const fire = run.deck.find((card) => card.cardId === 'C04')!;
    const growth = run.deck.find((card) => card.cardId === 'C05')!;
    run.battle!.hand = [fire.instanceId, growth.instanceId];
    run.battle!.drawPile = run.deck.filter((card) => card.instanceId !== fire.instanceId && card.instanceId !== growth.instanceId).map((card) => card.instanceId);
    expect(turnEnergySummary(run)).toBeNull(); // battle-start is not a turn-start event.
    run = play(run, 'C04');
    expect(run.battle!.energy).toBe(5);
    expect(turnEnergySummary(run)).toBeNull();
    run = play(run, 'C05');
    run = reduceRun(run, { type: 'end-turn' });
    expect(turnEnergySummary(run)).toEqual({ turn: 2, capacity: 4, locked: 2, restoredEnergy: 2, overloadSettled: true });
    const oneCost = run.battle!.hand.map((id) => run.deck.find((card) => card.instanceId === id)!).find((card) => card.cardId === 'C01' || card.cardId === 'C02')!;
    run = reduceRun(run, { type: 'play-card', cardInstanceId: oneCost.instanceId });
    expect(run.battle!.energy).toBe(1);
    expect(turnEnergySummary(run)?.restoredEnergy).toBe(2);
    run = reduceRun(run, { type: 'end-turn' });
    expect(turnEnergySummary(run)).toEqual({ turn: 3, capacity: 4, locked: 0, restoredEnergy: 4, overloadSettled: false });
  });

  it('returns unknown for missing, stale, inconsistent or different-battle recovery records', () => {
    let run = rig(['C01']);
    run = reduceRun(run, { type: 'end-turn' });
    const original = JSON.stringify(run);
    expect(turnEnergySummary(run)?.turn).toBe(2);
    const missing = structuredClone(run);
    const latest = missing.history.filter((event) => event.action === 'turn-start').at(-1)!;
    delete latest.data.energy;
    expect(turnEnergySummary(missing)).toBeNull();
    const missingData = structuredClone(run);
    missingData.history.filter((event) => event.action === 'turn-start').at(-1)!.data = undefined as never;
    expect(turnEnergySummary(missingData)).toBeNull();
    const inconsistent = structuredClone(run);
    inconsistent.history.filter((event) => event.action === 'turn-start').at(-1)!.data.energy = 99;
    expect(turnEnergySummary(inconsistent)).toBeNull();
    const stale = structuredClone(run); stale.battle!.turn++;
    expect(turnEnergySummary(stale)).toBeNull();
    const other = structuredClone(run);
    other.history.push({ id: 'other-start', type: 'battle', node: 'N3', action: 'battle-start', message: '', data: { enemyId: 'moss', hp: 42 } });
    expect(turnEnergySummary(other)).toBeNull();
    expect(JSON.stringify(run)).toBe(original);
  });
});
