export const colors = {
  brand: {
    50: '#f0fdf4',
    100: '#dcfce7',
    200: '#bbf7d0',
    300: '#86efac',
    400: '#4ade80',
    500: '#22c55e',
    600: '#16a34a',
    700: '#15803d',
    800: '#166534',
    900: '#14532d',
  },

  // Primary WhatsApp/VerzChat green
  green: {
    light: '#4ade80',
    DEFAULT: '#25D366',
    dark: '#128C7E',
    muted: 'rgba(37, 211, 102, 0.15)',
  },

  // Dark UI palette (matches existing dark theme)
  dark: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
    950: '#020617',
  },

  // Surface colors (GitHub-dark inspired)
  surface: {
    DEFAULT: '#0d1117',
    card: '#161b22',
    elevated: '#21262d',
    border: 'rgba(255, 255, 255, 0.07)',
    borderLight: '#30363d',
  },

  // Semantic
  blue: {
    DEFAULT: '#3b82f6',
    muted: 'rgba(59, 130, 246, 0.15)',
  },
  purple: {
    DEFAULT: '#8b5cf6',
    muted: 'rgba(139, 92, 246, 0.15)',
  },
  orange: {
    DEFAULT: '#f97316',
    muted: 'rgba(249, 115, 22, 0.15)',
  },
  red: {
    DEFAULT: '#ef4444',
    muted: 'rgba(239, 68, 68, 0.15)',
  },
  yellow: {
    DEFAULT: '#eab308',
    muted: 'rgba(234, 179, 8, 0.15)',
  },
  pink: {
    DEFAULT: '#ec4899',
    muted: 'rgba(236, 72, 153, 0.15)',
  },
  teal: {
    DEFAULT: '#14b8a6',
    muted: 'rgba(20, 184, 166, 0.15)',
  },

  // Text
  text: {
    primary: '#ffffff',
    secondary: 'rgba(255, 255, 255, 0.65)',
    muted: 'rgba(255, 255, 255, 0.4)',
    disabled: 'rgba(255, 255, 255, 0.25)',
    inverse: '#0d1117',
  },

  // Status
  status: {
    online: '#25D366',
    away: '#f97316',
    offline: '#64748b',
    busy: '#ef4444',
  },

  // Light mode overrides
  light: {
    background: '#ffffff',
    surface: '#f8fafc',
    card: '#ffffff',
    border: '#e2e8f0',
    text: {
      primary: '#0f172a',
      secondary: '#475569',
      muted: '#94a3b8',
    },
  },
} as const;

export type Colors = typeof colors;
