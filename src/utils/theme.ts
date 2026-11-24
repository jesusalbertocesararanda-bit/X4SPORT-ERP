export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'x4sport_theme_preference';
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'dark';

export function normalizeThemePreference(raw: unknown): ThemePreference {
  if (raw === 'dark' || raw === 'light' || raw === 'system') {
    return raw;
  }
  return DEFAULT_THEME_PREFERENCE;
}

export function getStoredThemePreference(
  storage: Pick<Storage, 'getItem'> | null =
    typeof window !== 'undefined' ? window.localStorage : null,
): ThemePreference {
  if (!storage) return DEFAULT_THEME_PREFERENCE;
  try {
    return normalizeThemePreference(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

export function saveThemePreference(
  preference: ThemePreference,
  storage: Pick<Storage, 'setItem'> | null =
    typeof window !== 'undefined' ? window.localStorage : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, normalizeThemePreference(preference));
  } catch {
    // Ignore storage quota/private mode errors silently
  }
}

export function getSystemPrefersDark(
  matchMediaFn: ((query: string) => MediaQueryList) | null =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia.bind(window)
      : null,
): boolean {
  if (!matchMediaFn) return true;
  try {
    return matchMediaFn('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'dark') return 'dark';
  if (preference === 'light') return 'light';
  return systemPrefersDark ? 'dark' : 'light';
}

export function applyResolvedThemeToDocument(
  resolved: ResolvedTheme,
  doc: Document | null = typeof document !== 'undefined' ? document : null,
): void {
  if (!doc || !doc.documentElement) return;
  const root = doc.documentElement;
  if (resolved === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  root.setAttribute('data-theme', resolved);
  root.style.colorScheme = resolved;
}
