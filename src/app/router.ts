import { createBrowserRouter, redirect, type RouteObject } from 'react-router';
import { resolveStartPath } from '@/features/onboarding/start';
import { features } from './features';
import { GalleryEntryPage, GalleryIndex } from './gallery/GalleryPage';
import { AppShell } from './layout/AppShell';
import { BareLayout } from './layout/BareLayout';
import { NotFound } from './layout/NotFound';
import { RouteError } from './layout/RouteError';

function featureRoutes(layout: 'shell' | 'bare'): RouteObject[] {
  return features
    .filter((feature) => feature.layout === layout)
    .map((feature) => ({ ...feature.route, path: feature.path }));
}

/**
 * Route tree:
 *   /            -> redirect chosen by the onboarding feature (resolveStartPath)
 *   /<feature>   -> each "shell" feature inside AppShell
 *   /<feature>   -> each "bare" feature full-window
 *   *            -> NotFound
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    ErrorBoundary: RouteError,
    children: [
      {
        Component: AppShell,
        children: [
          { index: true, loader: async () => redirect(await resolveStartPath()) },
          ...featureRoutes('shell'),
          { path: '*', Component: NotFound },
        ],
      },
      {
        Component: BareLayout,
        children: featureRoutes('bare'),
      },
      // Dev-only previews of every *.gallery.tsx entry (see src/app/gallery).
      ...(import.meta.env.DEV
        ? [
            { path: '__gallery', Component: GalleryIndex },
            { path: '__gallery/:id', Component: GalleryEntryPage },
          ]
        : []),
    ],
  },
];

/**
 * Browser history works in the packaged app too: Tauri serves index.html
 * for unknown asset paths.
 */
export function createAppRouter() {
  return createBrowserRouter(routes);
}
