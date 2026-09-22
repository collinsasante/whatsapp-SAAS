/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      // Single source of truth for the palette/type-scale/radius -- was
      // previously duplicated (colors) or entirely unused (radius, font
      // sizes) despite being defined in packages/theme. font sizes here are
      // iOS system-font sizes (11/13/15/17/20...), not Tailwind's web
      // defaults -- wiring them in makes text- classes match iOS conventions
      // app-wide without touching every screen.
      colors: require('@whatsapp-platform/theme').colors,
      borderRadius: require('@whatsapp-platform/theme').radius,
      fontSize: require('@whatsapp-platform/theme').fontSizes,
    },
  },
  plugins: [],
};
