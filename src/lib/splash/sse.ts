/**
 * Server-Sent Events parser, per the WHATWG HTML "event stream
 * interpretation" rules, fed with arbitrary text chunks.
 *
 * - Lines end with \n, \r\n or \r, including a \r\n split across chunks.
 * - Several `data:` lines in one event are joined with \n.
 * - Comment lines (`: splash-keepalive`) are not events; they go to
 *   `onComment`, which a UI can use as a liveness signal.
 * - `[DONE]` (OpenAI-style end marker) is returned like any other event;
 *   use `isDoneEvent`. Transports stop iterating when they see it.
 * - At end of input, a final event without its blank line is still
 *   dispatched (lenient: servers that close right after the last data line).
 */

export interface SseEvent {
  /** The `event:` field, or "message" when absent. */
  event: string;
  /** All `data:` lines of the event, joined with \n. */
  data: string;
  /** The last `id:` seen on the stream, if any. */
  id?: string;
  /** A `retry:` value seen in this event, in milliseconds. */
  retry?: number;
}

export interface SseParserOptions {
  /** Called with the text after ':' for each comment line. */
  onComment?: (comment: string) => void;
}

export const DONE_DATA = '[DONE]';

export function isDoneEvent(event: SseEvent): boolean {
  return event.data === DONE_DATA;
}

export class SseParser {
  private buffer = '';
  private dataLines: string[] = [];
  private eventType = '';
  private lastEventId: string | undefined;
  private retry: number | undefined;
  private pendingCR = false;
  private started = false;
  private readonly onComment: ((comment: string) => void) | undefined;

  constructor(options: SseParserOptions = {}) {
    this.onComment = options.onComment;
  }

  /** Feeds a chunk; returns the events it completed. */
  push(chunk: string): SseEvent[] {
    const events: SseEvent[] = [];
    if (chunk.length === 0) return events;
    if (!this.started) {
      this.started = true;
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
    }
    // A \r ended the previous chunk: a leading \n is the rest of that CRLF.
    if (this.pendingCR && chunk.startsWith('\n')) chunk = chunk.slice(1);
    this.pendingCR = false;

    // The kept buffer never holds a line terminator, so scan only new text.
    let scan = this.buffer.length;
    this.buffer += chunk;
    let lineStart = 0;
    const text = this.buffer;
    for (; scan < text.length; scan++) {
      const code = text.charCodeAt(scan);
      if (code !== 10 && code !== 13) continue;
      this.processLine(text.slice(lineStart, scan), events);
      if (code === 13) {
        if (scan + 1 < text.length) {
          if (text.charCodeAt(scan + 1) === 10) scan++;
        } else {
          this.pendingCR = true;
        }
      }
      lineStart = scan + 1;
    }
    this.buffer = text.slice(lineStart);
    return events;
  }

  /** Signals end of input; returns a final unterminated event, if any. */
  end(): SseEvent[] {
    const events: SseEvent[] = [];
    if (this.buffer.length > 0) {
      this.processLine(this.buffer, events);
      this.buffer = '';
    }
    this.dispatch(events);
    this.pendingCR = false;
    return events;
  }

  private processLine(line: string, events: SseEvent[]): void {
    if (line === '') {
      this.dispatch(events);
      return;
    }
    if (line.charCodeAt(0) === 58 /* : */) {
      this.onComment?.(stripLeadingSpace(line.slice(1)));
      return;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : stripLeadingSpace(line.slice(colon + 1));
    switch (field) {
      case 'event':
        this.eventType = value;
        break;
      case 'data':
        this.dataLines.push(value);
        break;
      case 'id':
        if (!value.includes('\0')) this.lastEventId = value;
        break;
      case 'retry':
        if (/^\d+$/.test(value)) this.retry = Number(value);
        break;
      default:
        // Unknown fields are ignored, per spec.
        break;
    }
  }

  private dispatch(events: SseEvent[]): void {
    if (this.dataLines.length === 0) {
      this.eventType = '';
      this.retry = undefined;
      return;
    }
    const event: SseEvent = {
      event: this.eventType || 'message',
      data: this.dataLines.join('\n'),
    };
    if (this.lastEventId !== undefined) event.id = this.lastEventId;
    if (this.retry !== undefined) event.retry = this.retry;
    events.push(event);
    this.dataLines = [];
    this.eventType = '';
    this.retry = undefined;
  }
}

function stripLeadingSpace(value: string): string {
  return value.charCodeAt(0) === 32 ? value.slice(1) : value;
}

/** Parses an async sequence of text chunks into events (including [DONE]). */
export async function* parseSse(
  chunks: AsyncIterable<string>,
  options: SseParserOptions = {},
): AsyncGenerator<SseEvent> {
  const parser = new SseParser(options);
  for await (const chunk of chunks) {
    yield* parser.push(chunk);
  }
  yield* parser.end();
}
