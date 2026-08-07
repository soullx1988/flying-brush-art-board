import { createReferenceGraphProjectFixture } from '../../../test-fixtures/src/iboard/reference-graph-project.js'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import {
  decodeIboard,
  encodeIboardJson,
  exportProjectToIboard,
  inspectIboard,
  writeIboardArchive,
} from '../index.js'

function validArchive(): Uint8Array {
  return exportProjectToIboard(structuredClone(createReferenceGraphProjectFixture()))
}

function withManifestMutation(mutate: (manifest: Record<string, unknown>) => void): Uint8Array {
  const entries = unzipSync(validArchive())
  const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json'])) as Record<string, unknown>
  mutate(manifest)
  entries['manifest.json'] = Uint8Array.from(encodeIboardJson(manifest))
  return writeIboardArchive(Object.entries(entries).map(([path, bytes]) => ({ path, bytes })))
}

describe('inspectIboard', () => {
  it('summarizes a compatible v1 archive without exposing decoded asset bytes', () => {
    const inspection = inspectIboard(validArchive())

    expect(inspection).toEqual({
      compatible: true,
      formatVersion: 1,
      sourceProject: {
        id: 'project-source',
        title: 'Reference graph fixture',
        rootBoardId: 'board-a',
      },
      boardCount: 4,
      referenceCount: 6,
      maxEmbedDepth: 3,
      assetCount: 1,
      assetBytes: 8,
      issues: [],
    })
    expect(JSON.stringify(inspection)).not.toContain('137,80,78,71')
  })

  it('returns an actionable compatibility issue instead of throwing', () => {
    const inspection = inspectIboard(withManifestMutation((manifest) => {
      manifest.formatVersion = 2
    }))

    expect(inspection.compatible).toBe(false)
    expect(inspection.issues).toEqual([
      expect.objectContaining({
        code: 'IBOARD_FORMAT_VERSION_UNSUPPORTED',
        message: expect.stringContaining('v1'),
        action: expect.stringContaining('v1'),
      }),
    ])
  })
})

describe('decodeIboard', () => {
  it('returns an isolated, fully validated project graph', () => {
    const decoded = decodeIboard(validArchive())
    const firstByte = decoded.assets[0]!.bytes[0]

    decoded.assets[0]!.bytes[0] = 0
    const decodedAgain = decodeIboard(validArchive())

    expect(decoded.manifest.rootBoardId).toBe('board-a')
    expect(decoded.boards).toHaveLength(4)
    expect(decoded.references).toHaveLength(6)
    expect(decodedAgain.assets[0]!.bytes[0]).toBe(firstByte)
  })

  it('does not migrate unpublished prototype versions', () => {
    const unsupported = withManifestMutation((manifest) => {
      manifest.formatVersion = 0
    })

    expect(() => decodeIboard(unsupported)).toThrow('IBOARD_FORMAT_VERSION_UNSUPPORTED')
  })
})
