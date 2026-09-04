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
    private readonly onDocumentChange: (boardId: string, roomSnapshot: unknown) => number | void = () => undefined,
    private readonly validateSnapshot: (boardId: string, roomSnapshot: unknown) => void = () => undefined,
    private readonly operationQueue = new BoardOperationQueue(),
    private readonly shouldInvalidateRoomBeforeBroadcast: (boardId: string, snapshot: unknown) => boolean = () => false,
    private readonly currentBoardRevision: (boardId: string) => number | undefined = () => undefined,
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
    let boardRevision: number | undefined
    try {
      boardRevision = this.currentBoardRevision(boardId)
    } catch {
      // Revision lookup is part of the post-commit synchronization boundary.
      // If it fails, an existing room is no longer safe to project because it
      // may predate the command that has just committed.
      if (room) this.invalidateRoom(boardId, room)
      return
    }
    if (room) {
      try {
        if (this.shouldInvalidateRoomBeforeBroadcast(boardId, snapshot)) {
          // A public room may become privacy-projected when a command adds an
          // owner-only reference. Close existing raw-snapshot sessions before
          // the new snapshot is loaded, then persist only the authoritative
          // command result. This prevents even a one-frame private broadcast.
          this.invalidateRoom(boardId, room)
          this.repository.compact(boardId, snapshot, 1, boardRevision)
          return
        }
        await room.loadSnapshot(snapshot)
        this.repository.compact(boardId, room.getCurrentSnapshot(), 1, boardRevision)
        return
      } catch {
        // The Board transaction has already committed. A room/load/compact
        // failure must not turn that success into an ambiguous HTTP error or
        // leave a stale live room able to overwrite the committed Board.
        this.invalidateRoom(boardId, room)
        try {
          this.repository.compact(boardId, snapshot, 1, boardRevision)
        } catch {
          // A stale persisted room retains its older board revision. The next
          // connection will reject it and seed from the authoritative Board.
        }
        return
      }
    }
    try {
      this.repository.compact(boardId, snapshot, 1, boardRevision)
    } catch {
      // The durable Board remains authoritative. A mismatched or absent room
      // snapshot will be ignored when the next collaboration room starts.
    }
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
    const boardRevision = this.currentBoardRevision(boardId)
    const persistedMatchesBoard = persisted
      && (boardRevision === undefined || persisted.boardRevision === boardRevision)
    const initialSnapshot = persistedMatchesBoard ? persisted.snapshot : this.initialSnapshot(boardId)
    let room: RealtimeRoom | undefined
    room = this.factory.create({
      boardId,
      ...(initialSnapshot === undefined ? {} : { initialSnapshot }),
      onDataChange: () => {
        const activeRoom = room
        if (!activeRoom || this.rooms.get(boardId) !== activeRoom) return
        void this.operationQueue.run(boardId, () => {
          if (this.rooms.get(boardId) !== activeRoom) return
          const snapshot = activeRoom.getCurrentSnapshot()
          try {
            this.validateSnapshot(boardId, snapshot)
          } catch {
            // Only semantic validation failures make the room state invalid.
            // Database/projection failures below must preserve the valid edit.
            this.pendingUpdates.delete(boardId)
            const authoritative = this.initialSnapshot(boardId)
            if (authoritative !== undefined) {
              void activeRoom.loadSnapshot(authoritative).catch(() => undefined)
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
        if (!room || this.rooms.get(boardId) !== room) return
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
      this.repository.compact(boardId, snapshot, 1, this.currentBoardRevision(boardId))
      return true
    } else {
      this.repository.saveSnapshot(boardId, snapshot, 1, this.currentBoardRevision(boardId))
      return false
    }
  }

  private projectSnapshot(boardId: string, snapshot: unknown): boolean {
    try {
      const projectedRevision = this.onDocumentChange(boardId, snapshot)
      const boardRevision = typeof projectedRevision === 'number'
        ? projectedRevision
        : this.currentBoardRevision(boardId)
      if (boardRevision !== undefined) this.repository.markBoardRevision(boardId, boardRevision)
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

  private invalidateRoom(boardId: string, room: RealtimeRoom): void {
    try {
      room.close?.()
    } catch {
      // Cleanup below is the data-integrity boundary; a transport-specific
      // close failure must not keep the stale room registered as writable.
    } finally {
      if (this.rooms.get(boardId) === room) this.rooms.delete(boardId)
      this.pendingUpdates.delete(boardId)
      this.pendingProjections.delete(boardId)
    }
  }
}
