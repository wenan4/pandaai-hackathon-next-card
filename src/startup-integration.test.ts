import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync('index.html', 'utf8');
const controller = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
if (!controller) throw new Error('Missing inline startup controller');

type Callback = (event: { target?: unknown }) => void;
class ElementStub {
  readonly attrs = new Map<string, string>();
  readonly listeners = new Map<string, Callback[]>();
  hidden = false;
  textContent = '';
  removed = false;
  firstElementChild: object | null = null;
  sheet: object | null = null;
  tagName = '';
  rel = '';
  type = '';
  classList = { add: vi.fn() };
  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  addEventListener(type: string, callback: Callback): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]); }
  fire(type: string): void { for (const callback of this.listeners.get(type) ?? []) callback({ target: this }); }
  remove(): void { this.removed = true; }
}

function harness(search = '?legacy=1&judge=1', bodyParsed = true) {
  const ids = ['app', 'startup-shell', 'startup-stage', 'startup-title', 'startup-message', 'startup-retry'];
  const elements = new Map(ids.map((id) => [id, new ElementStub()]));
  const app = elements.get('app')!; const shell = elements.get('startup-shell')!;
  app.setAttribute('inert', '');
  const timers = new Map<number, () => void>();
  const windowListeners = new Map<string, Callback[]>();
  const documentListeners = new Map<string, Callback[]>();
  const styles: ElementStub[] = [];
  const storage = new Map([['nextcard:v1', '{"old":"unchanged"}'], ['nextcard:adventure:v0.4', '{"new":"unchanged"}']]);
  const localStorage = { getItem: vi.fn((key: string) => storage.get(key) ?? null), setItem: vi.fn((key: string, value: string) => storage.set(key, value)), removeItem: vi.fn((key: string) => storage.delete(key)), clear: vi.fn(() => storage.clear()) };
  const loc = { href: `https://example.test/game/${search}#checkpoint`, search, hash: '#checkpoint', reload: vi.fn() };
  let nextTimer = 0;
  const win = {
    location: loc,
    setTimeout: (callback: () => void) => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    addEventListener: (type: string, callback: Callback) => windowListeners.set(type, [...(windowListeners.get(type) ?? []), callback]),
    removeEventListener: (type: string, callback: Callback) => windowListeners.set(type, (windowListeners.get(type) ?? []).filter((item) => item !== callback)),
  };
  const doc = {
    getElementById: (id: string) => bodyParsed ? elements.get(id) ?? null : null,
    querySelector: (selector: string) => selector === '#app' ? app : null,
    querySelectorAll: () => styles,
    addEventListener: (type: string, callback: Callback) => documentListeners.set(type, [...(documentListeners.get(type) ?? []), callback]),
  };
  const context = { window: win, document: doc, navigator: { onLine: true } };
  runInNewContext(controller!, context);
  const emit = (type: string, target: unknown = win): void => { for (const callback of windowListeners.get(type) ?? []) callback({ target }); };
  const clickRetry = (): void => {
    const button = elements.get('startup-retry')!;
    for (const callback of windowListeners.get('click') ?? []) callback({ target: button });
    for (const callback of documentListeners.get('click') ?? []) callback({ target: button });
    button.fire('click');
    const handler = html.match(/<button[^>]*id="startup-retry"[^>]*onclick="([^"]+)"/)?.[1];
    if (handler) runInNewContext(handler, context);
  };
  const fireSlow = (): void => { for (const callback of [...timers.values()]) callback(); };
  const finishBody = (): void => {
    bodyParsed = true;
    const refresh = html.match(/<script>\s*(if \(window\.__nextCardStartup\) window\.__nextCardStartup\.refresh\(\);)\s*<\/script>/)?.[1];
    if (!refresh) throw new Error('Missing body refresh for an earlier entry failure');
    runInNewContext(refresh, context);
  };
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc); vi.stubGlobal('localStorage', localStorage);
  return { app, shell, elements, styles, storage, localStorage, loc, win, emit, clickRetry, fireSlow, finishBody };
}

afterEach(() => {
  vi.doUnmock('./legacy'); vi.doUnmock('./adventure/ui');
  vi.resetModules(); vi.unstubAllGlobals();
});

