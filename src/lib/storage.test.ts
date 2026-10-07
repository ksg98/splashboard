import { describe, expect, it } from 'vitest';
import {
  createLocalStorageStore,
  createMemoryStore,
  getStorage,
  type KeyValueStore,
} from './storage';

async function exercise(store: KeyValueStore) {
  expect(await store.get('missing')).toBeUndefined();
  await store.set('a', { theme: 'dark', n: 1 });
  await store.set('b', [1, 2, 3]);
  expect(await store.get('a')).toEqual({ theme: 'dark', n: 1 });
  expect((await store.keys()).sort()).toEqual(['a', 'b']);
  await store.delete('a');
  expect(await store.get('a')).toBeUndefined();
  await store.clear();
  expect(await store.keys()).toEqual([]);
}

describe('storage', () => {
  it('memory store round-trips JSON values', async () => {
    await exercise(createMemoryStore());
  });

  it('localStorage store round-trips and stays in its namespace', async () => {
    window.localStorage.setItem('unrelated', 'keep');
    const store = createLocalStorageStore('settings');
    await exercise(store);
    await store.set('x', 1);
    expect(window.localStorage.getItem('splashboard:settings:x')).toBe('1');
    await store.clear();
    expect(window.localStorage.getItem('unrelated')).toBe('keep');
  });

  it('keeps areas apart', async () => {
    const settings = createLocalStorageStore('settings');
    const conversations = createLocalStorageStore('conversations');
    await settings.set('k', 'settings');
    await conversations.set('k', 'conversations');
    expect(await settings.get('k')).toBe('settings');
    expect(await conversations.get('k')).toBe('conversations');
  });

  it('defaults to localStorage in a browser', async () => {
    await getStorage().settings.set('probe', true);
    expect(window.localStorage.getItem('splashboard:settings:probe')).toBe('true');
  });
});
