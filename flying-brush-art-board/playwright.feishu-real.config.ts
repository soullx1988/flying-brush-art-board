import { defineConfig } from '@playwright/test'

// Real Feishu acceptance must point at an already-running, explicitly
// authorized local stack. It intentionally starts neither start-e2e-api.ts nor
// any mock provider. Set FEISHU_REAL_STORAGE_STATE when that stack requires an
// authenticated browser session.
const webOrigin = process.env.FEISHU_REAL_WEB_ORIGIN ?? 'http://localhost:4173'
const apiBase = process.env.FEISHU_REAL_API_BASE ?? 'http://localhost:8787'
process.env.E2E_API_BASE = apiBase

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['feishu-import.real.spec.ts'],
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: webOrigin,
    channel: 'chrome',
    locale: 'zh-CN',
    ...(process.env.FEISHU_REAL_STORAGE_STATE
      ? { storageState: process.env.FEISHU_REAL_STORAGE_STATE }
      : {}),
    trace: 'retain-on-failure',
  },
})
