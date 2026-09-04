import type { FastifyInstance } from 'fastify'

import type { TradingWorkspaceBootstrapService } from '../../application/trading-workspace-template.js'

export function registerTradingWorkspaceRoutes(
  app: FastifyInstance,
  bootstrap: TradingWorkspaceBootstrapService,
): void {
  app.put('/api/bootstrap/personal-trading-workspace', async (request, reply) => {
    if (!request.user?.openId) return reply.code(403).send({ code: 'TRADING_WORKSPACE_ACCESS_DENIED' })
    try {
      const result = await bootstrap.ensure(request.user.openId)
      return reply.code(result.status === 'created' ? 201 : 200).send(result)
    } catch (error) {
      if (error instanceof Error && error.message === 'TRADING_WORKSPACE_ACCESS_DENIED') {
        return reply.code(403).send({ code: error.message })
      }
      throw error
    }
  })
}
