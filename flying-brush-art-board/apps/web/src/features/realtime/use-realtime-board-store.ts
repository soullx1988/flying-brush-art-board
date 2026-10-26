import { useSync, type RemoteTLStoreWithStatus } from '@tldraw/sync'
import { useMemo } from 'react'
import {
  computed,
  createUserId,
  inlineBase64AssetStore,
  type TLUserStore,
  UserRecordType,
} from 'tldraw'

import { boardStoreShapeUtils } from '@infinite-board/tldraw-adapter'
import type { TldrawUserIdentity } from '../auth/tldraw-user'

export const MAX_INLINE_ASSET_BYTES = 5 * 1024 * 1024

const guardedInlineBase64AssetStore = {
  ...inlineBase64AssetStore,
  upload: (...args: Parameters<typeof inlineBase64AssetStore.upload>) => {
    const file = args[1]
    if (file.size > MAX_INLINE_ASSET_BYTES) {
      return Promise.reject(new Error('ASSET_TOO_LARGE'))
    }
    return inlineBase64AssetStore.upload(...args)
  },
}

export function getRealtimeBoardSocketUri(
  boardId: string,
  location: Pick<Location, 'protocol' | 'host'> = window.location,
): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/realtime/boards/${encodeURIComponent(boardId)}`
}

/**
 * The browser sends its HTTP-only session cookie during this same-origin WebSocket
 * handshake. No OAuth/session secret is exposed through the URL or local storage.
 */
export function useRealtimeBoardStore(
  boardId: string,
  user?: TldrawUserIdentity,
): RemoteTLStoreWithStatus {
  const users = useMemo<TLUserStore | undefined>(() => {
    if (!user) return undefined
    const currentUser = UserRecordType.create({
      id: createUserId(user.id),
      name: user.name,
      color: user.color,
    })
    return {
      currentUser: computed(`realtime-current-user:${user.id}`, () => currentUser),
    }
  }, [user?.color, user?.id, user?.name])

  return useSync({
    uri: getRealtimeBoardSocketUri(boardId),
    assets: guardedInlineBase64AssetStore,
    shapeUtils: boardStoreShapeUtils,
    ...(users ? { users } : {}),
  })
}
