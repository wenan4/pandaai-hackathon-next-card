import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENEMIES } from './content';
import { canPlayCard, createRun, pendingMarketStep, reduceRun } from './engine';
import { emptyResearchProfile } from './research';
import { parseAdventureSave } from './save-state';
import type { CardId, CardInstance, MarketQuote, Run } from './types';

type Style = 'combo' | 'growth';
type Strategy = Style | 'attack-only';
const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 104, 2026];

function deliver(run: Run): Run {
  const request = pendingMarketStep(run)!;
  const quote = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'adventure', 'stages', request.caseId, `${request.stage}.json`), 'utf8')) as MarketQuote;
  return reduceRun(run, { type: 'apply-quote', quote });
}
function attackValue(card: CardInstance, bonus: number): number {
  switch (card.cardId) {
    case 'C01': return (card.upgraded ? 9 : 6) + bonus;
    case 'C07': return 3 * ((card.upgraded ? 4 : 3) + bonus);
    case 'C09': return (card.upgraded ? 16 : 12) + bonus;
    case 'C12': return (card.upgraded ? 34 : 26) + bonus;
    case 'C13': return (card.upgraded ? 18 : 14) + bonus;
    default: return 0;
  }
}
/** Same declared policy as the existing simulation; not a human-play claim. */
function chooseCard(run: Run, style: Strategy): CardInstance | undefined {
  const battle = run.battle!;
  const hand = battle.hand.map((id) => run.deck.find((card) => card.instanceId === id)!);
  const eligible = hand.filter((card) => canPlayCard(run, card.instanceId).enabled);
  const get = (id: CardId): CardInstance | undefined => eligible.find((card) => card.cardId === id);
  const attack = (): CardInstance | undefined => get('C12') ?? get('C13') ?? get('C09') ?? get('C07') ?? get('C01');
  if (style === 'attack-only') return attack();
  const lethal = eligible.find((card) => attackValue(card, battle.attackBonus) >= battle.enemy.hp + battle.enemy.shield && attackValue(card, battle.attackBonus) > 0);
  if (lethal) return lethal;
  const incoming = battle.enemy.intent.kind === 'attack' ? Math.max(0, battle.enemy.intent.amount - battle.shield) : 0;
  const block = (): CardInstance | undefined => get('C10') ?? get('C02') ?? get('C06');
  if (incoming >= run.hp && block()) return block();
  if (get('C04') && battle.energy <= 2 && hand.some((card) => card.cardId !== 'C04')) return get('C04');
  if (battle.turn <= 2 && battle.enemy.hp > 24 && battle.energy >= 2 && run.hp > 12 && battle.capacity < (style === 'growth' ? 5 : 4)) {
    const growth = get('C11') ?? get('C05');
    if (growth) return growth;
  }
  if (get('C08') && get('C07') && battle.energy >= 2) return get('C08');
  if (incoming >= 4 && block()) return block();
  if (get('C03') && battle.energy >= 2 && battle.hand.length <= 5) return get('C03');
  if (get('C14')) return get('C14');
  return attack() ?? get('C06') ?? get('C02') ?? get('C03');
}
function stepBattle(run: Run, style: Strategy): Run {
  const card = chooseCard(run, style);
  if (!card) return reduceRun(run, { type: 'end-turn' });
  const retain = card.cardId === 'C14' ? run.battle!.hand.find((id) => id !== card.instanceId) : undefined;
  return reduceRun(run, { type: 'play-card', cardInstanceId: card.instanceId, ...(retain ? { retainCardId: retain } : {}) });
}

/** Reach the last camp with only legal actions and stage-specific quotes. */
function prepared(seed: number, style: Style): Run | null {
  let run = createRun({ seed, caseId: 'lantern-a' });
  let entered = false;
  for (let step = 0; step < 1000; step++) {
    if (run.status !== 'active') return null;
    if (run.phase === 'market') { run = deliver(run); continue; }
    if (run.phase === 'battle') { run = stepBattle(run, style); continue; }
    if (run.phase === 'reward') {
      const cardId: CardId = run.node === 'N1' ? style === 'growth' ? 'C11' : 'C07'
        : run.node === 'N3' ? style === 'growth' ? 'C12' : 'C08' : style === 'growth' ? 'C13' : 'C09';
      run = reduceRun(run, { type: 'choose-reward', cardId }); continue;
    }
    if (run.phase === 'route') {
      if (run.hp <= 30 && run.wallet.cashCents >= 1000) run = reduceRun(run, { type: 'heal' });
      else run = reduceRun(run, { type: 'choose-route', enemyId: seed % 2 === 0 ? 'moss' : run.node === 'N3' ? 'pursuer' : 'clock' });
      continue;
    }
    if (run.phase === 'camp') {
      if (run.node === 'N2') {
        if (!entered) {
          run = reduceRun(run, { type: 'buy-card', cardId: style === 'growth' ? 'C12' : 'C08' });
          run = reduceRun(run, { type: 'submit-entry', amountCents: 2000 }); entered = true;
        }
        run = reduceRun(run, { type: 'continue' }); continue;
      }
      if (run.camp!.decision === 'not-submitted') { run = reduceRun(run, { type: 'submit-redemption', percent: run.node === 'N4' ? 50 : 0 }); continue; }
      if (!run.camp!.freeChoiceUsed) {
        const basic = run.deck.find((card) => card.cardId === 'C01' && !card.upgraded);
        run = run.hp >= 38 && basic ? reduceRun(run, { type: 'free-upgrade', cardInstanceId: basic.instanceId }) : reduceRun(run, { type: 'free-rest' }); continue;
      }
      if (run.hp <= 31 && run.wallet.cashCents >= 1000) { run = reduceRun(run, { type: 'heal' }); continue; }
      const upgrade = run.deck.find((card) => card.cardId === (style === 'growth' ? 'C05' : 'C07') && !card.upgraded);
      if (upgrade && run.wallet.cashCents >= 3000) { run = reduceRun(run, { type: 'upgrade-card', cardInstanceId: upgrade.instanceId }); continue; }
      if (run.node === 'N6') return run;
      run = reduceRun(run, { type: 'continue' }); continue;
    }
  }
  throw new Error('未能到达守灯者');
}

