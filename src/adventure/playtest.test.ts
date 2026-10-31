import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARDS } from './content';
import { canPlayCard, createRun, pendingMarketStep, reduceRun } from './engine';
import type { CardId, CardInstance, MarketQuote, Run } from './types';

/**
 * Deterministic, declared policies for a small simulation, not human playtests.
 * All decisions and settlements use the same public reducer as the application.
 */
type Style = 'combo' | 'growth' | 'mixed' | 'attack-only';
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 104, 2026];
interface Outcome { status: Run['status']; node: Run['node']; hp: number; battlesWon: number; turns: number; usedGrowth: boolean; usedCombo: boolean; cards: number; cashCents: number }

function quoteFor(run: Run): MarketQuote {
  const pending = pendingMarketStep(run);
  if (!pending) throw new Error('模拟中没有可请求的阶段。');
  // Read only the stage the reducer currently requests, as the UI does.
  return JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'adventure', 'stages', pending.caseId, `${pending.stage}.json`), 'utf8')) as MarketQuote;
}

function attackValue(card: CardInstance, attackBonus: number): number {
  switch (card.cardId) {
    case 'C01': return (card.upgraded ? 9 : 6) + attackBonus;
    case 'C07': return 3 * ((card.upgraded ? 4 : 3) + attackBonus);
    case 'C09': return (card.upgraded ? 16 : 12) + attackBonus;
    case 'C12': return (card.upgraded ? 34 : 26) + attackBonus;
    case 'C13': return (card.upgraded ? 18 : 14) + attackBonus;
    default: return 0;
  }
}

