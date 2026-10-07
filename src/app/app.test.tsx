import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryStore, getStorage, setStorage } from '@/lib/storage';
import { renderRoutes } from '@/test/render';
import { features, navFeatures } from './features';
import { routes } from './router';
import { resolveTheme } from './theme/theme';

describe('app shell', () => {
  beforeEach(() => {
    setStorage({ settings: createMemoryStore(), conversations: createMemoryStore() });
  });

  it.each(features.map((f) => [f.id, f.path] as const))('routes /%s', async (_id, path) => {
    renderRoutes(routes, `/${path}`);
    expect((await screen.findAllByRole('heading')).length).toBeGreaterThan(0);
  });

  it('shows the sidebar nav: New chat and Search chats, then Activity, Models and Connect', async () => {
    renderRoutes(routes, '/chat');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Search chats' })).toBeInTheDocument();
    // Activity is the engine feature's page.
    const destinations = { Activity: 'engine', Models: 'models', Connect: 'connect' };
    for (const [label, id] of Object.entries(destinations)) {
      const feature = navFeatures().find((f) => f.id === id);
      expect(within(nav).getByRole('link', { name: label })).toHaveAttribute(
        'href',
        `/${feature?.path}`,
      );
    }
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('sends first runs to onboarding, then to chat', async () => {
    renderRoutes(routes, '/');
    expect(
      await screen.findByRole('heading', { name: 'Welcome to Splashboard' }),
    ).toBeInTheDocument();
  });

  it('opens chat at / after onboarding', async () => {
    await getStorage().settings.set('onboarding.completed', true);
    renderRoutes(routes, '/');
    expect(
      await screen.findByRole('heading', { name: 'What can I help with?' }),
    ).toBeInTheDocument();
  });

  it('has a not-found page', async () => {
    renderRoutes(routes, '/nowhere');
    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument();
  });

  it('applies the resolved theme to <html>', async () => {
    renderRoutes(routes, '/chat');
    await screen.findByRole('navigation', { name: 'Main' });
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('resolveTheme', () => {
  it('follows the system only for "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
