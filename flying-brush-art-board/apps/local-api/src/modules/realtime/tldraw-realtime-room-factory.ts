import { TLSocketRoom, type RoomSnapshot, type WebSocketMinimal } from '@tldraw/sync-core'
import {
  createBoardStore,
  getStoreSnapshot,
  loadSnapshotIntoStore,
  upgradeLegacyInteropShapeRecord,
} from '@infinite-board/tldraw-adapter'
import type { TLRecord } from 'tldraw'

import type { RealtimeRoom, RealtimeRoomFactory } from './realtime-room-manager.js'
import { asRealtimeSocket } from './realtime-socket.js'

class TldrawRealtimeRoom implements RealtimeRoom {
  private readonly schema = createBoardStore().schema
  private readonly room: TLSocketRoom<TLRecord, { openId: string; name: string }>
  private applyingServerSnapshot = false

  constructor(input: Parameters<RealtimeRoomFactory['create']>[0]) {
    this.room = new TLSocketRoom<TLRecord, { openId: string; name: string }>({
      schema: this.schema,
      ...(input.initialSnapshot ? { initialSnapshot: this.withBoardSchema(input.initialSnapshot) } : {}),
      onDataChange: () => {
        if (!this.applyingServerSnapshot) input.onDataChange()
      },
      onAfterReceiveMessage: ({ stringified, meta }) => input.onMessage(stringified, meta.openId),
    })
  }

  getCurrentSnapshot(): unknown {
    return this.room.getCurrentSnapshot()
  }

  getNumActiveSessions(): number {
    return this.room.getNumActiveSessions()
  }

  async loadSnapshot(snapshot: unknown): Promise<void> {
    const value = this.withBoardSchema(snapshot) as unknown as {
      documents?: Array<{ state?: unknown }>
      store?: Record<string, unknown>
    }
    const records = Array.isArray(value.documents)
      ? value.documents.flatMap((document) => document.state ? [document.state] : [])
      : Object.values(value.store ?? {})
    const nextById = new Map(records.flatMap((record) => {
      if (!record || typeof record !== 'object' || typeof (record as { id?: unknown }).id !== 'string') return []
      return [[(record as { id: string }).id, record] as const]
    }))
    this.applyingServerSnapshot = true
    try {
      await this.room.updateStore((store) => {
        for (const record of store.getAll()) {
          if (!nextById.has(record.id)) store.delete(record)
        }
        for (const record of nextById.values()) store.put(record as TLRecord)
      })
    } finally {
      this.applyingServerSnapshot = false
    }
  }

  /**
   * Board persistence uses compact store/editor snapshots, while sync-core can
   * also persist its own `{ documents }` room snapshots. Pass Board snapshots
   * through the shared adapter so legacy schema omissions and decimal indices
   * are normalized before sync-core exposes them to a browser connection.
   */
  private withBoardSchema(snapshot: unknown): RoomSnapshot {
    if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
      const value = snapshot as { documents?: unknown }
      if (Array.isArray(value.documents)) {
        return {
          ...(snapshot as RoomSnapshot),
          documents: value.documents.map((document) => {
            if (!document || typeof document !== 'object' || Array.isArray(document)) return document
            const item = document as Record<string, unknown>
            const result = upgradeLegacyInteropShapeRecord(item.state)
            return result.upgraded ? { ...item, state: result.record } : document
          }),
        } as RoomSnapshot
      }

      const store = createBoardStore()
      loadSnapshotIntoStore(store, snapshot)
      return getStoreSnapshot(store) as unknown as RoomSnapshot
    }
    return snapshot as RoomSnapshot
  }

  handleSocketConnect(input: { sessionId: string; socket: unknown; isReadonly: boolean; meta: { openId: string; name: string } }): void {
    this.room.handleSocketConnect({ ...input, socket: asRealtimeSocket(input.socket as WebSocketMinimal) })
  }

  handleSocketClose(sessionId: string): void {
    this.room.handleSocketClose(sessionId)
  }

  close(): void {
    this.room.close()
  }
}

export const tldrawRealtimeRoomFactory: RealtimeRoomFactory = {
  create(input) {
    return new TldrawRealtimeRoom(input)
  },
}
