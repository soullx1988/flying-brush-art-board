import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { createDatabase } from '../../db/schema.js'
import { MCP_SCOPES, McpOAuthRepository } from './mcp-oauth-repository.js'

const client = {
  client_id: 'oauth-client-1',
  client_name: 'Codex on teammate PC',
  redirect_uris: ['http://127.0.0.1:49152/callback'],
  token_endpoint_auth_method: 'none' as const,
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
}

function authorize(repository: McpOAuthRepository) {
  const registered = repository.registerClient(client)
  const requestToken = repository.createAuthorizationRequest({
    client: registered,
    redirectUri: client.redirect_uris[0]!,
    state: 'state-1',
    codeChallenge: 'a'.repeat(43),
    resource: 'http://127.0.0.1:8787/mcp',
  })
  const approved = repository.approveAuthorizationRequest(requestToken, { openId: 'ou_test', name: '测试用户' })
  return { registered, requestToken, approved }
}

describe('McpOAuthRepository', () => {
  it('stores authorization material as hashes and fixes every grant to all scopes', () => {
    const database = createDatabase(':memory:')
    try {
      const repository = new McpOAuthRepository(database, () => new Date('2026-07-30T00:00:00.000Z'))
      const { requestToken, approved } = authorize(repository)
      expect(approved.grant.scopes).toEqual(MCP_SCOPES)
      expect(approved.grant.enabled).toBe(true)
      expect(JSON.stringify(database.prepare('SELECT * FROM mcp_oauth_requests').all())).not.toContain(requestToken)
      expect(JSON.stringify(database.prepare('SELECT * FROM mcp_oauth_codes').all())).not.toContain(approved.code)

      const tokens = repository.exchangeAuthorizationCode({ clientId: client.client_id, code: approved.code, redirectUri: client.redirect_uris[0]! })
      expect(tokens.expires_in).toBe(3600)
      expect(tokens.scope).toBe(MCP_SCOPES.join(' '))
      expect(JSON.stringify(database.prepare('SELECT * FROM mcp_oauth_access_tokens').all())).not.toContain(tokens.access_token)
      expect(JSON.stringify(database.prepare('SELECT * FROM mcp_oauth_refresh_tokens').all())).not.toContain(tokens.refresh_token)
      expect(database.prepare('SELECT token_hash FROM mcp_oauth_access_tokens').get()).toEqual({
        token_hash: createHash('sha256').update(tokens.access_token).digest('hex'),
      })
    } finally {
      database.close()
    }
  })

  it('consumes authorization codes once and rotates refresh tokens once', () => {
    const database = createDatabase(':memory:')
    try {
      const repository = new McpOAuthRepository(database)
      const { approved } = authorize(repository)
      const first = repository.exchangeAuthorizationCode({ clientId: client.client_id, code: approved.code })
      expect(() => repository.exchangeAuthorizationCode({ clientId: client.client_id, code: approved.code })).toThrow('MCP_OAUTH_CODE_INVALID')
      const second = repository.rotateRefreshToken({ clientId: client.client_id, refreshToken: first.refresh_token! })
      expect(second.refresh_token).not.toBe(first.refresh_token)
      expect(() => repository.rotateRefreshToken({ clientId: client.client_id, refreshToken: first.refresh_token! })).toThrow('MCP_OAUTH_REFRESH_INVALID')
    } finally {
      database.close()
    }
  })

  it('rejects access and refresh while paused and revokes the whole family when disconnected', () => {
    const database = createDatabase(':memory:')
    try {
      const repository = new McpOAuthRepository(database)
      const { approved } = authorize(repository)
      const tokens = repository.exchangeAuthorizationCode({ clientId: client.client_id, code: approved.code })
      expect(repository.verifyAccessToken(tokens.access_token)?.openId).toBe('ou_test')

      expect(repository.setGrantEnabled(approved.grant.id, 'ou_test', false)).toBe(true)
      expect(repository.verifyAccessToken(tokens.access_token)).toBeUndefined()
      expect(repository.refreshTokenIdentity(client.client_id, tokens.refresh_token!)).toBeUndefined()

      expect(repository.setGrantEnabled(approved.grant.id, 'ou_test', true)).toBe(true)
      expect(repository.verifyAccessToken(tokens.access_token)?.id).toBe(approved.grant.id)
      expect(repository.revokeGrant(approved.grant.id, 'ou_test')).toBe(true)
      expect(repository.verifyAccessToken(tokens.access_token)).toBeUndefined()
      expect(repository.listGrantsForUser('ou_test')).toEqual([])
    } finally {
      database.close()
    }
  })
})
