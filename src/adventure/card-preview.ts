import { canPlayCard, reduceRun } from './engine';
import type { Run } from './types';

export interface CardPlayOutcome {
  enabled: true;
  energyBefore: number;
  energyAfter: number;
  capacityBefore: number;
  capacityAfter: number;
  overloadBefore: number;
  overloadAfter: number;
  playerShieldBefore: number;
  playerShieldAfter: number;
  enemyHpBefore: number;
  enemyHpAfter: number;
  enemyShieldBefore: number;
  enemyShieldAfter: number;
  attackBonusBefore: number;
  attackBonusAfter: number;
  hitCount: number;
  maxHitCount: number;
  damagePerHit: number;
  shieldDamage: number;
  healthDamage: number;
  overkillDamage: number;
  defeated: boolean;
  growthCapped: boolean;
  /** Projections below assume no more cards are played this turn. */
  incomingAttack: number | null;
  incomingHealthDamage: number | null;
  defeatedIfEndNow: boolean;
  nextEnergyIfSurviving: number | null;
}
export type CardPlayPreview = CardPlayOutcome | { enabled: false; reason: string };

/**
 * Simulate one legal action through the real reducer and expose only scalar,
 * already-visible effects of the selected card. In particular this never
 * returns the simulated run, logs, draw results, pile order, or RNG state.
 */
