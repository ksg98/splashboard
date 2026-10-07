import { describe, expect, it, vi } from 'vitest';
import { isDoneEvent, parseSse, SseParser, type SseEvent } from './sse';

function parseAll(chunks: string[], onComment?: (c: string) => void): SseEvent[] {
  const parser = new SseParser({ onComment });
  return [...chunks.flatMap((chunk) => parser.push(chunk)), ...parser.end()];
}

describe('SseParser', () => {
  it('parses single events with the default type', () => {
    expect(parseAll(['data: {"a":1}\n\n'])).toEqual([{ event: 'message', data: '{"a":1}' }]);
  });

  it('joins multi-line data with \\n', () => {
    expect(parseAll(['data: line one\ndata: line two\ndata:\n\n'])).toEqual([
      { event: 'message', data: 'line one\nline two\n' },
    ]);
  });

  it('reads event names, ids and retry', () => {
    const events = parseAll([
      'event: message_start\nid: 7\nretry: 1500\ndata: {"type":"message_start"}\n\n',
      'event: ping\ndata: {}\n\n',
    ]);
    expect(events).toEqual([
      { event: 'message_start', data: '{"type":"message_start"}', id: '7', retry: 1500 },
      { event: 'ping', data: '{}', id: '7' },
    ]);
  });

  it('skips comments and keepalives, reporting them', () => {
    const onComment = vi.fn();
    const events = parseAll([': splash-keepalive\n\n', ':\n', 'data: x\n\n'], onComment);
    expect(events).toEqual([{ event: 'message', data: 'x' }]);
    expect(onComment).toHaveBeenNthCalledWith(1, 'splash-keepalive');
    expect(onComment).toHaveBeenNthCalledWith(2, '');
  });

  it('handles chunks split anywhere, including mid-field and mid-CRLF', () => {
    const stream = 'event: delta\r\ndata: {"t":"héllo"}\r\n\r\ndata: [DONE]\r\n\r\n';
    const whole = parseAll([stream]);
    expect(whole).toEqual([
      { event: 'delta', data: '{"t":"héllo"}' },
      { event: 'message', data: '[DONE]' },
    ]);
    // Every split point, and one character per chunk.
    for (let i = 1; i < stream.length; i++) {
      expect(parseAll([stream.slice(0, i), stream.slice(i)])).toEqual(whole);
    }
    expect(parseAll(stream.split(''))).toEqual(whole);
  });

  it('treats a lone \\r as a line end', () => {
    expect(parseAll(['data: a\rdata: b\r\r'])).toEqual([{ event: 'message', data: 'a\nb' }]);
  });

  it('does not let an empty chunk break a split CRLF', () => {
    expect(parseAll(['data: a\r', '', '\n\r\n'])).toEqual([{ event: 'message', data: 'a' }]);
  });

  it('strips one leading space only, and a leading BOM', () => {
    expect(parseAll(['﻿data:  two spaces\n\n'])).toEqual([
      { event: 'message', data: ' two spaces' },
    ]);
  });

  it('ignores events without data and unknown fields', () => {
    expect(parseAll(['event: lonely\n\nfoo: bar\ndata: ok\n\n'])).toEqual([
      { event: 'message', data: 'ok' },
    ]);
  });

  it('flushes a final event without a blank line at end of input', () => {
    expect(parseAll(['data: tail'])).toEqual([{ event: 'message', data: 'tail' }]);
  });

  it('recognises [DONE]', () => {
    const [done] = parseAll(['data: [DONE]\n\n']);
    expect(done && isDoneEvent(done)).toBe(true);
  });
});

describe('parseSse', () => {
  it('parses an async chunk stream', async () => {
    async function* chunks() {
      yield 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n';
      yield '\n: splash-keepalive\n\ndata: [DO';
      yield 'NE]\n\n';
    }
    const events: SseEvent[] = [];
    for await (const event of parseSse(chunks())) events.push(event);
    expect(events.map((e) => e.data)).toEqual([
      '{"choices":[{"delta":{"content":"Hi"}}]}',
      '[DONE]',
    ]);
  });
});
