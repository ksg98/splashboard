import { useContext } from 'react';
import { ThemeContext, type ThemeContextValue } from './context';

/** Current theme and a setter (used by the settings feature). */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}