export function previewCardPlay(run: Run, cardInstanceId: string, retainCardId?: string): CardPlayPreview {
  const legal = canPlayCard(run, cardInstanceId);
  if (!legal.enabled) return { enabled: false, reason: legal.reason ?? '这张牌现在不能打出。' };
  const battle = run.battle;
  const card = run.deck.find((item) => item.instanceId === cardInstanceId);
  if (!battle || !card) return { enabled: false, reason: '当前没有可预览的战斗牌。' };
  if (card.cardId === 'C14') {
    const targets = battle.hand.filter((id) => id !== cardInstanceId);
    if (targets.length && (!retainCardId || !targets.includes(retainCardId))) return { enabled: false, reason: '请先选择另一张手牌保留。' };
    if (!targets.length && retainCardId) return { enabled: false, reason: '当前没有其他手牌可保留。' };
  } else if (retainCardId) return { enabled: false, reason: '这张牌不需要保留目标。' };

  // reduceRun clones its input; only the event's public scalar effects are read.
  const projected = reduceRun(run, { type: 'play-card', cardInstanceId, ...(retainCardId ? { retainCardId } : {}) });
  const action = projected.history.slice(run.history.length).find((item) => item.type === 'battle' && item.action === 'play-card');
  if (!action) throw new Error('缺少出牌结果，无法生成预览。');
  const number = (key: string): number => {
    const value = action.data[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('出牌结果不完整，无法生成预览。');
    return value;
  };
  const enemyHpAfter = number('enemyHpAfter');
  const enemyShieldAfter = number('enemyShieldAfter');
  const playerShieldAfter = number('playerShieldAfter');
  const capacityAfter = number('capacity');
  const overloadAfter = number('overloadNext');
  const hitCount = number('hitCount');
  const damagePerHit = number('damagePerHit');
  const shieldDamage = battle.enemy.shield - enemyShieldAfter;
  const healthDamage = battle.enemy.hp - enemyHpAfter;
  const defeated = enemyHpAfter === 0;
  const incomingAttack = !defeated && battle.enemy.intent.kind === 'attack' ? battle.enemy.intent.amount : null;
  const rawIncoming = incomingAttack === null ? 0 : Math.max(0, incomingAttack - playerShieldAfter);
  const defeatedIfEndNow = incomingAttack !== null && rawIncoming >= run.hp;
  return {
    enabled: true,
    energyBefore: battle.energy, energyAfter: number('energy'),
    capacityBefore: battle.capacity, capacityAfter,
    overloadBefore: battle.overloadNext, overloadAfter,
    playerShieldBefore: battle.shield, playerShieldAfter,
    enemyHpBefore: battle.enemy.hp, enemyHpAfter,
    enemyShieldBefore: battle.enemy.shield, enemyShieldAfter,
    attackBonusBefore: battle.attackBonus, attackBonusAfter: number('attackBonusAfter'),
    hitCount, maxHitCount: number('maxHitCount'), damagePerHit,
    shieldDamage, healthDamage,
    overkillDamage: Math.max(0, hitCount * damagePerHit - shieldDamage - healthDamage),
    defeated, growthCapped: card.cardId === 'C11' && battle.capacity >= 6,
    incomingAttack,
    incomingHealthDamage: incomingAttack === null ? null : Math.min(run.hp, rawIncoming),
    defeatedIfEndNow,
    nextEnergyIfSurviving: defeated || defeatedIfEndNow ? null : Math.max(0, capacityAfter - overloadAfter),
  };
}

/** Plain language shared by the compact mobile dock and desktop selection. */
export function describeCardPlayPreview(preview: CardPlayPreview): string[] {
  if (!preview.enabled) return [preview.reason];
  const lines: string[] = [];
  if (preview.hitCount > 0) {
    const executed = preview.hitCount * preview.damagePerHit;
    const potential = preview.maxHitCount * preview.damagePerHit;
    const perHit = preview.attackBonusBefore > 0 ? `（每段含增伤 +${preview.attackBonusBefore}）` : '';
    if (preview.maxHitCount > 1) {
      lines.push(`攻击最多 ${preview.maxHitCount} 段 × ${preview.damagePerHit} = ${potential}${perHit}；本次实际执行 ${preview.hitCount} 段，共 ${executed}。`);
    } else lines.push(`攻击 ${executed} 点${perHit}。`);
    lines.push(`对手护盾减少 ${preview.shieldDamage}，生命减少 ${preview.healthDamage}${preview.overkillDamage ? `；溢出 ${preview.overkillDamage} 点` : ''}。`);
    if (preview.defeated && preview.hitCount < preview.maxHitCount) lines.push('对手被击败后，剩余伤害段不会执行。');
  }
  if (preview.playerShieldAfter !== preview.playerShieldBefore) lines.push(`护盾 ${preview.playerShieldBefore} → ${preview.playerShieldAfter}（+${preview.playerShieldAfter - preview.playerShieldBefore}）。`);
  if (preview.attackBonusAfter > preview.attackBonusBefore) lines.push(`本回合后续攻击每段再 +${preview.attackBonusAfter - preview.attackBonusBefore}，累计 +${preview.attackBonusAfter}。`);
  lines.push(`当前能量 ${preview.energyBefore} → ${preview.energyAfter}。`);
  if (preview.capacityAfter > preview.capacityBefore) lines.push(`容量 ${preview.capacityBefore} → ${preview.capacityAfter}；新增格为空，下回合开始恢复。`);
  else if (preview.growthCapped) lines.push('容量已满；护盾仍生效，本次不能增加容量。');
  if (preview.defeated) {
    lines.push('击败对手后，敌人不会行动；本场未结算过载清除。');
  } else {
    if (preview.overloadAfter > 0) {
      lines.push(preview.defeatedIfEndNow
        ? `过载不扣本回合能量；若能存活至下回合，将锁定 ${preview.overloadAfter}。`
        : `过载不扣本回合能量；若现在结束且存活，下回合锁定 ${preview.overloadAfter}，恢复 ${preview.nextEnergyIfSurviving} 能量。`);
    }
    if (preview.incomingAttack !== null && preview.incomingHealthDamage !== null) {
      lines.push(`若现在结束回合，对手攻击 ${preview.incomingAttack}，你会损失 ${preview.incomingHealthDamage} 生命${preview.defeatedIfEndNow ? '、生命归零，本场失败' : ''}。`);
    }
  }
  return lines;
}

/** Keep the fixed mobile controls short; every quantity remains explicit. */
export function describeCompactCardPlayPreview(preview: CardPlayPreview): string[] {
  if (!preview.enabled) return [preview.reason];
  const lines: string[] = [];
  const effects: string[] = [];
  if (preview.hitCount) {
    const hits = preview.maxHitCount > 1 ? `${preview.hitCount}×${preview.damagePerHit}` : `${preview.damagePerHit}`;
    const theoretical = preview.hitCount < preview.maxHitCount ? `（最多 ${preview.maxHitCount}×${preview.damagePerHit}）` : '';
    const bonus = preview.attackBonusBefore > 0 ? `（每段+${preview.attackBonusBefore}）` : '';
    effects.push(`攻击 ${hits}${theoretical}${bonus}：破盾 ${preview.shieldDamage}，生命 −${preview.healthDamage}${preview.overkillDamage ? `，溢出 ${preview.overkillDamage}` : ''}`);
  }
  if (preview.playerShieldAfter !== preview.playerShieldBefore) effects.push(`护盾 ${preview.playerShieldBefore}→${preview.playerShieldAfter}`);
  if (preview.attackBonusAfter > preview.attackBonusBefore) effects.push(`后续每段 +${preview.attackBonusAfter - preview.attackBonusBefore}`);
  if (effects.length) lines.push(effects.join(' · '));
  lines.push(`能量 ${preview.energyBefore}→${preview.energyAfter}${preview.capacityAfter !== preview.capacityBefore ? ` · 容量 ${preview.capacityBefore}→${preview.capacityAfter}（空格，下回合生效）` : preview.growthCapped ? ' · 容量已满' : ''}`);
  if (preview.defeated) lines.push('击败对手；敌方不行动，过载清除。');
  else if (preview.defeatedIfEndNow) lines.push(`${preview.overloadAfter ? '过载当前不扣能量；' : ''}现在结束回合：生命 −${preview.incomingHealthDamage}，本场失败。`);
  else if (preview.overloadAfter > 0) lines.push(`过载当前不扣能量；下回合锁 ${preview.overloadAfter}，存活后恢复 ${preview.nextEnergyIfSurviving}。`);
  else if (preview.incomingHealthDamage !== null) lines.push(`现在结束回合：生命 −${preview.incomingHealthDamage}。`);
  return lines;
}
