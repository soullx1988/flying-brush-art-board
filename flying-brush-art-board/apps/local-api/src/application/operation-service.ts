import { createHash, randomBytes, randomUUID } from 'node:crypto'

import type { LocalDatabase } from '../db/schema.js'
import type { AuditRepository } from '../modules/audit/audit-repository.js'

export interface McpCommandContext {
  actorOpenId: string
  actorName: string
  clientId: string
  requestId: string
  operationId: string
  idempotencyKey?: string
}
export interface ApplicationOperationEvent {
  type: 'operation.started' | 'operation.committed' | 'operation.failed'
  operationId: string
  actorOpenId: string
  actorName: string
  clientId: string
  toolName: string
  projectId?: string
  boardId?: string
  summary: string
  affectedIds?: string[]
  createdAt: string
}

export interface ApplicationOperationEventPublisher {
  publish(event: ApplicationOperationEvent): void
}

export interface OperationWorkResult<T> {
  data: T
  summary: string
  affectedIds?: string[]
  beforeRevision?: number
  afterRevision?: number
}

export interface OperationReceipt<T> extends OperationWorkResult<T> {
  operationId: string
  replayed: boolean
}

interface OperationRow {
  id: string
  request_hash: string
  status: 'running' | 'succeeded' | 'failed'
  result_json: string | null
  error_code: string | null
  project_id: string | null
  board_id: string | null
  before_revision: number | null
  after_revision: number | null
  created_at: string
  updated_at: string
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]))
  }
  return value
}

export function hashMcpRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message
  return 'MCP_TOOL_FAILED'
}

export class McpOperationConflictError extends Error {
  readonly code: string
  constructor(code: 'MCP_IDEMPOTENCY_CONFLICT' | 'MCP_OPERATION_IN_PROGRESS' | 'MCP_PREVIOUS_OPERATION_FAILED') {
    super(code)
    this.name = 'McpOperationConflictError'
    this.code = code
  }
}

export class McpOperationService {
  constructor(
    private readonly database: LocalDatabase,
    private readonly audits: AuditRepository,
    private readonly events?: ApplicationOperationEventPublisher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(operationId: string, actorOpenId: string): Record<string, unknown> | undefined {
    const row = this.database.prepare(`SELECT id,status,result_json,error_code,project_id,board_id,before_revision,after_revision,created_at,updated_at
      FROM mcp_operations WHERE id=? AND actor_open_id=?`).get(operationId, actorOpenId) as Omit<OperationRow, 'request_hash'> | undefined
    if (!row) return undefined
    return {
      operationId: row.id,
      status: row.status,
      ...(row.result_json ? { result: JSON.parse(row.result_json) as unknown } : {}),
      ...(row.error_code ? { errorCode: row.error_code } : {}),
      ...(row.project_id ? { projectId: row.project_id } : {}),
      ...(row.board_id ? { boardId: row.board_id } : {}),
      ...(row.before_revision !== null ? { beforeRevision: row.before_revision } : {}),
      ...(row.after_revision !== null ? { afterRevision: row.after_revision } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  async execute<T>(input: {
    context: McpCommandContext
    toolName: string
    arguments: unknown
    projectId?: string
    boardId?: string
    initialSummary: string
    work(): Promise<OperationWorkResult<T>> | OperationWorkResult<T>
  }): Promise<OperationReceipt<T>> {
    const requestHash = hashMcpRequest(input.arguments)
    const existing = input.context.idempotencyKey
      ? this.database.prepare(`SELECT * FROM mcp_operations
          WHERE actor_open_id=? AND client_id=? AND tool_name=? AND idempotency_key=?`)
        .get(input.context.actorOpenId, input.context.clientId, input.toolName, input.context.idempotencyKey) as OperationRow | undefined
      : undefined
    if (existing) {
      if (existing.request_hash !== requestHash) throw new McpOperationConflictError('MCP_IDEMPOTENCY_CONFLICT')
      if (existing.status === 'running') throw new McpOperationConflictError('MCP_OPERATION_IN_PROGRESS')
      if (existing.status === 'failed' || !existing.result_json) throw new McpOperationConflictError('MCP_PREVIOUS_OPERATION_FAILED')
      const result = JSON.parse(existing.result_json) as OperationWorkResult<T>
      return { operationId: existing.id, replayed: true, ...result }
    }

    const now = this.now()
    const operationId = input.context.operationId || randomUUID()
    const expiresAt = new Date(now.getTime() + 30 * 86_400_000).toISOString()
    this.database.prepare(`INSERT INTO mcp_operations
      (id,actor_open_id,client_id,tool_name,idempotency_key,request_hash,status,result_json,error_code,project_id,board_id,before_revision,after_revision,created_at,updated_at,expires_at)
      VALUES (?,?,?,?,?,?, 'running',NULL,NULL,?,?,NULL,NULL,?,?,?)`)
      .run(operationId, input.context.actorOpenId, input.context.clientId, input.toolName,
        input.context.idempotencyKey ?? null, requestHash, input.projectId ?? null, input.boardId ?? null,
        now.toISOString(), now.toISOString(), expiresAt)
    this.events?.publish({
      type: 'operation.started', operationId, actorOpenId: input.context.actorOpenId,
      actorName: input.context.actorName, clientId: input.context.clientId, toolName: input.toolName,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.boardId ? { boardId: input.boardId } : {}),
      summary: input.initialSummary, createdAt: now.toISOString(),
    })

    try {
      const workResult = await input.work()
      const updatedAt = this.now().toISOString()
      this.database.prepare(`UPDATE mcp_operations SET status='succeeded',result_json=?,before_revision=?,after_revision=?,updated_at=? WHERE id=?`)
        .run(JSON.stringify(workResult), workResult.beforeRevision ?? null, workResult.afterRevision ?? null, updatedAt, operationId)
      this.audits.record({
        actorOpenId: input.context.actorOpenId,
        action: `mcp.${input.toolName}`,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.boardId ? { boardId: input.boardId } : {}),
        summary: {
          clientId: input.context.clientId, requestId: input.context.requestId, operationId,
          toolName: input.toolName, requestHash,
          ...(workResult.beforeRevision !== undefined ? { beforeRevision: workResult.beforeRevision } : {}),
          ...(workResult.afterRevision !== undefined ? { afterRevision: workResult.afterRevision } : {}),
          affectedCount: workResult.affectedIds?.length ?? 0,
        },
      })
      this.events?.publish({
        type: 'operation.committed', operationId, actorOpenId: input.context.actorOpenId,
        actorName: input.context.actorName, clientId: input.context.clientId, toolName: input.toolName,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.boardId ? { boardId: input.boardId } : {}),
        summary: workResult.summary,
        ...(workResult.affectedIds ? { affectedIds: workResult.affectedIds } : {}),
        createdAt: updatedAt,
      })
      return { operationId, replayed: false, ...workResult }
    } catch (error) {
      const code = errorCode(error)
      const updatedAt = this.now().toISOString()
      this.database.prepare(`UPDATE mcp_operations SET status='failed',error_code=?,updated_at=? WHERE id=?`)
        .run(code, updatedAt, operationId)
      this.events?.publish({
        type: 'operation.failed', operationId, actorOpenId: input.context.actorOpenId,
        actorName: input.context.actorName, clientId: input.context.clientId, toolName: input.toolName,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.boardId ? { boardId: input.boardId } : {}),
        summary: code, createdAt: updatedAt,
      })
      throw error
    }
  }

