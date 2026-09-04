import websocket from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'

import {
  UnknownSnapshotRecordError,
  assertBoardReferenceSemanticsUnchanged,
  createBoardStore,
} from '@infinite-board/tldraw-adapter'

import type { BoardRepository } from '../boards/board-repository.js'
import type { LocalDatabase } from '../../db/schema.js'
import { RealtimeRoomManager } from './realtime-room-manager.js'
import { RealtimeRoomRepository } from './realtime-room-repository.js'
import { tldrawRealtimeRoomFactory } from './tldraw-realtime-room-factory.js'
import { BoardOperationQueue } from './board-operation-queue.js'
import type { ProjectRepository } from '../projects/project-repository.js'
import {
  boardAccessLevel,
  boardSnapshotAccessForActor,
  canAccessBoard,
} from '../../privacy/board-access-policy.js'

const BOARD_RECORD_TYPES = new Set(['document', 'page', 'shape', 'asset', 'binding'])

export interface RealtimeConnectionClose {
  code: number
  reason: string
}

export function realtimeConnectionCloseForError(error: unknown): RealtimeConnectionClose {
  if (error instanceof UnknownSnapshotRecordError) {
    return { code: 4409, reason: 'BOARD_SNAPSHOT_UNSUPPORTED' }
  }
  if (error instanceof Error && error.message === 'BOARD_NOT_FOUND') {
    return { code: 4404, reason: 'BOARD_NOT_FOUND' }
  }
  return { code: 1011, reason: 'REALTIME_INITIALIZATION_FAILED' }
}

/** Converts sync-core's durable room format back to the Board REST snapshot format. */
export function roomSnapshotToBoardSnapshot(snapshot: unknown): unknown {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray((snapshot as { documents?: unknown }).documents)) {
    return snapshot
  }
  const room = snapshot as {
    documents: Array<{ state?: { id?: unknown; typeName?: unknown } }>
  }
  const store: Record<string, unknown> = {}
  for (const document of room.documents) {
    const state = document.state
    if (!state || typeof state.id !== 'string' || !BOARD_RECORD_TYPES.has(String(state.typeName))) continue
    store[state.id] = state
  }
  // Keep a tldraw store schema, but omit sync-core clocks, tombstones and
  // presence. This makes the Board projection independently reloadable.
  return { store, schema: createBoardStore().schema.serialize() }
}

export function createRealtimeRoomManager(database: LocalDatabase, boards: BoardRepository, operationQueue = new BoardOperationQueue()): RealtimeRoomManager {
  return new RealtimeRoomManager(
    new RealtimeRoomRepository(database),
    tldrawRealtimeRoomFactory,
    (boardId) => Boolean(boards.get(boardId)),
    500,
    (boardId) => boards.get(boardId)?.tldrawSnapshot,
    (boardId, roomSnapshot) => {
      return boards.saveRealtimeSnapshot(boardId, roomSnapshotToBoardSnapshot(roomSnapshot)).revision
    },
    (boardId, roomSnapshot) => {
      const current = boards.get(boardId)
      if (!current) throw new Error('BOARD_NOT_FOUND')
      assertBoardReferenceSemanticsUnchanged(
        current.tldrawSnapshot,
        roomSnapshotToBoardSnapshot(roomSnapshot),
      )
    },
    operationQueue,
    (boardId, snapshot) => {
      const board = boards.get(boardId)
      if (!board || boardAccessLevel(board) !== 'project') return false
      return boardSnapshotAccessForActor(
        { ...board, tldrawSnapshot: snapshot },
        boards.listByProject(board.projectId),
        undefined,
      ) === 'projected'
    },
    (boardId) => boards.get(boardId)?.revision,
  )
}

export async function registerRealtimeRoutes(
  app: FastifyInstance,
  manager: RealtimeRoomManager,
  boards: BoardRepository,
  projects: ProjectRepository,
): Promise<void> {
  await app.register(websocket)
  const idleRoomSweep = setInterval(() => { void manager.closeIdleRooms() }, 60_000)
  idleRoomSweep.unref?.()
  app.get<{ Params: { boardId: string } }>('/realtime/boards/:boardId', { websocket: true }, (socket, request) => {
    if (!request.user) {
      socket.close(4401, 'SESSION_EXPIRED')
      return
    }
    const board = boards.get(request.params.boardId)
    if (!board) {
      socket.close(4404, 'BOARD_NOT_FOUND')
      return
    }
    if (!canAccessBoard(board, projects.get(board.projectId), request.user.openId, projects.isMember(board.projectId, request.user.openId))) {
      socket.close(4403, 'BOARD_ACCESS_DENIED')
      return
    }
    if (boardSnapshotAccessForActor(board, boards.listByProject(board.projectId), request.user.openId) === 'projected') {
      socket.close(4403, 'BOARD_REALTIME_PROJECTED_READ_ONLY')
      return
    }
    try {
      manager.connect({ boardId: request.params.boardId, socket, user: request.user })
      // `asRealtimeSocket` exposes the Fastify/Node socket as an EventTarget,
      // so TLSocketRoom owns exactly one close/error listener. Registering a
      // second Fastify listener here closes the same session twice during tab
      // swaps and can race a durable snapshot projection.
    } catch (error) {
      const close = realtimeConnectionCloseForError(error)
      socket.close(close.code, close.reason)
    }
  })
  app.addHook('onClose', async () => {
    clearInterval(idleRoomSweep)
    await manager.shutdown()
  })
}
