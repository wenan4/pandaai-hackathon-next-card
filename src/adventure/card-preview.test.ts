import { describe, expect, it } from 'vitest';
import { describeCardPlayPreview, describeCompactCardPlayPreview, previewCardPlay } from './card-preview';
import { createRun, reduceRun } from './engine';
import type { CardId, Run } from './types';

function rig(cards: CardId[]): Run {
  const run = createRun({ seed: 104 });
  run.deck = cards.map((cardId, index) => ({ instanceId: `test-${index}`, cardId, upgraded: false }));
  const battle = run.battle!;
  battle.hand = run.deck.map((card) => card.instanceId);
  battle.drawPile = []; battle.discardPile = []; battle.exhaustPile = [];
  battle.enemy.hp = 100; battle.enemy.maxHp = 100; battle.enemy.shield = 0;
  return run;
}

describe('card action preview', () => {
  it('uses the real reducer for a buffed multi-hit attack against an existing shield', () => {
    let run = rig(['C08', 'C07']);
    const before = JSON.stringify(run);
    const buff = previewCardPlay(run, 'test-0');
    expect(buff).toMatchObject({ enabled: true, energyBefore: 3, energyAfter: 2, attackBonusBefore: 0, attackBonusAfter: 2 });
    expect(JSON.stringify(run)).toBe(before);
    run = reduceRun(run, { type: 'play-card', cardInstanceId: 'test-0' });
    run.battle!.enemy.shield = 4;
    const saved = JSON.stringify(run);
    const preview = previewCardPlay(run, 'test-1');
    expect(preview).toMatchObject({ enabled: true, hitCount: 3, maxHitCount: 3, damagePerHit: 5, shieldDamage: 4, healthDamage: 11, energyBefore: 2, energyAfter: 1, defeated: false });
    expect(describeCompactCardPlayPreview(preview).join(' ')).toContain('每段+2');
    const actual = reduceRun(run, { type: 'play-card', cardInstanceId: 'test-1' });
    expect(actual.battle!.enemy).toMatchObject({ hp: 89, shield: 0 });
    expect(actual.battle!.energy).toBe(1);
    expect(JSON.stringify(run)).toBe(saved);
  });

  it('separates theoretical multi-hit damage from actual hits and overkill on a lethal', () => {
    const run = rig(['C07']);
    run.battle!.attackBonus = 2;
    run.battle!.enemy.hp = 2; run.battle!.enemy.shield = 1;
    const before = JSON.stringify(run);
    const preview = previewCardPlay(run, 'test-0');
    expect(preview).toMatchObject({ enabled: true, defeated: true, hitCount: 1, maxHitCount: 3, damagePerHit: 5, shieldDamage: 1, healthDamage: 2, overkillDamage: 2, nextEnergyIfSurviving: null });
    const lines = describeCardPlayPreview(preview).join(' ');
    expect(lines).toContain('最多 3 段 × 5 = 15');
    expect(lines).toContain('实际执行 1 段');
    expect(lines).toContain('剩余伤害段不会执行');
    expect(reduceRun(run, { type: 'play-card', cardInstanceId: 'test-0' }).phase).toBe('reward');
    expect(JSON.stringify(run)).toBe(before);
  });

  it('clears overload on lethal instead of promising an extra enemy phase', () => {
    const run = rig(['C09']);
    run.battle!.enemy.hp = 1;
    const preview = previewCardPlay(run, 'test-0');
    expect(preview).toMatchObject({ enabled: true, energyBefore: 3, energyAfter: 2, overloadAfter: 1, defeated: true, nextEnergyIfSurviving: null });
    const lines = describeCardPlayPreview(preview).join(' ');
    expect(lines).toContain('敌人不会行动');
    expect(lines).toContain('未结算过载清除');
    expect(lines).not.toContain('下回合锁定');
  });

  it('shows current temporary energy, next-turn overload and empty growth accurately', () => {
    let run = rig(['C04', 'C05']);
    const fire = previewCardPlay(run, 'test-0');
    expect(fire).toMatchObject({ enabled: true, energyBefore: 3, energyAfter: 5, capacityAfter: 3, overloadAfter: 2, nextEnergyIfSurviving: 1 });
    run = reduceRun(run, { type: 'play-card', cardInstanceId: 'test-0' });
    const growth = previewCardPlay(run, 'test-1');
    expect(growth).toMatchObject({ enabled: true, energyBefore: 5, energyAfter: 3, capacityBefore: 3, capacityAfter: 4, overloadAfter: 2, nextEnergyIfSurviving: 2 });
    const text = describeCardPlayPreview(growth).join(' ');
    expect(text).toContain('新增格为空');
    expect(text).toContain('过载不扣本回合能量');
    expect(text).toContain('下回合锁定 2，恢复 2 能量');
  });

  it('calculates shield and the stated enemy intent without assuming extra plays', () => {
    const run = rig(['C10']);
    run.battle!.shield = 2;
    run.battle!.enemy.intent = { kind: 'attack', amount: 12 };
    const preview = previewCardPlay(run, 'test-0');
    expect(preview).toMatchObject({ enabled: true, playerShieldBefore: 2, playerShieldAfter: 16, incomingAttack: 12, incomingHealthDamage: 0, overloadAfter: 1, nextEnergyIfSurviving: 2 });
    expect(describeCardPlayPreview(preview).join(' ')).toContain('若现在结束回合');
  });

  it('allows a mixed shield/growth card at the cap but reports why growth is capped', () => {
    const run = rig(['C11']); run.battle!.capacity = 6;
    const preview = previewCardPlay(run, 'test-0');
    expect(preview).toMatchObject({ enabled: true, growthCapped: true, capacityBefore: 6, capacityAfter: 6, playerShieldAfter: 5 });
    expect(describeCardPlayPreview(preview).join(' ')).toContain('本次不能增加容量');
  });

  it('requires a valid visible retain target only when another hand card exists', () => {
    const run = rig(['C14', 'C01']);
    expect(previewCardPlay(run, 'test-0')).toMatchObject({ enabled: false, reason: expect.stringContaining('选择') });
    expect(previewCardPlay(run, 'test-0', 'not-in-hand')).toMatchObject({ enabled: false });
    expect(previewCardPlay(run, 'test-0', 'test-1')).toMatchObject({ enabled: true });
    expect(previewCardPlay(rig(['C14']), 'test-0')).toMatchObject({ enabled: true });
  });

  it('never returns draw identities, pile order or RNG, and does not change either run', () => {
    const first = rig(['C03', 'C01', 'C02', 'C06', 'C04']);
    first.battle!.hand = ['test-0']; first.battle!.drawPile = ['test-1', 'test-2', 'test-3', 'test-4'];
    const second = structuredClone(first);
    second.battle!.drawPile.reverse(); second.battle!.rngState = 123456;
    const beforeFirst = JSON.stringify(first); const beforeSecond = JSON.stringify(second);
    const a = previewCardPlay(first, 'test-0'); const b = previewCardPlay(second, 'test-0');
    expect(a).toEqual(b);
    for (const hidden of ['test-1', 'test-2', 'test-3', 'test-4', 'drawPile', 'discardPile', 'rngState']) expect(JSON.stringify(a)).not.toContain(hidden);
    expect(JSON.stringify(first)).toBe(beforeFirst);
    expect(JSON.stringify(second)).toBe(beforeSecond);
  });

  it('reports illegal cost and capacity without applying or predicting effects', () => {
    const run = rig(['C05', 'C01']);
    run.battle!.capacity = 6;
    expect(previewCardPlay(run, 'test-0')).toMatchObject({ enabled: false, reason: expect.stringContaining('容量') });
    run.battle!.energy = 0;
    expect(previewCardPlay(run, 'test-1')).toMatchObject({ enabled: false, reason: expect.stringContaining('能量') });
  });

  it('clamps incoming damage to remaining health and does not promise a next turn', () => {
    const run = rig(['C09']);
    run.hp = 3; run.battle!.shield = 2;
    // Intent already includes the enemy's visible attack bonus; do not add it twice.
    run.battle!.enemy.attackBonus = 4; run.battle!.enemy.intent = { kind: 'attack', amount: 16 };
    const preview = previewCardPlay(run, 'test-0');
    expect(preview).toMatchObject({ enabled: true, incomingAttack: 16, incomingHealthDamage: 3, defeatedIfEndNow: true, nextEnergyIfSurviving: null, overloadAfter: 1 });
    const text = describeCardPlayPreview(preview).join(' ');
    expect(text).toContain('对手攻击 16');
    expect(text).toContain('损失 3 生命');
    expect(text).toContain('生命归零');
    expect(text).not.toContain('恢复 null');
    expect(describeCompactCardPlayPreview(preview).join(' ')).toContain('本场失败');
    const afterCard = reduceRun(run, { type: 'play-card', cardInstanceId: 'test-0' });
    const afterEnemy = reduceRun(afterCard, { type: 'end-turn' });
    expect(afterCard.hp - afterEnemy.hp).toBe(3);
    expect(afterEnemy.status).toBe('defeated');
  });
});