function bossFrom(camp: Run, style: Strategy, hp: number): { run: Run; first: Run; turns: number; actions: number } {
  ENEMIES.keeper.maxHp = hp;
  const first = reduceRun(camp, { type: 'continue' });
  let run = first; let turns = 0; let actions = 0;
  while (run.phase === 'battle' && actions < 500) {
    turns = run.battle!.turn;
    run = stepBattle(run, style); actions++;
  }
  if (run.phase === 'battle') throw new Error('战斗没有结束');
  return { run, first, turns, actions };
}

describe('keeper balance on paired deterministic runs', () => {
  it('compares the same prepared decks through the official reducer', () => {
    const original = ENEMIES.keeper.maxHp;
    try {
      expect(original).toBe(75);
      expect(ENEMIES.keeper.maxHp).toBeGreaterThan(ENEMIES.moss.maxHp);
      expect(ENEMIES.keeper.cycle).toEqual([{ kind: 'attack', amount: 6 }, { kind: 'attack', amount: 14 }, { kind: 'shield', amount: 10 }]);
      const results = (['combo', 'growth'] as const).flatMap((style) => seeds.flatMap((seed) => {
        const camp = prepared(seed, style);
        if (!camp) return [];
        return [{ style, seed, old: bossFrom(camp, style, 90), current: bossFrom(camp, style, 75), reckless: bossFrom(camp, 'attack-only', 75) }];
      }));
      const pairs = results.filter((row) => row.old.run.status === 'cleared' && row.current.run.status === 'cleared');
      const average = (values: number[]) => values.reduce((sum, item) => sum + item, 0) / values.length;
      if (process.env.KEEPER_TRACE) console.log('keeper simulation', JSON.stringify({ starts: results.length, pairs: pairs.length, oldTurns: average(pairs.map((row) => row.old.turns)), newTurns: average(pairs.map((row) => row.current.turns)), oldActions: average(pairs.map((row) => row.old.actions)), newActions: average(pairs.map((row) => row.current.actions)), attackOnlyDefeats: results.filter((row) => row.reckless.run.status === 'defeated').length, changed: results.filter((row) => row.old.run.status !== row.current.run.status).map((row) => ({ seed: row.seed, style: row.style, old: row.old.run.status, current: row.current.run.status })) }));
      expect(results.length).toBeGreaterThan(12);
      for (const row of results) {
        expect(row.old.first.battle?.hand).toEqual(row.current.first.battle?.hand);
        expect(row.old.first.battle?.enemy.intent).toEqual(row.current.first.battle?.enemy.intent);
      }
      expect(pairs.length).toBeGreaterThan(12);
      expect(average(pairs.map((row) => row.current.turns))).toBeLessThan(average(pairs.map((row) => row.old.turns)));
      expect(average(pairs.map((row) => row.current.actions))).toBeLessThan(average(pairs.map((row) => row.old.actions)));
      expect(results.some((row) => row.reckless.run.status === 'defeated')).toBe(true);
      expect(results.some((row) => row.reckless.run.status === 'cleared')).toBe(true);
    } finally { ENEMIES.keeper.maxHp = original; }
  }, 30000);

  it('preserves an already saved old 90-HP battle when the default changes', () => {
    const original = ENEMIES.keeper.maxHp;
    try {
      const camp = prepared(104, 'combo')!;
      ENEMIES.keeper.maxHp = 90;
      const oldBattle = reduceRun(camp, { type: 'continue' });
      const saved = JSON.stringify({ schema: 'nextcard-adventure-save-v1', savedAt: 1000, observationStartedAt: 900, run: oldBattle, profile: emptyResearchProfile(true) });
      ENEMIES.keeper.maxHp = 75;
      const restored = parseAdventureSave(saved);
      expect(restored.kind).toBe('valid');
      if (restored.kind !== 'valid') throw new Error('无法恢复旧存档');
      expect(restored.value.run.battle?.enemy).toMatchObject({ id: 'keeper', hp: 90, maxHp: 90 });
      const after = reduceRun(restored.value.run, { type: 'end-turn' });
      expect(after.battle?.enemy).toMatchObject({ id: 'keeper', hp: 90, maxHp: 90 });
    } finally { ENEMIES.keeper.maxHp = original; }
  });
});
