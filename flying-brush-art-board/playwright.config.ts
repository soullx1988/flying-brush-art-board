import { defineConfig } from '@playwright/test'

const apiPort = 8787
const webPort = 4173
const apiOrigin = `http://127.0.0.1:${apiPort}`
const apiBase = `http://localhost:${apiPort}`
const webOrigin = `http://localhost:${webPort}`
const runId = process.env.E2E_RUN_ID ?? `standard-${Date.now()}-${process.pid}`
const inheritedEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
)
process.env.E2E_API_BASE = apiBase
process.env.E2E_RUN_ID = runId
process.env.E2E_SHUTDOWN_TOKEN = runId

export default defineConfig({
  testDir: './tests/e2e',
  globalTeardown: './tests/e2e/destructive-global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: webOrigin,
    channel: 'chrome',
    extraHTTPHeaders: {
      'x-infinite-board-automation': runId,
    },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm dev:api:e2e',
      url: `${apiOrigin}/health`,
      // Never attach a test run to a developer's real local API/database.
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...inheritedEnv,
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
        ...inheritedEnv,
        VITE_DEV_PORT: String(webPort),
        VITE_DEV_API_ORIGIN: apiOrigin,
      },
    },
  ],
})
