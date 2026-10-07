/**
 * A headless controller that binds an xterm.js terminal to a PTY session.
 *
 * It makes no visual decisions: the theme and any other xterm options come
 * from the caller, and so does the message shown when the terminal cannot run
 * (in a plain browser). The UI layer must also load xterm's own stylesheet,
 * `@xterm/xterm/css/xterm.css`, once.
 *
 * Typical use:
 *   const term = createTerminalController({ theme, onExit, onUnavailable });
 *   term.attach(element);            // opens xterm, fits, follows resizes
 *   await term.start({ kind: 'splash', args: ['claude'], env });
 *   ...
 *   term.dispose();                  // kills the session unless { kill: false }
 */
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal, type ITerminalOptions, type ITheme } from '@xterm/xterm';
import { isTauri } from '../env';
import { tauriPty, type PtyApi, type PtyEvent, type PtyExit, type PtyLaunch } from './pty';

export const DESKTOP_ONLY_MESSAGE =
  'The terminal requires the Splashboard desktop app; it is not available in the browser.';

export type TerminalStatus =
  'idle' | 'starting' | 'running' | 'exited' | 'failed' | 'unavailable' | 'disposed';

export interface ClipboardLike {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

export interface TerminalControllerOptions {
  /** xterm colours; the caller owns every visual choice. */
  theme?: ITheme;
  /** Any other xterm options (font, cursor, scrollback...). */
  terminalOptions?: Omit<ITerminalOptions, 'theme'>;
  /** Called when the terminal cannot run here (not the desktop app). */
  onUnavailable?: (message: string) => void;
  /** The session ended (after its last output). */
  onExit?: (exit: PtyExit) => void;
  onStatusChange?: (status: TerminalStatus) => void;
  /** Failures of background calls (write, resize, kill). */
  onError?: (error: Error) => void;
  /** Opens a clicked http(s) link; defaults to the system browser. */
  openLink?: (url: string) => void;
  /** Defaults to `navigator.clipboard`. */
  clipboard?: ClipboardLike;
  /** Test seams. */
  pty?: PtyApi;
  isDesktop?: () => boolean;
}

export interface DisposeOptions {
  /** Kill the running session (default true). false just detaches. */
  kill?: boolean;
}

type Input = string | Uint8Array;

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return new Error(String((error as { message: unknown }).message));
  }
  return new Error(String(error));
}

/** xterm's binary input: one char per byte (mouse reports in X10 mode). */
export function binaryStringToBytes(data: string): Uint8Array {
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;
  return bytes;
}

