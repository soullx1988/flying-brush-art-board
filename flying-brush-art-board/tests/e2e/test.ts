import {
  expect,
  test as base,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:8787'

/**
 * The E2E server provides a local OAuth provider.  Keep the production auth
 * boundary intact by acquiring a real (mock-provider) session before a test
 * calls protected endpoints, rather than adding an anonymous test bypass.
 */
export async function ensureApiLogin(request: APIRequestContext): Promise<void> {
  const existingSession = await request.get(`${API_BASE}/api/me`)
  if (existingSession.ok()) return

  const start = await request.get(`${API_BASE}/auth/feishu/start?returnTo=/`, {
    maxRedirects: 0,
  })
  const callback = start.headers().location
  if (start.status() !== 302 || !callback) {
    throw new Error(`Mock OAuth start failed: ${start.status()}`)
  }
  const callbackUrl = new URL(callback)
  const apiBase = new URL(API_BASE)
  callbackUrl.protocol = apiBase.protocol
  callbackUrl.hostname = apiBase.hostname
  callbackUrl.port = apiBase.port
  const completed = await request.get(callbackUrl.toString(), { maxRedirects: 0 })
  if (completed.status() !== 302) throw new Error(`Mock OAuth callback failed: ${completed.status()}`)

  const me = await request.get(`${API_BASE}/api/me`)
  if (!me.ok()) throw new Error(`Mock OAuth session was not retained: ${me.status()}`)
}

export async function loginPage(page: Page): Promise<void> {
  await ensureApiLogin(page.context().request)
}

export const test = base.extend({
  request: async ({ request }, use) => {
    await ensureApiLogin(request)
    await use(request)
  },
  page: async ({ page }, use) => {
    await loginPage(page)
    await use(page)
  },
})

export { expect }
export type { APIRequestContext, Page }
