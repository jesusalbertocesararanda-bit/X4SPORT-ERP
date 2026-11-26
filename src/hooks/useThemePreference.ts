import { useCallback, useEffect, useState } from 'react';
import {
  applyResolvedThemeToDocument,
  getStoredThemePreference,
  getSystemPrefersDark,
  normalizeThemePreference,
  resolveTheme,
  saveThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from '../utils/theme';

export interface UseThemePreferenceOptions {
  forceSystemTheme?: boolean;
}

export function useThemePreference(
  options: UseThemePreferenceOptions = {},
): {
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setThemePreference: (next: ThemePreference) => void;
} {
  const forceSystemTheme = Boolean(options.forceSystemTheme);
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(
    () => getStoredThemePreference(),
  );
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() =>
    getSystemPrefersDark(),
  );

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemPrefersDark(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  const resolvedTheme = resolveTheme(
    forceSystemTheme ? 'system' : themePreference,
    systemPrefersDark,
  );

  useEffect(() => {
    applyResolvedThemeToDocument(resolvedTheme);
  }, [resolvedTheme]);

  const setThemePreference = useCallback(
    (next: ThemePreference) => {
      const normalized = normalizeThemePreference(next);
      saveThemePreference(normalized);
      setThemePreferenceState(normalized);
      const immediateResolved = resolveTheme(
        forceSystemTheme ? 'system' : normalized,
        getSystemPrefersDark(),
      );
      applyResolvedThemeToDocument(immediateResolved);
    },
    [forceSystemTheme],
  );

  return {
    themePreference,
    resolvedTheme,
    setThemePreference,
  };
}
