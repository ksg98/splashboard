/**
 * The feature registry: every feature folder's definition, in one list the
 * router and nav read. Adding a feature means adding a folder under
 * src/features/ and one line here (and to FEATURES in eslint.config.js).
 */
import { chatFeature } from '@/features/chat/routes';
import { connectFeature } from '@/features/connect/routes';
import { engineFeature } from '@/features/engine/routes';
import { modelsFeature } from '@/features/models/routes';
import { onboardingFeature } from '@/features/onboarding/routes';
import { settingsFeature } from '@/features/settings/routes';
import type { FeatureDefinition } from './feature-types';

export const features: readonly FeatureDefinition[] = [
  chatFeature,
  engineFeature,
  modelsFeature,
  connectFeature,
  settingsFeature,
  onboardingFeature,
];

/** Nav entries, sorted. */
export function navFeatures(): (FeatureDefinition & {
  nav: NonNullable<FeatureDefinition['nav']>;
})[] {
  return features
    .filter((f): f is FeatureDefinition & { nav: NonNullable<FeatureDefinition['nav']> } => !!f.nav)
    .sort((a, b) => a.nav.order - b.nav.order);
}
