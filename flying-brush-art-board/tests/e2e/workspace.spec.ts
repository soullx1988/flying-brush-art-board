import { expect, test } from './test.js'

test('starts the web page and local API together', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '无限画板' })).toBeVisible()

  const health = await request.get('http://localhost:8787/health')
  expect(health.ok()).toBe(true)
  expect(await health.json()).toEqual({ status: 'ok', database: 'ok', userDirectory: 'ok', realtime: 'ok' })
})
