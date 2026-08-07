export interface ApplicationEvent {
  type: string
  operationId?: string
  actorOpenId?: string
  actorName?: string
  clientId?: string
  toolName?: string
  projectId?: string
  boardId?: string
  summary?: string
  affectedIds?: string[]
  createdAt: string
}

type Listener = (event: ApplicationEvent) => void

const listeners = new Set<Listener>()
let socket: WebSocket | undefined
let connectTimer: number | undefined
let reconnectTimer: number | undefined
let consumers = 0

function socketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/realtime/events`
}

function connect(): void {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return
  if (consumers === 0 || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return
  const connection = new WebSocket(socketUrl())
  socket = connection
  connection.addEventListener('message', (message) => {
    try {
      const event = JSON.parse(String(message.data)) as ApplicationEvent
      if (!event || typeof event.type !== 'string' || event.type === 'connected') return
      listeners.forEach((listener) => listener(event))
    } catch {
      // Ignore malformed or future event payloads; authoritative data is
      // always reloaded after a structural notification.
    }
  })
  connection.addEventListener('close', () => {
    if (socket !== connection) return
    socket = undefined
    if (consumers === 0) return
    reconnectTimer = window.setTimeout(connect, 1_000)
  })
}

export function startApplicationEvents(): () => void {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return () => undefined
  consumers += 1
  if (consumers === 1) {
    // React development StrictMode mounts, cleans up, and mounts effects again.
    // Deferring the initial handshake lets that first cleanup cancel it instead
    // of aborting a live WebSocket inside Vite's proxy.
    connectTimer = window.setTimeout(() => {
      connectTimer = undefined
      connect()
    }, 0)
  }
  let active = true
  return () => {
    if (!active) return
    active = false
    consumers = Math.max(0, consumers - 1)
    if (consumers > 0) return
    if (connectTimer !== undefined) window.clearTimeout(connectTimer)
    connectTimer = undefined
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
    reconnectTimer = undefined
    const connection = socket
    socket = undefined
    connection?.close()
  }
}

export function subscribeApplicationEvents(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
