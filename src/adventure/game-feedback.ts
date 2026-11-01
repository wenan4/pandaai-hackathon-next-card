import { CARDS, ENEMIES } from './content';
import type { CardInstance, EnemyId, GameEvent, Run, RunAction, RunStatus } from './types';

export interface OutcomeFeedback {
  status: RunStatus;
  title: string;
  summary: string;
  settlement: 'pending-quote' | 'pending-redemption' | 'settled' | 'none' | 'unknown';
  settlementText: string | null;
  lastOpponent: string | null;
  defeatBlow: string | null;
  evidenceIds: string[];
}

export interface ActionFeedback {
  kind: 'buy-card' | 'heal' | 'upgrade-card' | 'free-upgrade' | 'free-rest' | 'buy-archive' | 'choose-reward';
  title: string;
  detail: string;
}

const isEnemyId = (value: unknown): value is EnemyId =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(ENEMIES, value);

function numberField(event: GameEvent, key: string): number | null {
  const value = event.data?.[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Unknown or malformed saved fields stay unknown; do not infer a share count. */
function hasShares(run: Run): boolean | null {
  const value = run.wallet?.shareUnits;
  return typeof value === 'string' && /^\d+$/.test(value) ? /[1-9]/.test(value) : null;
}

function battleBoundary(history: GameEvent[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    const event = history[i];
    if (event?.type === 'battle' && ['battle-start', 'victory', 'defeat'].includes(event.action)) return i;
  }
  return -1;
}

/** Find the start for this battle only; never borrow an earlier opponent. */
function matchingStart(history: GameEvent[], boundaryIndex: number): GameEvent | null {
  const boundary = history[boundaryIndex];
  if (!boundary) return null;
  if (boundary.action === 'battle-start') return boundary;
  for (let i = boundaryIndex - 1; i >= 0; i--) {
    const event = history[i];
    if (!event || event.type !== 'battle') continue;
    if (event.node !== boundary.node) return null;
    if (event.action === 'battle-start') return event;
    if (event.action === 'victory' || event.action === 'defeat') return null;
  }
  return null;
}

/** Presentation of the actual ending and saved combat events, without estimating a settlement. */
export function outcomeFeedback(run: Run): OutcomeFeedback {
  const labels: Record<RunStatus, { title: string; summary: string }> = {
    active: { title: '冒险进行中', summary: '这次冒险尚未结束。' },
    defeated: { title: '战斗失败', summary: '这次冒险以战斗失败结束。' },
    cleared: { title: '冒险通关', summary: '战斗已经结束，这次冒险已通关。' },
    returned: { title: '提前返程', summary: '已选择提前返程，这次冒险已结束。' },
  };
  const feedback: OutcomeFeedback = {
    status: run.status, ...labels[run.status], settlement: 'none', settlementText: null,
    lastOpponent: null, defeatBlow: null, evidenceIds: [],
  };
  if (run.status !== 'active') {
    if (run.phase === 'market' && run.market?.pending) {
      if (run.market.order?.kind === 'sell') {
        feedback.settlement = 'pending-redemption';
        feedback.settlementText = run.market.order.automatic
          ? '冒险已结束，剩余份额的自动回收正等待报价；实际到账以执行结果为准。'
          : '冒险已结束，回收订单正等待报价；实际到账以执行结果为准。';
      } else {
        feedback.settlement = 'pending-quote';
        feedback.settlementText = run.status === 'cleared' && run.market.pending.stage === 't3' && hasShares(run) === true
          ? '战斗已结束，最终时点报价尚未到达；报价处理后剩余份额还需回收。'
          : '冒险已结束，当前时点的报价尚未到达。';
      }
    } else if (run.phase === 'ended' && hasShares(run) === false) {
      feedback.settlement = 'settled';
      feedback.settlementText = '本次冒险已结束，当前没有待回收份额。';
    } else {
      feedback.settlement = 'unknown';
      feedback.settlementText = '当前记录不足以确认回收进度。';
    }
  }

  const history = run.history ?? [];
  const index = battleBoundary(history);
  const boundary = history[index];
  // A missing terminal battle event must not turn a previous victory into the final opponent.
  const usable = boundary && (run.status !== 'defeated' || boundary.action === 'defeat')
    && (run.status !== 'cleared' || boundary.node === 'N7');
  if (usable) {
    const start = matchingStart(history, index);
    const value = boundary.action === 'victory' && isEnemyId(boundary.data?.enemyId)
      ? boundary.data.enemyId : start?.data?.enemyId;
    if (isEnemyId(value)) {
      feedback.lastOpponent = ENEMIES[value].name;
      feedback.evidenceIds.push(boundary.action === 'victory' && boundary.data?.enemyId === value ? boundary.id : start!.id);
    }
    const attack = history[index - 1];
    if (run.status === 'defeated' && boundary.action === 'defeat' && attack?.type === 'battle'
      && attack.action === 'enemy-attack' && attack.node === boundary.node) {
      const amount = numberField(attack, 'amount');
      const absorbed = numberField(attack, 'absorbed');
      const damage = numberField(attack, 'damage');
      const hp = numberField(attack, 'hp');
      if (amount !== null && absorbed !== null && damage !== null && damage > 0 && hp === 0
        && amount >= absorbed && amount - absorbed === damage) {
        feedback.defeatBlow = `最后一次攻击 ${amount} 点，护盾吸收 ${absorbed} 点，承受 ${damage} 点伤害，生命降至 0。`;
        feedback.evidenceIds.push(attack.id, boundary.id);
      }
    }
  }
  feedback.evidenceIds = [...new Set(feedback.evidenceIds)];
  return feedback;
}

function coins(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;
  return fraction ? `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}` : String(whole);
}

function sameCard(first: CardInstance, second: CardInstance): boolean {
  return first.instanceId === second.instanceId && first.cardId === second.cardId && first.upgraded === second.upgraded;
}

function unchangedDeck(before: Run, after: Run): boolean {
  return before.deck.length === after.deck.length && before.deck.every((card, index) => !!after.deck[index] && sameCard(card, after.deck[index]!));
}

function addedCard(before: Run, after: Run, cardId: CardInstance['cardId']): boolean {
  if (after.deck.length !== before.deck.length + 1 || !before.deck.every((card, index) => !!after.deck[index] && sameCard(card, after.deck[index]!))) return false;
  const added = after.deck[after.deck.length - 1];
  return !!added && added.cardId === cardId && !added.upgraded && !before.deck.some((card) => card.instanceId === added.instanceId);
}

function cardLabel(deck: CardInstance[], card: CardInstance): string {
  const matches = deck.filter((item) => item.cardId === card.cardId);
  const position = matches.findIndex((item) => item.instanceId === card.instanceId) + 1;
  return `${CARDS[card.cardId].name}${matches.length > 1 ? `（第 ${position} 张）` : ''}`;
}

/** Require one newly appended choice from this exact transition, not a stale or replayed action. */
function choiceFor(before: Run, after: Run, action: RunAction): GameEvent | null {
  if (before.id !== after.id || before.status !== 'active' || after.history.length <= before.history.length) return null;
  if (!before.history.every((event, index) => after.history[index]?.id === event.id && after.history[index]?.action === event.action)) return null;
  const added = after.history.slice(before.history.length);
  const choice = added[0];
  if (!choice || choice.type !== 'choice' || choice.action !== action.type) return null;
  // The first reward can additionally open a camp; no other later action belongs to this receipt.
  if (added.length > 1 && !(action.type === 'choose-reward' && added.length === 2
    && added[1]?.type === 'system' && added[1].action === 'camp-arrival')) return null;
  return choice;
}

/** Describe only successful, observable effects of this exact reducer transition. */
export function actionFeedback(before: Run, after: Run, action: RunAction): ActionFeedback | null {
  const choice = choiceFor(before, after, action);
  if (!choice) return null;
  const cost = before.wallet.cashCents - after.wallet.cashCents;
  if (!Number.isSafeInteger(cost) || cost < 0) return null;
  const balance = `剩余 ${coins(after.wallet.cashCents)} 金币。`;

  switch (action.type) {
    case 'choose-reward': {
      if (before.phase !== 'reward' || !before.reward || after.reward !== null || choice.data.cardId !== action.cardId || cost !== 0) return null;
      if (action.cardId === null) return unchangedDeck(before, after)
        ? { kind: action.type, title: '已跳过奖励', detail: '本次没有加入新牌。' } : null;
      if (!before.reward.choices.includes(action.cardId) || !addedCard(before, after, action.cardId)) return null;
      return { kind: action.type, title: '奖励已加入', detail: `${CARDS[action.cardId].name}已加入牌组。` };
    }
    case 'buy-card': {
      if (choice.data.cardId !== action.cardId || cost <= 0 || !addedCard(before, after, action.cardId)) return null;
      return { kind: action.type, title: '购买成功', detail: `${CARDS[action.cardId].name}已加入牌组，花费 ${coins(cost)} 金币；${balance}` };
    }
    case 'heal':
    case 'free-rest': {
      const healed = after.hp - before.hp;
      if (!Number.isSafeInteger(healed) || healed <= 0 || (action.type === 'heal' ? cost <= 0 : cost !== 0
        || before.camp?.freeChoiceUsed !== false || after.camp?.freeChoiceUsed !== true)) return null;
      return { kind: action.type, title: action.type === 'heal' ? '生命补给完成' : '免费休息完成',
        detail: `生命 ${before.hp} → ${after.hp}，恢复 ${healed} 点；${action.type === 'heal' ? `花费 ${coins(cost)} 金币；${balance}` : '未花费金币，本营地的免费整备机会已使用。'}` };
    }
    case 'upgrade-card':
    case 'free-upgrade': {
      const oldCard = before.deck.find((card) => card.instanceId === action.cardInstanceId);
      const newCard = after.deck.find((card) => card.instanceId === action.cardInstanceId);
      if (!oldCard || !newCard || oldCard.upgraded || !newCard.upgraded || newCard.cardId !== oldCard.cardId
        || choice.data.cardInstanceId !== action.cardInstanceId || (action.type === 'upgrade-card' ? cost <= 0 : cost !== 0
          || before.camp?.freeChoiceUsed !== false || after.camp?.freeChoiceUsed !== true)) return null;
      const definition = CARDS[oldCard.cardId];
      return { kind: action.type, title: action.type === 'upgrade-card' ? '卡牌升级完成' : '免费整理完成',
        detail: `${cardLabel(before.deck, oldCard)}已升级。升级前：${definition.description}（${definition.cost} 能量）；升级后：${definition.upgradedDescription}（${definition.upgradedCost} 能量）。${action.type === 'upgrade-card' ? `花费 ${coins(cost)} 金币；${balance}` : '未花费金币，本营地的免费整备机会已使用。'}` };
    }
    case 'buy-archive':
      return !before.archiveOwned && after.archiveOwned && cost > 0
        ? { kind: action.type, title: '档案购买成功', detail: `历史档案已拥有，花费 ${coins(cost)} 金币；${balance}` } : null;
    default: return null;
  }
}
