import { Settings } from 'lucide-react';
import type { FeatureDefinition } from '@/app/feature-types';
import { SettingsPage } from './SettingsPage';

export const settingsFeature: FeatureDefinition = {
  id: 'settings',
  path: 'settings',
  layout: 'shell',
  nav: { label: 'Settings', icon: Settings, order: 90 },
  route: { Component: SettingsPage },
};
