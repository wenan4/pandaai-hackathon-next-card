import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateRunOptions, MarketQuote, Run, RunAction } from './types';
import { createRun, pendingMarketStep, reduceRun } from './engine';
import { resetMarketCacheForTest } from './market';
import { emptyResearchProfile } from './research';
import { parseAdventureSave, type AdventureSave } from './save-state';
import { makeDemoPath } from './ui-demo';

// The documented policy still uses the real reducer and staged files; record
// each resulting state and start it as an actual real-source run for recovery.
const captured = vi.hoisted(() => ({ runs: [] as Run[], actions: [] as RunAction[] }));
vi.mock('./engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./engine')>();
  return {
    ...actual,
    createRun: (options?: CreateRunOptions) => { const run = actual.createRun({ ...options, source: 'real' }); captured.runs.push(run); return run; },
    reduceRun: (previous: Run, action: RunAction) => { const run = actual.reduceRun(previous, action); captured.runs.push(run); captured.actions.push(action); return run; },
  };
});

function saved(run: Run): AdventureSave {
  return { schema: 'nextcard-adventure-save-v1', savedAt: 1000, observationStartedAt: 900, priorExposure: false, tutorialStep: 0,
    run, profile: emptyResearchProfile(run.observationEnabled, 'real') };
}
function serialize(run: Run): string { return JSON.stringify(saved(run)); }

beforeEach(() => {
  captured.runs = [];
  captured.actions = [];
  resetMarketCacheForTest();
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
    try { return new Response(await readFile(`public${path}`), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    catch { return new Response('not found', { status: 404 }); }
  });
});
afterEach(() => { vi.unstubAllGlobals(); resetMarketCacheForTest(); });

