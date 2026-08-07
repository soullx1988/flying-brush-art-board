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
  it('waits for realtime room cleanup after deleting a non-root board', async () => {
    const database = createDatabase(':memory:')
    const app = Fastify()
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
})
