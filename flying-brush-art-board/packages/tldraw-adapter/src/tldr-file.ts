import {
  parseTldrawJsonFile,
  type TLEditorSnapshot,
} from 'tldraw'

import { migrateTldrawRecords } from './migrations.js'
import { createBoardStore } from './store.js'

export function decodeTldrFile(bytes: Uint8Array): TLEditorSnapshot {
  let file: { records?: unknown[] }
  try {
    file = JSON.parse(new TextDecoder().decode(bytes)) as { records?: unknown[] }
  } catch {
    throw new Error('Invalid .tldr file JSON')
  }

  if (!Array.isArray(file.records)) throw new Error('Invalid .tldr file records')

  const migratedFile = {
    ...file,
    records: migrateTldrawRecords(file.records),
  }
  const store = createBoardStore()
  const parsed = parseTldrawJsonFile({
    schema: store.schema,
    json: JSON.stringify(migratedFile),
  })
  if (!parsed.ok) {
    const cause = 'cause' in parsed.error ? parsed.error.cause : undefined
    const details = cause instanceof Error ? ` (${cause.message})` : ''
    throw new Error(`Unable to migrate .tldr file: ${parsed.error.type}${details}`)
  }

  // A parsed file carries document state only. Session state is deliberately
  // empty so opening it cannot import another board's camera or selection.
  return {
    document: parsed.value.getStoreSnapshot(),
    session: {} as TLEditorSnapshot['session'],
  }
}
