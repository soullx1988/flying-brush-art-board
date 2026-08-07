import { expect, test, type APIRequestContext } from './test.js'

const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:8787'

async function seedBoards(request: APIRequestContext, suffix: string) {
  const projectId = `project-tabs-${suffix}`
  const boardIds = [`board-a-${suffix}`, `board-b-${suffix}`, `board-c-${suffix}`]
  const created = await request.post(`${API_BASE}/api/projects`, {
    data: {
      id: projectId,
      title: 'Tab Project',
      rootBoard: { id: boardIds[0], title: 'Overview' },
    },
  })
  expect(created.ok()).toBe(true)
  for (const [index, title] of ['Research', 'Archive'].entries()) {
    const response = await request.post(`${API_BASE}/api/projects/${projectId}/boards`, {
      data: { id: boardIds[index + 1], title },
    })
    expect(response.ok()).toBe(true)
  }
  return { projectId, boardIds }
}

test('keeps only open sessions in browser-style tabs and supports keyboard closing', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, boardIds } = await seedBoards(request, suffix)
  await page.goto(`/projects/${projectId}/boards/${boardIds[0]}`)
  await expect(page.getByRole('tab')).toHaveCount(1)

  await page.getByRole('button', { name: '全部画板', exact: true }).click()
  await expect(page.getByRole('listitem', { name: 'Research' })).toBeVisible()
  await page.getByRole('listitem', { name: 'Research' }).getByRole('button', { name: 'Research 更多操作' }).click()
  await page.getByRole('menuitem', { name: '在新标签打开' }).click()
  await expect(page.getByRole('listitem', { name: 'Research' })).toBeHidden()
  await page.getByRole('button', { name: '全部画板', exact: true }).click()
  await expect(page.getByRole('listitem', { name: 'Archive' })).toBeVisible()
  await page.getByRole('listitem', { name: 'Archive' }).getByRole('button', { name: 'Archive 更多操作' }).click()
  await page.getByRole('menuitem', { name: '在新标签打开' }).click()
  await expect(page.getByRole('tab')).toHaveCount(3)

  const tablist = page.getByRole('tablist', { name: '已打开画板' })
  await tablist.press('Control+Shift+Tab')
  await expect(page.getByRole('tab', { name: /Research/ })).toHaveAttribute('aria-selected', 'true')
  await tablist.press('Control+w')
  await expect(page.getByRole('tab')).toHaveCount(2)
  await tablist.press('Control+w')
  await expect(page.getByRole('tab')).toHaveCount(1)
  await tablist.press('Control+w')
  await expect(page.getByRole('tab')).toHaveCount(0)
  await expect(page).toHaveURL(`/projects/${projectId}`)
  await expect(page.getByRole('heading', { name: 'Tab Project' })).toBeVisible()
})
