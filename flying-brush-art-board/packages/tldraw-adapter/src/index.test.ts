import { describe, expect, it } from 'vitest'

import * as adapter from './index.js'

describe('tldraw adapter package entrypoint', () => {
  it('exports every Task 7 adapter API from the package barrel', () => {
    expect(adapter).toMatchObject({
      TLDRAW_ADAPTER_PACKAGE: '@infinite-board/tldraw-adapter',
      createBoardStore: expect.any(Function),
      getTldrawLicenseKey: expect.any(Function),
      loadSnapshotIntoStore: expect.any(Function),
      getStoreSnapshot: expect.any(Function),
      decodeTldrFile: expect.any(Function),
      migrateTldrawRecords: expect.any(Function),
      degradeBoardReferenceToVisualCard: expect.any(Function),
      collectClipboardPayload: expect.any(Function),
      materializeClipboardPayload: expect.any(Function),
    })
  })
})
