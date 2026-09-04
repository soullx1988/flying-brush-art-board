import type { FastifyInstance, FastifyRequest } from 'fastify'

import type { AllowedUser } from './allowed-user-directory.js'
import { UserNotAllowedError } from './allowed-user-directory.js'
import { SessionRepository } from './session-repository.js'
import { UserDirectoryCache } from './user-directory-cache.js'

export const SESSION_COOKIE_NAME = 'infinite_board_session'

export interface AuthenticationDependencies {
  sessions: SessionRepository
  users: UserDirectoryCache
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AllowedUser
  }
}

function needsAuthentication(request: FastifyRequest): boolean {
  const path = request.routeOptions.url ?? request.url.split('?')[0] ?? '/'
  return path.startsWith('/api/') || path.startsWith('/realtime/') || path.startsWith('/auth/feishu/import/')
}

export function registerAuthenticationPlugin(app: FastifyInstance, dependencies: AuthenticationDependencies): void {
  app.addHook('onRequest', async (request, reply) => {
    if (!needsAuthentication(request)) return
    const token = request.cookies[SESSION_COOKIE_NAME]
    if (!token) return reply.code(401).send({ code: 'SESSION_EXPIRED' })
    const session = dependencies.sessions.findAndRefresh(token)
    if (!session) return reply.code(401).send({ code: 'SESSION_EXPIRED' })
    try {
      request.user = await dependencies.users.requireAllowed(session.openId)
    } catch (error) {
      if (error instanceof UserNotAllowedError) return reply.code(403).send({ code: 'USER_NOT_ALLOWED' })
      return reply.code(503).send({ code: 'USER_DIRECTORY_UNAVAILABLE' })
    }
  })
}
