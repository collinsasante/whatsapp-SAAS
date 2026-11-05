import path from 'path';
import { defineConfig } from 'vitest/config';

// Unit/component tests only (jsdom). Does not affect `next build`; the JSX transform matches Next's automatic runtime.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./vitest.setup.ts'], include: ['src/**/*.test.{ts,tsx}'], css: false },
});
