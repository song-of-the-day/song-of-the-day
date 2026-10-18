import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // CSS is stubbed in tests; tokens.css is kept so tokens.test.ts can read it with `?raw`.
      css: { include: [/src\/styles\/tokens\.css/] },
      restoreMocks: true,
      unstubGlobals: true,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/**/*.d.ts'],
        reporter: ['text', 'html'],
        thresholds: {
          lines: 80,
          statements: 80,
          functions: 80,
          branches: 75,
        },
      },
    },
  }),
);
