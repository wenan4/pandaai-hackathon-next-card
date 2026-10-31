import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const legacy = JSON.stringify({
  v: 1, session_id: 'legacy-session', notice_version: 'notice-v1', screen: 'start', round: 0,
  rounds: Array.from({ length: 3 }, () => ({ phase: 'claim', flips: [], explained: [], note: '', locked: false })),
  events: [], seq: 0, taskA: null, taskB: null,
});

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('legacy storage isolation', () => {
  it('clears only its own record and preserves adventure, exposure and unrelated data byte for byte', async () => {
    const entries = new Map([
      ['nextcard:v1', legacy],
      ['nextcard:adventure:v0.4', '{"saved":"adventure"}'],
      ['nextcard:adventure:v0.4:seen-cases', '["lantern-a"]'],
      ['nextcard:adventure:v0.4:funding-exposure', '{"exposure":"preserve"}'],
      ['nextcard:future-version', 'future'], ['unrelated', 'keep'],
    ]);
    const remaining = [...entries].filter(([key]) => key !== 'nextcard:v1');
    const removeItem = vi.fn((key: string) => { entries.delete(key); });
    vi.stubGlobal('localStorage', { getItem: (key: string) => entries.get(key) ?? null, removeItem });
    const store = await import('./store');
    const changed = vi.fn(); store.subscribe(changed);
    expect(store.clearAll()).toBe(true);
    expect(removeItem).toHaveBeenCalledExactlyOnceWith('nextcard:v1');
    expect([...entries]).toEqual(remaining);
    expect(store.getState().screen).toBe('notice');
    expect(changed).toHaveBeenCalledOnce();
  });

  it('retains both the saved and in-memory journey when clearing is denied', async () => {
    const entries = new Map([['nextcard:v1', legacy]]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => entries.get(key) ?? null,
      removeItem: () => { throw new DOMException('blocked', 'SecurityError'); },
    });
    const store = await import('./store');
    const before = store.getState(); const changed = vi.fn(); store.subscribe(changed);
    expect(store.clearAll()).toBe(false);
    expect(store.getState()).toBe(before);
    expect(store.getState().session_id).toBe('legacy-session');
    expect(entries.get('nextcard:v1')).toBe(legacy);
    expect(changed).not.toHaveBeenCalled();
  });
});
