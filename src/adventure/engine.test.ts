import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARDS, STARTER_DECK } from './content';
import { availableActions, canPlayCard, createRun, forkRun, pendingMarketStep, reduceRun } from './engine';
import { centsForShares, reserveEntry, settleEntry, settleSale, sharesForPercent, spendCash } from './ledger';
import type { CardId, MarketQuote, MarketStage, Run, Wallet } from './types';

function rig(cards: CardId[]): Run {
  const run = createRun();
  run.deck = cards.map((cardId, i) => ({ instanceId: `test-${i}`, cardId, upgraded: false }));
  const battle = run.battle!;
  battle.hand = run.deck.map((card) => card.instanceId);
  battle.drawPile = []; battle.discardPile = []; battle.exhaustPile = [];
  battle.enemy.hp = 999; battle.enemy.maxHp = 999;
  return run;
}

function play(run: Run, cardId: CardId, retainCardId?: string): Run {
  const card = run.deck.find((c) => c.cardId === cardId && run.battle?.hand.includes(c.instanceId));
  if (!card) throw new Error(`No ${cardId} in hand`);
  return reduceRun(run, { type: 'play-card', cardInstanceId: card.instanceId, retainCardId });
}

function forceWin(run: Run): Run {
  const battle = run.battle!;
  const card = run.deck.find((c) => c.cardId === 'C01')!;
  battle.hand = [card.instanceId];
  battle.drawPile = run.deck.filter((c) => c.instanceId !== card.instanceId).map((c) => c.instanceId);
  battle.discardPile = []; battle.exhaustPile = []; battle.energy = 3; battle.overloadNext = 0;
  battle.enemy.hp = 1; battle.enemy.shield = 0;
  return play(run, 'C01');
}

const quotes: Record<MarketStage, { date: string; price: number }> = {
  entry: { date: '20200102', price: 1_000_000 }, t1: { date: '20200201', price: 900_000 },
  't1-exec': { date: '20200203', price: 880_000 }, t2: { date: '20200301', price: 950_000 },
  't2-exec': { date: '20200302', price: 960_000 }, t3: { date: '20200401', price: 1_100_000 },
  'final-exec': { date: '20200402', price: 1_100_000 }, 'exit-after-entry': { date: '20200103', price: 1_000_000 },
  'exit-after-t1-exec': { date: '20200204', price: 880_000 }, 'exit-after-t2-exec': { date: '20200303', price: 970_000 },
};
function deliver(run: Run, actual = false): Run {
  const request = pendingMarketStep(run)!;
  const quote: MarketQuote = actual
    ? JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'adventure', 'stages', request.caseId, `${request.stage}.json`), 'utf8')) as MarketQuote
    : { caseId: request.caseId, step: request.stage, ...quotes[request.stage] };
  return reduceRun(run, { type: 'apply-quote', quote });
}

