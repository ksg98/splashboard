import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PtyApi, PtyEvent, PtyLaunch, PtySize } from './pty';

// xterm cannot render in jsdom: replace it with a small fake that records calls.
const { instances } = vi.hoisted(() => ({ instances: [] as FakeTerminalShape[] }));

interface FakeTerminalShape {
  cols: number;
  rows: number;
  options: Record<string, unknown>;
  written: Array<string | Uint8Array>;
  opened: HTMLElement | null;
  disposed: boolean;
  selection: string;
  addons: unknown[];
  emitData(data: string): void;
  emitBinary(data: string): void;
  resize(cols: number, rows: number): void;
}

vi.mock('@xterm/xterm', () => {
  type Listener<T> = (value: T) => void;
  class Emitter<T> {
    listeners: Listener<T>[] = [];
    event = (listener: Listener<T>) => {
      this.listeners.push(listener);
      return { dispose: () => (this.listeners = this.listeners.filter((l) => l !== listener)) };
    };
    fire(value: T) {
      this.listeners.forEach((l) => l(value));
    }
  }
  class Terminal {
    cols = 80;
    rows = 24;
    options: Record<string, unknown>;
    written: Array<string | Uint8Array> = [];
    opened: HTMLElement | null = null;
    disposed = false;
    selection = '';
    addons: unknown[] = [];
    #data = new Emitter<string>();
    #binary = new Emitter<string>();
    #resize = new Emitter<{ cols: number; rows: number }>();
    onData = this.#data.event;
    onBinary = this.#binary.event;
    onResize = this.#resize.event;
    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      instances.push(this as unknown as FakeTerminalShape);
    }
    loadAddon(addon: { activate?: (t: unknown) => void }) {
      this.addons.push(addon);
      addon.activate?.(this);
    }
    open(element: HTMLElement) {
      this.opened = element;
    }
    write(data: string | Uint8Array) {
      this.written.push(data);
    }
    resize(cols: number, rows: number) {
      if (cols === this.cols && rows === this.rows) return;
      this.cols = cols;
      this.rows = rows;
      this.#resize.fire({ cols, rows });
    }
    paste(text: string) {
      this.#data.fire(text);
    }
    emitData(data: string) {
      this.#data.fire(data);
    }
    emitBinary(data: string) {
      this.#binary.fire(data);
    }
    getSelection() {
      return this.selection;
    }
    hasSelection() {
      return this.selection.length > 0;
    }
    selectAll() {}
    clear() {}
    focus() {}
    dispose() {
      this.disposed = true;
    }
  }
  return { Terminal };
});

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    term: { resize(c: number, r: number): void } | null = null;
    activate(term: { resize(c: number, r: number): void }) {
      this.term = term;
    }
    fit() {
      this.term?.resize(120, 40);
    }
  },
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {
    handler: (event: unknown, uri: string) => void;
    constructor(handler: (event: unknown, uri: string) => void) {
      this.handler = handler;
    }
  },
}));

import {
  DESKTOP_ONLY_MESSAGE,
  TerminalController,
  binaryStringToBytes,
  takeBatch,
  type TerminalStatus,
} from './controller';

