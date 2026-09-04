import type { FastifyInstance } from 'fastify'

import type { ApplicationEventHub } from '../../application/domain-event-publisher.js'
import type { BoardRepository } from '../boards/board-repository.js'
import type { ProjectRepository } from '../projects/project-repository.js'
import { canAccessBoard, canAccessProject } from '../../privacy/board-access-policy.js'

export function registerApplicationEventSocket(
  app: FastifyInstance,
  events: ApplicationEventHub,
  boards: BoardRepository,
  projects: ProjectRepository,
): void {
  app.get('/realtime/events', { websocket: true }, (socket, request) => {
    if (!request.user) {
      socket.close(4401, 'SESSION_EXPIRED')
      return
    }
    socket.send(JSON.stringify({ type: 'connected', createdAt: new Date().toISOString() }))
    const unsubscribe = events.subscribe((event) => {
      if (socket.readyState !== 1) return
      const actorOpenId = request.user!.openId
      if (event.actorOpenId !== actorOpenId) {
        if (event.boardId) {
          const board = boards.get(event.boardId)
          if (!board || !canAccessBoard(
            board,
            projects.get(board.projectId),
            actorOpenId,
            projects.isMember(board.projectId, actorOpenId),
          )) return
        } else if (event.projectId) {
          const project = projects.get(event.projectId)
          if (!project || !canAccessProject(project, actorOpenId, projects.isMember(project.id, actorOpenId))) return
        } else {
          return
        }
      }
      socket.send(JSON.stringify(event))
    })
    socket.on('close', unsubscribe)
    socket.on('error', unsubscribe)
  })
}
