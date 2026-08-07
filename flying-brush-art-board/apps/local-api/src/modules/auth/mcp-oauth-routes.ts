import { readFileSync } from 'node:fs'

import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { RequestHandler } from 'express'
import express from 'express'
import { strToU8, zipSync } from 'fflate'
import { z } from 'zod'

import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js'
import { metadataHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/metadata.js'
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js'
import { revocationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js'
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js'

import { SESSION_COOKIE_NAME } from './auth-plugin.js'
import type { AllowedUser } from './allowed-user-directory.js'
import type { SessionRepository } from './session-repository.js'
import type { UserDirectoryCache } from './user-directory-cache.js'
import { MCP_SCOPES, type McpOAuthRepository } from './mcp-oauth-repository.js'
import type { InfiniteBoardOAuthProvider } from './mcp-oauth-provider.js'
import type { AuditRepository } from '../audit/audit-repository.js'

const grantParamsSchema = z.object({ grantId: z.string().uuid() }).strict()
const updateGrantSchema = z.object({ enabled: z.boolean() }).strict()
const requestTokenSchema = z.string().regex(/^ibmcp2_q_[A-Za-z0-9_-]{40,80}$/)

export interface McpOAuthRouteOptions {
  repository: McpOAuthRepository
  provider: InfiniteBoardOAuthProvider
  publicOrigin: URL
  audit?: AuditRepository
  sessions?: SessionRepository
  users?: UserDirectoryCache
  localUser?: AllowedUser
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

function firstForwarded(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  return raw?.split(',')[0]?.trim() || undefined
}

function requestOrigin(request: FastifyRequest): string | undefined {
  const protocol = firstForwarded(request.headers['x-forwarded-proto']) ?? request.protocol
  const host = firstForwarded(request.headers['x-forwarded-host']) ?? request.headers.host
  if (!host || (protocol !== 'http' && protocol !== 'https')) return undefined
  try {
    return new URL(`${protocol}://${host}`).origin
  } catch {
    return undefined
  }
}

function consentContentSecurityPolicy(redirectUri: string): string {
  const callbackOrigin = new URL(redirectUri).origin
  return `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${callbackOrigin}; base-uri 'none'; frame-ancestors 'none'`
}

async function currentUser(request: FastifyRequest, options: McpOAuthRouteOptions): Promise<AllowedUser | undefined> {
  if (options.sessions && options.users) {
    const sessionToken = request.cookies[SESSION_COOKIE_NAME]
    if (!sessionToken) return undefined
    const session = options.sessions.findAndRefresh(sessionToken)
    if (!session) return undefined
    return options.users.requireAllowed(session.openId)
  }
  return options.localUser
}

function consentPage(input: { requestToken: string; clientName: string; redirectUri: string; userName: string }): string {
  const clientName = escapeHtml(input.clientName)
  const redirectHost = escapeHtml(new URL(input.redirectUri).host)
  const userName = escapeHtml(input.userName)
  const requestToken = escapeHtml(input.requestToken)
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>授权 MCP 客户端</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f2f4f7;color:#17191c;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(520px,calc(100vw - 48px));padding:32px;border:1px solid #d9dee7;border-radius:24px;background:#fff;box-shadow:0 24px 70px #2731421c}
h1{margin:0 0 12px;font-size:25px}p{margin:8px 0;color:#596273}.client{margin:22px 0;padding:16px;border:1px solid #e2e6ed;border-radius:16px;background:#f8f9fb}.client strong{display:block;color:#17191c;font-size:17px}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:24px}button{height:40px;padding:0 18px;border:1px solid #cfd5df;border-radius:12px;background:#fff;font:inherit;cursor:pointer}button.primary{border-color:#17191c;background:#17191c;color:#fff}
</style></head><body><main><h1>连接 Infinite Board MCP</h1>
<p>当前登录用户：${userName}</p><div class="client"><strong>${clientName}</strong><span>授权回调：${redirectHost}</span></div>
<p>该客户端将获得项目、画板、评论、导入导出和审计的全部 MCP 权限。授权后可在“集成”页随时暂停或断开。</p>
<form method="post" action="/oauth/consent"><input type="hidden" name="request" value="${requestToken}"><div class="actions">
<button type="submit" name="decision" value="deny">取消</button><button class="primary" type="submit" name="decision" value="approve">允许并连接</button>
</div></form></main></body></html>`
}

function completionPage(): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>授权完成</title></head><body style="font:16px system-ui;padding:48px"><h1>授权已完成</h1><p>可以关闭此页面并返回 MCP 客户端。</p></body></html>`
}

function invalidAuthorizationPage(): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>授权请求已失效</title></head><body style="font:16px system-ui;padding:48px"><h1>授权请求已失效</h1><p>该请求可能已完成、已过期或被重复提交。请关闭此页，返回 MCP 客户端后重新点击“进行身份验证”。</p></body></html>`
}

export function createWindowsSetupScript(mcpUrl: string): string {
  return `# Infinite Board MCP v2 - Windows one-time setup
$ErrorActionPreference = 'Stop'
$mcpUrl = '${mcpUrl.replace(/'/g, "''")}'
$serverName = 'infinite_board'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Backup-Config([string]$Path) {
  if (Test-Path -LiteralPath $Path) {
    $backup = "$Path.bak-$timestamp"
    Copy-Item -LiteralPath $Path -Destination $backup -Force
    Write-Host "Backup: $backup"
  }
}

function Merge-McpJson([string]$Path, [string]$ClientName, [string]$UrlProperty) {
  $directory = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
  $config = [pscustomobject]@{}
  if (Test-Path -LiteralPath $Path) {
    try { $config = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw "$ClientName config is not valid JSON. No changes were written: $Path" }
    Backup-Config $Path
  }
  if (-not $config.PSObject.Properties['mcpServers']) { $config | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{}) }
  $entry = [pscustomobject]@{}
  $entry | Add-Member -NotePropertyName $UrlProperty -NotePropertyValue $mcpUrl
  if ($config.mcpServers.PSObject.Properties[$serverName]) { $config.mcpServers.$serverName = $entry }
  else { $config.mcpServers | Add-Member -NotePropertyName $serverName -NotePropertyValue $entry }
  $config | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $Path -Encoding UTF8
  Write-Host "$ClientName configured: $Path"
}

function Merge-CodexToml([string]$Path) {
  $directory = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
  $content = if (Test-Path -LiteralPath $Path) { Get-Content -LiteralPath $Path -Raw -Encoding UTF8 } else { '' }
  $newline = [Environment]::NewLine
  $quote = [char]34
  $section = '[mcp_servers.' + $serverName + ']' + $newline + 'url = ' + $quote + $mcpUrl + $quote + $newline + 'auth = ' + $quote + 'oauth' + $quote + $newline
  $pattern = "(?ms)^\\[mcp_servers\\." + [regex]::Escape($serverName) + "\\]\\s*\\r?\\n.*?(?=^\\[|\\z)"
  if ([regex]::IsMatch($content, $pattern)) {
    $content = [regex]::Replace($content, $pattern, $section)
  } else {
    if ($content.Length -gt 0 -and -not $content.EndsWith([char]10)) { $content += $newline }
    if ($content.Length -gt 0) { $content += $newline }
    $content += $section
  }
  Set-Content -LiteralPath $Path -Value $content -Encoding UTF8
  Write-Host "Codex shared config updated: $Path"
}

$codexConfig = Join-Path $env:USERPROFILE '.codex\\config.toml'
$codexConfiguredByCli = $false
if (Test-Path -LiteralPath $codexConfig) { Backup-Config $codexConfig }
$codex = Get-Command codex -ErrorAction SilentlyContinue
if ($codex) {
  try {
    & codex mcp remove $serverName 2>$null | Out-Null
    & codex mcp add $serverName --url $mcpUrl
    $codexConfiguredByCli = $LASTEXITCODE -eq 0
  } catch {
    Write-Host 'Codex CLI could not update the MCP entry; using shared config.toml instead.'
  }
}
if (-not $codexConfiguredByCli) { Merge-CodexToml $codexConfig }
Write-Host 'Codex configured. Desktop: restart Codex, then open Settings > Plugins > MCP > infinite_board and select Authenticate.'
if ($codex) { Write-Host 'CLI alternative: codex mcp login infinite_board' }

$skillSource = Join-Path $PSScriptRoot 'InfiniteBoard-MCP-Workflow-SKILL.md'
if (Test-Path -LiteralPath $skillSource) {
  $skillDirectory = Join-Path $env:USERPROFILE '.agents\\skills\\infinite-board-mcp-workflow'
  $skillTarget = Join-Path $skillDirectory 'SKILL.md'
  New-Item -ItemType Directory -Path $skillDirectory -Force | Out-Null
  Backup-Config $skillTarget
  Copy-Item -LiteralPath $skillSource -Destination $skillTarget -Force
  Write-Host "Codex skill installed: $skillTarget"
} else {
  Write-Host 'Workflow skill file not found; MCP configuration will continue without the Codex skill.'
}

Merge-McpJson (Join-Path $env:USERPROFILE '.cursor\\mcp.json') 'Cursor' 'url'
Merge-McpJson (Join-Path $env:USERPROFILE '.codeium\\windsurf\\mcp_config.json') 'Windsurf' 'serverUrl'

Write-Host ''
Write-Host "Infinite Board MCP URL: $mcpUrl"
Write-Host 'Restart Cursor/Windsurf and choose Authenticate when prompted. No personal token is required.'
`
}

export function createWindowsSetupArchive(mcpUrl: string): Uint8Array {
  return zipSync({
    'Install-InfiniteBoard-MCP.bat': strToU8(createWindowsSetupBatch()),
    'InfiniteBoard-MCP-Setup.ps1': strToU8(createWindowsSetupScript(mcpUrl)),
    'InfiniteBoard-MCP-Workflow-SKILL.md': strToU8(createInfiniteBoardMcpWorkflowSkill()),
  }, { level: 6 })
}

export function createInfiniteBoardMcpWorkflowSkill(): string {
  return readFileSync(new URL('../../../../../docs/mcp-skills/infinite-board-mcp-workflow/SKILL.md', import.meta.url), 'utf8')
}

export function createWindowsSetupBatch(): string {
  return `@echo off\r
setlocal\r
chcp 65001 >nul\r
title Infinite Board MCP v2 Setup\r
set "SETUP_SCRIPT=%~dp0InfiniteBoard-MCP-Setup.ps1"\r
set "SKILL_FILE=%~dp0InfiniteBoard-MCP-Workflow-SKILL.md"\r
if not exist "%SETUP_SCRIPT%" (\r
  echo Missing InfiniteBoard-MCP-Setup.ps1. Extract all files from the ZIP first.\r
  echo.\r
  pause\r
  exit /b 1\r
)\r
if not exist "%SKILL_FILE%" (\r
  echo Missing InfiniteBoard-MCP-Workflow-SKILL.md. Extract all files from the ZIP first.\r
  echo.\r
  pause\r
  exit /b 1\r
)\r
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SETUP_SCRIPT%"\r
set "SETUP_EXIT=%ERRORLEVEL%"\r
echo.\r
if not "%SETUP_EXIT%"=="0" (\r
  echo Setup failed. Review the error above, then run this file again.\r
) else (\r
  echo Setup completed. Restart your MCP client and complete OAuth authorization.\r
)\r
echo.\r
pause\r
exit /b %SETUP_EXIT%\r
`
}

export function registerMcpOAuthRoutes(app: FastifyInstance, options: McpOAuthRouteOptions): void {
  const authorizationMetadata = {
    issuer: options.publicOrigin.origin,
    authorization_endpoint: new URL('/oauth/authorize', options.publicOrigin).href,
    token_endpoint: new URL('/oauth/token', options.publicOrigin).href,
    registration_endpoint: new URL('/oauth/register', options.publicOrigin).href,
    revocation_endpoint: new URL('/oauth/revoke', options.publicOrigin).href,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    scopes_supported: [...MCP_SCOPES],
  }
  const protectedResourceMetadata = {
    resource: new URL('/mcp', options.publicOrigin).href,
    authorization_servers: [options.publicOrigin.origin],
    scopes_supported: [...MCP_SCOPES],
    resource_name: 'Infinite Board MCP v2',
  }
  const router = express.Router()
  router.use('/oauth/authorize', authorizationHandler({ provider: options.provider }))
  router.use('/oauth/token', tokenHandler({ provider: options.provider }))
  router.use('/oauth/register', clientRegistrationHandler({ clientsStore: options.repository, clientSecretExpirySeconds: 0 }))
  router.use('/oauth/revoke', revocationHandler({ provider: options.provider }))
  router.use('/.well-known/oauth-protected-resource/mcp', metadataHandler(protectedResourceMetadata))
  router.use('/.well-known/oauth-authorization-server', metadataHandler(authorizationMetadata))
  const guardedRouter: RequestHandler = (request, response, next) => {
    if (!request.path.startsWith('/oauth/') && !request.path.startsWith('/.well-known/')) return next()
    const protocol = firstForwarded(request.headers['x-forwarded-proto']) ?? request.protocol
    const host = firstForwarded(request.headers['x-forwarded-host']) ?? request.headers.host
    let origin: string | undefined
    try { if (host) origin = new URL(`${protocol}://${host}`).origin } catch { origin = undefined }
    if (origin !== options.publicOrigin.origin) return void response.status(421).json({ error: 'invalid_request' })
    const browserOrigin = request.headers.origin?.replace(/\/$/, '')
    if (browserOrigin && browserOrigin !== options.publicOrigin.origin) return void response.status(403).json({ error: 'invalid_request' })
    router(request, response, next)
  }
  ;(app as FastifyInstance & { use: (middleware: RequestHandler) => void }).use(guardedRouter)

  app.get('/oauth/consent', async (request, reply) => {
    const parsed = requestTokenSchema.safeParse((request.query as { request?: unknown }).request)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' })
    const pending = options.repository.getAuthorizationRequest(parsed.data)
    if (!pending) return reply.code(400).send({ error: 'invalid_request' })
    const user = await currentUser(request, options).catch(() => undefined)
    if (!user) {
      if (!options.sessions) return reply.code(401).type('text/html').send(completionPage())
      const returnTo = `/oauth/consent?request=${encodeURIComponent(parsed.data)}`
      return reply.redirect(`/auth/feishu/start?returnTo=${encodeURIComponent(returnTo)}`)
    }
    return reply.header('cache-control', 'no-store').header('content-security-policy', consentContentSecurityPolicy(pending.redirectUri))
      .type('text/html; charset=utf-8').send(consentPage({
        requestToken: parsed.data,
        clientName: pending.client.client_name?.trim() || 'MCP 客户端',
        redirectUri: pending.redirectUri,
        userName: user.name,
      }))
  })

  app.post('/oauth/consent', async (request, reply) => {
    const browserOrigin = typeof request.headers.origin === 'string' ? request.headers.origin.replace(/\/$/, '') : undefined
    if (!browserOrigin || browserOrigin !== options.publicOrigin.origin || requestOrigin(request) !== options.publicOrigin.origin) {
      return reply.code(403).send({ error: 'invalid_request' })
    }
    const body = request.body as { request?: unknown; decision?: unknown }
    const parsed = requestTokenSchema.safeParse(body?.request)
    if (!parsed.success || (body.decision !== 'approve' && body.decision !== 'deny')) return reply.code(400).send({ error: 'invalid_request' })
    if (!options.repository.getAuthorizationRequest(parsed.data)) {
      return reply.code(409).type('text/html; charset=utf-8').send(invalidAuthorizationPage())
    }
    const user = await currentUser(request, options).catch(() => undefined)
    if (!user) return reply.code(401).send({ error: 'login_required' })
    if (body.decision === 'deny') {
      const pending = options.repository.denyAuthorizationRequest(parsed.data)
      if (!pending) return reply.code(400).send({ error: 'invalid_request' })
      const redirect = new URL(pending.redirectUri)
      redirect.searchParams.set('error', 'access_denied')
      if (pending.state) redirect.searchParams.set('state', pending.state)
      return reply.code(303).redirect(redirect.href)
    }
    let approved: ReturnType<McpOAuthRepository['approveAuthorizationRequest']>
    try {
      approved = options.repository.approveAuthorizationRequest(parsed.data, user)
    } catch (error) {
      if (error instanceof Error && error.message === 'MCP_OAUTH_REQUEST_INVALID') {
        return reply.code(409).type('text/html; charset=utf-8').send(invalidAuthorizationPage())
      }
      throw error
    }
    options.audit?.record({ actorOpenId: user.openId, action: 'security.mcp.oauth_authorized', summary: { grantId: approved.grant.id, clientId: approved.grant.oauthClientId, clientName: approved.grant.clientName } })
    const redirect = new URL(approved.request.redirectUri)
    redirect.searchParams.set('code', approved.code)
    if (approved.request.state) redirect.searchParams.set('state', approved.request.state)
    return reply.code(303).redirect(redirect.href)
  })

  app.get('/api/mcp/clients', async (request) => options.repository.listGrantsForUser(request.user!.openId))

  app.patch('/api/mcp/clients/:grantId', async (request, reply) => {
    const params = grantParamsSchema.safeParse(request.params)
    const body = updateGrantSchema.safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    if (!options.repository.setGrantEnabled(params.data.grantId, request.user!.openId, body.data.enabled)) return reply.code(404).send({ code: 'MCP_CLIENT_NOT_FOUND' })
    options.audit?.record({ actorOpenId: request.user!.openId, action: 'security.mcp.client_enabled_changed', summary: { grantId: params.data.grantId, enabled: body.data.enabled } })
    return reply.code(204).send()
  })

  app.delete('/api/mcp/clients/:grantId', async (request, reply) => {
    const params = grantParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    if (!options.repository.revokeGrant(params.data.grantId, request.user!.openId)) return reply.code(404).send({ code: 'MCP_CLIENT_NOT_FOUND' })
    options.audit?.record({ actorOpenId: request.user!.openId, action: 'security.mcp.client_revoked', summary: { grantId: params.data.grantId } })
    return reply.code(204).send()
  })

  app.get('/api/mcp/setup/windows.ps1', async (request, reply) => {
    const origin = requestOrigin(request)
    if (!origin || origin !== options.publicOrigin.origin) return reply.code(409).send({ code: 'MCP_PUBLIC_ORIGIN_MISMATCH', expectedOrigin: options.publicOrigin.origin })
    const script = createWindowsSetupScript(new URL('/mcp', origin).href)
    return reply.header('cache-control', 'private, no-store')
      .header('content-disposition', 'attachment; filename="InfiniteBoard-MCP-Setup.ps1"')
      .type('text/plain; charset=utf-8').send(script)
  })

  app.get('/api/mcp/setup/windows.zip', async (request, reply) => {
    const origin = requestOrigin(request)
    if (!origin || origin !== options.publicOrigin.origin) return reply.code(409).send({ code: 'MCP_PUBLIC_ORIGIN_MISMATCH', expectedOrigin: options.publicOrigin.origin })
    const archive = createWindowsSetupArchive(new URL('/mcp', origin).href)
    return reply.header('cache-control', 'private, no-store')
      .header('content-disposition', 'attachment; filename="InfiniteBoard-MCP-Setup.zip"')
      .type('application/zip').send(Buffer.from(archive))
  })
}
