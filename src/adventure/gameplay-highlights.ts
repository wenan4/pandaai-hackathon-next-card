import { CARDS, ENEMIES } from './content';
import type { CardId, EnemyId, GameEvent, Run, RunSource } from './types';

export interface GameHighlight {
  id: string;
  kind: 'combo' | 'victory' | 'reward' | 'growth';
  title: string;
  text: string;
  evidenceIds: string[];
  source: RunSource;
}

interface EnemyStateAtEvent {
  hp: number | null;
  shield: number | null;
  hpEvidence: string | null;
  shieldEvidence: string | null;
}
interface Combo {
  buff: GameEvent;
  attack: GameEvent;
  hpLoss: number | null;
  shieldLoss: number | null;
  hpEvidence: string | null;
  shieldEvidence: string | null;
}

function numberField(event: GameEvent, key: string): number | null {
  const value = event.data[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isCardId(value: unknown): value is CardId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CARDS, value);
}

function isEnemyId(value: unknown): value is EnemyId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ENEMIES, value);
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}

/** Inspect events in order; missing legacy fields make the affected deltas unknown. */
function findCombo(history: GameEvent[]): Combo | null {
  let combatNode: GameEvent['node'] | null = null;
  let state: EnemyStateAtEvent = { hp: null, shield: null, hpEvidence: null, shieldEvidence: null };
  let buff: GameEvent | null = null;
  let best: Combo | null = null;
  for (const event of history) {
    if (event.type !== 'battle') continue;
    if (event.action === 'battle-start') {
      combatNode = event.node;
      state = { hp: numberField(event, 'hp'), shield: 0, hpEvidence: event.id, shieldEvidence: event.id };
      buff = null;
      continue;
    }
    if (combatNode !== event.node) {
      combatNode = event.node;
      state = { hp: null, shield: null, hpEvidence: null, shieldEvidence: null };
      buff = null;
    }
    if (event.action === 'enemy-attack') { state.shield = 0; state.shieldEvidence = event.id; continue; }
    if (event.action === 'enemy-shield') { state.shield = numberField(event, 'amount'); state.shieldEvidence = state.shield === null ? null : event.id; continue; }
    if (event.action !== 'play-card') continue;
    const cardId = event.data.cardId;
    const turn = numberField(event, 'turn');
    const hpAfter = numberField(event, 'enemyHpAfter');
    const shieldAfter = numberField(event, 'enemyShieldAfter');
    if (cardId === 'C08' && turn !== null) buff = event;
    if (cardId === 'C07' && turn !== null && buff && buff.node === event.node && numberField(buff, 'turn') === turn) {
      const hpLoss = state.hp !== null && hpAfter !== null && hpAfter <= state.hp ? state.hp - hpAfter : null;
      const shieldLoss = state.shield !== null && shieldAfter !== null && shieldAfter <= state.shield ? state.shield - shieldAfter : null;
      const candidate: Combo = { buff, attack: event, hpLoss, shieldLoss, hpEvidence: state.hpEvidence, shieldEvidence: state.shieldEvidence };
      const score = (item: Combo): number => (numberField(item.attack, 'hitCount') ?? 0) * (numberField(item.attack, 'damagePerHit') ?? 0);
      if (!best || score(candidate) > score(best)) best = candidate;
    }
    if (hpAfter !== null) { state.hp = hpAfter; state.hpEvidence = event.id; }
    else if (!isCardId(cardId) || CARDS[cardId].attack) { state.hp = null; state.hpEvidence = null; }
    if (shieldAfter !== null) { state.shield = shieldAfter; state.shieldEvidence = event.id; }
    else if (!isCardId(cardId) || CARDS[cardId].attack) { state.shield = null; state.shieldEvidence = null; }
  }
  return best;
}

function comboHighlight(combo: Combo, source: RunSource): GameHighlight {
  const hits = numberField(combo.attack, 'hitCount');
  const maxHits = numberField(combo.attack, 'maxHitCount');
  const perHit = numberField(combo.attack, 'damagePerHit');
  let text = '同一回合先打出余烬，再打出连刃。';
  const hasSegments = hits !== null && hits > 0 && perHit !== null && perHit > 0;
  if (hasSegments) {
    if (maxHits !== null && maxHits >= hits) text += `理论最多 ${maxHits} 段 × ${perHit} 点 = ${maxHits * perHit} 点；`;
    text += `实际执行 ${hits} 段 × ${perHit} 点 = ${hits * perHit} 点攻击。`;
    if (combo.hpLoss !== null && combo.shieldLoss !== null) {
      text += `其中护盾吸收 ${combo.shieldLoss} 点，目标生命减少 ${combo.hpLoss} 点。`;
      const excess = hits * perHit - combo.hpLoss - combo.shieldLoss;
      if (excess > 0) text += `另有 ${excess} 点溢出伤害。`;
    } else text += '记录不足，无法区分其中的破盾和生命损失。';
  } else text += '这次记录未保存分段伤害，无法重建数值。';
  return {
    id: `combo-${combo.attack.id}`, kind: 'combo', title: '余烬与连刃', text, source,
    evidenceIds: unique([combo.buff.id, combo.attack.id, combo.hpLoss === null ? null : combo.hpEvidence, combo.shieldLoss === null ? null : combo.shieldEvidence]),
  };
}

/** Gameplay-only highlights, grounded in saved events and safe for older runs. */
export function gameplayHighlights(run: Run): GameHighlight[] {
  const highlights: GameHighlight[] = [];
  const combo = findCombo(run.history);
  if (combo) highlights.push(comboHighlight(combo, run.source));

  const victories = run.history.filter((event) => event.type === 'battle' && event.action === 'victory' && isEnemyId(event.data.enemyId));
  if (victories.length) {
    const names = victories.map((event) => ENEMIES[event.data.enemyId as EnemyId].name);
    highlights.push({ id: `victories-${victories[0]!.id}`, kind: 'victory', title: '已击败的对手', text: `本局已击败${names.join('、')}。`, evidenceIds: victories.map((event) => event.id), source: run.source });
  }

  const rewards = run.history.filter((event) => event.type === 'choice' && event.action === 'choose-reward' && isCardId(event.data.cardId));
  if (rewards.length) {
    const names = rewards.map((event) => CARDS[event.data.cardId as CardId].name);
    highlights.push({ id: `rewards-${rewards[0]!.id}`, kind: 'reward', title: '加入牌组的奖励', text: `本局选择${names.join('、')}作为奖励，加入了牌组。`, evidenceIds: rewards.map((event) => event.id), source: run.source });
  }

  if (highlights.length < 3 && !combo) {
    const growth = run.history.find((event) => event.type === 'battle' && event.action === 'play-card' && (event.data.cardId === 'C05' || event.data.cardId === 'C11'));
    if (growth && isCardId(growth.data.cardId)) {
      const capacity = numberField(growth, 'capacity');
      highlights.push({ id: `growth-${growth.id}`, kind: 'growth', title: '一次成长牌操作', text: `本局打出${CARDS[growth.data.cardId].name}${capacity === null ? '' : `，操作后本场容量为 ${capacity}`}。`, evidenceIds: [growth.id], source: run.source });
    }
  }
  return highlights.slice(0, 3);
}
