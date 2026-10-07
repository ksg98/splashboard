import { getStorage } from '@/lib/storage';

export const ONBOARDING_COMPLETED_KEY = 'onboarding.completed';

/**
 * Where "/" goes. Called by the router's index loader, so the onboarding
 * feature decides when to show first-run screens (e.g. also when the splash
 * CLI is missing) without editing src/app.
 */
export async function resolveStartPath(): Promise<string> {
  const completed = await getStorage().settings.get<boolean>(ONBOARDING_COMPLETED_KEY);
  return completed ? '/chat' : '/welcome';
}

export async function markOnboardingCompleted(): Promise<void> {
  await getStorage().settings.set(ONBOARDING_COMPLETED_KEY, true);
}
