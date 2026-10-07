import { Boxes } from 'lucide-react';
import type { FeatureDefinition } from '@/app/feature-types';
import { ModelsPage } from './ModelsPage';

export const modelsFeature: FeatureDefinition = {
  id: 'models',
  path: 'models',
  layout: 'shell',
  nav: { label: 'Models', icon: Boxes, order: 30 },
  route: { Component: ModelsPage },
};
