import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'

import {
  assertBoardReferenceGraphValid,
  type BoardReferenceRecord,
  type StoredBoard,
} from '../../packages/board-core/src/index.js'
import {
  exportProjectToIboard,
  importDrawio,
  importTldr,
  preflightIboardEntries,
  readIboardArchive,
  sanitizeSvg,
} from '../../packages/interop/src/index.js'
import { createReferenceGraphProjectFixture } from '../../packages/test-fixtures/src/iboard/reference-graph-project.js'
import {
  createBoardReferenceShape,
  downgradeClipboardReferenceRecords,
} from '../../packages/tldraw-adapter/src/index.js'
import { boardClipboardPayloadSchema } from '../../apps/local-api/src/modules/clipboard/clipboard-command-routes.js'
import {
  importVisualFile,
  type VisualImportDependencies,
} from '../../apps/web/src/features/import-export/visual-import.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const timestamp = '2026-07-23T00:00:00.000Z'

function jsonEntry(entries: Record<string, Uint8Array>, path: string): any {
  const bytes = entries[path]
  if (!bytes) throw new Error(`Missing archive entry: ${path}`)
  return JSON.parse(decoder.decode(bytes))
}

function mutateReferences(
  mutate: (references: Array<Record<string, any>>) => void,
): Record<string, Uint8Array> {
  const entries = unzipSync(exportProjectToIboard(createReferenceGraphProjectFixture()))
  const references = jsonEntry(entries, 'references.json') as Array<Record<string, any>>
  mutate(references)
  entries['references.json'] = encoder.encode(JSON.stringify(references))
  return entries
}

