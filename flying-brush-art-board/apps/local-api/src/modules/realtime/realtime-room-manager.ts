import { randomUUID } from 'node:crypto'

import { RealtimeRoomRepository } from './realtime-room-repository.js'
import { BoardOperationQueue } from './board-operation-queue.js'

export interface RealtimeRoom {
  getCurrentSnapshot(): unknown
  getNumActiveSessions(): number
  loadSnapshot(snapshot: unknown): Promise<void>
  handleSocketConnect(input: { sessionId: string; socket: unknown; isReadonly: boolean; meta: { openId: string; name: string } }): void
  handleSocketClose(sessionId: string): void
  close?(): void
}

export interface RealtimeRoomFactory {
  create(input: {
    boardId: string
    initialSnapshot?: unknown
    onDataChange(): void
    onMessage(payload: string, actorOpenId: string): void
  }): RealtimeRoom
}

export interface RealtimeRoomConnection {
  sessionId: string
  disconnect(): void
}

export class RealtimeRoomManager {
  private readonly rooms = new Map<string, RealtimeRoom>()
  private readonly pendingUpdates = new Map<string, Array<{ payload: string; actorOpenId: string }>>()
  private readonly pendingProjections = new Set<string>()

  constructor(
    private readonly repository: RealtimeRoomRepository,
    private readonly factory: RealtimeRoomFactory,
    private readonly boardExists: (boardId: string) => boolean,
    private readonly compactAfter = 500,
    private readonly initialSnapshot: (boardId: string) => unknown | undefined = () => undefined,
    private readonly onDocumentChange: (boardId: string, roomSnapshot: unknown) => void = () => undefined,
    private readonly validateSnapshot: (boardId: string, roomSnapshot: unknown) => void = () => undefined,
    private readonly operationQueue = new BoardOperationQueue(),
  ) {}

  connect(input: { boardId: string; socket: unknown; user: { openId: string; name: string }; isReadonly?: boolean }): RealtimeRoomConnection {
    if (!this.boardExists(input.boardId)) throw new Error('BOARD_NOT_FOUND')
    const room = this.getOrCreate(input.boardId)
    const sessionId = randomUUID()
    room.handleSocketConnect({
      sessionId,
      socket: input.socket,
      isReadonly: input.isReadonly ?? false,
      meta: input.user,
    })
    return { sessionId, disconnect: () => room.handleSocketClose(sessionId) }
  }

  getActiveRoomCount(): number {
    return this.rooms.size
  }

  async closeIdleRooms(): Promise<void> {
    await Promise.all([...this.rooms.keys()].map((boardId) => this.operationQueue.run(boardId, () => {
      const room = this.rooms.get(boardId)
      if (!room) {
        this.pendingProjections.delete(boardId)
        return
      }
      if (this.pendingProjections.has(boardId)) this.projectSnapshot(boardId, room.getCurrentSnapshot())
      if (room.getNumActiveSessions() === 0) {
        try {
          this.persistCurrentRoom(boardId, room, true)
        } catch {
          // A transient persistence failure must not evict the only in-memory
          // copy of a valid collaborative edit. Retry on the next idle sweep.
          return
        }
        if (this.pendingProjections.has(boardId) && !this.projectSnapshot(boardId, room.getCurrentSnapshot())) return
        room.close?.()
        this.rooms.delete(boardId)
        this.pendingUpdates.delete(boardId)
        this.pendingProjections.delete(boardId)
      }
    })))
  }

  async closeBoard(boardId: string): Promise<void> {
    await this.operationQueue.run(boardId, () => this.closeBoardWithinQueue(boardId))
  }

  async closeBoardWithinQueue(boardId: string): Promise<void> {
    const room = this.rooms.get(boardId)
    if (!room) return
    try {
      if (this.boardExists(boardId)) {
        const snapshot = this.persistCurrentRoom(boardId, room, true)
        if (this.pendingProjections.has(boardId)) this.projectSnapshot(boardId, snapshot)
      }
    } finally {
      room.close?.()
      this.rooms.delete(boardId)
      this.pendingUpdates.delete(boardId)
      this.pendingProjections.delete(boardId)
    }
  }

  /** Applies an already-committed REST command to connected collaborators. */
  async applyCommittedSnapshot(boardId: string, snapshot: unknown): Promise<void> {
    await this.operationQueue.run(boardId, async () => {
      await this.applyCommittedSnapshotNow(boardId, snapshot)
    })
  }

