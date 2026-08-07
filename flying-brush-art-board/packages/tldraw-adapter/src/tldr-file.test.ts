import { describe, expect, it } from 'vitest'

import { createBoardStore } from './store.js'
import { getStoreSnapshot } from './snapshot.js'
import { decodeTldrFile } from './tldr-file.js'

describe('tldr file adapter', () => {
  it('migrates a 5.2.5 file and degrades board references into visual cards', () => {
    const store = createBoardStore()
    const file = {
      tldrawFileFormatVersion: 1,
      schema: store.schema.serialize(),
      records: [
        ...Object.values(getStoreSnapshot(store).store),
        {
          id: 'shape:reference',
          typeName: 'shape',
          type: 'board-reference',
          parentId: 'page:page',
          index: 'a1',
          x: 10,
          y: 20,
          props: { targetBoardId: 'board:target', referenceId: 'reference:source', kind: 'embed', label: 'Target' },
        },
      ],
    }

    const snapshot = decodeTldrFile(new TextEncoder().encode(JSON.stringify(file)))
    const records = Object.values(snapshot.document.store) as unknown as Array<Record<string, unknown>>
    const card = records.find((record) => record.id === 'shape:reference')

    expect(card).toMatchObject({ typeName: 'shape', type: 'geo', x: 10, y: 20 })
    expect(JSON.stringify(card)).not.toContain('targetBoardId')
    expect(JSON.stringify(card)).not.toContain('referenceId')
  })
})