describe('startup shell and actual entry orchestration', () => {
  it('ships a self-contained shell and explains disabled JavaScript', () => {
    expect(html).toMatch(/<style>[\s\S]*#startup-shell[\s\S]*<\/style>/);
    expect(html.indexOf('id="startup-shell"')).toBeGreaterThan(-1);
    expect(html.indexOf('id="startup-shell"')).toBeLessThan(html.indexOf('src="/src/main.ts"'));
    expect(html).toMatch(/<noscript>[\s\S]*启用 JavaScript[\s\S]*<\/noscript>/);
    expect(html).toMatch(/id="startup-retry"[^>]*>重新加载<\/button>/);
  });

  it('permits reload before DOMContentLoaded when the entry script is slow or unavailable', () => {
    const h = harness();
    const previous = [...h.storage]; const url = h.loc.href;
    h.fireSlow(); // The pending module can hold DOMContentLoaded indefinitely.
    expect(h.shell.attrs.get('data-state')).toBe('slow');
    expect(h.elements.get('startup-retry')!.hidden).toBe(false);
    h.clickRetry();
    expect(h.loc.reload).toHaveBeenCalledOnce();
    expect(h.loc.href).toBe(url);
    expect([...h.storage]).toEqual(previous);
    expect(h.localStorage.getItem).not.toHaveBeenCalled();
    expect(h.localStorage.setItem).not.toHaveBeenCalled();
    expect(h.localStorage.removeItem).not.toHaveBeenCalled();
    expect(h.localStorage.clear).not.toHaveBeenCalled();
  });

  it('shows an entry failure without requiring the main module to execute', () => {
    const h = harness();
    const failedScript = { tagName: 'SCRIPT', type: 'module' };
    h.emit('error', failedScript);
    expect(h.shell.attrs.get('data-state')).toBe('error');
    expect(h.shell.attrs.get('data-stage')).toBe('entry');
    h.clickRetry();
    expect(h.loc.reload).toHaveBeenCalledOnce();
    expect(h.storage.get('nextcard:v1')).toBe('{"old":"unchanged"}');
    expect(h.storage.get('nextcard:adventure:v0.4')).toBe('{"new":"unchanged"}');
  });

  it('shows an entry error that arrived before the body and before DOMContentLoaded', () => {
    // Production Vite may move the entry module into <head> ahead of the shell.
    const h = harness('?legacy=1', false);
    h.emit('error', { tagName: 'SCRIPT', type: 'module' });
    expect(h.shell.attrs.get('data-state')).toBeUndefined();
    h.finishBody();
    expect(h.shell.attrs.get('data-state')).toBe('error');
    expect(h.shell.attrs.get('data-stage')).toBe('entry');
    h.clickRetry();
    expect(h.loc.reload).toHaveBeenCalledOnce();
  });

  it('keeps loading during a late legacy bootstrap, then removes the shell after real readiness', async () => {
    const h = harness();
    let finish!: (result: { ok: true }) => void;
    const startup = new Promise<{ ok: true }>((resolve) => { finish = resolve; });
    vi.doMock('./legacy', () => ({ startup }));
    await import('./main');
    await vi.waitFor(() => expect(h.shell.attrs.get('data-stage')).toBe('legacy-data'));
    expect(h.shell.removed).toBe(false);
    h.fireSlow();
    expect(h.shell.attrs.get('data-state')).toBe('slow');
    h.app.firstElementChild = {};
    finish({ ok: true });
    await vi.waitFor(() => expect(h.shell.removed).toBe(true));
    expect(h.app.attrs.has('inert')).toBe(false);
    h.emit('error', h.win); // Later business errors do not resurrect startup failure.
    expect(h.shell.removed).toBe(true);
  });

  it('shows legacy data failure without changing address or either saved journey', async () => {
    const h = harness(); const before = [...h.storage]; const url = h.loc.href;
    vi.doMock('./legacy', () => ({ startup: Promise.resolve({ ok: false, stage: 'legacy-data' }) }));
    await import('./main');
    await vi.waitFor(() => expect(h.shell.attrs.get('data-state')).toBe('error'));
    expect(h.shell.attrs.get('data-stage')).toBe('legacy-data');
    h.clickRetry();
    expect(h.loc.reload).toHaveBeenCalledOnce();
    expect(h.loc.href).toBe(url);
    expect([...h.storage]).toEqual(before);
    expect(h.localStorage.getItem).not.toHaveBeenCalled();
    expect(h.localStorage.setItem).not.toHaveBeenCalled();
    expect(h.localStorage.removeItem).not.toHaveBeenCalled();
  });

  it('reports dynamic UI and stylesheet failures and requires a mounted first screen', async () => {
    const h = harness('?mode=adventure');
    vi.doMock('./adventure/ui', () => { throw new Error('network module failure'); });
    await import('./main');
    await vi.waitFor(() => expect(h.shell.attrs.get('data-state')).toBe('error'));
    expect(h.shell.attrs.get('data-stage')).toBe('ui');

    vi.resetModules(); vi.doUnmock('./adventure/ui');
    const empty = harness('?mode=adventure');
    vi.doMock('./adventure/ui', () => ({}));
    await import('./main');
    await vi.waitFor(() => expect(empty.shell.attrs.get('data-stage')).toBe('render'));
    expect(empty.shell.attrs.get('data-state')).toBe('error');

    vi.resetModules(); vi.doUnmock('./adventure/ui');
    const css = harness('?mode=adventure');
    vi.doMock('./adventure/ui', () => {
      css.emit('error', { tagName: 'LINK', rel: 'stylesheet' });
      throw new Error('failed stylesheet');
    });
    await import('./main');
    await vi.waitFor(() => expect(css.shell.attrs.get('data-state')).toBe('error'));
    expect(css.shell.attrs.get('data-stage')).toBe('style');
  });

  it('waits for a slow stylesheet and shows a successfully mounted adventure after it loads', async () => {
    const h = harness('?mode=adventure');
    const sheet = new ElementStub(); sheet.tagName = 'LINK'; sheet.rel = 'stylesheet'; h.styles.push(sheet);
    vi.doMock('./adventure/ui', () => { h.app.firstElementChild = {}; return {}; });
    await import('./main');
    await vi.waitFor(() => expect(h.shell.attrs.get('data-stage')).toBe('render'));
    expect(h.shell.removed).toBe(false);
    h.fireSlow();
    expect(h.shell.attrs.get('data-state')).toBe('slow');
    sheet.sheet = {}; sheet.fire('load');
    expect(h.shell.removed).toBe(true);
    expect(h.app.attrs.has('inert')).toBe(false);
  });
});

describe('legacy module readiness', () => {
  it('reports initial data failure through its exported startup promise', async () => {
    const h = harness('?legacy=1');
    vi.stubGlobal('location', h.loc);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    const { startup } = await import('./legacy');
    await expect(startup).resolves.toEqual({ ok: false, stage: 'legacy-data' });
    expect(h.app.firstElementChild).toBeNull();
    expect(h.localStorage.setItem).not.toHaveBeenCalled();
    expect(h.localStorage.removeItem).not.toHaveBeenCalled();
  });

  it('does not settle while real initial data is pending and reports an initial-render exception', async () => {
    const h = harness('?legacy=1');
    vi.stubGlobal('location', h.loc);
    let deliverVisible!: (response: Response) => void;
    const visible = new Promise<Response>((resolve) => { deliverVisible = resolve; });
    const taskA = readFileSync('public/data/taskA.json', 'utf8');
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('cases_visible.json') ? visible : Promise.resolve(new Response(taskA))));
    const { startup } = await import('./legacy');
    let settled = false;
    void startup.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    deliverVisible(new Response(readFileSync('public/data/cases_visible.json', 'utf8')));
    // This controlled DOM has no createElement; the first screen cannot mount.
    await expect(startup).resolves.toEqual({ ok: false, stage: 'render' });
    expect(h.localStorage.setItem).not.toHaveBeenCalled();
  });

  it('also waits for the legacy judge panel before reporting readiness', async () => {
    const h = harness('?legacy=1&judge=1');
    vi.stubGlobal('location', h.loc);
    let rejectPanelData!: (error: Error) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((_resolve, reject) => { rejectPanelData = reject; })));
    const { startup } = await import('./legacy');
    let settled = false;
    void startup.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(h.app.classList.add).toHaveBeenCalledWith('wide');
    rejectPanelData(new Error('offline'));
    // The panel tolerates missing optional data, but this DOM intentionally cannot render it.
    await expect(startup).resolves.toEqual({ ok: false, stage: 'render' });
  });
});
