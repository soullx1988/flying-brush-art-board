import { expect, test } from '@playwright/test'

test('Feishu login @collaboration-auth', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: '使用飞书登录' })).toBeVisible()
  await page.getByRole('link', { name: '使用飞书登录' }).click()
  await expect(page.getByTitle('E2E User')).toHaveText('E2E')
  await expect(page.getByRole('heading', { name: '无限画板' })).toBeVisible()
})
