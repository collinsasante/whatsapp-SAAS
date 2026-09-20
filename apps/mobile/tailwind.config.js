/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      // Single source of truth for the palette -- was previously duplicated
      // here by hand and could silently drift from packages/theme.
      colors: require('@whatsapp-platform/theme').colors,
    },
  },
  plugins: [],
};
