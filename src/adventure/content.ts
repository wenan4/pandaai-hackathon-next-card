import type { CardDefinition, CardId, EnemyDefinition, EnemyId, RouteOption } from './types';

export const CARDS: Record<CardId, CardDefinition> = {
  C01: { id: 'C01', name: '敲击', cost: 1, upgradedCost: 1, description: '造成 6 点伤害。', upgradedDescription: '造成 9 点伤害。', overload: 0, exhaust: false, retain: false, attack: true },
  C02: { id: 'C02', name: '格挡', cost: 1, upgradedCost: 1, description: '获得 6 点护盾。', upgradedDescription: '获得 9 点护盾。', overload: 0, exhaust: false, retain: false, attack: false },
  C03: { id: 'C03', name: '整理', cost: 1, upgradedCost: 1, description: '抽 2 张牌。', upgradedDescription: '抽 3 张牌。', overload: 0, exhaust: false, retain: false, attack: false },
  C04: { id: 'C04', name: '借火', cost: 0, upgradedCost: 0, description: '本回合获得 2 点能量；过载 2；消耗。', upgradedDescription: '本回合获得 3 点能量；过载 2；消耗。', overload: 2, exhaust: true, retain: false, attack: false },
  C05: { id: 'C05', name: '引根', cost: 2, upgradedCost: 1, description: '成长 1；消耗。新增容量下回合生效。', upgradedDescription: '成长 1；消耗。新增容量下回合生效。', overload: 0, exhaust: true, retain: false, attack: false },
  C06: { id: 'C06', name: '缓步', cost: 1, upgradedCost: 1, description: '获得 4 护盾，抽 1 张牌。', upgradedDescription: '获得 6 护盾，抽 1 张牌。', overload: 0, exhaust: false, retain: false, attack: false },
  C07: { id: 'C07', name: '连刃', cost: 1, upgradedCost: 1, description: '连续造成 3 次 3 点伤害。', upgradedDescription: '连续造成 3 次 4 点伤害。', overload: 0, exhaust: false, retain: false, attack: true },
  C08: { id: 'C08', name: '余烬', cost: 1, upgradedCost: 1, description: '本回合后续攻击牌每段伤害 +2。', upgradedDescription: '本回合后续攻击牌每段伤害 +3。', overload: 0, exhaust: false, retain: false, attack: false },
  C09: { id: 'C09', name: '引雷', cost: 1, upgradedCost: 1, description: '造成 12 点伤害；过载 1。', upgradedDescription: '造成 16 点伤害；过载 1。', overload: 1, exhaust: false, retain: false, attack: true },
  C10: { id: 'C10', name: '临时壁垒', cost: 1, upgradedCost: 1, description: '获得 14 护盾；过载 1。', upgradedDescription: '获得 18 护盾；过载 1。', overload: 1, exhaust: false, retain: false, attack: false },
  C11: { id: 'C11', name: '培育', cost: 2, upgradedCost: 2, description: '获得 5 护盾，成长 1；消耗。', upgradedDescription: '获得 8 护盾，成长 1；消耗。', overload: 0, exhaust: true, retain: false, attack: false },
  C12: { id: 'C12', name: '参天一击', cost: 4, upgradedCost: 4, description: '造成 26 点伤害；保留。', upgradedDescription: '造成 34 点伤害；保留。', overload: 0, exhaust: false, retain: true, attack: true },
  C13: { id: 'C13', name: '树冠守望', cost: 4, upgradedCost: 4, description: '获得 14 护盾，造成 14 点伤害；保留。', upgradedDescription: '获得 18 护盾，造成 18 点伤害；保留。', overload: 0, exhaust: false, retain: true, attack: true },
  C14: { id: 'C14', name: '候机', cost: 0, upgradedCost: 0, description: '选择另一张手牌保留一回合，抽 1；消耗。无其他手牌时仍可抽牌。', upgradedDescription: '选择另一张手牌保留一回合，抽 2；消耗。无其他手牌时仍可抽牌。', overload: 0, exhaust: true, retain: false, attack: false },
};

export const STARTER_DECK: CardId[] = ['C01', 'C01', 'C01', 'C02', 'C02', 'C02', 'C03', 'C04', 'C05', 'C06'];
export const PRICES = { healCents: 1000, upgradeCents: 2000, cardCents: 2500, archiveCents: 400 } as const;

export const ENEMIES: Record<EnemyId, EnemyDefinition> = {
  gatekeeper: { id: 'gatekeeper', name: '城门守卫', maxHp: 18, cycle: [{ kind: 'attack', amount: 4 }, { kind: 'shield', amount: 4 }, { kind: 'attack', amount: 6 }], rewardCents: 1200, blurb: '一场真正的短战斗：攻击、防护和整备依次出现。' },
  pursuer: { id: 'pursuer', name: '追灯者', maxHp: 34, cycle: [{ kind: 'attack', amount: 8 }, { kind: 'attack', amount: 8 }, { kind: 'attack', amount: 3 }], rewardCents: 1200, blurb: '前两回合攻势较强，第三回合稍有喘息。' },
  moss: { id: 'moss', name: '苔壳卫兵', maxHp: 42, cycle: [{ kind: 'shield', amount: 6 }, { kind: 'attack', amount: 5 }, { kind: 'attack', amount: 9 }], rewardCents: 1200, blurb: '初期整备，随后攻击加重，适合寻找成长窗口。' },
  clock: { id: 'clock', name: '摆钟侍从', maxHp: 38, cycle: [{ kind: 'attack', amount: 12 }, { kind: 'shield', amount: 6 }, { kind: 'attack', amount: 4 }], rewardCents: 1200, blurb: '大攻击与整备交替出现。' },
  keeper: { id: 'keeper', name: '守灯者', maxHp: 90, cycle: [{ kind: 'attack', amount: 6 }, { kind: 'attack', amount: 14 }, { kind: 'shield', amount: 10 }], rewardCents: 0, blurb: '守灯者按整备、压迫与恢复的固定节奏行动。' },
};

export const REWARDS: Record<'N1' | 'N3' | 'N5', CardId[]> = {
  N1: ['C07', 'C11', 'C10'],
  N3: ['C08', 'C12', 'C06'],
  N5: ['C09', 'C13', 'C14'],
};

export const CAMP_STOCK: Record<'N2' | 'N4' | 'N6', CardId[]> = {
  N2: ['C08', 'C12', 'C14'],
  N4: ['C07', 'C11', 'C13'],
  N6: ['C09', 'C10', 'C12'],
};

export const ROUTES: Record<'N3' | 'N5', RouteOption[]> = {
  N3: (['pursuer', 'moss'] as EnemyId[]).map((enemyId) => ({ enemyId, name: ENEMIES[enemyId].name, description: ENEMIES[enemyId].blurb, rewardCents: ENEMIES[enemyId].rewardCents })),
  N5: (['clock', 'moss'] as EnemyId[]).map((enemyId) => ({ enemyId, name: ENEMIES[enemyId].name, description: ENEMIES[enemyId].blurb, rewardCents: ENEMIES[enemyId].rewardCents })),
};
