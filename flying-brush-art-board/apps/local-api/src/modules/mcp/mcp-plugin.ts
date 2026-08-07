import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { FastifyInstance, FastifyRequest } from 'fastify'

import type { McpToolRegistryDependencies } from './mcp-tool-registry.js'
import { createInfiniteBoardMcpServer } from './mcp-tool-registry.js'

export interface McpMetricsSnapshot {
  activeRequests: number
  calls: number
  failures: number
  rateLimited: number
  durationsMs: number[]
}

export interface McpPluginOptions {
  dependencies: McpToolRegistryDependencies
  allowedHosts: string[]
  allowedOrigins?: string[]
  maxRequestBytes?: number
  maxConcurrentRequests?: number
  maxRequestsPerMinute?: number
}

interface RateEntry { startedAt: number; count: number }

function normalizedHost(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.trim().toLocaleLowerCase('en-US').replace(/\.$/, '')
}

function hostWithoutPort(host: string): string {
  try {
    return new URL(`http://${host}`).hostname.toLocaleLowerCase('en-US')
  } catch {
    return host
  }
}

function requestUrl(request: FastifyRequest): URL {
  const forwardedProto = typeof request.headers['x-forwarded-proto'] === 'string'
    ? request.headers['x-forwarded-proto'].split(',')[0]!.trim()
    : undefined
  const protocol = forwardedProto === 'https' ? 'https' : 'http'
  const host = normalizedHost(request.headers['x-forwarded-host']) ?? normalizedHost(request.headers.host) ?? '127.0.0.1'
  return new URL(request.url, `${protocol}://${host}`)
}

function webRequest(request: FastifyRequest): Request {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item))
    else if (value !== undefined) headers.set(key, String(value))
  }
  return new Request(requestUrl(request), { method: request.method, headers })
}

function sendJsonError(reply: Parameters<FastifyInstance['route']>[0] extends never ? never : any, statusCode: number, code: number, message: string) {
  return reply.code(statusCode).type('application/json').send({ jsonrpc: '2.0', error: { code, message }, id: null })
}

export function registerMcpPlugin(app: FastifyInstance, options: McpPluginOptions): McpMetricsSnapshot {
  const allowedHosts = new Set(options.allowedHosts.map((host) => normalizedHost(host)).filter((host): host is string => Boolean(host)))
  const allowedOrigins = new Set((options.allowedOrigins ?? []).map((origin) => origin.trim().replace(/\/$/, '')))
  const maxConcurrent = options.maxConcurrentRequests ?? 16
  const maxRequestsPerMinute = options.maxRequestsPerMinute ?? 120
  const rates = new Map<string, RateEntry>()
  const metrics: McpMetricsSnapshot = { activeRequests: 0, calls: 0, failures: 0, rateLimited: 0, durationsMs: [] }

  app.get<{ Params: { ticket: string } }>('/mcp/download/:ticket', async (request, reply) => {
    const host = normalizedHost(request.headers['x-forwarded-host']) ?? normalizedHost(request.headers.host)
    if (!host || (!allowedHosts.has(host) && !allowedHosts.has(hostWithoutPort(host)))) return reply.code(421).send({ code: 'MCP_HOST_NOT_ALLOWED' })
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin.replace(/\/$/, '') : undefined
    if (origin && !allowedOrigins.has(origin)) return reply.code(403).send({ code: 'MCP_ORIGIN_NOT_ALLOWED' })
    if (!request.user || !request.mcpAccess) return reply.code(401).send({ code: 'MCP_AUTH_REQUIRED' })
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(request.params.ticket)) return reply.code(404).send({ code: 'MCP_DOWNLOAD_NOT_FOUND' })
    const payload = await options.dependencies.downloads.read(request.params.ticket, request.user.openId, request.mcpAccess.id)
    if (!payload) return reply.code(404).send({ code: 'MCP_DOWNLOAD_NOT_FOUND' })
    const encodedName = encodeURIComponent(payload.fileName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    return reply.header('cache-control', 'private, no-store').header('content-disposition', `attachment; filename*=UTF-8''${encodedName}`).type(payload.mimeType).send(Buffer.from(payload.bytes))
  })

  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    bodyLimit: options.maxRequestBytes ?? 1_048_576,
    handler: async (request, reply) => {
      const host = normalizedHost(request.headers['x-forwarded-host']) ?? normalizedHost(request.headers.host)
      if (!host || (!allowedHosts.has(host) && !allowedHosts.has(hostWithoutPort(host)))) {
        return sendJsonError(reply, 421, -32000, 'MCP host is not allowed')
      }
      const origin = typeof request.headers.origin === 'string' ? request.headers.origin.replace(/\/$/, '') : undefined
      if (origin && !allowedOrigins.has(origin)) return sendJsonError(reply, 403, -32000, 'MCP origin is not allowed')
      if (!request.user || !request.mcpAccess) return sendJsonError(reply, 401, -32001, 'MCP authentication required')
      if (metrics.activeRequests >= maxConcurrent) {
        metrics.rateLimited++
        options.dependencies.audits.record({ actorOpenId: request.user.openId, action: 'security.mcp.rate_limited', summary: { clientId: request.mcpAccess.id, reason: 'concurrency' } })
        return sendJsonError(reply, 429, -32002, 'MCP server is busy')
      }

      const now = Date.now()
      const rate = rates.get(request.mcpAccess.id)
      const current = !rate || now - rate.startedAt >= 60_000 ? { startedAt: now, count: 0 } : rate
      if (current.count >= maxRequestsPerMinute) {
        metrics.rateLimited++
        options.dependencies.audits.record({ actorOpenId: request.user.openId, action: 'security.mcp.rate_limited', summary: { clientId: request.mcpAccess.id, reason: 'per_minute' } })
        rates.set(request.mcpAccess.id, current)
        return sendJsonError(reply, 429, -32002, 'MCP rate limit exceeded')
      }
      current.count++
      rates.set(request.mcpAccess.id, current)

      const startedAt = performance.now()
      metrics.activeRequests++
      metrics.calls++
      const requestId = typeof request.headers['x-request-id'] === 'string' && request.headers['x-request-id'].length <= 200
        ? request.headers['x-request-id']
        : randomUUID()
      reply.header('x-request-id', requestId)

      const server = createInfiniteBoardMcpServer(options.dependencies, {
        user: request.user,
        access: request.mcpAccess,
        requestId,
        serverBaseUrl: requestUrl(request).origin,
      })
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
      try {
        await server.connect(transport)
        const response = await transport.handleRequest(webRequest(request), { parsedBody: request.body })
        reply.code(response.status)
        response.headers.forEach((value, key) => reply.header(key, value))
        if (!response.body) return reply.send()
        return reply.send(Readable.fromWeb(response.body as never))
      } catch {
        metrics.failures++
        if (!reply.sent) return sendJsonError(reply, 500, -32603, 'Internal MCP error')
      } finally {
        metrics.activeRequests--
        metrics.durationsMs.push(performance.now() - startedAt)
        if (metrics.durationsMs.length > 1000) metrics.durationsMs.splice(0, metrics.durationsMs.length - 1000)
        await transport.close().catch(() => undefined)
        await server.close().catch(() => undefined)
      }
    },
  })

  app.get('/api/mcp/health', async () => {
    const sorted = [...metrics.durationsMs].sort((left, right) => left - right)
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : 0
    return {
      status: 'ok',
      activeRequests: metrics.activeRequests,
      calls: metrics.calls,
      failures: metrics.failures,
      rateLimited: metrics.rateLimited,
      p95Ms: Math.round(p95 ?? 0),
    }
  })

  return metrics
}
