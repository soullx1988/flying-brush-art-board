import type { WebSocketMinimal } from '@tldraw/sync-core'

type EventName = 'message' | 'close' | 'error'

interface NodeStyleSocket {
  readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener?: WebSocketMinimal['addEventListener']
  removeEventListener?: WebSocketMinimal['removeEventListener']
  on?(event: EventName, listener: (...args: unknown[]) => void): void
  off?(event: EventName, listener: (...args: unknown[]) => void): void
  removeListener?(event: EventName, listener: (...args: unknown[]) => void): void
}

function messageData(value: unknown): unknown {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return new TextDecoder().decode(value)
  return value
}

/**
 * @fastify/websocket may expose the Node `ws` event-emitter API instead of
 * EventTarget methods. TLSocketRoom only installs listeners through the
 * latter, so normalize both server-side shapes before handing it the socket.
 */
export function asRealtimeSocket(socket: NodeStyleSocket): WebSocketMinimal {
  if (socket.addEventListener) return socket as WebSocketMinimal

  const listeners = new Map<(event: unknown) => void, (...args: unknown[]) => void>()
  return {
    get readyState() { return socket.readyState },
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    addEventListener(type, listener) {
      const wrapped = (...args: unknown[]) => {
        if (type === 'message') listener({ data: messageData(args[0]) })
        else listener(args[0] ?? {})
      }
      listeners.set(listener, wrapped)
      socket.on?.(type, wrapped)
    },
    removeEventListener(type, listener) {
      const wrapped = listeners.get(listener)
      if (!wrapped) return
      listeners.delete(listener)
      if (socket.off) socket.off(type, wrapped)
      else socket.removeListener?.(type, wrapped)
    },
  }
}