function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function defaultOpenLink(url: string): void {
  if (isTauri()) {
    import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url)).catch(() => undefined);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export class TerminalController {
  readonly available: boolean;
  readonly #options: TerminalControllerOptions;
  readonly #pty: PtyApi;
  readonly #term: Terminal | null = null;
  readonly #fit: FitAddon | null = null;
  readonly #cleanups: Array<() => void> = [];
  #status: TerminalStatus;
  #element: HTMLElement | null = null;
  #sessionId: number | null = null;
  /** Bumped per start and on dispose so stale session events are ignored. */
  #generation = 0;
  #outbox: Input[] = [];
  #flushing = false;

  constructor(options: TerminalControllerOptions = {}) {
    this.#options = options;
    this.#pty = options.pty ?? tauriPty;
    this.available = (options.isDesktop ?? isTauri)();
    if (!this.available) {
      this.#status = 'unavailable';
      return;
    }
    this.#status = 'idle';
    const term = new Terminal({ ...options.terminalOptions, theme: options.theme });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_event, uri) => this.#openLink(uri)));
    const subscriptions = [
      term.onData((data) => this.#queueInput(data)),
      term.onBinary((data) => this.#queueInput(binaryStringToBytes(data))),
      term.onResize((size) => this.#resizeSession(size.cols, size.rows)),
    ];
    this.#cleanups.push(() => subscriptions.forEach((s) => s.dispose()));
    this.#term = term;
    this.#fit = fit;
  }

  get status(): TerminalStatus {
    return this.#status;
  }

  get sessionId(): number | null {
    return this.#sessionId;
  }

  /** The underlying xterm instance (null outside the desktop app). */
  get terminal(): Terminal | null {
    return this.#term;
  }

  /** Opens the terminal in `element`, fits it and follows its size. */
  attach(element: HTMLElement): void {
    if (!this.#term) {
      this.#unavailable();
      return;
    }
    if (this.#status === 'disposed' || this.#element === element) return;
    if (this.#element) {
      throw new Error('this terminal is already attached; dispose it and create a new one');
    }
    this.#element = element;
    this.#term.open(element);
    this.fit();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.fit());
      observer.observe(element);
      this.#cleanups.push(() => observer.disconnect());
    }
  }

  /** Fits the terminal to its element; resizes the session when it changes. */
  fit(): void {
    if (!this.#fit || !this.#element || this.#status === 'disposed') return;
    try {
      this.#fit.fit();
    } catch {
      // Not measurable yet (hidden or zero-sized); the observer retries.
    }
  }

  /** Starts a session; resolves with its id, or null when unavailable. */
  async start(launch: PtyLaunch): Promise<number | null> {
    const term = this.#term;
    if (!term) {
      this.#unavailable();
      return null;
    }
    if (this.#status === 'disposed') throw new Error('this terminal has been disposed');
    if (this.#status === 'starting' || this.#status === 'running') {
      throw new Error('a session is already running in this terminal');
    }
    const generation = ++this.#generation;
    this.#sessionId = null;
    this.#outbox = [];
    let exitedEarly = false;
    this.#setStatus('starting');
    const size = { cols: term.cols, rows: term.rows };
    try {
      const id = await this.#pty.spawn(launch, size, (event) => {
        if (generation !== this.#generation) return;
        if (event.type === 'exit' && this.#sessionId === null) exitedEarly = true;
        this.#onEvent(event);
      });
      if (generation !== this.#generation) {
        // Disposed (or restarted) while starting: do not leak the session.
        this.#pty.kill(id).catch(() => undefined);
        return null;
      }
      if (!exitedEarly) {
        this.#sessionId = id;
        this.#setStatus('running');
        if (term.cols !== size.cols || term.rows !== size.rows) {
          this.#resizeSession(term.cols, term.rows);
        }
        this.#flush();
      }
      return id;
    } catch (error) {
      if (generation === this.#generation) this.#setStatus('failed');
      throw toError(error);
    }
  }

  /** Sends text to the session as if typed. */
  input(data: string): void {
    this.#queueInput(data);
  }

  /** Hangs up the running session; its exit arrives through onExit. */
  async kill(): Promise<void> {
    if (this.#sessionId === null || this.#status !== 'running') return;
    await this.#pty.kill(this.#sessionId);
  }

  /** Copies the selection; false when nothing is selected. */
  async copySelection(): Promise<boolean> {
    const text = this.#term?.getSelection() ?? '';
    if (!text) return false;
    await this.#clipboard().writeText(text);
    return true;
  }

  /** Pastes the clipboard (bracketed when the program asked for it). */
  async paste(): Promise<void> {
    if (!this.#term) return;
    const text = await this.#clipboard().readText();
    if (text) this.#term.paste(text);
  }

  hasSelection(): boolean {
    return this.#term?.hasSelection() ?? false;
  }

  selectAll(): void {
    this.#term?.selectAll();
  }

  /** Clears the scrollback (the program's screen is redrawn by itself). */
  clear(): void {
    this.#term?.clear();
  }

  focus(): void {
    this.#term?.focus();
  }

  setTheme(theme: ITheme): void {
    if (this.#term) this.#term.options.theme = theme;
  }

  /** Detaches from the DOM and frees xterm; kills the session by default. */
  dispose({ kill = true }: DisposeOptions = {}): void {
    if (this.#status === 'disposed' || this.#status === 'unavailable') {
      this.#status = 'disposed';
      return;
    }
    const id = this.#sessionId;
    if (kill && id !== null && this.#status === 'running') {
      this.#pty.kill(id).catch(() => undefined);
    }
    this.#generation++;
    this.#sessionId = null;
    this.#outbox = [];
    this.#cleanups.splice(0).forEach((cleanup) => cleanup());
    this.#term?.dispose();
    this.#element = null;
    this.#setStatus('disposed');
  }

  #onEvent(event: PtyEvent): void {
    if (event.type === 'data') {
      this.#term?.write(event.bytes);
      return;
    }
    this.#sessionId = null;
    this.#outbox = [];
    this.#setStatus('exited');
    this.#options.onExit?.({ code: event.code, signal: event.signal });
  }

  #queueInput(data: Input): void {
    if (this.#status !== 'running' && this.#status !== 'starting') return;
    if (data.length === 0) return;
    this.#outbox.push(data);
    this.#flush();
  }

  /**
   * Writes queued input one call at a time, merging what queued up meanwhile,
   * so keystrokes and pastes reach the program in order.
   */
  #flush(): void {
    if (this.#flushing || this.#sessionId === null || this.#status !== 'running') return;
    const id = this.#sessionId;
    const batch = takeBatch(this.#outbox);
    if (batch === null) return;
    this.#flushing = true;
    this.#pty
      .write(id, batch)
      .catch((error: unknown) => this.#options.onError?.(toError(error)))
      .finally(() => {
        this.#flushing = false;
        this.#flush();
      });
  }

  #resizeSession(cols: number, rows: number): void {
    if (this.#sessionId === null || this.#status !== 'running') return;
    this.#pty
      .resize(this.#sessionId, { cols, rows })
      .catch((error: unknown) => this.#options.onError?.(toError(error)));
  }

  #setStatus(status: TerminalStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#options.onStatusChange?.(status);
  }

  #unavailable(): void {
    this.#options.onUnavailable?.(DESKTOP_ONLY_MESSAGE);
  }

  #openLink(url: string): void {
    if (!isHttpUrl(url)) return;
    (this.#options.openLink ?? defaultOpenLink)(url);
  }

  #clipboard(): ClipboardLike {
    const clipboard = this.#options.clipboard ?? globalThis.navigator?.clipboard;
    if (!clipboard) throw new Error('no clipboard is available');
    return clipboard;
  }
}

/**
 * Removes and returns the leading run of same-kind input from `queue`, joined
 * into one write; null when the queue is empty.
 */
export function takeBatch(queue: Input[]): Input | null {
  const first = queue[0];
  if (first === undefined) return null;
  let count = 1;
  while (count < queue.length && typeof queue[count] === typeof first) count++;
  const run = queue.splice(0, count);
  if (typeof first === 'string') return (run as string[]).join('');
  const bytes = run as Uint8Array[];
  const total = bytes.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of bytes) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}

export function createTerminalController(
  options: TerminalControllerOptions = {},
): TerminalController {
  return new TerminalController(options);
}
