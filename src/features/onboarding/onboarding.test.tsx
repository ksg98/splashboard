import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryStore, getStorage, setStorage } from '@/lib/storage';
import { renderRoutes } from '@/test/render';
import { WelcomePage } from './WelcomePage';
import { ONBOARDING_COMPLETED_KEY, resolveStartPath } from './start';
import { useOnboardingStore } from './store';

describe('onboarding feature', () => {
  beforeEach(() => {
    setStorage({ settings: createMemoryStore(), conversations: createMemoryStore() });
  });

  it('starts at /welcome until completed', async () => {
    expect(await resolveStartPath()).toBe('/welcome');
    await getStorage().settings.set(ONBOARDING_COMPLETED_KEY, true);
    expect(await resolveStartPath()).toBe('/chat');
  });

  it('shows the first-run welcome', async () => {
    renderRoutes(
      [
        { path: '/welcome', Component: WelcomePage },
        { path: '/chat', element: <h1>Chat</h1> },
      ],
      '/welcome',
    );
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('tracks the step', () => {
    useOnboardingStore.getState().setStep('model');
    expect(useOnboardingStore.getState().step).toBe('model');
  });
});
