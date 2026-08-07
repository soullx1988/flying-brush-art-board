import { describe, expect, it, vi } from 'vitest'

import { createDatabase } from '../db/schema.js'
import { AuditRepository } from '../modules/audit/audit-repository.js'
import { McpConfirmationService, McpOperationConflictError, McpOperationService } from './operation-service.js'

describe('McpOperationService', () => {
  it('records and replays an idempotent operation', async () => {
    const database = createDatabase(':memory:')
    const events = { publish: vi.fn() }
    const service = new McpOperationService(database, new AuditRepository(database), events)
    const work = vi.fn(async () => ({ data: { value: 1 }, summary: 'done', affectedIds: ['shape:a'], afterRevision: 2 }))
    const context = { actorOpenId: 'u', actorName: 'User', clientId: 'client', requestId: 'r', operationId: 'op', idempotencyKey: 'same' }
    const first = await service.execute({ context, toolName: 'shape_create', arguments: { x: 1 }, boardId: 'b', initialSummary: 'working', work })
    const second = await service.execute({ context: { ...context, operationId: 'other' }, toolName: 'shape_create', arguments: { x: 1 }, boardId: 'b', initialSummary: 'working', work })
    expect(first.replayed).toBe(false)
    expect(second).toMatchObject({ operationId: 'op', replayed: true })
    expect(work).toHaveBeenCalledTimes(1)
    expect(events.publish).toHaveBeenCalledTimes(2)
    database.close()
  })

  it('rejects reusing an idempotency key for different input', async () => {
    const database = createDatabase(':memory:')
    const service = new McpOperationService(database, new AuditRepository(database))
    const context = { actorOpenId: 'u', actorName: 'User', clientId: 'c', requestId: 'r', operationId: 'op', idempotencyKey: 'key' }
    await service.execute({ context, toolName: 'x', arguments: { x: 1 }, initialSummary: 'x', work: () => ({ data: {}, summary: 'ok' }) })
    await expect(service.execute({ context: { ...context, operationId: 'op2' }, toolName: 'x', arguments: { x: 2 }, initialSummary: 'x', work: () => ({ data: {}, summary: 'ok' }) }))
      .rejects.toBeInstanceOf(McpOperationConflictError)
    database.close()
  })
})

describe('McpConfirmationService', () => {
  it('binds a one-time token to actor, tool, target and request', () => {
    const database = createDatabase(':memory:')
    const service = new McpConfirmationService(database, () => new Date('2026-07-30T00:00:00Z'))
    const created = service.create({ actorOpenId: 'u', clientId: 'c', toolName: 'delete', targetId: 'p', request: { p: 1 } })
    service.consume({ confirmationToken: created.confirmationToken, actorOpenId: 'u', clientId: 'c', toolName: 'delete', targetId: 'p', request: { p: 1 } })
    expect(() => service.consume({ confirmationToken: created.confirmationToken, actorOpenId: 'u', clientId: 'c', toolName: 'delete', targetId: 'p', request: { p: 1 } }))
      .toThrow('MCP_CONFIRMATION_INVALID')
    database.close()
  })

  it('rejects an expired token or a changed client, request, and revision', () => {
    const database = createDatabase(':memory:')
    let now = new Date('2026-07-30T00:00:00Z')
    const service = new McpConfirmationService(database, () => now)
    const input = { actorOpenId: 'u', clientId: 'c', toolName: 'delete', targetId: 'b', request: { ids: ['shape:a'] }, expectedRevision: 7 }

    const clientBound = service.create(input)
    expect(() => service.consume({ ...input, clientId: 'other', confirmationToken: clientBound.confirmationToken }))
      .toThrow('MCP_CONFIRMATION_INVALID')

    const requestBound = service.create(input)
    expect(() => service.consume({ ...input, request: { ids: ['shape:b'] }, confirmationToken: requestBound.confirmationToken }))
      .toThrow('MCP_CONFIRMATION_INVALID')

    const revisionBound = service.create(input)
    expect(() => service.consume({ ...input, expectedRevision: 8, confirmationToken: revisionBound.confirmationToken }))
      .toThrow('MCP_CONFIRMATION_INVALID')

    const expired = service.create({ ...input, ttlMs: 1_000 })
    now = new Date('2026-07-30T00:00:02Z')
    expect(() => service.consume({ ...input, confirmationToken: expired.confirmationToken }))
      .toThrow('MCP_CONFIRMATION_INVALID')
    database.close()
  })
})
