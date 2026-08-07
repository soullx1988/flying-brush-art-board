import { defineConfig } from '@playwright/test'

const apiPort = 8877
const webPort = 4273
const apiOrigin = `http://127.0.0.1:${apiPort}`
const apiBase = `http://localhost:${apiPort}`
const webOrigin = `http://localhost:${webPort}`
const runId = process.env.DESTRUCTIVE_RUN_ID ?? `destructive-${Date.now()}-${process.pid}`
process.env.E2E_API_BASE = apiBase
process.env.DESTRUCTIVE_RUN_ID = runId
process.env.E2E_SHUTDOWN_TOKEN = runId

export default defineConfig({
  testDir: './tests/e2e',
  globalTeardown: './tests/e2e/destructive-global-teardown.ts',
  testMatch: [
    'autosave.spec.ts',
    'board-reference-navigation.spec.ts',
    'board-tabs.spec.ts',
    'comments-audit.spec.ts',
    'destructive-canvas.spec.ts',
    'full-regression.spec.ts',
    'realtime-collaboration.spec.ts',
  ],
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: webOrigin,
    channel: 'chrome',
    locale: 'zh-CN',
    extraHTTPHeaders: {
      'x-infinite-board-automation': runId,
    },
    trace: 'on',
  },
  webServer: [
    {
      command: 'pnpm dev:api:e2e',
      url: `${apiOrigin}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        E2E_API_PORT: String(apiPort),
        E2E_RUN_ID: runId,
        E2E_SHUTDOWN_TOKEN: runId,
        E2E_WEB_ORIGIN: webOrigin,
      },
    },
    {
      command: 'pnpm dev:web',
      url: webOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_DEV_PORT: String(webPort),
        VITE_DEV_API_ORIGIN: apiOrigin,
      },
    },
  ],
})
