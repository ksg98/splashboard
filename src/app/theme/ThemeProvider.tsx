import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { isTauri } from '@/lib/env';
import { ThemeContext, type ThemeContextValue } from './context';
import {
  readStoredPreference,
  resolveTheme,
  storePreference,
  subscribeToSystemTheme,
  systemPrefersDark,
  type ResolvedTheme,
  type ThemePreference,
} from './theme';

/**
 * Dev gallery only: /__gallery/<id>?theme=light|dark pins the theme so
 * screenshots are deterministic. Read here because this provider's effect runs
 * after the gallery page's own (parents' effects run after their children's).
 */
function galleryThemeOverride(): ResolvedTheme | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  if (!window.location.pathname.startsWith('/__gallery')) return null;
  const theme = new URLSearchParams(window.location.search).get('theme');
  return theme === 'light' || theme === 'dark' ? theme : null;
}

/**
 * Applies the theme as <html data-theme="light|dark"> (tokens.css switches
 * on it), follows the OS setting while the preference is "system", and keeps
 * the native window appearance in step inside Tauri.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark, () => false);
  const resolved = resolveTheme(preference, systemDark);

  useEffect(() => {
    const root = document.documentElement;
    const applied = galleryThemeOverride() ?? resolved;
    root.dataset.theme = applied;
    root.style.colorScheme = applied;
  }, [resolved]);

  useEffect(() => {
    if (!isTauri()) return;
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().setTheme(preference === 'system' ? null : preference),
      )
      .catch(() => undefined);
  }, [preference]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolved,
      setPreference: (next) => {
        storePreference(next);
        setPreferenceState(next);
      },
    }),
    [preference, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
