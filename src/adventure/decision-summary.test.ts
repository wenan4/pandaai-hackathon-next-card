import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decisionSummary } from './decision-summary';
import { canPlayCard, createRun, pendingMarketStep, reduceRun } from './engine';
import type { CardId, MarketQuote, Run } from './types';

type CombatStep = CardId | 'end';

function playSequence(initial: Run, steps: CombatStep[]): Run {
  return steps.reduce((run, step) => {
    if (step === 'end') return reduceRun(run, { type: 'end-turn' });
    const card = run.deck.find((item) => item.cardId === step && run.battle?.hand.includes(item.instanceId));
    if (!card) throw new Error(`当前无法打出 ${step}`);
    return reduceRun(run, { type: 'play-card', cardInstanceId: card.instanceId });
  }, initial);
}

function deliver(run: Run): Run {
  const pending = pendingMarketStep(run);
  if (!pending) throw new Error('没有待处理的报价');
  const path = join(process.cwd(), 'public', 'data', 'adventure', 'stages', pending.caseId, `${pending.stage}.json`);
  return reduceRun(run, { type: 'apply-quote', quote: JSON.parse(readFileSync(path, 'utf8')) as MarketQuote });
}

/** Real reducer actions reach the first camp, with its actual battle reward. */
function firstCamp(): Run {
  let run = createRun({ seed: 104, caseId: 'lantern-d', observationEnabled: true });
  run = playSequence(run, ['C02', 'C03', 'C01', 'end', 'C01', 'C04', 'C02', 'C02', 'end', 'C02', 'end', 'C01']);
  return reduceRun(run, { type: 'choose-reward', cardId: 'C07' });
}

/** Real actions and stage quotes reach the N4 decision, including a zero-entry path. */
function halfway(amountCents: number): Run {
  let run = reduceRun(firstCamp(), { type: 'buy-card', cardId: 'C08' });
  run = reduceRun(run, { type: 'submit-entry', amountCents });
  run = deliver(reduceRun(run, { type: 'continue' }));
  run = reduceRun(run, { type: 'choose-route', enemyId: 'moss' });
  run = playSequence(run, ['C05', 'C04', 'C08', 'C07', 'C01', 'end', 'C02', 'C06', 'end', 'C02', 'C01', 'C01', 'C06', 'end', 'C07']);
  return deliver(reduceRun(run, { type: 'choose-reward', cardId: 'C08' }));
}

/** Play a fixed defensive policy without bypassing card or energy rules. */
function winMoss(initial: Run): Run {
  let run = initial;
  for (let count = 0; count < 200 && run.phase === 'battle'; count++) {
    const battle = run.battle!;
    const cards = battle.hand.map((id) => run.deck.find((card) => card.instanceId === id)!).filter((card) => canPlayCard(run, card.instanceId).enabled);
    const get = (id: CardId) => cards.find((card) => card.cardId === id);
    const incoming = battle.enemy.intent.kind === 'attack' && battle.enemy.intent.amount > battle.shield;
    const card = (incoming ? get('C02') ?? get('C06') : undefined)
      ?? (battle.energy <= 2 ? get('C04') : undefined)
      ?? (get('C07') && battle.energy >= 2 ? get('C08') : undefined)
      ?? get('C07') ?? get('C01') ?? get('C03') ?? get('C06') ?? get('C02');
    run = card ? reduceRun(run, { type: 'play-card', cardInstanceId: card.instanceId }) : reduceRun(run, { type: 'end-turn' });
  }
  if (run.phase !== 'reward') throw new Error('没有击败苔壳卫兵');
  return run;
}

afterEach(() => vi.unstubAllGlobals());

