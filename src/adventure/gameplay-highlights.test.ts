import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCalibrationDemo } from './calibration-demo';
import { createRun } from './engine';
import { gameplayHighlights } from './gameplay-highlights';
import { resetMarketCacheForTest } from './market';
import type { GameEvent, Run } from './types';

function event(id: string, action: string, data: GameEvent['data'], type: GameEvent['type'] = 'battle'): GameEvent {
  return { id, node: 'N3', type, action, message: '', data };
}

function withEvents(events: GameEvent[]): Run {
  const run = createRun({ seed: 104, source: 'demo' });
  run.history = events;
  return run;
}

afterEach(() => { vi.unstubAllGlobals(); resetMarketCacheForTest(); });

describe('gameplay highlights', () => {
  it('extracts a genuinely played combo, victories and rewards from the legal calibration journey', async () => {
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const address = typeof input === 'string' ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
      try { return new Response(await readFile(`public${address}`), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
      catch { return new Response('not found', { status: 404 }); }
    });
    const run = await makeCalibrationDemo();
    const saved = JSON.stringify(run);
    const highlights = gameplayHighlights(run);
    expect(highlights).toHaveLength(3);
    expect(highlights.every((item) => item.source === 'demo' && item.evidenceIds.length > 0)).toBe(true);
    const combo = highlights.find((item) => item.kind === 'combo')!;
    expect(combo.text).toContain('实际执行 3 段 × 5 点 = 15 点攻击');
    expect(combo.text).toContain('护盾吸收 0 点，目标生命减少 15 点');
    expect(combo.evidenceIds.every((id) => run.history.some((entry) => entry.id === id))).toBe(true);
    expect(highlights.find((item) => item.kind === 'victory')?.text).toContain('城门守卫、苔壳卫兵');
    expect(highlights.find((item) => item.kind === 'reward')?.text).toContain('连刃、余烬');
    expect(JSON.stringify(run)).toBe(saved);
  });

  it('distinguishes potential, executed hits, shield, actual health loss and overkill on lethal', () => {
    const run = withEvents([
      event('start', 'battle-start', { enemyId: 'moss', hp: 2 }),
      event('shield', 'enemy-shield', { amount: 1, turn: 1 }),
      event('buff', 'play-card', { cardId: 'C08', turn: 2, enemyHpAfter: 2, enemyShieldAfter: 1 }),
      event('attack', 'play-card', { cardId: 'C07', turn: 2, hitCount: 1, maxHitCount: 3, damagePerHit: 5, damage: 4, enemyHpAfter: 0, enemyShieldAfter: 0 }),
    ]);
    const combo = gameplayHighlights(run).find((item) => item.kind === 'combo')!;
    expect(combo.text).toContain('理论最多 3 段 × 5 点 = 15 点');
    expect(combo.text).toContain('实际执行 1 段 × 5 点 = 5 点攻击');
    expect(combo.text).toContain('护盾吸收 1 点，目标生命减少 2 点');
    expect(combo.text).toContain('另有 2 点溢出伤害');
    expect(combo.evidenceIds).toEqual(expect.arrayContaining(['buff', 'attack']));
  });

  it('does not invent damage details for old saves or when prior enemy state is missing', () => {
    const old = withEvents([
      event('start', 'battle-start', { enemyId: 'moss', hp: 42 }),
      event('buff', 'play-card', { cardId: 'C08', turn: 1 }),
      event('attack', 'play-card', { cardId: 'C07', turn: 1, damage: 15 }),
    ]);
    const oldCombo = gameplayHighlights(old).find((item) => item.kind === 'combo')!;
    expect(oldCombo.text).toContain('未保存分段伤害');
    expect(oldCombo.text).not.toContain('15');
    const partial = withEvents([
      event('buff', 'play-card', { cardId: 'C08', turn: 1 }),
      event('attack', 'play-card', { cardId: 'C07', turn: 1, hitCount: 3, maxHitCount: 3, damagePerHit: 5, enemyHpAfter: 20, enemyShieldAfter: 0 }),
    ]);
    const partialCombo = gameplayHighlights(partial).find((item) => item.kind === 'combo')!;
    expect(partialCombo.text).toContain('实际执行 3 段 × 5 点 = 15 点攻击');
    expect(partialCombo.text).toContain('无法区分其中的破盾和生命损失');
    expect(partialCombo.text).not.toContain('目标生命减少 15');
  });

  it('requires a real same-turn buff before the attack, not card ownership or reversed order', () => {
    const owned = createRun();
    owned.deck.push({ instanceId: 'extra', cardId: 'C07', upgraded: false });
    owned.deck.push({ instanceId: 'extra2', cardId: 'C08', upgraded: false });
    expect(gameplayHighlights(owned)).toEqual([]);
    const noCombo = withEvents([
      event('start', 'battle-start', { enemyId: 'moss', hp: 42 }),
      event('attack-first', 'play-card', { cardId: 'C07', turn: 1 }),
      event('buff-later', 'play-card', { cardId: 'C08', turn: 1 }),
      event('attack-next-turn', 'play-card', { cardId: 'C07', turn: 2 }),
    ]);
    expect(gameplayHighlights(noCombo).some((item) => item.kind === 'combo')).toBe(false);
  });

  it('reports only occurred victories and selected rewards, with source but no invented ending', () => {
    for (const status of ['active', 'returned', 'defeated'] as const) {
      const run = withEvents([
        event('victory', 'victory', { enemyId: 'moss', turns: 3 }),
        event('picked', 'choose-reward', { cardId: 'C07' }, 'choice'),
        event('skipped', 'choose-reward', { cardId: null }, 'choice'),
        event('grew', 'play-card', { cardId: 'C05', turn: 1, capacity: 4 }),
      ]);
      run.status = status; run.source = 'fork';
      const highlights = gameplayHighlights(run);
      expect(highlights.map((item) => item.kind)).toEqual(['victory', 'reward', 'growth']);
      expect(highlights.every((item) => item.source === 'fork')).toBe(true);
      expect(highlights.map((item) => item.text).join(' ')).not.toContain('通关');
      expect(highlights.find((item) => item.kind === 'reward')?.evidenceIds).toEqual(['picked']);
      expect(highlights.find((item) => item.kind === 'growth')?.text).toContain('容量为 4');
    }
  });

  it('does not use finances or unplayed cards as inputs to gameplay highlights', () => {
    const run = withEvents([event('victory', 'victory', { enemyId: 'moss', turns: 3 })]);
    const changed = structuredClone(run);
    changed.wallet.cashCents = 1; changed.wallet.shareUnits = '123456789';
    changed.deck.push({ instanceId: 'extra', cardId: 'C08', upgraded: true });
    expect(gameplayHighlights(changed)).toEqual(gameplayHighlights(run));
  });
});
