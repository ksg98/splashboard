import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { ThemeProvider } from '@/app/theme/ThemeProvider';

/**
 * Renders `ui` at `path` inside the theme provider and a memory router, the
 * way the app shell would. For a whole-app render use `renderApp`.
 */
export function renderWithProviders(
  ui: ReactElement,
  { path = '/' }: { path?: string } = {},
): RenderResult {
  const router = createMemoryRouter([{ path: '*', element: ui }], { initialEntries: [path] });
  return render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
}

/** Renders the given route tree (usually the app's `routes`) at `path`. */
export function renderRoutes(routes: RouteObject[], path = '/'): RenderResult {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
}
