import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENEMIES } from './content';
import { canPlayCard, createRun, intentFor, pendingMarketStep, reduceRun } from './engine';
import { battleIntentForecast, enemyPattern } from './enemy-information';
import type { CardId, EnemyId, MarketQuote, Run } from './types';

function play(run: Run, cardId: CardId): Run {
  const card = run.deck.find((item) => item.cardId === cardId && run.battle?.hand.includes(item.instanceId));
  if (!card) throw new Error(`Seeded action ${cardId} is not legal`);
  return reduceRun(run, { type: 'play-card', cardInstanceId: card.instanceId });
}

function firstCamp(): Run {
  let run = createRun({ seed: 104 });
  for (const card of ['C02', 'C03', 'C01'] as CardId[]) run = play(run, card);
  run = reduceRun(run, { type: 'end-turn' });
  for (const card of ['C01', 'C04', 'C02', 'C02'] as CardId[]) run = play(run, card);
  run = reduceRun(run, { type: 'end-turn' });
  run = play(run, 'C02'); run = reduceRun(run, { type: 'end-turn' });
  run = play(run, 'C01'); run = reduceRun(run, { type: 'choose-reward', cardId: 'C07' });
  return run;
}

function reachMoss(): Run {
  let run = firstCamp();
  while (run.hp < run.maxHp) run = reduceRun(run, { type: 'heal' });
  run = reduceRun(run, { type: 'submit-entry', amountCents: 0 });
  run = reduceRun(run, { type: 'continue' });
  const pending = pendingMarketStep(run)!;
  const quote = JSON.parse(readFileSync(`public/data/adventure/stages/${pending.caseId}/${pending.stage}.json`, 'utf8')) as MarketQuote;
  run = reduceRun(run, { type: 'apply-quote', quote });
  return reduceRun(run, { type: 'choose-route', enemyId: 'moss' });
}

function blockIncoming(initial: Run): Run {
  let run = initial;
  for (let i = 0; i < 8; i++) {
    const battle = run.battle!;
    if (battle.enemy.intent.kind !== 'attack' || battle.shield >= battle.enemy.intent.amount) break;
    const hand = battle.hand.map((id) => run.deck.find((card) => card.instanceId === id)!).filter((card) => canPlayCard(run, card.instanceId).enabled);
    const card = hand.find((item) => item.cardId === 'C02') ?? hand.find((item) => item.cardId === 'C06')
      ?? (battle.energy >= 2 ? hand.find((item) => item.cardId === 'C03') : undefined);
    if (!card) break;
    run = reduceRun(run, { type: 'play-card', cardInstanceId: card.instanceId });
  }
  return run;
}

