import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canPlayCard, createRun, pendingMarketStep, reduceRun } from './engine';
import { actionFeedback, outcomeFeedback } from './game-feedback';
import type { CardId, CardInstance, MarketQuote, Run, RunAction } from './types';

/** Read only the stage the real reducer has unlocked. */
function deliver(run: Run): Run {
  const request = pendingMarketStep(run);
  if (!request) throw new Error('No quote requested');
  const quote = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'adventure', 'stages', request.caseId, `${request.stage}.json`), 'utf8')) as MarketQuote;
  return reduceRun(run, { type: 'apply-quote', quote });
}

function combatAction(run: Run): RunAction {
  const battle = run.battle!;
  // Take a real opening hit so healing can be tested without fabricating HP.
  if (run.node === 'N1' && battle.turn === 1 && run.hp === run.maxHp) return { type: 'end-turn' };
  const hand = battle.hand.map((id) => run.deck.find((card) => card.instanceId === id)!);
  const eligible = hand.filter((card) => canPlayCard(run, card.instanceId).enabled);
  const get = (id: CardId): CardInstance | undefined => eligible.find((card) => card.cardId === id);
  const rawDamage = (id: CardId): number => id === 'C01' ? 6 : id === 'C07' ? 9 : id === 'C09' ? 12 : id === 'C12' ? 26 : id === 'C13' ? 14 : 0;
  let chosen = eligible.find((card) => rawDamage(card.cardId) > 0 && rawDamage(card.cardId) + (card.cardId === 'C07' ? 3 : 1) * battle.attackBonus >= battle.enemy.hp + battle.enemy.shield);
  if (!chosen && get('C04') && battle.energy <= 2 && hand.some((card) => card.cardId !== 'C04')) chosen = get('C04');
  if (!chosen && battle.turn <= 2 && battle.enemy.hp > 24 && battle.energy >= 2 && run.hp > 12) chosen = get('C11') ?? get('C05');
  if (!chosen && get('C08') && get('C07') && battle.energy >= 2) chosen = get('C08');
  const incoming = battle.enemy.intent.kind === 'attack' ? battle.enemy.intent.amount : 0;
  if (!chosen && incoming - battle.shield >= 4) chosen = get('C10') ?? get('C02') ?? get('C06');
  if (!chosen && get('C03') && battle.energy >= 2 && battle.hand.length <= 5) chosen = get('C03');
  if (!chosen) chosen = get('C14') ?? get('C12') ?? get('C13') ?? get('C09') ?? get('C07') ?? get('C01') ?? get('C06') ?? get('C02') ?? get('C03');
  if (!chosen) return { type: 'end-turn' };
  const retain = chosen.cardId === 'C14' ? battle.hand.find((id) => id !== chosen!.instanceId) : undefined;
  return { type: 'play-card', cardInstanceId: chosen.instanceId, ...(retain ? { retainCardId: retain } : {}) };
}

/** Follow the public reducer through real fights, rewards, camps and quote phases. */
function journey(stop: (run: Run) => boolean, investment = 2000): Run {
  let run = createRun({ seed: 104, source: 'demo' });
  for (let step = 0; step < 1000; step++) {
    if (stop(run)) return run;
    if (run.status === 'defeated' || run.phase === 'ended') throw new Error(`Unexpected end at ${run.node}: ${run.status}`);
    if (run.phase === 'market') { run = deliver(run); continue; }
    if (run.phase === 'battle') { run = reduceRun(run, combatAction(run)); continue; }
    if (run.phase === 'reward') {
      const cardId = run.node === 'N1' ? 'C07' : run.node === 'N3' ? 'C08' : 'C09';
      run = reduceRun(run, { type: 'choose-reward', cardId }); continue;
    }
    if (run.phase === 'route') {
      if (run.hp <= 30 && run.wallet.cashCents >= 1000) run = reduceRun(run, { type: 'heal' });
      else run = reduceRun(run, { type: 'choose-route', enemyId: 'moss' });
      continue;
    }
    if (run.phase === 'camp') {
      if (run.node === 'N2') {
        if (!run.camp!.purchased.includes('C08')) run = reduceRun(run, { type: 'buy-card', cardId: 'C08' });
        else if (!run.market.entryCommitted) run = reduceRun(run, { type: 'submit-entry', amountCents: investment });
        else run = reduceRun(run, { type: 'continue' });
        continue;
      }
      if (run.camp!.decision === 'not-submitted') { run = reduceRun(run, { type: 'submit-redemption', percent: 0 }); continue; }
      if (!run.camp!.freeChoiceUsed) { run = reduceRun(run, { type: 'free-rest' }); continue; }
      if (run.hp <= 31 && run.wallet.cashCents >= 1000) { run = reduceRun(run, { type: 'heal' }); continue; }
      const card = run.deck.find((item) => item.cardId === 'C07' && !item.upgraded);
      if (card && run.wallet.cashCents >= 2000) { run = reduceRun(run, { type: 'upgrade-card', cardInstanceId: card.instanceId }); continue; }
      run = reduceRun(run, { type: 'continue' }); continue;
    }
  }
  throw new Error('Journey exceeded action limit');
}

