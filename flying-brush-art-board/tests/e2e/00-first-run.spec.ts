import { expect, test } from './test.js'

const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:8787'

test('guides a first browser visit into the generated five-board trading workspace', async ({ page, request }) => {
  const before = await request.get(`${API_BASE}/api/projects`)
  expect(before.ok()).toBe(true)
  expect(await before.json()).toEqual([])

  const bootstrapped = page.waitForResponse((response) => (
    response.url().endsWith('/api/bootstrap/personal-trading-workspace')
      && response.request().method() === 'PUT'
  ))
  await page.goto('/')
  const bootstrapResponse = await bootstrapped
  expect(bootstrapResponse.ok()).toBe(true)
  const workspace = await bootstrapResponse.json() as {
    status: 'created' | 'existing' | 'retired'
    project?: { id: string; rootBoardId: string }
    rootBoard?: { id: string }
    boards?: Array<{ id: string; title: string }>
  }
  expect(workspace.status).toBe('created')
  expect(workspace.project).toBeDefined()
  expect(workspace.rootBoard).toBeDefined()
  expect(workspace.boards?.map((board) => board.title)).toEqual([
    '\u603b\u89c8', '\u4eca\u5929\u600e\u4e48\u770b', '\u6570\u636e', '\u903b\u8f91', '\u7ecf\u9a8c', '\u5fc3\u6001',
  ])

  await expect(page).toHaveURL(
    `/projects/${workspace.project!.id}/boards/${workspace.rootBoard!.id}`,
  )
  await expect(page.getByRole('heading', { name: '\u603b\u89c8' })).toBeVisible()
  await expect(page.getByLabel('\u767d\u677f\u753b\u5e03')).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor?.getCurrentPageShapes().filter((shape: { type: string }) => (
      shape.type === 'board-reference'
    )).map((shape: { props: { titleFallback: string } }) => shape.props.titleFallback).sort()
  })).toEqual(['\u4eca\u5929\u600e\u4e48\u770b', '\u5fc3\u6001', '\u6570\u636e', '\u7ecf\u9a8c', '\u903b\u8f91'].sort())

  const persisted = await request.get(
    `${API_BASE}/api/projects/${encodeURIComponent(workspace.project!.id)}`,
  )
  expect(persisted.ok()).toBe(true)
  expect((await persisted.json() as { boards: unknown[] }).boards).toHaveLength(6)
})
