import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../app.js'
import { createDatabase, type LocalDatabase } from '../../db/schema.js'

describe('PDF export routes', () => {
  let database: LocalDatabase
  let assetDirectory: string
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    database = createDatabase(':memory:')
    assetDirectory = mkdtempSync(join(tmpdir(), 'infinite-board-pdf-routes-'))
    app = await buildApp({ database, assetDirectory })
    await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        id: 'project-pdf',
        title: 'PDF project',
        rootBoard: { id: 'board-root', title: 'Root board' },
      },
    })
    await app.inject({
      method: 'POST',
      url: '/api/projects/project-pdf/boards',
      payload: { id: 'board-child', title: 'Child board', tldrawSnapshot: { store: {} } },
    })
  })

  afterEach(async () => {
    await app.close()
    database.close()
    rmSync(assetDirectory, { recursive: true, force: true })
  })

  it('exports one Board as one page and a project as exactly its Board count', async () => {
    const boardResponse = await app.inject({ method: 'POST', url: '/api/boards/board-root/export.pdf' })
    const projectResponse = await app.inject({ method: 'POST', url: '/api/projects/project-pdf/export.pdf' })

    expect(boardResponse.statusCode).toBe(200)
    expect(boardResponse.headers['content-type']).toBe('application/pdf')
    expect((await getDocument({ data: new Uint8Array(boardResponse.rawPayload) }).promise).numPages).toBe(1)
    expect(projectResponse.statusCode).toBe(200)
    expect(projectResponse.headers['content-disposition']).toContain("filename*=UTF-8''")
    expect((await getDocument({ data: new Uint8Array(projectResponse.rawPayload) }).promise).numPages).toBe(2)
  })

  it('returns explicit missing-resource errors without a partial PDF body', async () => {
    const missingBoard = await app.inject({ method: 'POST', url: '/api/boards/missing/export.pdf' })
    const missingProject = await app.inject({ method: 'POST', url: '/api/projects/missing/export.pdf' })

    expect(missingBoard.statusCode).toBe(404)
    expect(missingBoard.json()).toEqual({ code: 'BOARD_NOT_FOUND' })
    expect(missingProject.statusCode).toBe(404)
    expect(missingProject.json()).toEqual({ code: 'PROJECT_NOT_FOUND' })
  })
})
