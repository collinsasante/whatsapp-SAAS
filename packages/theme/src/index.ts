export * from './colors';
export * from './spacing';
export * from './typography';
export * from './radius';
export * from './shadows';

// Consolidated theme object for convenience
import { colors } from './colors';
import { spacing, insets } from './spacing';
import { fontSizes, fontWeights, lineHeights, letterSpacings } from './typography';
import { radius } from './radius';
import { shadows } from './shadows';

export const theme = {
  colors,
  spacing,
  insets,
  fontSizes,
  fontWeights,
  lineHeights,
  letterSpacings,
  radius,
  shadows,
} as const;

export type Theme = typeof theme;