function n2(): Run { return journey((run) => run.phase === 'camp' && run.node === 'N2'); }
function n3(): Run { return journey((run) => run.phase === 'route' && run.node === 'N3'); }
function n4Ready(): Run { return journey((run) => run.phase === 'camp' && run.node === 'N4' && run.camp?.decision === 'settled'); }

describe('game action feedback', () => {
  it('reports selecting or skipping a real reward, without changing either run', () => {
    const before = journey((run) => run.phase === 'reward');
    const choose: RunAction = { type: 'choose-reward', cardId: 'C07' };
    const after = reduceRun(before, choose);
    const saved = JSON.stringify([before, after]);
    expect(actionFeedback(before, after, choose)).toMatchObject({ kind: 'choose-reward', title: '奖励已加入', detail: expect.stringContaining('连刃') });
    const skip: RunAction = { type: 'choose-reward', cardId: null };
    const skipped = reduceRun(before, skip);
    expect(actionFeedback(before, skipped, skip)?.detail).toContain('没有加入新牌');
    expect(actionFeedback(before, skipped, choose)).toBeNull();
    expect(JSON.stringify([before, after])).toBe(saved);
  });

  it('reports the actual purchase, upgrade, same-name position and archive cost', () => {
    let before = n2();
    const buy: RunAction = { type: 'buy-card', cardId: 'C08' };
    let after = reduceRun(before, buy);
    const receipt = actionFeedback(before, after, buy)!;
    expect(receipt.detail).toContain('余烬');
    expect(receipt.detail).toContain('花费 25 金币');
    expect(receipt.detail).toContain(`剩余 ${after.wallet.cashCents / 100} 金币`);
    const attacks = after.deck.filter((card) => card.cardId === 'C01');
    before = after;
    const upgrade: RunAction = { type: 'upgrade-card', cardInstanceId: attacks[1]!.instanceId };
    after = reduceRun(before, upgrade);
    expect(actionFeedback(before, after, upgrade)?.detail).toContain('敲击（第 2 张）');
    expect(actionFeedback(before, after, upgrade)?.detail).toContain('升级前：造成 6 点伤害');
    expect(actionFeedback(before, after, upgrade)?.detail).toContain('升级后：造成 9 点伤害');
    expect(actionFeedback(before, after, upgrade)?.detail).toContain('花费 20 金币');
    before = after;
    const another: RunAction = { type: 'upgrade-card', cardInstanceId: attacks[2]!.instanceId };
    after = reduceRun(before, another);
    expect(actionFeedback(before, after, another)?.detail).toContain('敲击（第 3 张）');
    before = after;
    const archive: RunAction = { type: 'buy-archive' };
    after = reduceRun(before, archive);
    expect(actionFeedback(before, after, archive)?.detail).toContain('花费 4 金币');
  });

  it('reports actual healing and upgrade at the roadside', () => {
    const before = n3();
    expect(before.hp).toBeLessThan(before.maxHp);
    const heal: RunAction = { type: 'heal' };
    const after = reduceRun(before, heal);
    const detail = actionFeedback(before, after, heal)?.detail ?? '';
    expect(detail).toContain(`生命 ${before.hp} → ${after.hp}`);
    expect(detail).toContain(`恢复 ${after.hp - before.hp} 点`);
    expect(detail).toContain('花费 10 金币');
    expect(detail).toContain(`剩余 ${after.wallet.cashCents / 100} 金币`);
    const card = before.deck.find((item) => item.cardId === 'C05')!;
    const upgrade: RunAction = { type: 'upgrade-card', cardInstanceId: card.instanceId };
    const improved = reduceRun(before, upgrade);
    const upgradeText = actionFeedback(before, improved, upgrade)?.detail ?? '';
    expect(upgradeText).toContain('引根');
    expect(upgradeText).toContain('2 能量');
    expect(upgradeText).toContain('1 能量');
  });

  it('reports free actions only when they have real effect and use the camp opportunity', () => {
    const camp = n4Ready();
    expect(camp.hp).toBeLessThan(camp.maxHp);
    const rest: RunAction = { type: 'free-rest' };
    const rested = reduceRun(camp, rest);
    expect(actionFeedback(camp, rested, rest)?.detail).toContain(`恢复 ${rested.hp - camp.hp} 点`);
    expect(actionFeedback(camp, rested, rest)?.detail).toContain('未花费金币');
    expect(actionFeedback(camp, rested, rest)?.detail).toContain('免费整备机会已使用');
    const basic = camp.deck.find((card) => card.cardId === 'C01')!;
    const upgrade: RunAction = { type: 'free-upgrade', cardInstanceId: basic.instanceId };
    const upgraded = reduceRun(camp, upgrade);
    expect(actionFeedback(camp, upgraded, upgrade)?.detail).toContain('免费整备机会已使用');
    expect(actionFeedback(camp, upgraded, upgrade)?.detail).toContain('未花费金币');

    let full = camp;
    while (full.hp < full.maxHp) full = reduceRun(full, { type: 'heal' });
    const noHealing = reduceRun(full, rest); // Engine permits this; the UI disables it.
    expect(noHealing.hp).toBe(full.hp);
    expect(actionFeedback(full, noHealing, rest)).toBeNull();
  });

  it('ignores no-op, failed purchase, duplicate action IDs, and stale before/after pairs', () => {
    let camp = n2();
    const buy: RunAction = { type: 'buy-card', cardId: 'C08', actionId: 'buy-once' };
    const bought = reduceRun(camp, buy);
    expect(actionFeedback(camp, camp, buy)).toBeNull();
    expect(actionFeedback(bought, reduceRun(bought, buy), buy)).toBeNull();
    const archived = reduceRun(bought, { type: 'buy-archive' });
    expect(actionFeedback(camp, archived, buy)).toBeNull();
    camp = bought;
    for (const card of camp.deck.filter((item) => item.cardId === 'C01').slice(0, 2)) camp = reduceRun(camp, { type: 'upgrade-card', cardInstanceId: card.instanceId });
    const attempted: RunAction = { type: 'purchase-attempted', purchase: 'buy-card', cardId: 'C12' };
    const failed = reduceRun(camp, attempted);
    expect(failed.wallet.cashCents).toBe(camp.wallet.cashCents);
    expect(actionFeedback(camp, failed, attempted)).toBeNull();
    expect(() => reduceRun(camp, { type: 'buy-card', cardId: 'C12' })).toThrow();
  });
});

