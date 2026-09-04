import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import {
  tradingSourceMetadata,
  tradingWorkbenchSnapshot,
  type TradingSource,
} from './trading-source.js'

const stockParamsSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict()

export function registerTradingRoutes(app: FastifyInstance, source: TradingSource): void {
  app.get('/api/trading/snapshot', async (request, reply) => {
    const state = await source.getSnapshot()
    const etag = `"${state.revision}"`
    reply
      .header('etag', etag)
      .header('cache-control', 'no-store')
      .header('x-trading-stream-id', state.streamId)
      .header('x-trading-sequence', state.sequence)
    if (request.headers['if-none-match'] === etag) return reply.code(304).send()
    return tradingWorkbenchSnapshot(state)
  })

  app.get('/api/trading/stocks/:code', async (request, reply) => {
    const params = stockParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    const state = await source.getSnapshot()
    const stock = state.stocks.get(params.data.code)
    if (!stock) return reply.code(404).send({ code: 'TRADING_STOCK_NOT_FOUND' })
    return reply.header('cache-control', 'no-store').send({
      ...stock,
      ...tradingSourceMetadata(state),
    })
  })

  app.get('/api/trading/announcements', async (_request, reply) => {
    const state = await source.getSnapshot()
    return reply.header('cache-control', 'no-store').send({
      ...tradingSourceMetadata(state),
      announcements: state.snapshot.announcements,
    })
  })

  app.get('/api/trading/events', async (request, reply) => {
    const initial = await source.getSnapshot()
    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    let lastWrittenSequence = 0
    const write = (event: string, state: Awaited<ReturnType<TradingSource['getSnapshot']>>) => {
      if (state.streamId === initial.streamId && state.sequence <= lastWrittenSequence) return
      lastWrittenSequence = state.sequence
      reply.raw.write(`id: ${state.streamId}:${state.sequence}\nevent: ${event}\ndata: ${JSON.stringify(tradingSourceMetadata(state))}\n\n`)
    }
    write(initial.snapshot.sourceHealth === 'CURRENT' ? 'trading.ready' : 'trading.snapshot.changed', initial)
    const unsubscribe = source.subscribe((state) => write('trading.snapshot.changed', state))
    const reconciled = await source.getSnapshot()
    write('trading.snapshot.changed', reconciled)
    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15_000)
    heartbeat.unref?.()
    request.raw.once('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
      reply.raw.end()
    })
  })
}