function chooseCard(run: Run, style: Style): CardInstance | undefined {
  const battle = run.battle!;
  const hand = battle.hand.map((id) => run.deck.find((card) => card.instanceId === id)!);
  const eligible = hand.filter((card) => canPlayCard(run, card.instanceId).enabled);
  const get = (cardId: CardId) => eligible.find((card) => card.cardId === cardId);
  const attack = () => get('C12') ?? get('C13') ?? get('C09') ?? get('C07') ?? get('C01');
  // The baseline intentionally ignores enemy intent, block, draw, growth and combos.
  if (style === 'attack-only') return attack();
  const lethal = eligible.find((card) => attackValue(card, battle.attackBonus) >= battle.enemy.hp + battle.enemy.shield && attackValue(card, battle.attackBonus) > 0);
  if (lethal) return lethal;
  const incoming = battle.enemy.intent.kind === 'attack' ? Math.max(0, battle.enemy.intent.amount - battle.shield) : 0;
  const block = () => get('C10') ?? get('C02') ?? get('C06');
  if (incoming >= run.hp && block()) return block();
  // Borrow only when another card can use the immediate energy.
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

function simulate(seed: number, style: Style, amountCents = 0): Outcome {
  let run = createRun({ seed, caseId: 'lantern-a', source: 'demo', observationEnabled: false });
  let entered = false;
  let turns = 0;
  let usedGrowth = false;
  let usedCombo = false;
  for (let step = 0; step < 1000 && run.phase !== 'ended'; step++) {
    if (run.phase === 'market') { run = reduceRun(run, { type: 'apply-quote', quote: quoteFor(run) }); continue; }
    if (run.phase === 'reward') {
      const cardId: CardId | null = run.node === 'N1' ? style === 'growth' ? 'C11' : 'C07'
        : run.node === 'N3' ? style === 'growth' || style === 'mixed' ? 'C12' : style === 'combo' ? 'C08' : null
          : style === 'growth' || style === 'mixed' ? 'C13' : 'C09';
      run = reduceRun(run, { type: 'choose-reward', cardId }); continue;
    }
    if (run.phase === 'camp') {
      if (run.node === 'N2') {
        if (!entered) {
          if (style !== 'attack-only') run = reduceRun(run, { type: 'buy-card', cardId: style === 'growth' ? 'C12' : 'C08' });
          run = reduceRun(run, { type: 'submit-entry', amountCents }); entered = true;
        }
        run = reduceRun(run, { type: 'continue' }); continue;
      }
      if (run.camp!.decision === 'not-submitted') {
        run = reduceRun(run, { type: 'submit-redemption', percent: amountCents > 0 && run.node === 'N4' ? 50 : 0 }); continue;
      }
      if (!run.camp!.freeChoiceUsed) {
        const basic = run.deck.find((card) => card.cardId === 'C01' && !card.upgraded);
        run = run.hp >= 38 && basic ? reduceRun(run, { type: 'free-upgrade', cardInstanceId: basic.instanceId }) : reduceRun(run, { type: 'free-rest' }); continue;
      }
      if (run.hp <= 31 && run.wallet.cashCents >= 1000) { run = reduceRun(run, { type: 'heal' }); continue; }
      const upgrade = run.deck.find((card) => card.cardId === (style === 'growth' ? 'C05' : 'C07') && !card.upgraded);
      if (upgrade && run.wallet.cashCents >= 3000) { run = reduceRun(run, { type: 'upgrade-card', cardInstanceId: upgrade.instanceId }); continue; }
      run = reduceRun(run, { type: 'continue' }); continue;
    }
    if (run.phase === 'route') {
      if (run.hp <= 30 && run.wallet.cashCents >= 1000) { run = reduceRun(run, { type: 'heal' }); continue; }
      // Both actual route options are exercised, with the same seed-to-route rule for all policies.
      const enemyId = seed % 2 === 0 ? 'moss' : run.node === 'N3' ? 'pursuer' : 'clock';
      run = reduceRun(run, { type: 'choose-route', enemyId }); continue;
    }
    if (run.phase !== 'battle' || !run.battle) throw new Error('模拟遇到未知状态。');
    const card = chooseCard(run, style);
    if (!card) { turns++; run = reduceRun(run, { type: 'end-turn' }); continue; }
    if (card.cardId === 'C05' || card.cardId === 'C11') usedGrowth = true;
    if (card.cardId === 'C07' && run.battle.attackBonus > 0) usedCombo = true;
    const retainCardId = card.cardId === 'C14' ? run.battle.hand.find((id) => id !== card.instanceId) : undefined;
    run = reduceRun(run, { type: 'play-card', cardInstanceId: card.instanceId, ...(retainCardId ? { retainCardId } : {}) });
  }
  if (run.phase !== 'ended') throw new Error('模拟超过动作上限，未到终局。');
  return { status: run.status, node: run.node, hp: run.hp, battlesWon: run.history.filter((event) => event.action === 'victory').length, turns, usedGrowth, usedCombo, cards: run.deck.length, cashCents: run.wallet.cashCents };
}

describe('small deterministic policy simulation, not human testing', () => {
  it('quantifies the tutorial opening and always presents at least one playable card', () => {
    let noAttack = 0;
    let noAttackOrDraw = 0;
    const examples: number[] = [];
    const noDrawExamples: number[] = [];
    for (let seed = 0; seed < 1024; seed++) {
      const run = createRun({ seed });
      const hand = run.battle!.hand.map((id) => run.deck.find((card) => card.instanceId === id)!);
      expect(hand.some((card) => canPlayCard(run, card.instanceId).enabled)).toBe(true);
      if (!hand.some((card) => CARDS[card.cardId].attack)) {
        noAttack++; if (examples.length < 5) examples.push(seed);
        if (!hand.some((card) => card.cardId === 'C03' || card.cardId === 'C06')) { noAttackOrDraw++; if (noDrawExamples.length < 5) noDrawExamples.push(seed); }
      }
    }
    if (process.env.PLAYTEST_TRACE) console.log('tutorial: 1024 seeds, opening hands without an attack:', noAttack, 'examples:', examples.join(','), '; without attack or draw:', noAttackOrDraw, 'examples:', noDrawExamples.join(','), '; all had a playable card');
  });

  it('can protect and draw a fresh hand when a tutorial opening lacks both attack and draw', () => {
    for (const seed of [327, 346, 664]) {
      let run = createRun({ seed });
      const hand = run.battle!.hand.map((id) => run.deck.find((card) => card.instanceId === id)!);
      if (hand.some((card) => CARDS[card.cardId].attack || card.cardId === 'C03' || card.cardId === 'C06')) continue;
      const block = hand.find((card) => card.cardId === 'C02' && canPlayCard(run, card.instanceId).enabled);
      expect(block).toBeDefined();
      run = reduceRun(run, { type: 'play-card', cardInstanceId: block!.instanceId });
      run = reduceRun(run, { type: 'end-turn' });
      expect(run.hp).toBe(42);
      expect(run.battle!.turn).toBe(2);
      expect(run.battle!.hand.some((id) => CARDS[run.deck.find((card) => card.instanceId === id)!.cardId].attack)).toBe(true);
    }
  });

  it('exercises three zero-contract builds and a deliberately simple attack-only baseline', () => {
    const results = new Map<Style, Outcome[]>();
    for (const style of ['combo', 'growth', 'mixed', 'attack-only'] as const) {
      const outcomes = SEEDS.map((seed) => simulate(seed, style));
      results.set(style, outcomes);
      if (process.env.PLAYTEST_TRACE) console.log(style, JSON.stringify({ victories: outcomes.filter((o) => o.status === 'cleared').length, defeats: outcomes.filter((o) => o.status === 'defeated').length, foughtGrowth: outcomes.filter((o) => o.usedGrowth).length, foughtCombo: outcomes.filter((o) => o.usedCombo).length, details: outcomes.map((o, i) => `${SEEDS[i]}:${o.status === 'cleared' ? 'C' : `D${o.battlesWon}`}:${o.hp}`) }));
      expect(outcomes).toHaveLength(SEEDS.length);
      expect(outcomes.every((outcome) => outcome.status === 'cleared' || outcome.status === 'defeated')).toBe(true);
      if (style !== 'attack-only') expect(outcomes.some((outcome) => outcome.status === 'cleared')).toBe(true);
    }
    expect(results.get('growth')!.some((outcome) => outcome.usedGrowth)).toBe(true);
    expect(results.get('combo')!.some((outcome) => outcome.usedCombo)).toBe(true);
    expect(results.get('mixed')!.some((outcome) => outcome.usedGrowth && outcome.usedCombo)).toBe(true);
    expect(results.get('attack-only')!.some((outcome) => outcome.status === 'defeated')).toBe(true);
  }, 30_000);

  it('can finish with the same combo policy while participating in a contract', () => {
    const outcome = simulate(104, 'combo', 2000);
    expect(outcome.status).toBe('cleared');
    expect(outcome.battlesWon).toBe(4);
  });
});