  async applyCommittedSnapshotWithinQueue(boardId: string, snapshot: unknown): Promise<void> {
    await this.applyCommittedSnapshotNow(boardId, snapshot)
  }

  private async applyCommittedSnapshotNow(boardId: string, snapshot: unknown): Promise<void> {
    const room = this.rooms.get(boardId)
    if (room) {
      await room.loadSnapshot(snapshot)
      this.repository.compact(boardId, room.getCurrentSnapshot())
      return
    }
    this.repository.compact(boardId, snapshot)
  }

  async shutdown(): Promise<void> {
    for (const boardId of [...this.rooms.keys()]) {
      await this.operationQueue.run(boardId, () => {
        const room = this.rooms.get(boardId)
        if (!room) return
        try {
          if (this.boardExists(boardId)) {
            const snapshot = this.persistCurrentRoom(boardId, room, true)
            if (this.pendingProjections.has(boardId)) this.projectSnapshot(boardId, snapshot)
          }
        } catch { /* process shutdown cannot retry */
        } finally {
          room.close?.()
          this.rooms.delete(boardId)
          this.pendingUpdates.delete(boardId)
          this.pendingProjections.delete(boardId)
        }
      })
    }
  }

  private getOrCreate(boardId: string): RealtimeRoom {
    const existing = this.rooms.get(boardId)
    if (existing) return existing
    const persisted = this.repository.loadSnapshot(boardId)
    const initialSnapshot = persisted?.snapshot ?? this.initialSnapshot(boardId)
    let room: RealtimeRoom | undefined
    room = this.factory.create({
      boardId,
      ...(initialSnapshot === undefined ? {} : { initialSnapshot }),
      onDataChange: () => {
        if (!room) return
        void this.operationQueue.run(boardId, () => {
          const snapshot = room!.getCurrentSnapshot()
          try {
            this.validateSnapshot(boardId, snapshot)
          } catch {
            // Only semantic validation failures make the room state invalid.
            // Database/projection failures below must preserve the valid edit.
            this.pendingUpdates.delete(boardId)
            const authoritative = this.initialSnapshot(boardId)
            if (authoritative !== undefined) {
              void room!.loadSnapshot(authoritative).catch(() => undefined)
            }
            return
          }
          try {
            const compacted = this.persistSnapshot(boardId, snapshot)
            if (compacted) this.pendingUpdates.delete(boardId)
            else this.flushPendingUpdates(boardId)
          } catch {
            // Keep the authoritative state and its buffered messages in memory;
            // a later data change or idle-room sweep will retry persistence.
            return
          }
          this.projectSnapshot(boardId, snapshot)
        }).catch(() => undefined)
      },
      onMessage: (payload, actorOpenId) => {
        const pending = this.pendingUpdates.get(boardId) ?? []
        pending.push({ payload, actorOpenId })
        this.pendingUpdates.set(boardId, pending)
      },
    })
    this.rooms.set(boardId, room)
    return room
  }

  private persistCurrentRoom(boardId: string, room: RealtimeRoom, forceCompact = false): unknown {
    const snapshot = room.getCurrentSnapshot()
    this.validateSnapshot(boardId, snapshot)
    const compacted = this.persistSnapshot(boardId, snapshot, forceCompact)
    if (compacted) this.pendingUpdates.delete(boardId)
    else this.flushPendingUpdates(boardId)
    return snapshot
  }

  private persistSnapshot(boardId: string, snapshot: unknown, forceCompact = false): boolean {
    const updateCount = this.repository.loadSnapshot(boardId)?.updateCount ?? 0
    const pendingCount = this.pendingUpdates.get(boardId)?.length ?? 0
    if (forceCompact || updateCount + pendingCount >= this.compactAfter) {
      this.repository.compact(boardId, snapshot)
      return true
    } else {
      this.repository.saveSnapshot(boardId, snapshot)
      return false
    }
  }

  private projectSnapshot(boardId: string, snapshot: unknown): boolean {
    try {
      this.onDocumentChange(boardId, snapshot)
      this.pendingProjections.delete(boardId)
      return true
    } catch {
      this.pendingProjections.add(boardId)
      return false
    }
  }

  private flushPendingUpdates(boardId: string): void {
    const pending = this.pendingUpdates.get(boardId)
    if (!pending) return
    while (pending.length > 0) {
      const update = pending[0]!
      this.repository.appendUpdate(boardId, update.payload, update.actorOpenId)
      pending.shift()
    }
    this.pendingUpdates.delete(boardId)
  }
}
