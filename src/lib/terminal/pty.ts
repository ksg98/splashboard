/**
 * Typed wrappers for the PTY commands in src-tauri/src/pty/commands.rs.
 *
 * A session's channel carries its output as raw bytes (`ArrayBuffer`) and,
 * last, one `{ event: 'exit', code, signal }` object. Message order is kept.
 */
import { Channel, invoke } from '@tauri-apps/api/core';

/** Programs `pty_spawn` accepts (resolved on the login PATH by Rust). */
export const ALLOWED_PROGRAMS = ['splash', 'claude', 'opencode', 'codex', 'hermes', 'pi'] as const;
export type AllowedProgram = (typeof ALLOWED_PROGRAMS)[number];

export interface PtyExit {
  /** Exit code (1 when ended by a signal); null if waiting for it failed. */
  code: number | null;
  /** Description of the signal that ended the program, if any. */
  signal: string | null;
}

export type PtyEvent = { type: 'data'; bytes: Uint8Array } | ({ type: 'exit' } & PtyExit);

export interface PtySize {
  cols: number;
  rows: number;
}

interface CommonLaunch {
  args?: string[];
  /** Working directory; the home folder when omitted. */
  cwd?: string;
  /** Added to the session's environment (login PATH, TERM, LANG are set). */
  env?: Record<string, string>;
}

/** What a terminal runs: `splash <args>` or an allowlisted program. */
export type PtyLaunch =
  | ({ kind: 'splash' } & CommonLaunch)
  | ({ kind: 'program'; program: AllowedProgram } & CommonLaunch);

export interface PtySessionInfo {
  id: number;
  pid: number | null;
  program: string;
  args: string[];
}

/** Rust `AppError` as a rejected invoke delivers it. */
export interface PtyCommandError {
  kind: string;
  message: string;
}

export class PtyError extends Error {
  readonly kind: string;
  constructor(kind: string, message: string) {
    super(message);
    this.name = 'PtyError';
    this.kind = kind;
  }
}

function toPtyError(error: unknown): PtyError {
  if (error instanceof PtyError) return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const e = error as Partial<PtyCommandError>;
    return new PtyError(
      typeof e.kind === 'string' ? e.kind : 'other',
      String(e.message ?? 'terminal error'),
    );
  }
  return new PtyError('other', typeof error === 'string' ? error : 'terminal error');
}

/** Turns one raw channel message into a typed event; null if unrecognised. */
export function decodePtyMessage(message: unknown): PtyEvent | null {
  // A tag check rather than instanceof: the buffer may come from another realm.
  if (Object.prototype.toString.call(message) === '[object ArrayBuffer]') {
    return { type: 'data', bytes: new Uint8Array(message as ArrayBuffer) };
  }
  if (ArrayBuffer.isView(message)) {
    return {
      type: 'data',
      bytes: new Uint8Array(message.buffer, message.byteOffset, message.byteLength),
    };
  }
  // Older IPC paths serialize bytes as a number array.
  if (Array.isArray(message) && message.every((b) => typeof b === 'number')) {
    return { type: 'data', bytes: Uint8Array.from(message as number[]) };
  }
  if (typeof message === 'object' && message !== null && 'event' in message) {
    const m = message as { event: unknown; code?: unknown; signal?: unknown };
    if (m.event === 'exit') {
      return {
        type: 'exit',
        code: typeof m.code === 'number' ? m.code : null,
        signal: typeof m.signal === 'string' ? m.signal : null,
      };
    }
  }
  return null;
}

/** The PTY command surface; tests and the controller take it injected. */
export interface PtyApi {
  spawn(launch: PtyLaunch, size: PtySize, onEvent: (event: PtyEvent) => void): Promise<number>;
  write(id: number, data: string | Uint8Array): Promise<void>;
  resize(id: number, size: PtySize): Promise<void>;
  kill(id: number): Promise<void>;
  list(): Promise<PtySessionInfo[]>;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toPtyError(error);
  }
}

/** The desktop implementation over Tauri `invoke`. */
export const tauriPty: PtyApi = {
  spawn(launch, size, onEvent) {
    const channel = new Channel<unknown>((message) => {
      const event = decodePtyMessage(message);
      if (event) onEvent(event);
    });
    const common = {
      args: launch.args ?? [],
      cwd: launch.cwd ?? null,
      env: launch.env ?? {},
      cols: size.cols,
      rows: size.rows,
      onEvent: channel,
    };
    return launch.kind === 'splash'
      ? call<number>('pty_spawn_splash', common)
      : call<number>('pty_spawn', { ...common, program: launch.program });
  },
  write(id, data) {
    return call<void>('pty_write', {
      id,
      data: typeof data === 'string' ? data : Array.from(data),
    });
  },
  resize(id, size) {
    return call<void>('pty_resize', { id, cols: size.cols, rows: size.rows });
  },
  kill(id) {
    return call<void>('pty_kill', { id });
  },
  list() {
    return call<PtySessionInfo[]>('pty_list');
  },
};