describe('this-run decision summary', () => {
  it('keeps missing choices unknown and never reads history in play-only mode', () => {
    const run = createRun({ seed: 104, observationEnabled: true });
    const summary = decisionSummary(run);
    expect(summary.funding.status).toBe('unobserved');
    expect(summary.response.status).toBe('unobserved');
    expect(summary.information.status).toBe('unobserved');
    expect(summary.boundary).toContain('不能推断稳定交易人格');
    expect(summary.boundary).toContain('战斗打法不参与');

    const disabled = new Proxy({ ...run, observationEnabled: false }, {
      get(target, key, receiver) {
        if (key === 'history') throw new Error('play-only history should not be read');
        return Reflect.get(target, key, receiver);
      },
    });
    expect(Object.values(decisionSummary(disabled)).filter((value) => typeof value === 'object').map((value) => value.status))
      .toEqual(['disabled', 'disabled', 'disabled']);
  });

  it('describes actual allocation with its prior spending and cash left', () => {
    const camp = firstCamp();
    expect(camp.wallet.cashCents).toBe(7200);
    const bought = reduceRun(camp, { type: 'buy-card', cardId: 'C08' });
    const partial = reduceRun(bought, { type: 'submit-entry', amountCents: 2000 });
    const insight = decisionSummary(partial).funding;
    expect(insight).toMatchObject({ status: 'observed', brief: '参与 20 金币，留下 27 金币' });
    expect(insight.detail).toContain('购买和补给共花费 25 金币');
    expect(insight.evidenceIds).toEqual(partial.history.filter((event) => ['buy-card', 'submit-entry'].includes(event.action)).map((event) => event.id));

    expect(decisionSummary(reduceRun(camp, { type: 'submit-entry', amountCents: 0 })).funding.brief).toBe('参与 0 金币，留下 72 金币');
    expect(decisionSummary(reduceRun(camp, { type: 'submit-entry', amountCents: 7200 })).funding.brief).toBe('参与 72 金币，留下 0 金币');
  });

  it('keeps a redemption choice separate from execution and its reference value separate from gains', () => {
    const camp = halfway(2000);
    const choice = reduceRun(camp, { type: 'submit-redemption', percent: 50 });
    const pending = decisionSummary(choice).response;
    expect(choice.phase).toBe('market');
    expect(pending).toMatchObject({ status: 'observed', brief: '中途选择回收一半' });
    expect(pending.detail).toContain('参考价值 17.43 金币');
    expect(pending.detail).toContain('低于当时份额成本 2.57 金币');
    expect(pending.detail).toContain('不代表回收已到账');
    const executed = deliver(choice);
    expect(executed.history.some((event) => event.action === 'apply-quote' && event.data.stage === 't1-exec')).toBe(true);
    expect(decisionSummary(executed).response).toEqual(pending);

    const noShares = reduceRun(halfway(0), { type: 'submit-redemption', percent: 0 });
    expect(decisionSummary(noShares).response).toMatchObject({ status: 'unobserved', brief: '尚无持有后的自主选择' });
  });

  it('preserves distinct choices at the two actual decision points', () => {
    let run = halfway(2000);
    run = deliver(reduceRun(run, { type: 'submit-redemption', percent: 0 }));
    run = reduceRun(run, { type: 'free-rest' });
    run = reduceRun(run, { type: 'continue' });
    run = winMoss(reduceRun(run, { type: 'choose-route', enemyId: 'moss' }));
    run = deliver(reduceRun(run, { type: 'choose-reward', cardId: 'C09' }));
    expect(run.node).toBe('N6');
    run = reduceRun(run, { type: 'submit-redemption', percent: 50 });
    const response = decisionSummary(run).response;
    expect(response.brief).toBe('中途继续持有；最后营地选择回收一半');
    expect(response.evidenceIds).toEqual(run.history.filter((event) => event.action === 'submit-redemption').map((event) => event.id));
    expect(response.detail).toContain('中途营地');
    expect(response.detail).toContain('最后营地');
  });

  it('distinguishes buying an archive from opening it', () => {
    const bought = reduceRun(firstCamp(), { type: 'buy-archive' });
    expect(decisionSummary(bought).information).toMatchObject({ status: 'observed', brief: '购买档案，未见打开记录' });
    expect(decisionSummary(bought).information.detail).toContain('花费 4 金币');
    const opened = reduceRun(bought, { type: 'open-archive' });
    const information = decisionSummary(opened).information;
    expect(information.brief).toBe('购买并打开档案');
    expect(information.detail).toContain('打开不代表已经理解');
    expect(information.evidenceIds).toEqual(opened.history.filter((event) => ['buy-archive', 'open-archive'].includes(event.action)).map((event) => event.id));
  });

  it('preserves unknown values in older incomplete records instead of deriving missing facts', () => {
    const run = reduceRun(halfway(2000), { type: 'submit-redemption', percent: 100 });
    const entry = run.history.find((event) => event.action === 'submit-entry')!;
    const redemption = run.history.find((event) => event.action === 'submit-redemption')!;
    entry.snapshot = undefined;
    redemption.snapshot!.referenceValueCents = null;
    const summary = decisionSummary(run);
    expect(summary.funding).toMatchObject({ status: 'unobserved', brief: '参与 20 金币，留用未知' });
    expect(summary.response).toMatchObject({ status: 'observed', brief: '中途选择全部回收' });
    expect(summary.response.detail).toContain('参考价值或成本未完整记录');
    expect(summary.response.detail).not.toContain('17.43');

    redemption.snapshot = undefined;
    expect(decisionSummary(run).response.status).toBe('unobserved');
    delete entry.data.amountCents;
    expect(decisionSummary(run).funding.brief).toBe('参与金额未记录');
  });

  it('is pure, never fetches prices, preserves source, and excludes combat from financial observations', () => {
    const run = reduceRun(halfway(2000), { type: 'submit-redemption', percent: 0 });
    run.source = 'demo';
    const before = JSON.stringify(run);
    const fetch = vi.fn(() => { throw new Error('summary must not fetch'); });
    vi.stubGlobal('fetch', fetch);
    const summary = decisionSummary(run);
    expect(summary.source).toBe('demo');
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(run)).toBe(before);
    const withoutBattleEvents = { ...run, history: run.history.filter((event) => event.type !== 'battle') };
    expect(decisionSummary(withoutBattleEvents)).toEqual(summary);
  });
});