describe('deterministic combat', () => {
  it('starts with 14 defined cards and a ten-card, six-kind seeded deck', () => {
    expect(Object.keys(CARDS)).toHaveLength(14);
    expect(STARTER_DECK).toHaveLength(10);
    expect(new Set(STARTER_DECK).size).toBe(6);
    const first = createRun({ seed: 42 });
    expect(createRun({ seed: 42 }).battle).toEqual(first.battle);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });
  it('overload restores one less turn only, and growth adds empty capacity', () => {
    const original = rig(['C04', 'C05']);
    let run = play(original, 'C04');
    expect([run.battle!.energy, run.battle!.capacity, run.battle!.overloadNext]).toEqual([5, 3, 2]);
    expect(original.battle!.energy).toBe(3);
    run = play(run, 'C05');
    expect([run.battle!.energy, run.battle!.capacity, run.battle!.overloadNext]).toEqual([3, 4, 2]);
    run = reduceRun(run, { type: 'end-turn' });
    expect([run.battle!.energy, run.battle!.capacity, run.battle!.overloadNext]).toEqual([2, 4, 0]);
    run = reduceRun(run, { type: 'end-turn' });
    expect(run.battle!.energy).toBe(4);
  });
  it('rejects overload over capacity atomically and allows overload lethals', () => {
    let run = rig(['C04', 'C09', 'C10']);
    run = play(run, 'C04'); run = play(run, 'C09');
    const before = JSON.stringify(run);
    expect(canPlayCard(run, 'test-2').reason).toContain('过载');
    expect(() => play(run, 'C10')).toThrow('过载');
    expect(JSON.stringify(run)).toBe(before);
    run.battle!.enemy.hp = 1;
    run.battle!.overloadNext = 0;
    run.battle!.hand = ['test-1'];
    run = play(run, 'C09');
    expect(run.phase).toBe('reward');
    expect(run.hp).toBe(42);
    run = reduceRun(run, { type: 'choose-reward', cardId: 'C07' });
    expect(run.deck.some((c) => c.cardId === 'C04')).toBe(true);
    expect(run.battle).toBeNull();
  });
  it('buffs every later hit separately but never earlier hits', () => {
    let combo = rig(['C08', 'C07']);
    combo = play(combo, 'C08'); combo = play(combo, 'C07');
    expect(combo.battle!.enemy.hp).toBe(999 - 15);
    let reverse = rig(['C08', 'C07']);
    reverse = play(reverse, 'C07'); reverse = play(reverse, 'C08');
    expect(reverse.battle!.enemy.hp).toBe(999 - 9);
  });
  it('retains permanent cards until played and C14 targets for only one turn', () => {
    let run = rig(['C14', 'C12', 'C01']);
    run = play(run, 'C14', 'test-2');
    expect(run.battle!.exhaustPile).toContain('test-0');
    run = reduceRun(run, { type: 'end-turn' });
    expect(run.battle!.hand).toEqual(expect.arrayContaining(['test-1', 'test-2']));
    for (let i = 0; i < 5; i++) {
      const instanceId = `filler-${i}`;
      run.deck.push({ instanceId, cardId: 'C02', upgraded: false });
      run.battle!.drawPile.push(instanceId);
    }
    run = reduceRun(run, { type: 'end-turn' });
    expect(run.battle!.hand).toContain('test-1');
    expect(run.battle!.hand).not.toContain('test-2');
    expect(run.battle!.discardPile).toContain('test-2');
  });
  it('exhausted cards return to the full deck in the next battle, with reset capacity', () => {
    let run = createRun();
    const fire = run.deck.find((card) => card.cardId === 'C04')!;
    const attack = run.deck.find((card) => card.cardId === 'C01')!;
    run.battle!.hand = [fire.instanceId, attack.instanceId];
    run.battle!.drawPile = run.deck.filter((card) => !run.battle!.hand.includes(card.instanceId)).map((card) => card.instanceId);
    run.battle!.enemy.hp = 1;
    run = play(run, 'C04');
    expect(run.battle!.exhaustPile).toContain(fire.instanceId);
    run = play(run, 'C01');
    run = reduceRun(run, { type: 'choose-reward', cardId: null });
    run = reduceRun(run, { type: 'submit-entry', amountCents: 0 });
    run = reduceRun(run, { type: 'continue' }); run = deliver(run);
    run = reduceRun(run, { type: 'choose-route', enemyId: 'moss' });
    expect(run.battle!.capacity).toBe(3);
    expect(run.battle!.overloadNext).toBe(0);
    expect([...run.battle!.hand, ...run.battle!.drawPile]).toContain(fire.instanceId);
    expect(run.battle!.exhaustPile).toEqual([]);
  });
  it('sends draws above eight cards to discard and allows C14 without another hand card', () => {
    let run = rig(['C03', 'C01', 'C01', 'C01', 'C02', 'C02', 'C02', 'C06', 'C09', 'C10']);
    run.battle!.hand = run.battle!.hand.slice(0, 8);
    run.battle!.drawPile = ['test-8', 'test-9'];
    run = play(run, 'C03');
    expect(run.battle!.hand).toHaveLength(8);
    expect(run.battle!.discardPile).toContain('test-8');
    expect(run.battle!.log.some((line) => line.includes('手牌已满'))).toBe(true);
    let solo = rig(['C14', 'C01']);
    solo.battle!.hand = ['test-0']; solo.battle!.drawPile = ['test-1'];
    solo = play(solo, 'C14');
    expect(solo.battle!.hand).toEqual(['test-1']);
    expect(solo.battle!.exhaustPile).toContain('test-0');
  });
  it('rejects pure growth at the capacity cap, but still allows hybrid growth/shield', () => {
    let run = rig(['C05', 'C11']);
    run.battle!.capacity = 6;
    expect(canPlayCard(run, 'test-0').enabled).toBe(false);
    expect(canPlayCard(run, 'test-1').enabled).toBe(true);
    run = play(run, 'C11');
    expect(run.battle!.shield).toBe(5);
    expect(run.battle!.capacity).toBe(6);
    expect(run.battle!.energy).toBe(1);
  });
  it('shows the enemy attack bonus in advance from phase ten', () => {
    let run = rig([]);
    run.hp = 99; run.maxHp = 99;
    run.battle!.enemy.id = 'moss'; run.battle!.turn = 9;
    run.battle!.enemy.intent = { kind: 'attack', amount: 9 };
    run = reduceRun(run, { type: 'end-turn' });
    expect(run.battle!.enemy.attackBonus).toBe(2);
    expect(run.battle!.enemy.intent).toEqual({ kind: 'shield', amount: 6 });
    run = reduceRun(run, { type: 'end-turn' });
    expect(run.battle!.enemy.attackBonus).toBe(4);
    expect(run.battle!.enemy.intent).toEqual({ kind: 'attack', amount: 9 });
  });
});

