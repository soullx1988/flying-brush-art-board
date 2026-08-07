import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { afterEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../app.js'
import { createDatabase } from '../../db/schema.js'
import { McpOAuthRepository } from '../auth/mcp-oauth-repository.js'

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

function issueOAuthToken(repository: McpOAuthRepository, resource: string) {
  const client = repository.registerClient({
    client_id: 'mcp-protocol-test',
    client_name: 'MCP protocol test',
    redirect_uris: ['http://127.0.0.1:49152/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  })
  const requestToken = repository.createAuthorizationRequest({
    client,
    redirectUri: client.redirect_uris[0]!,
    codeChallenge: 'a'.repeat(43),
    resource,
  })
  const approved = repository.approveAuthorizationRequest(requestToken, { openId: 'local-acceptance-user', name: 'Local acceptance user' })
  return repository.exchangeAuthorizationCode({ clientId: client.client_id, code: approved.code }).access_token
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'infinite-board-mcp-'))
  const database = createDatabase(':memory:')
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const oauth = new McpOAuthRepository(database)
  const accessToken = issueOAuthToken(oauth, `${baseUrl}/mcp`)
  const app = await buildApp({
    database,
    dataDirectory: directory,
    assetDirectory: join(directory, 'assets'),
    environment: { NODE_ENV: 'test', FEISHU_AUTH_ENABLED: 'false', MCP_ENABLED: 'true' },
    enableMcp: true,
    enableRealtime: true,
    mcpPublicUrl: baseUrl,
    mcpAllowedHosts: ['127.0.0.1'],
    mcpAllowedOrigins: [baseUrl],
  })
  await app.listen({ host: '127.0.0.1', port })
  cleanup.push(async () => {
    await app.close()
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const client = new Client({ name: 'mcp-test-client', version: '2.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
  })
  await client.connect(transport as never)
  cleanup.push(async () => client.close())
  return { app, baseUrl, client, accessToken, database }
}

class InMemoryOAuthProvider implements OAuthClientProvider {
  readonly redirectUrl = 'http://127.0.0.1:49152/callback'
  readonly clientMetadata: OAuthClientMetadata = {
    client_name: 'Official SDK OAuth test',
    redirect_uris: [this.redirectUrl],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }
  authorizationUrl?: URL
  private information?: OAuthClientInformationMixed
  private oauthTokens?: OAuthTokens
  private verifier?: string

  clientInformation() { return this.information }
  saveClientInformation(value: OAuthClientInformationMixed) { this.information = value }
  tokens() { return this.oauthTokens }
  saveTokens(value: OAuthTokens) { this.oauthTokens = value }
  redirectToAuthorization(url: URL) { this.authorizationUrl = url }
  saveCodeVerifier(value: string) { this.verifier = value }
  codeVerifier() {
    if (!this.verifier) throw new Error('PKCE verifier missing')
    return this.verifier
  }
}

describe('remote MCP v2 protocol', () => {
  it('rejects missing and legacy PAT credentials with OAuth discovery metadata', async () => {
    const { baseUrl } = await fixture()
    for (const authorization of [undefined, 'Bearer ibmcp_legacy_personal_token']) {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }),
      })
      expect(response.status).toBe(401)
      expect(response.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource/mcp')
    }
  })

  it('completes login with the official SDK OAuth Client Provider flow', async () => {
    const { baseUrl } = await fixture()
    const provider = new InMemoryOAuthProvider()
    const firstTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { authProvider: provider })
    const firstClient = new Client({ name: 'oauth-bootstrap', version: '2.0.0' })
    await expect(firstClient.connect(firstTransport as never)).rejects.toThrow()
    expect(provider.authorizationUrl).toBeInstanceOf(URL)

    const authorize = await fetch(provider.authorizationUrl!, { redirect: 'manual' })
    expect(authorize.status).toBe(302)
    const consentUrl = new URL(authorize.headers.get('location')!, baseUrl)
    const consent = await fetch(`${baseUrl}/oauth/consent`, {
      method: 'POST',
      redirect: 'manual',
      headers: { origin: baseUrl, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ request: consentUrl.searchParams.get('request')!, decision: 'approve' }),
    })
    expect(consent.status).toBe(303)
    const code = new URL(consent.headers.get('location')!).searchParams.get('code')!
    await firstTransport.finishAuth(code)

    const authenticatedTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { authProvider: provider })
    const authenticatedClient = new Client({ name: 'oauth-authenticated', version: '2.0.0' })
    await authenticatedClient.connect(authenticatedTransport as never)
    expect((await authenticatedClient.listTools()).tools.length).toBeGreaterThan(20)
    await authenticatedClient.close()
  })

  it('initializes, reports v2 capabilities and commits project plus shape through application services', async () => {
    const { client, database } = await fixture()
    const listed = await client.listTools()
    expect(listed.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'system_get_current_user', 'system_get_capabilities', 'project_create', 'board_create_embedded', 'board_inspect', 'shape_create', 'shape_batch', 'audit_list',
    ]))

    const capabilities = await client.callTool({ name: 'system_get_capabilities', arguments: {} })
    expect(capabilities.structuredContent).toMatchObject({
      serverVersion: '2.0.0',
      transport: 'Streamable HTTP',
      authentication: 'OAuth 2.1',
      features: { atomicEmbeddedBoardCreate: true },
    })
    const projectResult = await client.callTool({ name: 'project_create', arguments: { title: 'MCP 项目', idempotencyKey: 'create-project-1' } })
    expect(projectResult.isError).not.toBe(true)
    const projectReceipt = projectResult.structuredContent as { data: { project: { id: string }; rootBoard: { id: string } } }
    const boardId = projectReceipt.data.rootBoard.id

    const shapeResult = await client.callTool({
      name: 'shape_create',
      arguments: { boardId, kind: 'geo', x: 100, y: 120, width: 180, height: 100, text: '里程碑', expectedRevision: 0, idempotencyKey: 'shape-1' },
    })
    expect(shapeResult.isError).not.toBe(true)
    expect(shapeResult.structuredContent).toMatchObject({ revision: 1, affectedIds: [expect.stringMatching(/^shape:/)] })
    const board = database.prepare('SELECT revision,tldraw_snapshot FROM boards WHERE id=?').get(boardId) as { revision: number; tldraw_snapshot: string }
    expect(board.revision).toBe(1)
    expect(board.tldraw_snapshot).toContain('里程碑')
    expect(database.prepare('SELECT COUNT(*) AS count FROM board_checkpoints WHERE board_id=?').get(boardId)).toEqual({ count: 1 })
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='mcp.shape_create'").get()).toEqual({ count: 1 })
  })

  it('atomically creates an embedded board with the same reference shape contract as the web insert tool', async () => {
    const { client, database } = await fixture()
    const created = await client.callTool({ name: 'project_create', arguments: { title: 'Embedded board project' } })
    const project = (created.structuredContent as { data: { rootBoard: { id: string } } }).data

    const embedded = await client.callTool({
      name: 'board_create_embedded',
      arguments: {
        sourceBoardId: project.rootBoard.id,
        title: 'Child requirements',
        x: 320,
        y: 240,
        expectedRevision: 0,
        idempotencyKey: 'embedded-board-1',
      },
    })

    expect(embedded.isError).not.toBe(true)
    const receipt = embedded.structuredContent as {
      revision: number
      affectedIds: string[]
      data: {
        board: { id: string; title: string; revision: number }
        reference: { id: string; shapeId: string; sourceBoardId: string; targetBoardId: string; kind: string }
        revision: number
      }
    }
    expect(receipt).toMatchObject({
      revision: 1,
      data: {
        board: { title: 'Child requirements', revision: 0 },
        reference: { sourceBoardId: project.rootBoard.id, kind: 'embed' },
        revision: 1,
      },
    })
    expect(receipt.data.reference.targetBoardId).toBe(receipt.data.board.id)
    expect(receipt.affectedIds).toEqual([
      receipt.data.board.id,
      receipt.data.reference.id,
      receipt.data.reference.shapeId,
    ])

    const source = database.prepare('SELECT revision,tldraw_snapshot FROM boards WHERE id=?').get(project.rootBoard.id) as { revision: number; tldraw_snapshot: string }
    const target = database.prepare('SELECT revision,tldraw_snapshot FROM boards WHERE id=?').get(receipt.data.board.id) as { revision: number; tldraw_snapshot: string }
    const shape = Object.values((JSON.parse(source.tldraw_snapshot) as { store: Record<string, any> }).store)
      .find((record: any) => record.id === receipt.data.reference.shapeId) as any
    expect(source.revision).toBe(1)
    expect(JSON.parse(target.tldraw_snapshot)).toEqual({ store: {} })
    expect(shape).toMatchObject({
      typeName: 'shape',
      type: 'board-reference',
      x: 320,
      y: 240,
      props: {
        w: 300,
        h: 168,
        referenceId: receipt.data.reference.id,
        targetBoardId: receipt.data.board.id,
        kind: 'embed',
        titleFallback: 'Child requirements',
      },
    })

    const replayed = await client.callTool({
      name: 'board_create_embedded',
      arguments: {
        sourceBoardId: project.rootBoard.id,
        title: 'Child requirements',
        x: 320,
        y: 240,
        expectedRevision: 0,
        idempotencyKey: 'embedded-board-1',
      },
    })
    expect(replayed.structuredContent).toMatchObject({ replayed: true, revision: 1 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM boards').get()).toEqual({ count: 2 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM board_references').get()).toEqual({ count: 1 })

    const conflicted = await client.callTool({
      name: 'board_create_embedded',
      arguments: {
        sourceBoardId: project.rootBoard.id,
        title: 'Must roll back',
        expectedRevision: 0,
        idempotencyKey: 'embedded-board-conflict',
      },
    })
    expect(conflicted.isError).toBe(true)
    expect(conflicted.structuredContent).toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(database.prepare('SELECT COUNT(*) AS count FROM boards').get()).toEqual({ count: 2 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM board_references').get()).toEqual({ count: 1 })
  })

  it('returns a short-lived OAuth-authenticated download link instead of inline binary', async () => {
    const { client, accessToken } = await fixture()
    const created = await client.callTool({ name: 'project_create', arguments: { title: 'Export project' } })
    const projectId = (created.structuredContent as { data: { project: { id: string } } }).data.project.id
    const exported = await client.callTool({ name: 'export_project', arguments: { projectId, format: 'iboard' } })
    expect(JSON.stringify(exported.structuredContent)).not.toContain('base64')
    const download = (exported.structuredContent as { data: { downloadUrl: string; expiresAt: string } }).data
    const response = await fetch(download.downloadUrl, { headers: { authorization: `Bearer ${accessToken}` } })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/vnd.infinite-board+zip')
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(100)
  })

  it('returns object-shaped reference and comment collections through the SDK', async () => {
    const { client } = await fixture()
    const created = await client.callTool({ name: 'project_create', arguments: { title: 'Collection contract project' } })
    const project = (created.structuredContent as { data: { project: { id: string }; rootBoard: { id: string } } }).data
    const second = await client.callTool({ name: 'board_create', arguments: { projectId: project.project.id, title: 'Target' } })
    const targetBoardId = (second.structuredContent as { data: { id: string } }).data.id

    await client.callTool({
      name: 'reference_create',
      arguments: { sourceBoardId: project.rootBoard.id, targetBoardId, kind: 'link', expectedRevision: 0 },
    })
    await client.callTool({
      name: 'comment_create',
      arguments: { boardId: project.rootBoard.id, body: 'Contract comment' },
    })

    const references = await client.callTool({
      name: 'reference_list',
      arguments: { boardId: project.rootBoard.id, direction: 'outbound' },
    })
    const comments = await client.callTool({
      name: 'comment_list',
      arguments: { boardId: project.rootBoard.id, status: 'open' },
    })

    expect(references.isError).not.toBe(true)
    expect(references.structuredContent).toMatchObject({
      references: [expect.objectContaining({ sourceBoardId: project.rootBoard.id, targetBoardId })],
    })
    expect(comments.isError).not.toBe(true)
    expect(comments.structuredContent).toMatchObject({
      threads: [expect.objectContaining({ boardId: project.rootBoard.id, status: 'open' })],
    })
  })
})
