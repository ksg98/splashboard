import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, channels } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  channels: [] as Array<{ onmessage: (message: unknown) => void }>,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  Channel: class {
    onmessage: (message: unknown) => void;
    constructor(onmessage: (message: unknown) => void) {
      this.onmessage = onmessage;
      channels.push(this);
    }
  },
}));

import { PtyError, decodePtyMessage, tauriPty, type PtyEvent } from './pty';

beforeEach(() => {
  invokeMock.mockReset();
  channels.length = 0;
});

describe('decodePtyMessage', () => {
  it('decodes raw bytes, typed arrays and number arrays as data', () => {
    const buffer = new TextEncoder().encode('hi').buffer;
    expect(decodePtyMessage(buffer)).toEqual({ type: 'data', bytes: new Uint8Array([104, 105]) });
    expect(decodePtyMessage(new Uint8Array([1, 2]))).toEqual({
      type: 'data',
      bytes: new Uint8Array([1, 2]),
    });
    expect(decodePtyMessage([27, 91])).toEqual({ type: 'data', bytes: new Uint8Array([27, 91]) });
  });

  it('decodes the exit event', () => {
    expect(decodePtyMessage({ event: 'exit', code: 0, signal: null })).toEqual({
      type: 'exit',
      code: 0,
      signal: null,
    });
    expect(decodePtyMessage({ event: 'exit', code: 1, signal: 'Hangup' })).toEqual({
      type: 'exit',
      code: 1,
      signal: 'Hangup',
    });
  });

  it('ignores anything else', () => {
    expect(decodePtyMessage({ event: 'other' })).toBeNull();
    expect(decodePtyMessage('text')).toBeNull();
    expect(decodePtyMessage(null)).toBeNull();
  });
});

describe('tauriPty', () => {
  it('spawns splash sessions through pty_spawn_splash with a channel', async () => {
    invokeMock.mockResolvedValue(7);
    const events: PtyEvent[] = [];
    const id = await tauriPty.spawn(
      { kind: 'splash', args: ['claude'], env: { SPLASH_PORT: '8000' }, cwd: '/tmp' },
      { cols: 100, rows: 30 },
      (e) => events.push(e),
    );
    expect(id).toBe(7);
    const [command, args] = invokeMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(command).toBe('pty_spawn_splash');
    expect(args).toMatchObject({
      args: ['claude'],
      cwd: '/tmp',
      env: { SPLASH_PORT: '8000' },
      cols: 100,
      rows: 30,
    });
    expect(args.onEvent).toBe(channels[0]);

    channels[0]?.onmessage(new TextEncoder().encode('out').buffer);
    channels[0]?.onmessage({ event: 'exit', code: 0, signal: null });
    channels[0]?.onmessage({ unknown: true });
    const plain = events.map((e) =>
      e.type === 'data' ? { type: 'data', text: new TextDecoder().decode(e.bytes) } : e,
    );
    expect(plain).toEqual([
      { type: 'data', text: 'out' },
      { type: 'exit', code: 0, signal: null },
    ]);
  });

  it('spawns allowlisted programs through pty_spawn', async () => {
    invokeMock.mockResolvedValue(3);
    await tauriPty.spawn({ kind: 'program', program: 'claude' }, { cols: 80, rows: 24 }, () => {});
    const [command, args] = invokeMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(command).toBe('pty_spawn');
    expect(args).toMatchObject({ program: 'claude', args: [], cwd: null, env: {} });
  });

  it('sends text as a string and bytes as a number array', async () => {
    invokeMock.mockResolvedValue(undefined);
    await tauriPty.write(1, 'ls\r');
    await tauriPty.write(1, new Uint8Array([27, 200]));
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'pty_write', { id: 1, data: 'ls\r' });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'pty_write', { id: 1, data: [27, 200] });
  });

  it('resizes, kills and lists', async () => {
    invokeMock.mockResolvedValue([]);
    await tauriPty.resize(2, { cols: 90, rows: 20 });
    await tauriPty.kill(2);
    await tauriPty.list();
    expect(invokeMock.mock.calls).toEqual([
      ['pty_resize', { id: 2, cols: 90, rows: 20 }],
      ['pty_kill', { id: 2 }],
      ['pty_list', undefined],
    ]);
  });

  it('turns Rust AppErrors into PtyErrors', async () => {
    invokeMock.mockRejectedValue({ kind: 'splashNotFound', message: 'no splash' });
    const error = await tauriPty
      .spawn({ kind: 'splash', args: ['--version'] }, { cols: 80, rows: 24 }, () => {})
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PtyError);
    expect(error).toMatchObject({ kind: 'splashNotFound', message: 'no splash' });

    invokeMock.mockRejectedValue('boom');
    await expect(tauriPty.kill(1)).rejects.toMatchObject({ kind: 'other', message: 'boom' });
  });
});