/** A reproducible player policy; every transition goes through the public reducer. */
function fullAdventure(style: 'combo' | 'growth', amountCents: number, alternateRoutes = false): { run: Run; actions: string[] } {
  let run = createRun({ seed: 104, source: 'demo' });
  const actions: string[] = [];
  let n2Done = false;
  const upgrades = new Set<string>();
  for (let n = 0; n < 800 && run.phase !== 'ended'; n++) {
    if (run.phase === 'market') {
      actions.push(`quote:${pendingMarketStep(run)!.stage}`);
      run = deliver(run, true); continue;
    }
    if (run.phase === 'reward') {
      const cardId: CardId = run.node === 'N1' ? style === 'combo' ? 'C07' : 'C11' : run.node === 'N3' ? style === 'combo' ? 'C08' : 'C12' : style === 'combo' ? 'C09' : 'C13';
      actions.push(`${run.node}:reward:${cardId}`);
      run = reduceRun(run, { type: 'choose-reward', cardId }); continue;
    }
    if (run.phase === 'camp') {
      if (run.node === 'N2') {
        if (!n2Done) {
          const cardId: CardId = style === 'combo' ? 'C08' : 'C12';
          actions.push(`N2:buy:${cardId}`); run = reduceRun(run, { type: 'buy-card', cardId });
          actions.push(`N2:entry:${amountCents}`); run = reduceRun(run, { type: 'submit-entry', amountCents }); n2Done = true;
        }
        run = reduceRun(run, { type: 'continue' }); continue;
      }
      if (run.camp!.decision === 'not-submitted') {
        const percent = amountCents > 0 && run.node === 'N4' ? 50 : 0;
        actions.push(`${run.node}:redeem:${percent}`);
        run = reduceRun(run, { type: 'submit-redemption', percent }); continue;
      }
      if (!run.camp!.freeChoiceUsed) {
        actions.push(`${run.node}:free-rest`); run = reduceRun(run, { type: 'free-rest' }); continue;
      }
      if (run.hp <= 31 && run.wallet.cashCents >= 1000) {
        actions.push(`${run.node}:heal`); run = reduceRun(run, { type: 'heal' }); continue;
      }
      const card = run.deck.find((c) => c.cardId === (style === 'combo' ? 'C07' : 'C05') && !c.upgraded);
      if (card && !upgrades.has(card.instanceId) && run.wallet.cashCents >= 2000) {
        actions.push(`${run.node}:upgrade:${card.cardId}`); upgrades.add(card.instanceId);
        run = reduceRun(run, { type: 'upgrade-card', cardInstanceId: card.instanceId }); continue;
      }
      run = reduceRun(run, { type: 'continue' }); continue;
    }
    if (run.phase === 'route') {
      if (run.hp <= 30 && run.wallet.cashCents >= 1000) {
        actions.push(`${run.node}:heal`); run = reduceRun(run, { type: 'heal' }); continue;
      }
      const enemyId = alternateRoutes ? run.node === 'N3' ? 'pursuer' : 'clock' : 'moss';
      actions.push(`${run.node}:route:${enemyId}`); run = reduceRun(run, { type: 'choose-route', enemyId }); continue;
    }
    if (run.phase !== 'battle') throw new Error(`Unexpected ${run.phase}`);
    const battle = run.battle!;
    const hand = battle.hand.map((id) => run.deck.find((card) => card.instanceId === id)!);
    const eligible = hand.filter((card) => canPlayCard(run, card.instanceId).enabled);
    const rawDamage = (cardId: CardId): number => cardId === 'C01' ? 6 : cardId === 'C07' ? 9 : cardId === 'C09' ? 12 : cardId === 'C12' ? 26 : cardId === 'C13' ? 14 : 0;
    let selected = eligible.find((card) => rawDamage(card.cardId) + (card.cardId === 'C07' ? 3 : 1) * battle.attackBonus >= battle.enemy.hp + battle.enemy.shield && rawDamage(card.cardId) > 0);
    const c = (id: CardId) => eligible.find((card) => card.cardId === id);
    if (!selected && c('C04') && battle.energy <= 2 && hand.some((card) => card.cardId !== 'C04')) selected = c('C04');
    if (!selected && battle.turn <= 2 && battle.enemy.hp > 24 && battle.energy >= 2 && run.hp > 12) selected = c('C11') ?? c('C05');
    if (!selected && c('C08') && c('C07') && battle.energy >= 2) selected = c('C08');
    const incoming = battle.enemy.intent.kind === 'attack' ? battle.enemy.intent.amount : 0;
    if (!selected && incoming - battle.shield >= 4) selected = c('C10') ?? c('C02') ?? c('C06');
    if (!selected && c('C03') && battle.energy >= 2 && battle.hand.length <= 5) selected = c('C03');
    if (!selected && c('C14')) selected = c('C14');
    if (!selected) selected = c('C12') ?? c('C13') ?? c('C09') ?? c('C07') ?? c('C01') ?? c('C06') ?? c('C02') ?? c('C03');
    if (selected) {
      const other = battle.hand.find((id) => id !== selected!.instanceId);
      const retainCardId = selected.cardId === 'C14' ? other : undefined;
      actions.push(`${run.node}:T${battle.turn}:${selected.cardId}`);
      run = reduceRun(run, { type: 'play-card', cardInstanceId: selected.instanceId, ...(retainCardId ? { retainCardId } : {}) });
    } else {
      actions.push(`${run.node}:T${battle.turn}:end`); run = reduceRun(run, { type: 'end-turn' });
    }
  }
  return { run, actions };
}

