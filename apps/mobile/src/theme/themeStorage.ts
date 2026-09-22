import { colorScheme } from 'nativewind';
import { mmkv } from '../lib/storage';

export type ThemePreference = 'light' | 'dark' | 'system';

const KEY = 'theme_preference';

export function loadThemePreference(): ThemePreference {
  const v = mmkv.getString(KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

export function saveThemePreference(pref: ThemePreference): void {
  mmkv.set(KEY, pref);
  colorScheme.set(pref);
}

/** Applies the persisted preference to NativeWind's color scheme. Call once, before first render. */
export function initTheme(): void {
  colorScheme.set(loadThemePreference());
}
