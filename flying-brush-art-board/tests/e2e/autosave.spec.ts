import { expect, test } from './test.js'

test('autosaves an edited board after the 800ms browser debounce', async ({ page }) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const importBoardSession = new Function(
      'return import("/src/features/boards/board-session.ts")',
    ) as () => Promise<{
      BoardSession: new (options: unknown) => {
        mount(tabId: string, boardId: string, editor: unknown): Promise<void>
      }
    }>
    const { BoardSession } = await importBoardSession()
    const saves: Array<{ boardId: string; expectedRevision: number; snapshot: unknown }> = []
    const listeners = new Set<() => void>()
    let snapshot: unknown = { shapes: [] }
    const editor = {
      getSnapshot: () => snapshot,
      loadSnapshot: (nextSnapshot: unknown) => {
        snapshot = nextSnapshot
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    const session = new BoardSession({
      api: {
        loadBoard: async () => ({ snapshot: { shapes: [] }, revision: 6 }),
        saveSnapshot: async (
          boardId: string,
          expectedRevision: number,
          nextSnapshot: unknown,
        ) => {
          saves.push({ boardId, expectedRevision, snapshot: nextSnapshot })
          return { snapshot: nextSnapshot, revision: expectedRevision + 1 }
        },
      },
    })
    await session.mount('tab-browser', 'board-browser', editor)
    snapshot = { shapes: [{ id: 'shape:browser-edit' }] }
    for (const listener of listeners) listener()

    await new Promise((resolve) => setTimeout(resolve, 760))
    const savesBeforeDebounce = saves.length
    await new Promise((resolve) => setTimeout(resolve, 100))
    return { savesBeforeDebounce, saves }
  })

  expect(result.savesBeforeDebounce).toBe(0)
  expect(result.saves).toEqual([
    {
      boardId: 'board-browser',
      expectedRevision: 6,
      snapshot: { shapes: [{ id: 'shape:browser-edit' }] },
    },
  ])
})