describe('outcome and settlement feedback', () => {
  it('distinguishes active, the final time quote, automatic redemption, and completed settlement', () => {
    expect(outcomeFeedback(createRun()).status).toBe('active');
    expect(outcomeFeedback(createRun()).settlement).toBe('none');
    const finalQuote = journey((run) => run.status === 'cleared' && run.market.pending?.stage === 't3');
    const saved = JSON.stringify(finalQuote);
    expect(finalQuote.market.order).toBeNull();
    const initial = outcomeFeedback(finalQuote);
    expect(initial).toMatchObject({ status: 'cleared', settlement: 'pending-quote', lastOpponent: '守灯者' });
    expect(initial.settlementText).toContain('报价尚未到达');
    expect(initial.settlementText).not.toContain('自动回收');
    const badQuote: MarketQuote = { caseId: finalQuote.caseId, step: 't1', date: '20300101', price: 1000000 };
    expect(() => reduceRun(finalQuote, { type: 'apply-quote', quote: badQuote })).toThrow();
    expect(outcomeFeedback(finalQuote)).toEqual(initial);
    expect(JSON.stringify(finalQuote)).toBe(saved);
    const pending = deliver(finalQuote);
    expect(pending.market.order).toMatchObject({ kind: 'sell', automatic: true });
    expect(outcomeFeedback(pending)).toMatchObject({ status: 'cleared', settlement: 'pending-redemption' });
    expect(outcomeFeedback(pending).settlementText).toContain('自动回收正等待报价');
    const ended = deliver(pending);
    expect(outcomeFeedback(ended)).toMatchObject({ status: 'cleared', settlement: 'settled' });
    expect(outcomeFeedback(ended).settlementText).toContain('没有待回收份额');
  });

  it('reports no sale when a clear has zero shares', () => {
    const finalQuote = journey((run) => run.status === 'cleared' && run.market.pending?.stage === 't3', 0);
    expect(finalQuote.wallet.shareUnits).toBe('0');
    expect(outcomeFeedback(finalQuote).settlement).toBe('pending-quote');
    expect(outcomeFeedback(finalQuote).settlementText).not.toContain('回收');
    const ended = deliver(finalQuote);
    expect(ended.phase).toBe('ended');
    expect(outcomeFeedback(ended).settlement).toBe('settled');
  });

  it('keeps an early return distinct before and after automatic redemption', () => {
    const lastCamp = journey((run) => run.node === 'N6' && run.phase === 'camp');
    const returned = reduceRun(lastCamp, { type: 'return-home' });
    expect(outcomeFeedback(returned)).toMatchObject({ status: 'returned', settlement: 'pending-redemption', lastOpponent: '苔壳卫兵' });
    expect(outcomeFeedback(deliver(returned))).toMatchObject({ status: 'returned', settlement: 'settled' });
    const noShares = journey((run) => run.node === 'N6' && run.phase === 'camp', 0);
    const returnedWithoutSale = reduceRun(noShares, { type: 'return-home' });
    expect(returnedWithoutSale.phase).toBe('ended');
    expect(outcomeFeedback(returnedWithoutSale)).toMatchObject({ status: 'returned', settlement: 'settled' });
  });

  it('attributes defeat and its final hit only to saved events from that battle', () => {
    let run = n3();
    run = reduceRun(run, { type: 'choose-route', enemyId: 'pursuer' });
    while (run.status === 'active') run = reduceRun(run, { type: 'end-turn' });
    expect(run.status).toBe('defeated');
    const result = outcomeFeedback(run);
    const attack = run.history[run.history.findIndex((event) => event.action === 'defeat') - 1]!;
    expect(result).toMatchObject({ status: 'defeated', settlement: 'pending-redemption', lastOpponent: '追灯者' });
    expect(result.defeatBlow).toContain(`承受 ${attack.data.damage} 点伤害`);
    expect(result.evidenceIds).toContain(attack.id);
    expect(outcomeFeedback(deliver(run))).toMatchObject({ status: 'defeated', settlement: 'settled' });

    const legacy = structuredClone(run);
    const lastAttack = [...legacy.history].reverse().find((event) => event.action === 'enemy-attack')!;
    delete lastAttack.data.damage;
    const lastStart = [...legacy.history].reverse().find((event) => event.action === 'battle-start')!;
    delete lastStart.data.enemyId;
    const missing = outcomeFeedback(legacy);
    expect(missing.status).toBe('defeated');
    expect(missing.defeatBlow).toBeNull();
    expect(missing.lastOpponent).toBeNull();
    expect(missing.evidenceIds).not.toContain(lastAttack.id);

    const missingDefeat = structuredClone(run);
    missingDefeat.history = missingDefeat.history.filter((event) => event.action !== 'defeat' && event.node !== 'N3');
    expect(outcomeFeedback(missingDefeat).lastOpponent).toBeNull();
    expect(outcomeFeedback(missingDefeat).defeatBlow).toBeNull();
  });

  it('does not invent a sale for defeat without shares or a settlement for a missing balance', () => {
    let defeated = createRun();
    while (defeated.status === 'active') defeated = reduceRun(defeated, { type: 'end-turn' });
    expect(defeated.phase).toBe('ended');
    expect(outcomeFeedback(defeated)).toMatchObject({ status: 'defeated', settlement: 'settled', lastOpponent: '城门守卫' });
    const legacy = structuredClone(defeated);
    delete (legacy.wallet as Partial<Run['wallet']>).shareUnits;
    expect(outcomeFeedback(legacy).settlement).toBe('unknown');
  });
});
