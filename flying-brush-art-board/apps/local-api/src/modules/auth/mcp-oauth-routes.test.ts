import { createHash } from 'node:crypto'
import { createServer } from 'node:net'

import { strFromU8, unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../app.js'
import { createDatabase } from '../../db/schema.js'
import { MCP_SCOPES, McpOAuthRepository } from './mcp-oauth-repository.js'

const cleanup: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.()
})

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('TEST_PORT_MISSING'))
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

async function fixture() {
  const port = await freePort()
  const publicOrigin = `http://127.0.0.1:${port}`
  const database = createDatabase(':memory:')
  const app = await buildApp({
    database,
    environment: { NODE_ENV: 'test', FEISHU_AUTH_ENABLED: 'false', MCP_ENABLED: 'true' },
    enableMcp: true,
    mcpPublicUrl: publicOrigin,
    mcpAllowedHosts: ['127.0.0.1'],
    mcpAllowedOrigins: [publicOrigin],
  })
  await app.listen({ host: '127.0.0.1', port })
  cleanup.push(async () => {
    await app.close()
    database.close()
  })
  return { publicOrigin, database }
}

function form(input: Record<string, string>): string {
  return new URLSearchParams(input).toString()
}

function postForm(url: string, body: string, headers: HeadersInit = {}): Promise<Response> {
  return fetch(url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body })
}