describe('public enemy patterns and intent forecasts', () => {
  it('exposes each initial cycle and HP as independent copies', () => {
    expect(enemyPattern('pursuer')).toEqual({ enemyId: 'pursuer', name: '追灯者', maxHp: 34, cycle: [
      { kind: 'attack', amount: 8 }, { kind: 'attack', amount: 8 }, { kind: 'attack', amount: 3 },
    ], attackGrowth: { fromTurn: 10, perTurn: 2 } });
    expect(enemyPattern('moss').cycle).toEqual([{ kind: 'shield', amount: 6 }, { kind: 'attack', amount: 5 }, { kind: 'attack', amount: 9 }]);
    expect(enemyPattern('clock').cycle).toEqual([{ kind: 'attack', amount: 12 }, { kind: 'shield', amount: 6 }, { kind: 'attack', amount: 4 }]);
    expect(enemyPattern('keeper').maxHp).toBe(90);
    expect(enemyPattern('gatekeeper').attackGrowth).toBeNull();
    const copy = enemyPattern('moss'); copy.cycle[0]!.amount = 999; copy.attackGrowth!.perTurn = 99;
    expect(ENEMIES.moss.cycle[0]!.amount).toBe(6);
    expect(enemyPattern('moss').attackGrowth?.perTurn).toBe(2);
  });

  it('applies turn-based escalation to attacks only, including shield turns in elapsed time', () => {
    expect([10, 11, 12].map((turn) => intentFor('gatekeeper', turn))).toEqual([
      { kind: 'attack', amount: 4 }, { kind: 'shield', amount: 4 }, { kind: 'attack', amount: 6 },
    ]);
    expect([10, 11, 12].map((turn) => intentFor('moss', turn))).toEqual([
      { kind: 'shield', amount: 6 }, { kind: 'attack', amount: 9 }, { kind: 'attack', amount: 15 },
    ]);
    expect([10, 11, 12].map((turn) => intentFor('clock', turn))).toEqual([
      { kind: 'attack', amount: 14 }, { kind: 'shield', amount: 6 }, { kind: 'attack', amount: 10 },
    ]);
    expect(intentFor('keeper', 12)).toEqual({ kind: 'shield', amount: 10 });
    expect(intentFor('pursuer', 9)).toEqual({ kind: 'attack', amount: 3 });
    expect(intentFor('pursuer', 10)).toEqual({ kind: 'attack', amount: 10 });
  });

  it('uses the actual current intent and does not touch hidden piles, RNG or the run', () => {
    const run = createRun({ seed: 104 });
    const before = JSON.stringify(run);
    const battle = new Proxy(run.battle!, { get(target, key, receiver) {
      if (['drawPile', 'discardPile', 'hand', 'rngState'].includes(String(key))) throw new Error('hidden state was read');
      return Reflect.get(target, key, receiver);
    } });
    const view = new Proxy(run, { get(target, key, receiver) {
      if (['deck', 'history', 'market', 'wallet'].includes(String(key))) throw new Error('unrelated state was read');
      return key === 'battle' ? battle : Reflect.get(target, key, receiver);
    } });
    expect(battleIntentForecast(view)).toEqual({ enemyId: 'gatekeeper', actions: [
      { timing: 'this-turn', turn: 1, intent: { kind: 'attack', amount: 4 } },
      { timing: 'next-turn', turn: 2, intent: { kind: 'shield', amount: 4 } },
      { timing: 'following-turn', turn: 3, intent: { kind: 'attack', amount: 6 } },
    ] });
    expect(JSON.stringify(run)).toBe(before);
    const oldSave = structuredClone(run);
    oldSave.battle!.enemy.intent = { kind: 'shield', amount: 13 };
    expect(battleIntentForecast(oldSave)!.actions[0].intent).toEqual({ kind: 'shield', amount: 13 });
    expect(battleIntentForecast(oldSave)!.actions[1].intent).toEqual({ kind: 'shield', amount: 4 });
  });

  it('matches actual tutorial actions and next turns without escalating', () => {
    let run = createRun({ seed: 104 });
    for (let turn = 1; turn <= 12; turn++) {
      const forecast = battleIntentForecast(run)!;
      expect(forecast.actions.map((action) => action.turn)).toEqual([turn, turn + 1, turn + 2]);
      const next = reduceRun(run, { type: 'end-turn' });
      const resolved = next.history.filter((event) => event.action === 'enemy-attack' || event.action === 'enemy-shield').at(-1)!;
      expect(resolved.data.amount).toBe(forecast.actions[0].intent.amount);
      expect(resolved.action).toBe(forecast.actions[0].intent.kind === 'attack' ? 'enemy-attack' : 'enemy-shield');
      expect(next.phase).toBe('battle');
      expect(next.battle!.enemy.intent).toEqual(forecast.actions[1].intent);
      run = next;
    }
    expect(run.battle!.turn).toBe(13);
  });

  it('matches a legally played moss battle across turns 9–12, including growth across a shield turn', () => {
    let run = reachMoss();
    for (let turn = 1; turn <= 12; turn++) {
      const forecast = battleIntentForecast(run)!;
      expect(forecast.actions[0].intent).toEqual(run.battle!.enemy.intent);
      if (turn === 9) expect(forecast.actions.map((action) => action.intent)).toEqual([
        { kind: 'attack', amount: 9 }, { kind: 'shield', amount: 6 }, { kind: 'attack', amount: 9 },
      ]);
      if (turn === 10) expect(run.battle!.enemy.attackBonus).toBe(2);
      if (turn === 11) expect(forecast.actions[0].intent).toEqual({ kind: 'attack', amount: 9 });
      if (turn === 12) expect(forecast.actions[0].intent).toEqual({ kind: 'attack', amount: 15 });
      run = blockIncoming(run);
      const next = reduceRun(run, { type: 'end-turn' });
      expect(next.phase).toBe('battle');
      expect(next.battle!.enemy.intent).toEqual(forecast.actions[1].intent);
      run = next;
    }
  });

  it('returns unknown outside battle or for invalid saved intent data', () => {
    const run = createRun({ seed: 104 });
    const damaged = structuredClone(run);
    damaged.battle!.turn = 0;
    expect(battleIntentForecast(damaged)).toBeNull();
    damaged.battle!.turn = 1; damaged.battle!.enemy.id = 'unknown' as EnemyId;
    expect(battleIntentForecast(damaged)).toBeNull();
    expect(battleIntentForecast(firstCamp())).toBeNull();
  });
});