class FakePty implements PtyApi {
  spawned: Array<{ launch: PtyLaunch; size: PtySize }> = [];
  writes: Array<{ id: number; data: string | Uint8Array }> = [];
  resizes: Array<{ id: number; size: PtySize }> = [];
  kills: number[] = [];
  emit: (event: PtyEvent) => void = () => {};
  nextId = 1;
  writeGate: Promise<void> | null = null;
  spawn = vi.fn(async (launch: PtyLaunch, size: PtySize, onEvent: (e: PtyEvent) => void) => {
    this.spawned.push({ launch, size });
    this.emit = onEvent;
    return this.nextId++;
  });
  write = vi.fn(async (id: number, data: string | Uint8Array) => {
    this.writes.push({ id, data });
    if (this.writeGate) await this.writeGate;
  });
  resize = vi.fn(async (id: number, size: PtySize) => {
    this.resizes.push({ id, size });
  });
  kill = vi.fn(async (id: number) => {
    this.kills.push(id);
  });
  list = vi.fn(async () => []);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const lastTerminal = () => instances[instances.length - 1] as FakeTerminalShape;

let pty: FakePty;
beforeEach(() => {
  pty = new FakePty();
  instances.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function make(extra: Partial<ConstructorParameters<typeof TerminalController>[0]> = {}) {
  return new TerminalController({ pty, isDesktop: () => true, ...extra });
}

describe('TerminalController', () => {
  it('passes the injected theme and options to xterm', () => {
    const theme = { background: '#000000' };
    make({ theme, terminalOptions: { fontSize: 13 } });
    expect(lastTerminal().options).toEqual({ fontSize: 13, theme });
    expect(lastTerminal().addons).toHaveLength(2);
  });

  it('attaches, fits and starts a session at the fitted size', async () => {
    const statuses: TerminalStatus[] = [];
    const term = make({ onStatusChange: (s) => statuses.push(s) });
    const element = document.createElement('div');
    term.attach(element);
    expect(lastTerminal().opened).toBe(element);
    const id = await term.start({ kind: 'splash', args: ['claude'] });
    expect(id).toBe(1);
    expect(pty.spawned[0]?.size).toEqual({ cols: 120, rows: 40 });
    expect(term.status).toBe('running');
    expect(term.sessionId).toBe(1);
    expect(statuses).toEqual(['starting', 'running']);
  });

  it('writes output and reports the exit', async () => {
    const onExit = vi.fn();
    const term = make({ onExit });
    await term.start({ kind: 'splash', args: ['--help'] });
    const bytes = new TextEncoder().encode('hello');
    pty.emit({ type: 'data', bytes });
    expect(lastTerminal().written).toEqual([bytes]);
    pty.emit({ type: 'exit', code: 2, signal: null });
    expect(onExit).toHaveBeenCalledWith({ code: 2, signal: null });
    expect(term.status).toBe('exited');
    expect(term.sessionId).toBeNull();
  });

  it('handles an exit that arrives before spawn resolves', async () => {
    const onExit = vi.fn();
    pty.spawn.mockImplementationOnce(async (_l, _s, onEvent) => {
      onEvent({ type: 'exit', code: 1, signal: null });
      return 9;
    });
    const term = make({ onExit });
    await term.start({ kind: 'splash', args: ['claude'] });
    expect(term.status).toBe('exited');
    expect(term.sessionId).toBeNull();
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('forwards typing in order, merging input queued during a write', async () => {
    const term = make();
    await term.start({ kind: 'splash', args: [] });
    let release: () => void = () => {};
    pty.writeGate = new Promise<void>((resolve) => (release = resolve));
    lastTerminal().emitData('a');
    lastTerminal().emitData('b');
    lastTerminal().emitData('c');
    expect(pty.writes).toEqual([{ id: 1, data: 'a' }]);
    pty.writeGate = null;
    release();
    await flush();
    expect(pty.writes).toEqual([
      { id: 1, data: 'a' },
      { id: 1, data: 'bc' },
    ]);
  });

  it('sends binary input as bytes', async () => {
    const term = make();
    await term.start({ kind: 'splash', args: [] });
    lastTerminal().emitBinary('\x1b[M\xc8');
    await flush();
    expect(pty.writes[0]?.data).toEqual(new Uint8Array([27, 91, 77, 200]));
  });

  it('ignores input when no session is running', async () => {
    const term = make();
    lastTerminal().emitData('x');
    term.input('y');
    await flush();
    expect(pty.writes).toEqual([]);
  });

  it('resizes the session when xterm resizes', async () => {
    const term = make();
    await term.start({ kind: 'splash', args: [] });
    lastTerminal().resize(100, 30);
    expect(pty.resizes).toEqual([{ id: 1, size: { cols: 100, rows: 30 } }]);
  });

  it('follows the element size with a ResizeObserver', async () => {
    const observers: Array<{ cb: () => void; disconnected: boolean }> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        entry: { cb: () => void; disconnected: boolean };
        constructor(cb: () => void) {
          this.entry = { cb, disconnected: false };
          observers.push(this.entry);
        }
        observe() {}
        disconnect() {
          this.entry.disconnected = true;
        }
      },
    );
    const term = make();
    await term.start({ kind: 'splash', args: [] });
    term.attach(document.createElement('div'));
    // Attaching after start fits the terminal and resizes the session.
    expect(pty.resizes).toEqual([{ id: 1, size: { cols: 120, rows: 40 } }]);
    expect(observers).toHaveLength(1);
    term.dispose();
    expect(observers[0]?.disconnected).toBe(true);
  });

  it('copies the selection and pastes the clipboard', async () => {
    const clipboard = {
      writeText: vi.fn(async () => {}),
      readText: vi.fn(async () => 'pasted'),
    };
    const term = make({ clipboard });
    await term.start({ kind: 'splash', args: [] });
    expect(await term.copySelection()).toBe(false);
    lastTerminal().selection = 'selected text';
    expect(term.hasSelection()).toBe(true);
    expect(await term.copySelection()).toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith('selected text');
    await term.paste();
    await flush();
    expect(pty.writes).toEqual([{ id: 1, data: 'pasted' }]);
  });

  it('opens only http(s) links through the injected opener', () => {
    const openLink = vi.fn();
    make({ openLink });
    const links = lastTerminal().addons[1] as { handler: (e: unknown, uri: string) => void };
    links.handler({}, 'https://example.com/a');
    links.handler({}, 'file:///etc/passwd');
    expect(openLink.mock.calls).toEqual([['https://example.com/a']]);
  });

  it('kills the session on dispose unless asked to detach', async () => {
    const a = make();
    await a.start({ kind: 'splash', args: [] });
    a.dispose();
    expect(pty.kills).toEqual([1]);
    expect(lastTerminal().disposed).toBe(true);
    expect(a.status).toBe('disposed');

    const b = make();
    await b.start({ kind: 'splash', args: [] });
    b.dispose({ kill: false });
    expect(pty.kills).toEqual([1]);
    // Events after dispose are dropped.
    pty.emit({ type: 'data', bytes: new Uint8Array([65]) });
    expect(lastTerminal().written).toEqual([]);
  });

  it('kills a session that finished starting after dispose', async () => {
    let resolveSpawn: (id: number) => void = () => {};
    pty.spawn.mockImplementationOnce(() => new Promise<number>((r) => (resolveSpawn = r)));
    const term = make();
    const started = term.start({ kind: 'splash', args: [] });
    term.dispose();
    resolveSpawn(5);
    expect(await started).toBeNull();
    expect(pty.kills).toEqual([5]);
  });

  it('can start again after the session exits, but not while running', async () => {
    const term = make();
    await term.start({ kind: 'splash', args: [] });
    await expect(term.start({ kind: 'splash', args: [] })).rejects.toThrow(/already running/);
    pty.emit({ type: 'exit', code: 0, signal: null });
    expect(await term.start({ kind: 'splash', args: ['--version'] })).toBe(2);
  });

  it('marks a failed spawn and rethrows', async () => {
    pty.spawn.mockRejectedValueOnce({ kind: 'splashNotFound', message: 'no splash' });
    const term = make();
    await expect(term.start({ kind: 'splash', args: [] })).rejects.toThrow('no splash');
    expect(term.status).toBe('failed');
  });

  it('reports background errors through onError', async () => {
    const onError = vi.fn();
    const term = make({ onError });
    await term.start({ kind: 'splash', args: [] });
    pty.write.mockRejectedValueOnce(new Error('gone'));
    term.input('x');
    await flush();
    expect(onError).toHaveBeenCalledWith(new Error('gone'));
  });
});

describe('browser fallback', () => {
  it('reports that the terminal needs the desktop app and does nothing else', async () => {
    const onUnavailable = vi.fn();
    const term = new TerminalController({ pty, isDesktop: () => false, onUnavailable });
    expect(term.available).toBe(false);
    expect(term.status).toBe('unavailable');
    expect(term.terminal).toBeNull();
    expect(instances).toHaveLength(0);
    term.attach(document.createElement('div'));
    expect(await term.start({ kind: 'splash', args: ['claude'] })).toBeNull();
    expect(onUnavailable).toHaveBeenCalledTimes(2);
    expect(onUnavailable).toHaveBeenCalledWith(DESKTOP_ONLY_MESSAGE);
    expect(pty.spawn).not.toHaveBeenCalled();
    expect(await term.copySelection()).toBe(false);
    term.dispose();
  });

  it('uses the real environment check by default', () => {
    // jsdom is not the Tauri webview.
    expect(new TerminalController({ pty }).available).toBe(false);
  });
});

describe('helpers', () => {
  it('converts binary strings to bytes', () => {
    expect(binaryStringToBytes('\x00\xff A')).toEqual(new Uint8Array([0, 255, 32, 65]));
  });

  it('batches runs of the same input kind', () => {
    const queue: Array<string | Uint8Array> = [
      'a',
      'b',
      new Uint8Array([1]),
      new Uint8Array([2]),
      'c',
    ];
    expect(takeBatch(queue)).toBe('ab');
    expect(takeBatch(queue)).toEqual(new Uint8Array([1, 2]));
    expect(takeBatch(queue)).toBe('c');
    expect(takeBatch(queue)).toBeNull();
  });
});
