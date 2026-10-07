import { describe, expect, it } from 'vitest';
import error400 from '../../../fixtures/splash-1.2.0/error_400.json';
import error401 from '../../../fixtures/splash-1.2.0/error_401.json';
import error404 from '../../../fixtures/splash-1.2.0/error_404.json';
import errorContext from '../../../fixtures/splash-1.2.0/error_context_length.json';
import errorModel from '../../../fixtures/splash-1.2.0/error_model_not_found.json';
import hostForbidden from '../../../fixtures/splash-1.2.0/host_forbidden.json';
import originForbidden from '../../../fixtures/splash-1.2.0/origin_forbidden.json';
import {
  SplashHttpError,
  SplashStreamError,
  SplashTransportError,
  abortError,
  classifySplashError,
  isAbortError,
  parseRetryAfter,
  splashErrorMessage,
} from './errors';

const http = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new SplashHttpError(status, JSON.stringify(body), headers);

describe('SplashHttpError', () => {
  it('exposes the message, code, type and Retry-After of a Splash error', () => {
    const error = http(
      503,
      {
        error: { message: 'engine is recovering', type: 'server_error', code: 'engine_recovering' },
      },
      { 'retry-after': '1' },
    );
    expect(error.message).toBe('engine is recovering');
    expect(error.code).toBe('engine_recovering');
    expect(error.errorType).toBe('server_error');
    expect(error.retryAfter).toBe(1);
  });

  it('falls back for non-JSON bodies', () => {
    const error = new SplashHttpError(502, '<html>bad gateway</html>');
    expect(error.message).toBe('Splash answered HTTP 502');
    expect(error.code).toBeUndefined();
    expect(splashErrorMessage('nope')).toBeUndefined();
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates', () => {
    expect(parseRetryAfter('1')).toBe(1);
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
    const now = Date.parse('Sun, 04 Oct 2026 07:20:30 GMT');
    expect(parseRetryAfter('Sun, 04 Oct 2026 07:20:32 GMT', now)).toBe(2);
  });
});

describe('classifySplashError', () => {
  it('tells unreachable, timeout and abort apart', () => {
    expect(
      classifySplashError(new SplashTransportError('ECONNREFUSED', 'unreachable')),
    ).toMatchObject({ kind: 'unreachable', retryable: true });
    expect(classifySplashError(new SplashTransportError('fetch failed'))).toMatchObject({
      kind: 'unreachable',
      code: 'network',
    });
    expect(classifySplashError(new SplashTransportError('timed out', 'timeout'))).toMatchObject({
      kind: 'timeout',
    });
    expect(classifySplashError(abortError())).toMatchObject({ kind: 'aborted' });
    expect(isAbortError(abortError('x'))).toBe(true);
    expect(classifySplashError(new SplashTransportError('not JSON', 'invalidResponse')).kind).toBe(
      'invalid-response',
    );
  });

  it('classifies the recorded error bodies', () => {
    expect(classifySplashError(http(403, originForbidden))).toMatchObject({
      kind: 'forbidden-origin',
      status: 403,
      code: 'forbidden',
      retryable: false,
    });
    expect(classifySplashError(http(403, hostForbidden)).kind).toBe('forbidden-host');
    expect(
      classifySplashError(http(401, error401, { 'www-authenticate': 'Bearer' })),
    ).toMatchObject({ kind: 'unauthorized', code: 'authentication_error' });
    expect(classifySplashError(http(400, error400))).toMatchObject({
      kind: 'bad-request',
      message: 'temperature must be a number in [0, 2]',
    });
    expect(classifySplashError(http(400, errorContext)).kind).toBe('context-length');
    expect(classifySplashError(http(404, error404)).kind).toBe('not-found');
    expect(classifySplashError(http(404, errorModel)).code).toBe('model_not_found');
  });

  it('carries Retry-After for 503s', () => {
    const overloaded = http(
      503,
      { error: { message: 'full', type: 'server_error', code: 'frontend_overloaded' } },
      { 'retry-after': '1' },
    );
    expect(classifySplashError(overloaded)).toMatchObject({
      kind: 'overloaded',
      retryAfter: 1,
      retryable: true,
    });
    const shutdown = http(503, {
      error: { message: 'bye', type: 'server_error', code: 'server_shutdown' },
    });
    expect(classifySplashError(shutdown)).toMatchObject({
      kind: 'unavailable',
      retryAfter: 1,
      retryable: false,
    });
  });

  it('classifies 5xx and stream errors', () => {
    expect(
      classifySplashError(
        http(500, {
          error: { message: 'restarts stopped', type: 'server_error', code: 'engine_failed' },
        }),
      ).kind,
    ).toBe('engine-failed');
    expect(
      classifySplashError(http(504, { error: { message: 't', type: 'server_error' } })),
    ).toMatchObject({ kind: 'server', retryable: true });
    expect(classifySplashError(new SplashStreamError('stalled', 'mask_timeout'))).toMatchObject({
      kind: 'stream',
      code: 'mask_timeout',
      retryable: true,
    });
    expect(classifySplashError('boom')).toMatchObject({ kind: 'unknown', message: 'boom' });
  });
});
