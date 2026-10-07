import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryStore, setStorage } from '@/lib/storage';
import { renderWithProviders } from '@/test/render';
import { SettingsPage } from './SettingsPage';
import { DEFAULT_SETTINGS, useSettingsStore } from './store';

describe('settings feature', () => {
  beforeEach(() => {
    setStorage({ settings: createMemoryStore(), conversations: createMemoryStore() });
    useSettingsStore.setState({ settings: DEFAULT_SETTINGS, loaded: false });
  });

  it('switches the theme', async () => {
    renderWithProviders(<SettingsPage />, { path: '/settings' });
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('persists settings through storage', async () => {
    await useSettingsStore.getState().update({ autoStartEngine: true });
    useSettingsStore.setState({ settings: DEFAULT_SETTINGS, loaded: false });
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().settings.autoStartEngine).toBe(true);
  });
});
