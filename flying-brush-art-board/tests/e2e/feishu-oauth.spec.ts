import { expect, test } from './test.js'

const API_BASE = 'http://localhost:8787'

test('completes the mock Feishu import OAuth lifecycle on isolated import routes', async ({ request }) => {
  await request.delete(`${API_BASE}/api/integrations/feishu/account`)
  const start = await request.get(`${API_BASE}/auth/feishu/import/start`, { maxRedirects: 0 })
  expect(start.status()).toBe(302)
  const authorizationUrl = start.headers().location
  expect(authorizationUrl).toBeTruthy()
  const state = new URL(authorizationUrl!).searchParams.get('state')
  expect(state).toBeTruthy()

  const callback = await request.get(`${API_BASE}/auth/feishu/import/callback`, {
    params: { state: state!, code: 'mock-authorized-code' },
  })
  expect(callback.ok()).toBe(true)
  await expect(callback.json()).resolves.toEqual({ connected: true, scopes: expect.any(Array) })

  const connected = await request.get(`${API_BASE}/api/integrations/feishu/status`)
  await expect(connected.json()).resolves.toEqual({ connected: true, scopes: expect.any(Array) })
  expect((await request.post(`${API_BASE}/api/integrations/feishu/refresh`)).ok()).toBe(true)
  expect((await request.delete(`${API_BASE}/api/integrations/feishu/account`)).status()).toBe(204)
  await expect((await request.get(`${API_BASE}/api/integrations/feishu/status`)).json()).resolves.toEqual({ connected: false })
})
