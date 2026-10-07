/**
 * Test-only helpers: fake Transports that replay recorded Splash streams
 * (fixtures/splash-1.2.0/*.sse and *.timeline.jsonl) with a manual clock.
 */
import { SplashHttpError, abortError } from './errors';
import { SseParser, isDoneEvent, type SseEvent } from './sse';
import type { SplashResponse, SplashStreamInit, Transport } from './transport';

/** A clock the replay advances to each recorded line's `t_ms`. */
export interface ManualClock {
  t: number;
  now: () => number;
}

export function manualClock(start = 0): ManualClock {
  const clock: ManualClock = { t: start, now: () => clock.t };
  return clock;
}

export type TimelineRow =
  | { t_ms: number; status: number; headers: Record<string, string> }
  | { t_ms: number; line: string };

export function parseTimeline(jsonl: string): TimelineRow[] {
  return jsonl
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as TimelineRow);
}

/** Raw `.sse` text as rows 1 ms apart, preceded by a 200 header row. */
export function sseRows(text: string): TimelineRow[] {
  const rows: TimelineRow[] = [{ t_ms: 0, status: 200, headers: {} }];
  text.split('\n').forEach((line, index) => rows.push({ t_ms: index + 1, line }));
  return rows;
}

export interface ReplayOptions {
  clock?: ManualClock;
  /** Abort-free failure: throw this when the stream would open. */
  failWith?: Error;
  /** Stop after this many rows as if the server closed the connection. */
  truncateAfterRows?: number;
  /** Called after each yielded event (tests abort from here). */
  afterEvent?: (event: SseEvent, index: number) => void;
}

/** A Transport whose `stream()` replays `rows` and records the request it got. */
export function replayTransport(
  rows: TimelineRow[],
  options: ReplayOptions = {},
): Transport & { lastInit: SplashStreamInit | undefined } {
  const transport = {
    kind: 'http' as const,
    lastInit: undefined as SplashStreamInit | undefined,
    request(): Promise<SplashResponse> {
      return Promise.reject(new Error('replayTransport: request() not supported'));
    },
    async *stream(init: SplashStreamInit): AsyncGenerator<SseEvent> {
      transport.lastInit = init;
      if (options.failWith) throw options.failWith;
      const parser = new SseParser({ onComment: (comment) => init.onComment?.(comment) });
      let yielded = 0;
      const limit = options.truncateAfterRows ?? rows.length;
      for (const row of rows.slice(0, limit)) {
        // Let the consumer run between rows, like real network reads.
        await Promise.resolve();
        if (init.signal?.aborted) throw abortError(init.signal.reason);
        if (options.clock) options.clock.t = row.t_ms;
        if ('status' in row) {
          if (row.status < 200 || row.status >= 300) {
            throw new SplashHttpError(row.status, '', row.headers);
          }
          init.onOpen?.({ status: row.status, headers: row.headers });
          continue;
        }
        for (const event of parser.push(`${row.line}\n`)) {
          if (isDoneEvent(event)) return;
          yield event;
          options.afterEvent?.(event, yielded++);
          if (init.signal?.aborted) throw abortError(init.signal.reason);
        }
      }
      for (const event of parser.end()) {
        if (isDoneEvent(event)) return;
        yield event;
      }
    },
  };
  return transport;
}
