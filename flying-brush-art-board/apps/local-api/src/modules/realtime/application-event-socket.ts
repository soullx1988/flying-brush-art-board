import type { FastifyInstance } from 'fastify'

import type { ApplicationEventHub } from '../../application/domain-event-publisher.js'

export function registerApplicationEventSocket(app: FastifyInstance, events: ApplicationEventHub): void {
  app.get('/realtime/events', { websocket: true }, (socket, request) => {
    if (!request.user) {
      socket.close(4401, 'SESSION_EXPIRED')
      return
    }
    socket.send(JSON.stringify({ type: 'connected', createdAt: new Date().toISOString() }))
    const unsubscribe = events.subscribe((event) => {
      if (socket.readyState !== 1) return
      // Current authorization policy gives each allowed user access to all local
      // projects. If project membership is introduced, filter here before send.
      socket.send(JSON.stringify(event))
    })
    socket.on('close', unsubscribe)
    socket.on('error', unsubscribe)
  })
}
