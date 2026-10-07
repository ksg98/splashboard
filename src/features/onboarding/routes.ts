import type { FeatureDefinition } from '@/app/feature-types';
import { WelcomePage } from './WelcomePage';

export const onboardingFeature: FeatureDefinition = {
  id: 'onboarding',
  path: 'welcome',
  // Full window, no nav: first run, or Splash not installed.
  layout: 'bare',
  route: { Component: WelcomePage },
};