describe('safe adventure save parsing', () => {
  it('accepts every real reducer state of a full four-battle journey, and failure with pending settlement', async () => {
    const result = await makeDemoPath('A', 'lantern-a');
    expect(result.source).toBe('real'); expect(result.status).toBe('cleared');
    const phases = new Set(captured.runs.map((run) => run.phase));
    expect(phases).toEqual(new Set(['battle', 'reward', 'camp', 'route', 'market', 'ended']));
    for (const [index, run] of captured.runs.entries()) {
      const parsed = parseAdventureSave(serialize(run));
      expect(parsed.kind, `transition ${index}: ${run.node}/${run.phase}/${run.status}`).toBe('valid');
      if (parsed.kind === 'valid') expect(parsed.value.run).toEqual(run);
    }

    let defeat = captured.runs.find((run) => run.node === 'N3' && run.phase === 'battle')!;
    for (let count = 0; count < 40 && defeat.phase === 'battle'; count++) defeat = reduceRun(defeat, { type: 'end-turn' });
    expect(defeat.status).toBe('defeated');
    expect(defeat.phase).toBe('market');
    expect(parseAdventureSave(serialize(defeat)).kind).toBe('valid');
    const pending = pendingMarketStep(defeat)!;
    const quote = JSON.parse(await readFile(`public/data/adventure/stages/${pending.caseId}/${pending.stage}.json`, 'utf8')) as MarketQuote;
    defeat = reduceRun(defeat, { type: 'apply-quote', quote });
    expect(defeat.phase).toBe('ended');
    expect(parseAdventureSave(serialize(defeat)).kind).toBe('valid');
  });

  it('distinguishes absent, malformed and unknown versions without any storage access', () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    expect(parseAdventureSave(null)).toEqual({ kind: 'empty' });
    expect(parseAdventureSave('')).toMatchObject({ kind: 'invalid' });
    expect(parseAdventureSave('{broken')).toMatchObject({ kind: 'invalid' });
    expect(parseAdventureSave('null')).toMatchObject({ kind: 'invalid' });
    const base = saved(createRun());
    expect(parseAdventureSave(JSON.stringify({ ...base, schema: 'a-newer-schema' })).kind).toBe('unsupported');
    expect(parseAdventureSave(JSON.stringify({ ...base, run: { ...base.run, version: '0.4.2' } })).kind).toBe('unsupported');
    expect(parseAdventureSave(JSON.stringify({ ...base, profile: { ...base.profile, version: 'research-v2' } })).kind).toBe('unsupported');
    expect(parseAdventureSave(JSON.stringify(base)).kind).toBe('valid');
    expect(storage.getItem).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled(); expect(storage.clear).not.toHaveBeenCalled();
  });

  it('accepts known missing legacy fields without changing the input game state', () => {
    const run = createRun({ observationEnabled: true });
    const legacy = JSON.parse(serialize(run)) as Record<string, unknown>;
    delete legacy.priorExposure; delete legacy.tutorialStep;
    const profile = legacy.profile as Record<string, unknown>;
    delete profile.source; delete profile.funding_exposure; delete profile.prior_exposure_disclosures;
    for (const item of profile.knowledge_observations as Record<string, unknown>[]) { delete item.excluded_evidence_ids; delete item.disclosure_ids; }
    const raw = JSON.stringify(legacy); const before = JSON.stringify(run);
    const parsed = parseAdventureSave(raw);
    expect(parsed.kind).toBe('valid');
    if (parsed.kind === 'valid') {
      expect(parsed.value.run).toEqual(run);
      expect(parsed.value.profile.source).toBe('real');
      expect(parsed.value.profile.funding_exposure).toEqual([]);
      expect(parsed.value.profile.prior_exposure_disclosures).toEqual([]);
    }
    expect(JSON.stringify(run)).toBe(before);
    expect(JSON.stringify(legacy)).toBe(raw);
  });

  it('rejects broken run fields, unknown definitions, missing card references and profile damage', () => {
    const base = JSON.parse(serialize(createRun())) as Record<string, any>;
    const corruptions: ((value: Record<string, any>) => void)[] = [
      (value) => { delete value.run.history; },
      (value) => { value.run.wallet = null; },
      (value) => { value.run.wallet.cashCents = '7200'; },
      (value) => { value.run.wallet.shareUnits = 'not-shares'; },
      (value) => { value.run.deck[0].cardId = 'C99'; },
      (value) => { value.run.battle.enemy.id = 'unknown'; },
      (value) => { value.run.battle.hand[0] = 'missing-card'; },
      (value) => { value.run.battle.drawPile.push(value.run.battle.hand[0]); },
      (value) => { value.run.nextCardNumber = 1; },
      (value) => { value.run.history[0].id = 'e2'; },
      (value) => { value.profile.knowledge_evidence = {}; },
      (value) => { value.profile.funding_exposure = { questionKey: 'x', help: 'hint', answerExposed: true, priorExposure: true }; },
      (value) => { value.run.source = 'demo'; },
      (value) => { value.profile.source = 'fork'; },
      (value) => { value.run.observationEnabled = false; },
    ];
    for (const [i, damage] of corruptions.entries()) {
      const candidate = structuredClone(base); damage(candidate);
      expect(parseAdventureSave(JSON.stringify(candidate)).kind, `corruption ${i}`).toBe('invalid');
    }
  });

  it('checks nested checkpoint snapshots before they can be forked', async () => {
    await makeDemoPath('A', 'lantern-a');
    const run = captured.runs.find((item) => item.checkpoints.length > 0)!;
    const broken = JSON.parse(serialize(run)) as Record<string, any>;
    broken.run.checkpoints[0].snapshot.wallet.cashCents = 'not-money';
    expect(parseAdventureSave(JSON.stringify(broken)).kind).toBe('invalid');
    broken.run.checkpoints[0].snapshot.wallet.cashCents = 1000;
    broken.run.checkpoints[0].snapshot.battle = { enemy: { id: 'unknown' } };
    expect(parseAdventureSave(JSON.stringify(broken)).kind).toBe('invalid');
  });

  it('protects broken settlement references without replaying or repairing their values', async () => {
    await makeDemoPath('A', 'lantern-a');
    const entry = captured.runs.find((run) => run.phase === 'market' && run.market.order?.kind === 'entry')!;
    const sale = captured.runs.find((run) => run.phase === 'market' && run.market.order?.kind === 'sell' && run.status === 'active')!;
    const final = captured.runs.find((run) => run.phase === 'market' && run.market.pending?.stage === 't3')!;
    expect(entry).toBeDefined(); expect(sale).toBeDefined(); expect(final).toBeDefined();

    const examples: [Run, (value: Record<string, any>) => void][] = [
      [entry, (value) => { value.run.market.pending.stage = 't1'; }],
      [entry, (value) => { value.run.market.order.amountCents = value.run.wallet.reservedCents + 1; }],
      [sale, (value) => { value.run.camp = null; }],
      [sale, (value) => { value.run.market.order.shareUnits = (BigInt(value.run.wallet.shareUnits) + 1n).toString(); }],
      [final, (value) => { value.run.status = 'active'; }],
      [final, (value) => { value.run.history.find((event: Record<string, any>) => event.type === 'market' && event.action === 'apply-quote').data.price = 0; }],
    ];
    for (const [run, damage] of examples) {
      const candidate = JSON.parse(serialize(run)) as Record<string, any>;
      damage(candidate);
      const original = JSON.stringify(candidate);
      expect(parseAdventureSave(original).kind).toBe('invalid');
      expect(JSON.stringify(candidate)).toBe(original);
    }
  });

  it('accepts reducer-generated zero participation and early return states', async () => {
    await makeDemoPath('A', 'lantern-a');
    const actions = [...captured.actions];
    let zero = captured.runs[0]!;
    for (const action of actions) {
      if (zero.phase === 'ended') break;
      zero = reduceRun(zero, action.type === 'submit-entry' ? { ...action, amountCents: 0 } : action);
      expect(parseAdventureSave(serialize(zero)).kind, `${zero.node}/${zero.phase}/${zero.status}`).toBe('valid');
    }
    expect(zero.status).toBe('cleared');
    expect(zero.wallet.investedCents).toBe(0);
    expect(zero.wallet.shareUnits).toBe('0');

    let returned = captured.runs.find((run) => run.phase === 'camp' && run.node === 'N6' && run.camp?.decision === 'not-submitted' && run.wallet.shareUnits !== '0')!;
    expect(returned).toBeDefined();
    returned = reduceRun(returned, { type: 'return-home' });
    expect(returned.status).toBe('returned'); expect(returned.phase).toBe('market');
    expect(parseAdventureSave(serialize(returned)).kind).toBe('valid');
    const pending = pendingMarketStep(returned)!;
    const quote = JSON.parse(await readFile(`public/data/adventure/stages/${pending.caseId}/${pending.stage}.json`, 'utf8')) as MarketQuote;
    returned = reduceRun(returned, { type: 'apply-quote', quote });
    expect(returned.phase).toBe('ended');
    expect(parseAdventureSave(serialize(returned)).kind).toBe('valid');
  });

  it('accepts nonempty future case identifiers but protects malformed random state', () => {
    const run = createRun({ caseId: 'future-case-2027' });
    expect(parseAdventureSave(serialize(run)).kind).toBe('valid');
    const broken = JSON.parse(serialize(run)) as Record<string, any>;
    broken.run.battle.rngState = 0x100000000;
    expect(parseAdventureSave(JSON.stringify(broken)).kind).toBe('invalid');
  });
});