  pruneExpired(): number {
    return this.database.prepare('DELETE FROM mcp_operations WHERE expires_at < ?').run(this.now().toISOString()).changes
  }
}

export class McpConfirmationService {
  constructor(
    private readonly database: LocalDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(input: {
    actorOpenId: string
    clientId: string
    toolName: string
    targetId: string
    request: unknown
    expectedRevision?: number
    ttlMs?: number
  }): { confirmationToken: string; expiresAt: string } {
    const token = `ibconfirm_${randomBytes(24).toString('base64url')}`
    const createdAt = this.now()
    const expiresAt = new Date(createdAt.getTime() + (input.ttlMs ?? 300_000)).toISOString()
    this.database.prepare(`INSERT INTO mcp_confirmations
      (token_hash,actor_open_id,client_id,tool_name,target_id,request_hash,expected_revision,created_at,expires_at,consumed_at)
      VALUES (?,?,?,?,?,?,?,?,?,NULL)`)
      .run(hashMcpRequest(token), input.actorOpenId, input.clientId, input.toolName, input.targetId,
        hashMcpRequest(input.request), input.expectedRevision ?? null, createdAt.toISOString(), expiresAt)
    return { confirmationToken: token, expiresAt }
  }

  consume(input: {
    confirmationToken: string
    actorOpenId: string
    clientId: string
    toolName: string
    targetId: string
    request: unknown
    expectedRevision?: number
  }): void {
    const row = this.database.prepare('SELECT * FROM mcp_confirmations WHERE token_hash=?')
      .get(hashMcpRequest(input.confirmationToken)) as {
        actor_open_id: string; client_id: string; tool_name: string; target_id: string; request_hash: string
        expected_revision: number | null; expires_at: string; consumed_at: string | null
      } | undefined
    const matches = row
      && !row.consumed_at
      && Date.parse(row.expires_at) > this.now().getTime()
      && row.actor_open_id === input.actorOpenId
      && row.client_id === input.clientId
      && row.tool_name === input.toolName
      && row.target_id === input.targetId
      && row.request_hash === hashMcpRequest(input.request)
      && row.expected_revision === (input.expectedRevision ?? null)
    if (!matches) throw Object.assign(new Error('MCP_CONFIRMATION_INVALID'), { code: 'MCP_CONFIRMATION_INVALID' })
    const updated = this.database.prepare(`UPDATE mcp_confirmations SET consumed_at=?
      WHERE token_hash=? AND consumed_at IS NULL`).run(this.now().toISOString(), hashMcpRequest(input.confirmationToken))
    if (updated.changes !== 1) throw Object.assign(new Error('MCP_CONFIRMATION_INVALID'), { code: 'MCP_CONFIRMATION_INVALID' })
  }

  pruneExpired(): number {
    return this.database.prepare('DELETE FROM mcp_confirmations WHERE expires_at < ?').run(this.now().toISOString()).changes
  }
}
