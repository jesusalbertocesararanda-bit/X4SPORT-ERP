import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  applyResolvedThemeToDocument,
  getStoredThemePreference,
  normalizeThemePreference,
  resolveTheme,
  saveThemePreference,
} from './theme';

test('normalizeThemePreference accepts dark/light/system and defaults to dark', () => {
  assert.equal(normalizeThemePreference('dark'), 'dark');
  assert.equal(normalizeThemePreference('light'), 'light');
  assert.equal(normalizeThemePreference('system'), 'system');
  assert.equal(normalizeThemePreference(null), DEFAULT_THEME_PREFERENCE);
  assert.equal(normalizeThemePreference('unknown'), 'dark');
});

test('getStoredThemePreference and saveThemePreference persist strictly in localStorage key', () => {
  const map = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };

  assert.equal(getStoredThemePreference(mockStorage), 'dark');

  saveThemePreference('light', mockStorage);
  assert.equal(map.get(THEME_STORAGE_KEY), 'light');
  assert.equal(getStoredThemePreference(mockStorage), 'light');

  saveThemePreference('system', mockStorage);
  assert.equal(map.get(THEME_STORAGE_KEY), 'system');
  assert.equal(getStoredThemePreference(mockStorage), 'system');
});

test('resolveTheme resolves dark, light, and system dynamically', () => {
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('dark', true), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('light', false), 'light');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
});

test('applyResolvedThemeToDocument toggles .dark class, data-theme attribute, and colorScheme', () => {
  const classes = new Set<string>(['dark']);
  const attrs = new Map<string, string>();
  const mockDoc = {
    documentElement: {
      classList: {
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
      },
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      style: { colorScheme: 'dark' },
    },
  } as unknown as Document;

  applyResolvedThemeToDocument('light', mockDoc);
  assert.equal(classes.has('dark'), false);
  assert.equal(attrs.get('data-theme'), 'light');
  assert.equal(mockDoc.documentElement.style.colorScheme, 'light');

  applyResolvedThemeToDocument('dark', mockDoc);
  assert.equal(classes.has('dark'), true);
  assert.equal(attrs.get('data-theme'), 'dark');
  assert.equal(mockDoc.documentElement.style.colorScheme, 'dark');
});
