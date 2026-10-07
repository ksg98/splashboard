import { Gauge } from 'lucide-react';
import type { FeatureDefinition } from '@/app/feature-types';
import { EnginePage } from './EnginePage';

export const engineFeature: FeatureDefinition = {
  id: 'engine',
  path: 'engine',
  layout: 'shell',
  nav: { label: 'Engine', icon: Gauge, order: 20 },
  route: { Component: EnginePage },
};