describe('MCP OAuth v2 routes', () => {
  it('publishes discovery and rejects forged hosts plus the removed token API', async () => {
    const { publicOrigin } = await fixture()
    const resource = await fetch(`${publicOrigin}/.well-known/oauth-protected-resource/mcp`)
    expect(resource.status).toBe(200)
    expect(await resource.json()).toMatchObject({ resource: `${publicOrigin}/mcp`, authorization_servers: [publicOrigin] })

    const authorization = await fetch(`${publicOrigin}/.well-known/oauth-authorization-server`)
    expect(authorization.status).toBe(200)
    expect(await authorization.json()).toMatchObject({
      issuer: publicOrigin,
      authorization_endpoint: `${publicOrigin}/oauth/authorize`,
      token_endpoint: `${publicOrigin}/oauth/token`,
      registration_endpoint: `${publicOrigin}/oauth/register`,
      revocation_endpoint: `${publicOrigin}/oauth/revoke`,
      code_challenge_methods_supported: ['S256'],
    })

    expect((await fetch(`${publicOrigin}/.well-known/oauth-authorization-server`, { headers: { 'x-forwarded-host': 'evil.example' } })).status).toBe(421)
    expect((await fetch(`${publicOrigin}/api/mcp/tokens`)).status).toBe(404)
    const setup = await fetch(`${publicOrigin}/api/mcp/setup/windows.ps1`)
    expect(setup.status).toBe(200)
    expect(setup.headers.get('content-disposition')).toContain('InfiniteBoard-MCP-Setup.ps1')
    expect(await setup.text()).toContain(`$mcpUrl = '${publicOrigin}/mcp'`)
    const setupArchive = await fetch(`${publicOrigin}/api/mcp/setup/windows.zip`)
    if (!setupArchive.ok) throw new Error(await setupArchive.text())
    expect(setupArchive.status).toBe(200)
    expect(setupArchive.headers.get('content-disposition')).toContain('InfiniteBoard-MCP-Setup.zip')
    const files = unzipSync(new Uint8Array(await setupArchive.arrayBuffer()))
    expect(strFromU8(files['InfiniteBoard-MCP-Setup.ps1']!)).toContain(`$mcpUrl = '${publicOrigin}/mcp'`)
    const batch = strFromU8(files['Install-InfiniteBoard-MCP.bat']!)
    expect(batch).toContain('InfiniteBoard-MCP-Setup.ps1')
    expect(batch).toContain('InfiniteBoard-MCP-Workflow-SKILL.md')
    expect(batch).toContain('-ExecutionPolicy Bypass')
    const workflowSkill = strFromU8(files['InfiniteBoard-MCP-Workflow-SKILL.md']!)
    expect(workflowSkill).toContain('name: infinite-board-mcp-workflow')
    expect(workflowSkill).toContain('## Handle destructive work')
  })

  it('completes PKCE, consumes codes once, rotates refresh tokens and enforces pause plus disconnect', async () => {
    const { publicOrigin } = await fixture()
    const redirectUri = 'http://127.0.0.1:49152/callback'
    const verifier = 'v'.repeat(64)
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const registration = await fetch(`${publicOrigin}/oauth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Codex teammate PC', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
    })
    expect(registration.status).toBe(201)
    const registered = await registration.json() as { client_id: string; client_secret?: string }
    expect(registered.client_id).toBeTruthy()
    expect(registered.client_secret).toBeUndefined()

    const authorizeUrl = new URL('/oauth/authorize', publicOrigin)
    authorizeUrl.search = form({ response_type: 'code', client_id: registered.client_id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', resource: `${publicOrigin}/mcp`, scope: MCP_SCOPES.join(' '), state: 'state-1' })
    const authorize = await fetch(authorizeUrl, { redirect: 'manual' })
    expect(authorize.status).toBe(302)
    const consentLocation = new URL(authorize.headers.get('location')!, publicOrigin)
    expect(consentLocation.pathname).toBe('/oauth/consent')
    const requestToken = consentLocation.searchParams.get('request')!

    const consentPage = await fetch(consentLocation)
    expect(consentPage.status).toBe(200)
    expect(consentPage.headers.get('content-security-policy')).toContain(`form-action 'self' ${new URL(redirectUri).origin}`)

    const consent = await postForm(`${publicOrigin}/oauth/consent`, form({ request: requestToken, decision: 'approve' }), { origin: publicOrigin })
    expect(consent.status).toBe(303)
    const callback = new URL(consent.headers.get('location')!)
    expect(callback.origin + callback.pathname).toBe(redirectUri)
    expect(callback.searchParams.get('state')).toBe('state-1')
    const code = callback.searchParams.get('code')!

    const repeatedConsent = await postForm(`${publicOrigin}/oauth/consent`, form({ request: requestToken, decision: 'approve' }), { origin: publicOrigin })
    expect(repeatedConsent.status).toBe(409)
    expect(await repeatedConsent.text()).toContain('授权请求已失效')

    const tokenBody = form({ grant_type: 'authorization_code', client_id: registered.client_id, code, code_verifier: verifier, redirect_uri: redirectUri, resource: `${publicOrigin}/mcp` })
    const wrongVerifierBody = form({ grant_type: 'authorization_code', client_id: registered.client_id, code, code_verifier: 'x'.repeat(64), redirect_uri: redirectUri, resource: `${publicOrigin}/mcp` })
    expect((await postForm(`${publicOrigin}/oauth/token`, wrongVerifierBody)).status).toBe(400)
    const token = await postForm(`${publicOrigin}/oauth/token`, tokenBody)
    expect(token.status).toBe(200)
    const tokens = await token.json() as { access_token: string; refresh_token: string; expires_in: number; scope: string }
    expect(tokens.expires_in).toBe(3600)
    expect(tokens.scope).toBe(MCP_SCOPES.join(' '))
    expect((await postForm(`${publicOrigin}/oauth/token`, tokenBody)).status).toBe(400)

    const clients = await fetch(`${publicOrigin}/api/mcp/clients`)
    expect(clients.status).toBe(200)
    const [grant] = await clients.json() as Array<{ id: string; enabled: boolean; clientName: string }>
    expect(grant).toMatchObject({ enabled: true, clientName: 'Codex teammate PC' })

    expect((await fetch(`${publicOrigin}/api/mcp/clients/${grant!.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) })).status).toBe(204)
    const refreshBody = form({ grant_type: 'refresh_token', client_id: registered.client_id, refresh_token: tokens.refresh_token, resource: `${publicOrigin}/mcp` })
    expect((await postForm(`${publicOrigin}/oauth/token`, refreshBody)).status).toBe(400)

    expect((await fetch(`${publicOrigin}/api/mcp/clients/${grant!.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) })).status).toBe(204)
    const refreshed = await postForm(`${publicOrigin}/oauth/token`, refreshBody)
    expect(refreshed.status).toBe(200)
    const refreshedTokens = await refreshed.json() as { access_token: string; refresh_token: string }
    expect((await postForm(`${publicOrigin}/oauth/token`, refreshBody)).status).toBe(400)

    expect((await fetch(`${publicOrigin}/api/mcp/clients/${grant!.id}`, { method: 'DELETE' })).status).toBe(204)
    const rejected = await fetch(`${publicOrigin}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${refreshedTokens.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
    expect(rejected.status).toBe(401)
  })

  it('rejects unknown scope, unregistered redirects, cross-origin consent and public-origin mismatches', async () => {
    const { publicOrigin } = await fixture()
    const redirectUri = 'http://127.0.0.1:49152/callback'
    const registration = await fetch(`${publicOrigin}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Security test', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }) })
    const clientId = ((await registration.json()) as { client_id: string }).client_id
    const base = { response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', resource: `${publicOrigin}/mcp` }
    const unknownScope = await fetch(`${publicOrigin}/oauth/authorize?${form({ ...base, scope: 'project:read unknown' })}`, { redirect: 'manual' })
    expect(unknownScope.status).toBe(302)
    expect(new URL(unknownScope.headers.get('location')!).searchParams.get('error')).toBe('invalid_request')
    expect((await fetch(`${publicOrigin}/oauth/authorize?${form({ ...base, redirect_uri: 'https://evil.example/callback', scope: MCP_SCOPES.join(' ') })}`, { redirect: 'manual' })).status).toBe(400)
    expect((await postForm(`${publicOrigin}/oauth/consent`, form({ request: 'ibmcp2_q_' + 'a'.repeat(43), decision: 'approve' }), { origin: 'https://evil.example' })).status).toBe(403)
    expect((await fetch(`${publicOrigin}/api/mcp/setup/windows.ps1`, { headers: { 'x-forwarded-host': '127.0.0.1:9999' } })).status).toBe(409)
    expect((await fetch(`${publicOrigin}/api/mcp/setup/windows.zip`, { headers: { 'x-forwarded-host': '127.0.0.1:9999' } })).status).toBe(409)
  })

  it('supports the standard revocation endpoint and revokes the entire token family', async () => {
    const { publicOrigin, database } = await fixture()
    const repository = new McpOAuthRepository(database)
    const client = repository.registerClient({
      client_id: 'revoke-test-client', client_name: 'Revoke test', redirect_uris: ['http://127.0.0.1:49152/callback'],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    })
    const request = repository.createAuthorizationRequest({ client, redirectUri: client.redirect_uris[0]!, codeChallenge: 'a'.repeat(43), resource: `${publicOrigin}/mcp` })
    const approved = repository.approveAuthorizationRequest(request, { openId: 'local-acceptance-user', name: 'Local acceptance user' })
    const tokens = repository.exchangeAuthorizationCode({ clientId: client.client_id, code: approved.code })
    const revoked = await postForm(`${publicOrigin}/oauth/revoke`, form({ token: tokens.refresh_token!, token_type_hint: 'refresh_token', client_id: client.client_id }))
    expect(revoked.status).toBe(200)
    expect(repository.verifyAccessToken(tokens.access_token)).toBeUndefined()
    expect(repository.refreshTokenIdentity(client.client_id, tokens.refresh_token!)).toBeUndefined()
  })
})