function board(id: string, projectId = 'project-graph'): StoredBoard {
  return {
    id,
    projectId,
    title: id,
    revision: 0,
    tldrawSnapshot: { store: {} },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function reference(
  id: string,
  sourceBoardId: string,
  targetBoardId: string,
  kind: 'embed' | 'link',
  projectId = 'project-graph',
): BoardReferenceRecord {
  return {
    id,
    projectId,
    sourceBoardId,
    targetBoardId,
    shapeId: `shape:${id}`,
    kind,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function visualDependencies(): VisualImportDependencies {
  return {
    uploadAsset: vi.fn(async () => ({
      sha256: 'a'.repeat(64),
      mime: 'image/png' as const,
      size: 1,
    })),
    createBoardWithVisuals: vi.fn(async () => ({ boardId: 'created', revision: 1, snapshot: {} })),
    pasteVisuals: vi.fn(async () => ({ boardId: 'target', revision: 1, snapshot: {} })),
  }
}

function walkFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? walkFiles(path) : [path]
  })
}

describe('untrusted archive and XML inputs', () => {
  it('rejects ZIP traversal names and compressed archives over declared expansion limits', () => {
    const traversal = zipSync({ '../escape.json': encoder.encode('{}') })
    const compressed = zipSync({ 'boards/large.json': new Uint8Array(4_096) }, { level: 9 })

    expect(() => readIboardArchive(traversal)).toThrow('IBOARD_ARCHIVE_PATH_UNSAFE')
    expect(() => readIboardArchive(compressed, { maxUncompressedBytes: 1_024 })).toThrow(
      'IBOARD_ARCHIVE_SIZE_LIMIT_EXCEEDED',
    )
  })

  it('rejects external XML entities and strips active or remote SVG content', () => {
    const externalEntity = `<!DOCTYPE mxfile [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
      <mxfile><diagram><mxGraphModel><root><mxCell id="0" value="&xxe;"/></root></mxGraphModel></diagram></mxfile>`
    expect(() => importDrawio(externalEntity)).toThrow(
      expect.objectContaining({ code: 'DRAWIO_UNSAFE_XML' }),
    )

    const sanitized = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
      <script>alert(1)</script><foreignObject>unsafe</foreignObject>
      <image href="https://attacker.invalid/pixel.png"/>
      <rect width="20" height="20" fill="url(javascript:alert(1))"/>
    </svg>`).svg
    expect(sanitized).not.toMatch(/script|foreignObject|onload|attacker\.invalid|javascript:/i)
  })

  it('rejects over-limit raster dimensions and malformed active-content PDFs before persistence', async () => {
    const oversizedDependencies = visualDependencies()
    await expect(importVisualFile({
      file: new File(
        [pngHeader(16_385, 100).buffer as ArrayBuffer],
        'oversized.png',
        { type: 'image/png' },
      ),
      target: { kind: 'new-board', projectId: 'project-1' },
    }, oversizedDependencies)).rejects.toThrow('VISUAL_DIMENSION_LIMIT_EXCEEDED')
    expect(oversizedDependencies.uploadAsset).not.toHaveBeenCalled()

    const pdfDependencies = visualDependencies()
    const maliciousPdf = `%PDF-1.7
      1 0 obj << /Type /Catalog /OpenAction 2 0 R >> endobj
      2 0 obj << /S /JavaScript /JS (app.launchURL('https://attacker.invalid')) >> endobj
      %%EOF`
    await expect(importVisualFile({
      file: new File([maliciousPdf], 'active-content.pdf', { type: 'application/pdf' }),
      target: { kind: 'new-board', projectId: 'project-1' },
    }, pdfDependencies)).rejects.toThrow()
    expect(pdfDependencies.uploadAsset).not.toHaveBeenCalled()
    expect(pdfDependencies.createBoardWithVisuals).not.toHaveBeenCalled()
  })
})

describe('tampered .iboard reference graphs', () => {
  it.each([
    ['dangling target', (references: Array<Record<string, any>>) => {
      references[0]!.targetBoardId = 'board-missing'
    }, 'BOARD_REFERENCE_TARGET_NOT_FOUND'],
    ['cross-project edge', (references: Array<Record<string, any>>) => {
      references[0]!.projectId = 'project-other'
    }, 'BOARD_REFERENCE_CROSS_PROJECT'],
    ['duplicate reference id', (references: Array<Record<string, any>>) => {
      references[1]!.id = references[0]!.id
    }, 'BOARD_REFERENCE_DUPLICATE_ID'],
    ['duplicate source shape', (references: Array<Record<string, any>>) => {
      const sameSource = references.filter((item) => item.sourceBoardId === 'board-a')
      sameSource[1]!.shapeId = sameSource[0]!.shapeId
    }, 'BOARD_REFERENCE_DUPLICATE_SHAPE'],
    ['embed cycle', (references: Array<Record<string, any>>) => {
      const backEdge = references.find((item) => item.id === 'ref-d-a-link')!
      backEdge.kind = 'embed'
    }, 'EMBED_CYCLE'],
    ['reference/Shape mismatch', (references: Array<Record<string, any>>) => {
      const link = references.find((item) => item.id === 'ref-d-a-link')!
      link.targetBoardId = 'board-b'
    }, 'BOARD_REFERENCE_SEMANTICS_MISMATCH'],
  ])('rejects %s in references.json', (_label, mutate, code) => {
    expect(() => preflightIboardEntries(mutateReferences(mutate))).toThrow(code)
  })

  it('rejects an eleventh embed level but permits duplicate, self, and cyclic link routes', () => {
    const boards = Array.from({ length: 11 }, (_, index) => board(`board-${index + 1}`))
    const tooDeep = Array.from({ length: 10 }, (_, index) =>
      reference(`embed-${index + 1}`, boards[index]!.id, boards[index + 1]!.id, 'embed'))
    expect(() => assertBoardReferenceGraphValid(boards, tooDeep)).toThrow(
      'EMBED_DEPTH_LIMIT_EXCEEDED',
    )

    const linkBoards = [board('A'), board('B')]
    const links = [
      reference('link-a-b-1', 'A', 'B', 'link'),
      reference('link-a-b-2', 'A', 'B', 'link'),
      reference('link-a-a', 'A', 'A', 'link'),
      reference('link-b-a', 'B', 'A', 'link'),
    ]
    expect(() => assertBoardReferenceGraphValid(linkBoards, links)).not.toThrow()
  })
})

describe('untrusted .tldr and clipboard JSON', () => {
  it('rejects malformed .tldr records and clipboard envelopes through explicit schemas', () => {
    const malformedTldr = encoder.encode(JSON.stringify({
      tldrawFileFormatVersion: 1,
      schema: {},
      records: 'not-an-array',
    }))
    expect(() => importTldr(malformedTldr)).toThrow(
      expect.objectContaining({ code: 'TLDR_SCHEMA_UNSUPPORTED' }),
    )

    const malformedClipboard = boardClipboardPayloadSchema.safeParse({
      version: 1,
      sourceProjectId: 'project-1',
      sourceBoardId: 'board-1',
      shapes: [{ typeName: 'shape' }],
      bindings: [],
      references: [],
      assets: [],
      copiedAt: timestamp,
      hiddenReferenceGraph: [{ targetBoardId: 'board-secret' }],
    })
    expect(malformedClipboard.success).toBe(false)
  })

  it('degrades cross-project reference cards without executable URLs or recoverable fields', () => {
    const copied = reference('copied', 'source', 'target', 'embed', 'project-other')
    const snapshot = {
      store: {
        [copied.shapeId]: createBoardReferenceShape(copied, 'External target'),
      },
    }
    const next = downgradeClipboardReferenceRecords(snapshot, [{
      shapeId: copied.shapeId,
      referenceId: copied.id,
      targetBoardId: copied.targetBoardId,
      kind: copied.kind,
    }], copied.projectId) as {
      store: Record<string, { type: string; meta: Record<string, unknown>; props: Record<string, unknown> }>
    }
    const card = next.store[copied.shapeId]!

    expect(card.type).toBe('geo')
    expect(card.meta).toEqual({})
    expect(card.props.url).toBe('')
    expect(JSON.stringify(card)).not.toMatch(/referenceId|targetBoardId|project-other|\/projects\//)
  })
})

describe('credential containment', () => {
  it('keeps Feishu credentials out of browser sources, tracked local env files, and localStorage code', () => {
    // Scan authored browser source rather than generated dist bundles. Minified
    // bundles put unrelated localStorage and token strings on one line, which
    // makes the containment regex report false positives after `pnpm build`.
    const webRoot = resolve('apps/web/src')
    const webSource = walkFiles(webRoot)
      .filter((path) => /\.(?:html|ts|tsx|js|jsx)$/.test(path))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
    expect(webSource).not.toMatch(/FEISHU_APP_(?:ID|SECRET)|FEISHU_REAL_SMOKE/)
    expect(webSource).not.toMatch(/localStorage[^\n]*(?:token|secret|credential)/i)

    const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split(/\r?\n/)
    expect(tracked).not.toContain('.env.local')
    expect(tracked.some((path) => /(?:^|\/)(?:oauth|token)[^/]*\.json$/i.test(path))).toBe(false)

    const ignore = readFileSync(resolve('.gitignore'), 'utf8')
    expect(ignore).toContain('.env.*')
    expect(ignore).toContain('*oauth*.json')
    expect(ignore).toContain('*token*.json')
  })
})
