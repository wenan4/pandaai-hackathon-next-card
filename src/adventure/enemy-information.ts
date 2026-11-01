import { ENEMIES } from './content';
import { enemyAttackGrowth, intentFor } from './engine';
import type { EnemyId, Intent, Run } from './types';

export interface EnemyPattern {
  enemyId: EnemyId;
  name: string;
  maxHp: number;
  /** One full base cycle, starting with the first enemy turn. */
  cycle: Intent[];
  /** Attack bonus accumulates each turn from this point; shield values do not grow. */
  attackGrowth: { fromTurn: number; perTurn: number } | null;
}

export type EnemyIntentTiming = 'this-turn' | 'next-turn' | 'following-turn';
export interface ScheduledEnemyIntent { timing: EnemyIntentTiming; turn: number; intent: Intent }
export interface BattleIntentForecast {
  enemyId: EnemyId;
  /** Future entries describe the fixed plan only if the battle continues. */
  actions: [ScheduledEnemyIntent, ScheduledEnemyIntent, ScheduledEnemyIntent];
}

/** A copied, public pattern; it contains no battle state or random information. */
export function enemyPattern(enemyId: EnemyId): EnemyPattern {
  const enemy = ENEMIES[enemyId];
  return {
    enemyId,
    name: enemy.name,
    maxHp: enemy.maxHp,
    cycle: enemy.cycle.map((intent) => ({ kind: intent.kind, amount: intent.amount })),
    attackGrowth: enemyAttackGrowth(enemyId),
  };
}

/** Current intent comes from the battle; later actions use the same rule as the reducer. */
export function battleIntentForecast(run: Run): BattleIntentForecast | null {
  const battle = run.battle;
  if (run.phase !== 'battle' || !battle?.enemy || !Object.prototype.hasOwnProperty.call(ENEMIES, battle.enemy.id)
    || !Number.isSafeInteger(battle.turn) || battle.turn < 1 || battle.turn > Number.MAX_SAFE_INTEGER - 2) return null;
  const current = battle.enemy.intent;
  if (!current || (current.kind !== 'attack' && current.kind !== 'shield') || !Number.isSafeInteger(current.amount) || current.amount < 0) return null;
  const next = intentFor(battle.enemy.id, battle.turn + 1);
  const following = intentFor(battle.enemy.id, battle.turn + 2);
  if (!Number.isSafeInteger(next.amount) || !Number.isSafeInteger(following.amount)) return null;
  return {
    enemyId: battle.enemy.id,
    actions: [
      { timing: 'this-turn', turn: battle.turn, intent: { kind: current.kind, amount: current.amount } },
      { timing: 'next-turn', turn: battle.turn + 1, intent: next },
      { timing: 'following-turn', turn: battle.turn + 2, intent: following },
    ],
  };
}
