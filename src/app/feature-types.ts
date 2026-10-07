import type { LucideIcon } from 'lucide-react';
import type { NonIndexRouteObject } from 'react-router';

/**
 * What a feature folder exports (from its routes.ts) to plug into the app.
 * The shell builds the router and the nav from these, so a feature changes
 * its own route, sub-routes, loaders and nav entry without touching src/app.
 */
export interface FeatureDefinition {
  /** Stable id, same as the folder name. */
  id: string;
  /** URL segment under "/", e.g. "chat" -> /chat. */
  path: string;
  /**
   * "shell": inside the app shell (title bar + nav).
   * "bare": the whole window (first-run screens).
   */
  layout: 'shell' | 'bare';
  /** Main-nav entry; omit to keep the feature out of the nav. */
  nav?: {
    label: string;
    icon: LucideIcon;
    /** Ascending sort key. */
    order: number;
  };
  /**
   * The feature's route at `path`: its Component, plus any `children`,
   * `loader`, `ErrorBoundary`... (`path` is set by the shell).
   */
  route: Omit<NonIndexRouteObject, 'path'>;
}
