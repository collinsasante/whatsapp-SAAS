import { useColorScheme as useNativeWindColorScheme } from 'nativewind';
import { colors } from '@whatsapp-platform/theme';
import { loadThemePreference, saveThemePreference, type ThemePreference } from './themeStorage';

/** Resolved color values for spots that can't use Tailwind classes -- inline `style`, and native `color` props like Ionicons. */
const palette = {
  dark: {
    background: colors.surface.DEFAULT,
    card: colors.surface.card,
    elevated: colors.surface.elevated,
    border: colors.surface.border,
    borderLight: colors.surface.borderLight,
    textPrimary: colors.text.primary,
    textSecondary: colors.text.secondary,
    textMuted: colors.text.muted,
    textDisabled: colors.text.disabled,
  },
  light: {
    background: colors.light.background,
    card: colors.light.card,
    elevated: colors.light.elevated,
    border: colors.light.border,
    borderLight: colors.light.borderLight,
    textPrimary: colors.light.text.primary,
    textSecondary: colors.light.text.secondary,
    textMuted: colors.light.text.muted,
    textDisabled: colors.light.text.disabled,
  },
} as const;

export function useAppTheme() {
  const { colorScheme, setColorScheme } = useNativeWindColorScheme();
  const isDark = colorScheme !== 'light';
  const resolved = isDark ? palette.dark : palette.light;

  const setPreference = (pref: ThemePreference) => {
    saveThemePreference(pref);
  };

  return {
    colorScheme: isDark ? ('dark' as const) : ('light' as const),
    isDark,
    colors: resolved,
    /** The user's stored choice -- 'system' if they haven't overridden it, distinct from the resolved light/dark above. */
    preference: loadThemePreference(),
    setPreference,
    setColorScheme,
  };
}
