/**
 * Persistent key/value storage for settings and conversations.
 *
 * - Desktop: `@tauri-apps/plugin-store`, one JSON file per area in the app
 *   data dir (~/Library/Application Support/ai.splashboard.app/).
 * - Browser dev: `localStorage`, namespaced per area.
 * - Tests: `createMemoryStore()` via `setStorage()`.
 *
 * Values must be JSON-serialisable. Use `getStorage().settings` /
 * `getStorage().conversations`; do not create stores of your own.
 */
import type { Store } from '@tauri-apps/plugin-store';
import { isTauri } from './env';

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

export interface AppStorage {
  /** App settings (theme, engine launch defaults, connectors, ...). */
  settings: KeyValueStore;
  /** Chat conversations, one key per conversation id. */
  conversations: KeyValueStore;
}

export type StorageArea = keyof AppStorage;

/** In-memory store (tests, or a fallback when nothing persistent works). */
export function createMemoryStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const data = new Map<string, string>(
    Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]),
  );
  return {
    async get<T>(key: string) {
      const raw = data.get(key);
      return raw === undefined ? undefined : (JSON.parse(raw) as T);
    },
    async set(key, value) {
      data.set(key, JSON.stringify(value));
    },
    async delete(key) {
      data.delete(key);
    },
    async keys() {
      return [...data.keys()];
    },
    async clear() {
      data.clear();
    },
  };
}

/** `localStorage`-backed store; keys are prefixed with `splashboard:<area>:`. */
export function createLocalStorageStore(
  area: string,
  storage: Storage = window.localStorage,
): KeyValueStore {
  const prefix = `splashboard:${area}:`;
  const ownKeys = () => {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) keys.push(key.slice(prefix.length));
    }
    return keys;
  };
  return {
    async get<T>(key: string) {
      const raw = storage.getItem(prefix + key);
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      storage.setItem(prefix + key, JSON.stringify(value));
    },
    async delete(key) {
      storage.removeItem(prefix + key);
    },
    async keys() {
      return ownKeys();
    },
    async clear() {
      for (const key of ownKeys()) storage.removeItem(prefix + key);
    },
  };
}

/** Tauri plugin-store-backed store, saved to `<file>` in the app data dir. */
export function createTauriStore(file: string): KeyValueStore {
  // Loaded lazily so the plugin is only touched inside the desktop app.
  let loaded: Promise<Store> | undefined;
  const store = () => {
    loaded ??= import('@tauri-apps/plugin-store').then(({ load }) =>
      load(file, { autoSave: 200, defaults: {} }),
    );
    return loaded;
  };
  return {
    async get<T>(key: string) {
      return (await store()).get<T>(key);
    },
    async set(key, value) {
      await (await store()).set(key, value);
    },
    async delete(key) {
      await (await store()).delete(key);
    },
    async keys() {
      return (await store()).keys();
    },
    async clear() {
      await (await store()).clear();
    },
  };
}

function createDefaultStorage(): AppStorage {
  if (isTauri()) {
    return {
      settings: createTauriStore('settings.json'),
      conversations: createTauriStore('conversations.json'),
    };
  }
  try {
    const probe = '__splashboard_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return {
      settings: createLocalStorageStore('settings'),
      conversations: createLocalStorageStore('conversations'),
    };
  } catch {
    return { settings: createMemoryStore(), conversations: createMemoryStore() };
  }
}

let current: AppStorage | undefined;

export function getStorage(): AppStorage {
  current ??= createDefaultStorage();
  return current;
}

/** Replaces the storage (tests). Pass undefined to go back to the default. */
export function setStorage(storage: AppStorage | undefined): void {
  current = storage;
}
