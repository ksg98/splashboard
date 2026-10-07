/**
 * Types for server.mjs (used by the vitest suite in src/lib/splash/mock-splash.test.ts).
 * Kept free of Node type imports: the app tsconfig has no Node types.
 */

export declare const DEFAULT_FIXTURES_DIR: string;

export interface MockSplashOptions {
  /** Default 127.0.0.1. */
  host?: string;
  /** Default 8090; 0 picks a free port. */
  port?: number;
  /** Pacing multiplier (default 1 = recorded speed; Infinity = no delays). */
  speed?: number;
  /** Which /status snapshots to serve (default `cycle`: idle -> busy -> ... -> saturated). */
  statusMode?: 'cycle' | 'busy' | 'idle' | 'saturated';
  /** Advance /status by wall time (default) or by one step per poll. */
  statusAdvance?: 'time' | 'poll';
  /** Default 1000. */
  statusStepMs?: number;
  /** Simulate the idle weight release after this many ms without a chat (0 = off). */
  idleReleaseMs?: number;
  /** Require this key on non-public routes. */
  apiKey?: string;
  /** Origins admitted with CORS headers ('*' = any). */
  allowedOrigins?: string[];
  fixturesDir?: string;
  /** Default true (no request log). */
  quiet?: boolean;
}

export interface MockSplashStats {
  requests: number;
  statusPolls: number;
  streams: { started: number; active: number; completed: number; cancelled: number };
  lastChatRequest: Record<string, unknown> | null;
}

export interface MockSplash {
  url: string;
  host: string;
  port: number;
  /** The node:http Server. */
  server: unknown;
  stats: MockSplashStats;
  close(): Promise<void>;
}

export declare function startMockSplash(options?: MockSplashOptions): Promise<MockSplash>;
