import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  globalTeardown: './tests/e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:4173',
    channel: 'chrome',
    extraHTTPHeaders: {
      'x-infinite-board-automation': 'playwright-e2e',
    },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm dev:api:e2e',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm dev:web',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