describe('complete, legal four-fight adventures', () => {
  it('clears with purchases, an upgrade, participation and a half redemption', () => {
    const { run, actions } = fullAdventure('combo', 2000);
    if (process.env.ADVENTURE_TRACE) console.log('combo:', actions.join(' | '), 'final cash cents:', run.wallet.cashCents, 'hp:', run.hp, 'save chars:', JSON.stringify(run).length);
    expect({ status: run.status, hp: run.hp, actions }).toMatchObject({ status: 'cleared' });
    expect(run.history.filter((entry) => entry.action === 'victory')).toHaveLength(4);
    expect(actions).toContain('N2:buy:C08');
    expect(actions.some((action) => action.includes(':upgrade:'))).toBe(true);
    expect(actions).toContain('N4:redeem:50');
    expect(run.wallet.shareUnits).toBe('0');
  });
  it('clears with zero participation and a growth deck', () => {
    const { run, actions } = fullAdventure('growth', 0);
    if (process.env.ADVENTURE_TRACE) console.log('growth:', actions.join(' | '), 'final cash cents:', run.wallet.cashCents, 'hp:', run.hp);
    expect({ status: run.status, hp: run.hp, actions }).toMatchObject({ status: 'cleared' });
    expect(run.history.filter((entry) => entry.action === 'victory')).toHaveLength(4);
    expect(run.wallet.investedCents).toBe(0);
    expect(actions).toContain('N2:entry:0');
  });
  it('can take both alternative branch enemies and still finish', () => {
    const { run, actions } = fullAdventure('combo', 2000, true);
    expect({ status: run.status, hp: run.hp, actions }).toMatchObject({ status: 'cleared' });
    expect(actions).toContain('N3:route:pursuer');
    expect(actions).toContain('N5:route:clock');
  });
});

