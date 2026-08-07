import { describe, expect, it } from 'vitest'

import {
  clipboardCommandReceiptSchema,
  clipboardMaterializedPatchSchema,
  clipboardPasteRequestSchema,
  clipboardReplayRequestSchema,
} from './clipboard-contracts.js'

describe('clipboard contracts', () => {
  it('requires a nonnegative expected revision and application session for paste and replay requests', () => {
    expect(clipboardPasteRequestSchema.safeParse({ payload: {}, placement: { x: 1, y: 2 } }).success).toBe(false)
    expect(clipboardPasteRequestSchema.safeParse({ payload: {}, expectedRevision: -1, placement: { viewportCenter: true } }).success).toBe(false)
    expect(clipboardReplayRequestSchema.safeParse({ expectedRevision: 0 }).success).toBe(false)
    expect(clipboardReplayRequestSchema.safeParse({ expectedRevision: 0, sessionId: 'session:one' }).success).toBe(true)
    expect(clipboardReplayRequestSchema.safeParse({ expectedRevision: 1.5 }).success).toBe(false)
    expect(
      clipboardPasteRequestSchema.safeParse({
        payload: { adapterWillParseThisLater: true },
        expectedRevision: 0,
        sessionId: 'session:one',
        placement: { viewportCenter: true },
      }).success,
    ).toBe(true)
  })

  it('validates materialized command fields without parsing the clipboard payload', () => {
    expect(
      clipboardMaterializedPatchSchema.safeParse({
        nextSnapshot: { arbitrary: 'adapter-owned' },
        idMap: { source: 'target' },
        assetBlobs: [{ sha256: 'a'.repeat(64), mime: 'image/png', size: 1, bytes: new Uint8Array([1]) }],
        assetUsages: [{ shapeId: 'shape:1', assetRecordId: 'asset:1', sha256: 'a'.repeat(64) }],
        referenceCandidates: [],
      }).success,
    ).toBe(true)
    expect(
      clipboardMaterializedPatchSchema.safeParse({
        nextSnapshot: {},
        idMap: {},
        assetBlobs: [],
        assetUsages: [],
        referenceCandidates: [],
        payload: { version: 'not parsed here' },
      }).success,
    ).toBe(false)
  })

  it('exports the authoritative command receipt response contract', () => {
    expect(
      clipboardCommandReceiptSchema.safeParse({
        commandId: 'command:1',
        boardId: 'board:1',
        revision: 1,
        snapshot: {},
        idMap: {},
        createdReferenceIds: [],
      }).success,
    ).toBe(true)
  })
})
