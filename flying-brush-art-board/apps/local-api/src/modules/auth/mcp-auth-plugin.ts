import type { FastifyInstance, FastifyRequest } from 'fastify'

import type { AllowedUser } from './allowed-user-directory.js'
import { UserNotAllowedError } from './allowed-user-directory.js'
import type { McpOAuthAccess, McpOAuthRepository, McpScope } from './mcp-oauth-repository.js'
import type { UserDirectoryCache } from './user-directory-cache.js'
import type { AuditRepository } from '../audit/audit-repository.js'

declare module 'fastify' {
  interface FastifyRequest {
    mcpAccess?: McpOAuthAccess
  }
}

function isMcpRequest(request: FastifyRequest): boolean {
  const path = request.url.split('?', 1)[0]
  return path === '/mcp' || path?.startsWith('/mcp/') === true
}

function bearerToken(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') return undefined
  const match = /^Bearer ([A-Za-z0-9_-]{16,256})$/.exec(header)
  return match?.[1]
}

export interface McpAuthenticationOptions {
  oauth: McpOAuthRepository
  resourceMetadataUrl: string
  users?: UserDirectoryCache
  localUser?: AllowedUser
  audit?: AuditRepository
}

export function registerMcpAuthentication(app: FastifyInstance, options: McpAuthenticationOptions): void {
  app.addHook('onRequest', async (request, reply) => {
    if (!isMcpRequest(request)) return
    const token = bearerToken(request.headers.authorization)
    if (!token) {
      options.audit?.record({ actorOpenId: 'anonymous', action: 'security.mcp.auth_failed', summary: { reason: 'missing_bearer', version: '2.0.0' } })
      reply.header('WWW-Authenticate', `Bearer resource_metadata="${options.resourceMetadataUrl}"`)
      return reply.code(401).send({ code: 'MCP_OAUTH_REQUIRED' })
    }
    const access = options.oauth.verifyAccessToken(token)
    if (!access) {
      options.audit?.record({ actorOpenId: 'anonymous', action: 'security.mcp.auth_failed', summary: { reason: 'invalid_oauth_token', version: '2.0.0' } })
      reply.header('WWW-Authenticate', `Bearer error="invalid_token", resource_metadata="${options.resourceMetadataUrl}"`)
      return reply.code(401).send({ code: 'MCP_OAUTH_TOKEN_INVALID' })
    }
    try {
      const user = options.users
        ? await options.users.requireAllowed(access.openId)
        : options.localUser?.openId === access.openId
          ? options.localUser
          : undefined
      if (!user) return reply.code(403).send({ code: 'USER_NOT_ALLOWED' })
      request.user = user
      request.mcpAccess = access
      options.audit?.record({ actorOpenId: user.openId, action: 'security.mcp.auth_succeeded', summary: { grantId: access.id, clientId: access.oauthClientId, version: '2.0.0' } })
    } catch (error) {
      if (error instanceof UserNotAllowedError) return reply.code(403).send({ code: 'USER_NOT_ALLOWED' })
      return reply.code(503).send({ code: 'USER_DIRECTORY_UNAVAILABLE' })
    }
  })
}

export function requireMcpScope(request: FastifyRequest, scope: McpScope): void {
  if (!request.mcpAccess?.scopes.includes(scope)) {
    throw Object.assign(new Error('MCP_SCOPE_REQUIRED'), { code: 'MCP_SCOPE_REQUIRED', scope })
  }
}