describe('cash, shares and replay boundaries', () => {
  it('reproduces the manual §5.5 example without mixing spending with contract performance', () => {
    const wallet: Wallet = { cashCents: 10_000, reservedCents: 0, shareUnits: '0', costBasisCents: 0, investedCents: 0, proceedsCents: 0, realizedPnlCents: 0, ledger: [] };
    reserveEntry(wallet, 4000, 'entry', 'N2'); settleEntry(wallet, 4000, 100_000_000);
    expect(wallet.shareUnits).toBe('400000000000');
    expect(centsForShares(wallet.shareUnits, 90_000_000)).toBe(3600);
    const half = sharesForPercent(wallet.shareUnits, 50);
    expect(settleSale(wallet, half, 88_000_000, 'sell1', 'N4').proceedsCents).toBe(1760);
    expect(wallet.cashCents).toBe(7760);
    spendCash(wallet, 2000, 'upgrade', 'N4', '升级');
    expect(wallet.cashCents).toBe(5760);
    expect(settleSale(wallet, wallet.shareUnits, 110_000_000, 'sell2', 'N8').proceedsCents).toBe(2200);
    expect(wallet.cashCents).toBe(7960);
    expect(wallet.realizedPnlCents).toBe(-40);
    expect(wallet.ledger.map((entry) => entry.kind)).toEqual(['entry-reserve', 'redemption', 'purchase', 'redemption']);
  });
  it('locks orders, refuses estimated proceeds, applies a quote once, and preserves snapshots', () => {
    let run = forceWin(createRun());
    run = reduceRun(run, { type: 'choose-reward', cardId: 'C07' });
    run = reduceRun(run, { type: 'submit-entry', amountCents: 6000, actionId: 'entry-one' });
    expect(reduceRun(run, { type: 'submit-entry', amountCents: 6000, actionId: 'entry-one' })).toBe(run);
    expect(run.wallet.cashCents).toBe(1200);
    run = reduceRun(run, { type: 'continue' });
    expect(pendingMarketStep(run)?.stage).toBe('entry');
    run = deliver(run);
    run = reduceRun(run, { type: 'choose-route', enemyId: 'moss' });
    run = forceWin(run);
    run = reduceRun(run, { type: 'choose-reward', cardId: 'C08' });
    run = deliver(run);
    run = reduceRun(run, { type: 'submit-redemption', percent: 50 });
    expect(run.wallet.cashCents).toBe(2400);
    expect(availableActions(run).find((a) => a.type === 'buy-card')?.enabled).toBe(false);
    expect(() => reduceRun(run, { type: 'buy-card', cardId: 'C07' })).toThrow();
    const quote: MarketQuote = { caseId: run.caseId, step: 't1-exec', ...quotes['t1-exec'] };
    run = reduceRun(run, { type: 'apply-quote', quote });
    expect(run.wallet.cashCents).toBe(5040);
    const twice = reduceRun(run, { type: 'apply-quote', quote });
    expect(twice.wallet).toEqual(run.wallet);
    const original = JSON.stringify(run);
    const checkpoint = run.checkpoints.find((c) => c.action === 'submit-entry')!;
    let branch = forkRun(run, checkpoint.id);
    expect(branch.source).toBe('fork');
    expect(branch.node).toBe('N2');
    expect(branch.wallet.cashCents).toBe(7200);
    expect(branch.history.some((entry) => entry.action === 'submit-redemption')).toBe(false);
    branch = reduceRun(branch, { type: 'submit-entry', amountCents: 2000 });
    expect(branch.wallet.cashCents).toBe(5200);
    expect(JSON.stringify(run)).toBe(original);
  });
  it('fails with outstanding shares and requests the opening after the last completed time point', () => {
    let run = forceWin(createRun());
    run = reduceRun(run, { type: 'choose-reward', cardId: null });
    run = reduceRun(run, { type: 'submit-entry', amountCents: 3000 });
    run = reduceRun(run, { type: 'continue' }); run = deliver(run);
    run = reduceRun(run, { type: 'choose-route', enemyId: 'pursuer' });
    run.hp = 1;
    run = reduceRun(run, { type: 'end-turn' });
    expect(run.status).toBe('defeated');
    expect(pendingMarketStep(run)?.stage).toBe('exit-after-entry');
    expect(run.wallet.cashCents).toBe(4200);
    run = deliver(run);
    expect(run.phase).toBe('ended');
    expect(run.wallet.cashCents).toBe(7200);
    expect(run.history.some((e) => e.action === 'auto-liquidation')).toBe(true);
    expect(run.history.some((e) => e.action === 'submit-redemption')).toBe(false);
  });
  it('returns at the correct next opening whether or not the N6 choice was executed', () => {
    let run = forceWin(createRun());
    run = reduceRun(run, { type: 'choose-reward', cardId: null });
    run = reduceRun(run, { type: 'submit-entry', amountCents: 3000 });
    run = reduceRun(run, { type: 'continue' }); run = deliver(run);
    run = reduceRun(run, { type: 'choose-route', enemyId: 'moss' }); run = forceWin(run);
    run = reduceRun(run, { type: 'choose-reward', cardId: null }); run = deliver(run);
    run = reduceRun(run, { type: 'submit-redemption', percent: 0 }); run = deliver(run);
    run = reduceRun(run, { type: 'continue' });
    run = reduceRun(run, { type: 'choose-route', enemyId: 'moss' }); run = forceWin(run);
    run = reduceRun(run, { type: 'choose-reward', cardId: null }); run = deliver(run);
    const early = reduceRun(run, { type: 'return-home' });
    expect(pendingMarketStep(early)?.stage).toBe('t2-exec');
    expect(deliver(early).status).toBe('returned');
    let later = reduceRun(run, { type: 'submit-redemption', percent: 50 }); later = deliver(later);
    later = reduceRun(later, { type: 'return-home' });
    expect(pendingMarketStep(later)?.stage).toBe('exit-after-t2-exec');
    expect(deliver(later).status).toBe('returned');
    expect(run.status).toBe('active');
  });
});
