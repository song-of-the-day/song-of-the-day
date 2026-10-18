import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);

/**
 * End-to-end tests run against an already running stack: the Vite dev server (default) or the
 * nginx compose stack in CI (`E2E_BASE_URL=http://localhost:8080`).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    timezoneId: 'America/Toronto',
    locale: 'en-CA',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(isCI
      ? []
      : [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]),
  ],
});
