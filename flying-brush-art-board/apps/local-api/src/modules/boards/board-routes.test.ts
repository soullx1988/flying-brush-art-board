import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import { createDatabase } from '../../db/schema.js'
import { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'
import { registerBoardRoutes } from './board-routes.js'
import { BoardRepository } from './board-repository.js'
import { BoardDeletionCoordinator } from '../realtime/board-deletion-coordinator.js'
import { BoardOperationQueue } from '../realtime/board-operation-queue.js'

describe('board routes', () => {
  it('returns a conflict instead of deleting a board that contains a protected core', async () => {
    const database = createDatabase(':memory:')
    const app = Fastify()
    app.addHook('onRequest', async (request) => {
      request.user = { openId: 'local-acceptance-user', name: 'Local acceptance user' }
    })
    try {
      database.exec(
        "INSERT INTO projects VALUES ('p','P','b-root',1,'t','t');"
        + " INSERT INTO boards VALUES ('b-root','p','Root','{}',NULL,0,'t','t')",
      )
      const projects = new ProjectRepository(database)
      const boards = new BoardRepository(database)
      const references = new BoardReferenceRepository(database)
      const protectedRecord = {
        id: 'shape:today-core',
        typeName: 'shape',
        type: 'trading-panel',
        parentId: 'page:page',
        opacity: 1,
        meta: { protectedCore: true, template: 'shortline-trading-v1', templateRole: 'today-core' },
        props: { panelKind: 'today-overview' },
      }
      boards.createTemplate({
        id: 'b-protected',
        projectId: 'p',
        title: 'Protected',
        tldrawSnapshot: { store: { [protectedRecord.id]: protectedRecord } },
        revision: 0,
        createdAt: 't',
        updatedAt: 't',
      })
      const closeRoom = vi.fn(async () => {})
      const deletions = new BoardDeletionCoordinator(new BoardOperationQueue(), {
        closeBoardWithinQueue: closeRoom,
      })
      registerBoardRoutes(app, projects, boards, references, undefined, undefined, deletions)

      const response = await app.inject({ method: 'DELETE', url: '/api/boards/b-protected' })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({
        code: 'PROTECTED_CORE_MUTATION_FORBIDDEN',
        recordId: protectedRecord.id,
        reason: 'board-delete',
      })
      expect(closeRoom).not.toHaveBeenCalled()
      expect(boards.get('b-protected')).toBeDefined()
    } finally {
      await app.close()
      database.close()
    }
  })

  it('waits for realtime room cleanup after deleting a non-root board', async () => {
    const database = createDatabase(':memory:')
    const app = Fastify()
    app.addHook('onRequest', async (request) => {
      request.user = { openId: 'local-acceptance-user', name: 'Local acceptance user' }
    })
    try {
      database.exec(
        "INSERT INTO projects VALUES ('p','P','b-root',1,'t','t');"
        + " INSERT INTO boards VALUES ('b-root','p','Root','{}',NULL,0,'t','t');"
        + " INSERT INTO boards VALUES ('b-delete','p','Delete me','{}',NULL,0,'t','t')",
      )
      const projects = new ProjectRepository(database)
      const boards = new BoardRepository(database)
      const references = new BoardReferenceRepository(database)
      const closeRoom = vi.fn(async () => {
        expect(boards.get('b-delete')).toBeUndefined()
      })
      const deletions = new BoardDeletionCoordinator(new BoardOperationQueue(), {
        closeBoardWithinQueue: closeRoom,
      })
      registerBoardRoutes(app, projects, boards, references, undefined, undefined, deletions)

      const response = await app.inject({ method: 'DELETE', url: '/api/boards/b-delete' })

      expect(response.statusCode).toBe(204)
      expect(closeRoom).toHaveBeenCalledOnce()
      expect(closeRoom).toHaveBeenCalledWith('b-delete')
      expect(boards.get('b-delete')).toBeUndefined()
    } finally {
      await app.close()
      database.close()
    }
  })

  it('rejects a stale REST snapshot after a realtime snapshot advances the revision', async () => {
    const database = createDatabase(':memory:')
    const app = Fastify()
    app.addHook('onRequest', async (request) => {
      request.user = { openId: 'local-acceptance-user', name: 'Local acceptance user' }
    })
    try {
      database.exec("INSERT INTO projects VALUES ('p','P','b-cas',1,'t','t')")
      const projects = new ProjectRepository(database)
      const boards = new BoardRepository(database)
      const references = new BoardReferenceRepository(database)
      const initialSnapshot = {
        store: { 'document:document': { id: 'document:document', typeName: 'document', name: 'initial' } },
      }
      const realtimeSnapshot = {
        store: { 'document:document': { id: 'document:document', typeName: 'document', name: 'realtime' } },
      }
      const staleRestSnapshot = {
        store: { 'document:document': { id: 'document:document', typeName: 'document', name: 'stale-rest' } },
      }
      boards.create({
        id: 'b-cas',
        projectId: 'p',
        title: 'CAS board',
        tldrawSnapshot: initialSnapshot,
        revision: 0,
        createdAt: 't',
        updatedAt: 't',
      })
      registerBoardRoutes(app, projects, boards, references)

      const realtimeCommit = boards.saveRealtimeSnapshot('b-cas', realtimeSnapshot)
      expect(realtimeCommit.revision).toBe(1)

      const response = await app.inject({
        method: 'PUT',
        url: '/api/boards/b-cas/snapshot',
        payload: { expectedRevision: 0, snapshot: staleRestSnapshot },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ code: 'REVISION_CONFLICT', currentRevision: 1 })
      expect(boards.get('b-cas')).toMatchObject({
        revision: 1,
        tldrawSnapshot: realtimeSnapshot,
      })
    } finally {
      await app.close()
      database.close()
    }
  })
})
