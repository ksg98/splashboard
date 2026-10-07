import { Plug } from 'lucide-react';
import type { FeatureDefinition } from '@/app/feature-types';
import { ConnectPage } from './ConnectPage';

export const connectFeature: FeatureDefinition = {
  id: 'connect',
  path: 'connect',
  layout: 'shell',
  nav: { label: 'Connect', icon: Plug, order: 40 },
  route: { Component: ConnectPage },
};
