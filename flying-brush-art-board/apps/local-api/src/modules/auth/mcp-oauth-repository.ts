import { createHash, randomBytes, randomUUID } from 'node:crypto'

import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'

import type { LocalDatabase } from '../../db/schema.js'

export const MCP_SCOPES = [
  'project:read',
  'project:write',
  'board:read',
  'board:write',
  'import',
  'export',
  'audit:read',
] as const

export type McpScope = (typeof MCP_SCOPES)[number]

const AUTHORIZATION_REQUEST_TTL_MS = 5 * 60 * 1_000
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1_000
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1_000
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1_000

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function token(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`
}

function parseScopes(value: string): McpScope[] {
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed) || !parsed.every((scope) => MCP_SCOPES.includes(scope as McpScope))) {
    throw new Error('MCP_OAUTH_SCOPES_INVALID')
  }
  return parsed as McpScope[]
}

function publicClient(client: OAuthClientInformationFull): OAuthClientInformationFull {
  return {
    ...client,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: MCP_SCOPES.join(' '),
    client_secret: undefined,
    client_secret_expires_at: undefined,
  }
}

interface AuthorizationRequestRow {
  client_id: string
  redirect_uri: string
  state: string | null
  code_challenge: string
  resource: string
  expires_at: string
}

interface GrantRow {
  id: string
  open_id: string
  user_name: string
  client_id: string
  client_name: string
  scopes_json: string
  enabled: number
  created_at: string
  updated_at: string
  last_used_at: string | null
  revoked_at: string | null
}

interface AuthorizationCodeRow {
  grant_id: string
  client_id: string
  redirect_uri: string
  code_challenge: string
  resource: string
  expires_at: string
  consumed_at: string | null
}

interface RefreshTokenRow {
  grant_id: string
  client_id: string
  scopes_json: string
  resource: string
  expires_at: string
  used_at: string | null
  revoked_at: string | null
}

export interface McpOAuthGrantRecord {
  id: string
  openId: string
  userName: string
  oauthClientId: string
  clientName: string
  scopes: McpScope[]
  enabled: boolean
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
  revokedAt?: string
}

export interface McpOAuthAccess extends McpOAuthGrantRecord {
  accessTokenExpiresAt: string
}

export interface McpAuthorizationRequest {
  requestToken: string
  client: OAuthClientInformationFull
  redirectUri: string
  state?: string
  codeChallenge: string
  resource: string
  expiresAt: string
}

function toGrant(row: GrantRow): McpOAuthGrantRecord {
  return {
    id: row.id,
    openId: row.open_id,
    userName: row.user_name,
    oauthClientId: row.client_id,
    clientName: row.client_name,
    scopes: parseScopes(row.scopes_json),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_used_at ? { lastUsedAt: row.last_used_at } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
  }
}

export class McpOAuthRepository implements OAuthRegisteredClientsStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const row = this.database.prepare('SELECT metadata_json FROM mcp_oauth_clients WHERE client_id=?').get(clientId) as { metadata_json: string } | undefined
    if (!row) return undefined
    return JSON.parse(row.metadata_json) as OAuthClientInformationFull
  }

  registerClient(client: OAuthClientInformationFull): OAuthClientInformationFull {
    const normalized = publicClient(client)
    const now = this.now().toISOString()
    this.database.prepare(`INSERT INTO mcp_oauth_clients(client_id,metadata_json,created_at,updated_at)
      VALUES (?,?,?,?)
      ON CONFLICT(client_id) DO UPDATE SET metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
      .run(normalized.client_id, JSON.stringify(normalized), now, now)
    return normalized
  }

  createAuthorizationRequest(input: {
    client: OAuthClientInformationFull
    redirectUri: string
    state?: string
    codeChallenge: string
    resource: string
  }): string {
    const requestToken = token('ibmcp2_q_')
    const now = this.now()
    this.database.prepare(`INSERT INTO mcp_oauth_requests
      (request_hash,client_id,redirect_uri,state,code_challenge,resource,created_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(
        hash(requestToken), input.client.client_id, input.redirectUri, input.state ?? null,
        input.codeChallenge, input.resource, now.toISOString(), new Date(now.getTime() + AUTHORIZATION_REQUEST_TTL_MS).toISOString(),
      )
    return requestToken
  }

  getAuthorizationRequest(requestToken: string): McpAuthorizationRequest | undefined {
    const row = this.database.prepare(`SELECT client_id,redirect_uri,state,code_challenge,resource,expires_at
      FROM mcp_oauth_requests WHERE request_hash=?`).get(hash(requestToken)) as AuthorizationRequestRow | undefined
    if (!row || Date.parse(row.expires_at) <= this.now().getTime()) return undefined
    const client = this.getClient(row.client_id)
    if (!client) return undefined
    return {
      requestToken,
      client,
      redirectUri: row.redirect_uri,
      ...(row.state ? { state: row.state } : {}),
      codeChallenge: row.code_challenge,
      resource: row.resource,
      expiresAt: row.expires_at,
    }
  }

  approveAuthorizationRequest(requestToken: string, user: { openId: string; name: string }): { request: McpAuthorizationRequest; code: string; grant: McpOAuthGrantRecord } {
    const execute = this.database.transaction(() => {
      const request = this.getAuthorizationRequest(requestToken)
      if (!request) throw new Error('MCP_OAUTH_REQUEST_INVALID')
      this.database.prepare('DELETE FROM mcp_oauth_requests WHERE request_hash=?').run(hash(requestToken))

      const now = this.now()
      const nowIso = now.toISOString()
      const existing = this.database.prepare(`SELECT id FROM mcp_oauth_grants
        WHERE open_id=? AND client_id=? AND revoked_at IS NULL`).all(user.openId, request.client.client_id) as Array<{ id: string }>
      for (const row of existing) this.revokeGrantInternal(row.id, nowIso)

      const grantId = randomUUID()
      const clientName = request.client.client_name?.trim() || 'MCP 客户端'
      this.database.prepare(`INSERT INTO mcp_oauth_grants
        (id,open_id,user_name,client_id,client_name,scopes_json,enabled,created_at,updated_at,last_used_at,revoked_at)
        VALUES (?,?,?,?,?,?,1,?,?,NULL,NULL)`)
        .run(grantId, user.openId, user.name, request.client.client_id, clientName, JSON.stringify(MCP_SCOPES), nowIso, nowIso)

      const code = token('ibmcp2_c_')
      this.database.prepare(`INSERT INTO mcp_oauth_codes
        (code_hash,grant_id,client_id,redirect_uri,code_challenge,resource,created_at,expires_at,consumed_at)
        VALUES (?,?,?,?,?,?,?,?,NULL)`)
        .run(
          hash(code), grantId, request.client.client_id, request.redirectUri, request.codeChallenge,
          request.resource, nowIso, new Date(now.getTime() + AUTHORIZATION_CODE_TTL_MS).toISOString(),
        )
      const grant = this.getGrant(grantId)
      if (!grant) throw new Error('MCP_OAUTH_GRANT_CREATE_FAILED')
      return { request, code, grant }
    })
    return execute()
  }

  denyAuthorizationRequest(requestToken: string): McpAuthorizationRequest | undefined {
    const request = this.getAuthorizationRequest(requestToken)
    if (request) this.database.prepare('DELETE FROM mcp_oauth_requests WHERE request_hash=?').run(hash(requestToken))
    return request
  }

  challengeForAuthorizationCode(clientId: string, code: string): string | undefined {
    const row = this.database.prepare(`SELECT code_challenge FROM mcp_oauth_codes
      WHERE code_hash=? AND client_id=? AND consumed_at IS NULL AND expires_at>?`)
      .get(hash(code), clientId, this.now().toISOString()) as { code_challenge: string } | undefined
    return row?.code_challenge
  }

  authorizationCodeIdentity(clientId: string, code: string): { openId: string } | undefined {
    return this.database.prepare(`SELECT g.open_id AS openId FROM mcp_oauth_codes c
      JOIN mcp_oauth_grants g ON g.id=c.grant_id
      WHERE c.code_hash=? AND c.client_id=? AND c.consumed_at IS NULL AND c.expires_at>?
        AND g.enabled=1 AND g.revoked_at IS NULL`)
      .get(hash(code), clientId, this.now().toISOString()) as { openId: string } | undefined
  }

  exchangeAuthorizationCode(input: {
    clientId: string
    code: string
    redirectUri?: string
    resource?: string
  }): OAuthTokens {
    const execute = this.database.transaction(() => {
      const row = this.database.prepare(`SELECT grant_id,client_id,redirect_uri,code_challenge,resource,expires_at,consumed_at
        FROM mcp_oauth_codes WHERE code_hash=? AND client_id=?`).get(hash(input.code), input.clientId) as AuthorizationCodeRow | undefined
      if (!row || row.consumed_at || Date.parse(row.expires_at) <= this.now().getTime()) throw new Error('MCP_OAUTH_CODE_INVALID')
      if (input.redirectUri !== undefined && input.redirectUri !== row.redirect_uri) throw new Error('MCP_OAUTH_REDIRECT_MISMATCH')
      if (input.resource !== undefined && input.resource !== row.resource) throw new Error('MCP_OAUTH_RESOURCE_MISMATCH')
      const grant = this.getGrant(row.grant_id)
      if (!grant?.enabled || grant.revokedAt) throw new Error('MCP_OAUTH_GRANT_DISABLED')
      this.database.prepare('UPDATE mcp_oauth_codes SET consumed_at=? WHERE code_hash=? AND consumed_at IS NULL')
        .run(this.now().toISOString(), hash(input.code))
      return this.issueTokens(grant, row.resource)
    })
    return execute()
  }

  refreshTokenIdentity(clientId: string, refreshToken: string): { openId: string } | undefined {
    return this.database.prepare(`SELECT g.open_id AS openId FROM mcp_oauth_refresh_tokens r
      JOIN mcp_oauth_grants g ON g.id=r.grant_id
      WHERE r.token_hash=? AND r.client_id=? AND r.used_at IS NULL AND r.revoked_at IS NULL AND r.expires_at>?
        AND g.enabled=1 AND g.revoked_at IS NULL`)
      .get(hash(refreshToken), clientId, this.now().toISOString()) as { openId: string } | undefined
  }

  rotateRefreshToken(input: { clientId: string; refreshToken: string; resource?: string }): OAuthTokens {
    const execute = this.database.transaction(() => {
      const row = this.database.prepare(`SELECT grant_id,client_id,scopes_json,resource,expires_at,used_at,revoked_at
        FROM mcp_oauth_refresh_tokens WHERE token_hash=? AND client_id=?`)
        .get(hash(input.refreshToken), input.clientId) as RefreshTokenRow | undefined
      if (!row || row.used_at || row.revoked_at || Date.parse(row.expires_at) <= this.now().getTime()) throw new Error('MCP_OAUTH_REFRESH_INVALID')
      if (input.resource !== undefined && input.resource !== row.resource) throw new Error('MCP_OAUTH_RESOURCE_MISMATCH')
      const grant = this.getGrant(row.grant_id)
      if (!grant?.enabled || grant.revokedAt) throw new Error('MCP_OAUTH_GRANT_DISABLED')
      this.database.prepare('UPDATE mcp_oauth_refresh_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL')
        .run(this.now().toISOString(), hash(input.refreshToken))
      return this.issueTokens(grant, row.resource)
    })
    return execute()
  }

  verifyAccessToken(accessToken: string): McpOAuthAccess | undefined {
    const now = this.now()
    const row = this.database.prepare(`SELECT a.expires_at AS access_expires_at,g.* FROM mcp_oauth_access_tokens a
      JOIN mcp_oauth_grants g ON g.id=a.grant_id
      WHERE a.token_hash=? AND a.revoked_at IS NULL AND a.expires_at>?
        AND g.enabled=1 AND g.revoked_at IS NULL`)
      .get(hash(accessToken), now.toISOString()) as (GrantRow & { access_expires_at: string }) | undefined
    if (!row) return undefined
    const usedAt = now.toISOString()
    this.database.prepare('UPDATE mcp_oauth_access_tokens SET last_used_at=? WHERE token_hash=?').run(usedAt, hash(accessToken))
    this.database.prepare('UPDATE mcp_oauth_grants SET last_used_at=?,updated_at=? WHERE id=?').run(usedAt, usedAt, row.id)
    return { ...toGrant({ ...row, last_used_at: usedAt }), accessTokenExpiresAt: row.access_expires_at }
  }

  revokeToken(request: OAuthTokenRevocationRequest, clientId?: string): void {
    const tokenHash = hash(request.token)
    const access = this.database.prepare(`SELECT grant_id FROM mcp_oauth_access_tokens
      WHERE token_hash=? AND (? IS NULL OR client_id=?)`).get(tokenHash, clientId ?? null, clientId ?? null) as { grant_id: string } | undefined
    const refresh = access ? undefined : this.database.prepare(`SELECT grant_id FROM mcp_oauth_refresh_tokens
      WHERE token_hash=? AND (? IS NULL OR client_id=?)`).get(tokenHash, clientId ?? null, clientId ?? null) as { grant_id: string } | undefined
    const grantId = access?.grant_id ?? refresh?.grant_id
    if (grantId) this.revokeGrantInternal(grantId, this.now().toISOString())
  }

  listGrantsForUser(openId: string): McpOAuthGrantRecord[] {
    return (this.database.prepare(`SELECT * FROM mcp_oauth_grants
      WHERE open_id=? AND revoked_at IS NULL ORDER BY created_at DESC`).all(openId) as GrantRow[]).map(toGrant)
  }

  setGrantEnabled(grantId: string, openId: string, enabled: boolean): boolean {
    const now = this.now().toISOString()
    const result = this.database.prepare(`UPDATE mcp_oauth_grants SET enabled=?,updated_at=?
      WHERE id=? AND open_id=? AND revoked_at IS NULL`).run(enabled ? 1 : 0, now, grantId, openId)
    return result.changes > 0
  }

  revokeGrant(grantId: string, openId: string): boolean {
    const row = this.database.prepare('SELECT id FROM mcp_oauth_grants WHERE id=? AND open_id=? AND revoked_at IS NULL')
      .get(grantId, openId) as { id: string } | undefined
    if (!row) return false
    this.revokeGrantInternal(grantId, this.now().toISOString())
    return true
  }

  getGrant(grantId: string): McpOAuthGrantRecord | undefined {
    const row = this.database.prepare('SELECT * FROM mcp_oauth_grants WHERE id=?').get(grantId) as GrantRow | undefined
    return row ? toGrant(row) : undefined
  }

  pruneExpired(): void {
    const now = this.now().toISOString()
    this.database.prepare('DELETE FROM mcp_oauth_requests WHERE expires_at<=?').run(now)
    this.database.prepare('DELETE FROM mcp_oauth_codes WHERE expires_at<=? OR consumed_at IS NOT NULL').run(now)
    this.database.prepare('DELETE FROM mcp_oauth_access_tokens WHERE expires_at<=? OR revoked_at IS NOT NULL').run(now)
    this.database.prepare('DELETE FROM mcp_oauth_refresh_tokens WHERE expires_at<=? OR revoked_at IS NOT NULL OR used_at IS NOT NULL').run(now)
  }

  private issueTokens(grant: McpOAuthGrantRecord, resource: string): OAuthTokens {
    const now = this.now()
    const accessToken = token('ibmcp2_a_')
    const refreshToken = token('ibmcp2_r_')
    const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString()
    const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS).toISOString()
    this.database.prepare(`INSERT INTO mcp_oauth_access_tokens
      (token_hash,grant_id,client_id,scopes_json,resource,created_at,expires_at,last_used_at,revoked_at)
      VALUES (?,?,?,?,?,?,?,NULL,NULL)`)
      .run(hash(accessToken), grant.id, grant.oauthClientId, JSON.stringify(grant.scopes), resource, now.toISOString(), accessExpiresAt)
    this.database.prepare(`INSERT INTO mcp_oauth_refresh_tokens
      (token_hash,grant_id,client_id,scopes_json,resource,created_at,expires_at,used_at,revoked_at)
      VALUES (?,?,?,?,?,?,?,NULL,NULL)`)
      .run(hash(refreshToken), grant.id, grant.oauthClientId, JSON.stringify(grant.scopes), resource, now.toISOString(), refreshExpiresAt)
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope: grant.scopes.join(' '),
    }
  }

  private revokeGrantInternal(grantId: string, revokedAt: string): void {
    this.database.prepare('UPDATE mcp_oauth_grants SET enabled=0,revoked_at=?,updated_at=? WHERE id=? AND revoked_at IS NULL')
      .run(revokedAt, revokedAt, grantId)
    this.database.prepare('UPDATE mcp_oauth_access_tokens SET revoked_at=? WHERE grant_id=? AND revoked_at IS NULL').run(revokedAt, grantId)
    this.database.prepare('UPDATE mcp_oauth_refresh_tokens SET revoked_at=? WHERE grant_id=? AND revoked_at IS NULL').run(revokedAt, grantId)
  }
}
