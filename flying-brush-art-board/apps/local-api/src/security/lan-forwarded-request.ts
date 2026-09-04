import type { IncomingHttpHeaders } from 'node:http'

export interface LanApiSecurity {
  enabled: boolean
  allowedOrigins: ReadonlySet<string>
}

export type LanRequestDecision =
  | { allowed: true }
  | { allowed: false; statusCode: 403 | 421 | 503; code: string }

type Environment = Record<string, string | undefined>

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`[LAN_SECURITY] ${name} is required`)
  return value
}

function parseExactHttpsOrigins(value: string): ReadonlySet<string> {
  const origins = value.split(',').map((entry) => {
    const candidate = entry.trim()
    let url: URL
    try {
      url = new URL(candidate)
    } catch {
      throw new Error('[LAN_SECURITY] LAN_ALLOWED_ORIGINS must contain exact HTTPS origins')
    }
    if (!candidate || candidate.includes('*') || url.protocol !== 'https:'
      || url.origin !== candidate.replace(/\/$/, '') || url.pathname !== '/'
      || url.search || url.hash || url.username || url.password) {
      throw new Error('[LAN_SECURITY] LAN_ALLOWED_ORIGINS must contain exact HTTPS origins')
    }
    return url.origin
  })
  const unique = new Set(origins)
  if (unique.size === 0) throw new Error('[LAN_SECURITY] LAN_ALLOWED_ORIGINS is required')
  return unique
}

/**
 * The API remains loopback-only. Enabling a LAN reverse proxy is an explicit,
 * fail-closed mode and must use the same exact HTTPS origins as Feishu OAuth.
 */
export function resolveLanApiSecurity(
  environment: Environment,
  authenticationAllowedOrigins?: ReadonlySet<string>,
): LanApiSecurity {
  if (environment.LAN_EXPOSURE_ENABLED !== 'true') {
    return { enabled: false, allowedOrigins: new Set() }
  }
  if (environment.FEISHU_AUTH_ENABLED !== 'true') {
    throw new Error('[LAN_SECURITY] FEISHU_AUTH_ENABLED must be explicitly set to true')
  }
  if (environment.FEISHU_WHITELIST_ENABLED !== 'true') {
    throw new Error('[LAN_SECURITY] FEISHU_WHITELIST_ENABLED must be explicitly set to true')
  }
  required(environment, 'FEISHU_ALLOWED_OPEN_IDS')
  required(environment, 'FEISHU_APP_ID')
  required(environment, 'FEISHU_APP_SECRET')
  const sessionSecret = required(environment, 'SESSION_SECRET')
  if (Buffer.byteLength(sessionSecret) < 32) {
    throw new Error('[LAN_SECURITY] SESSION_SECRET must be at least 32 bytes')
  }
  required(environment, 'LAN_HTTPS_PFX')
  const allowedOrigins = parseExactHttpsOrigins(required(environment, 'LAN_ALLOWED_ORIGINS'))
  if (!authenticationAllowedOrigins || authenticationAllowedOrigins.size === 0) {
    throw new Error('[LAN_SECURITY] authenticated OAuth origin allowlist is required')
  }
  if (authenticationAllowedOrigins.size !== allowedOrigins.size
    || [...allowedOrigins].some((origin) => !authenticationAllowedOrigins.has(origin))) {
    throw new Error('[LAN_SECURITY] OAuth and LAN origin allowlists must match exactly')
  }
  return { enabled: true, allowedOrigins }
}

function exactHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string' || !value || value.includes(',')) return undefined
  return value.trim() || undefined
}

function isLoopbackAuthority(value: string | string[] | undefined): boolean {
  const authority = exactHeader(value)
  if (!authority) return false
  try {
    const url = new URL(`http://${authority}`)
    return url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === 'localhost'
  } catch {
    return false
  }
}

export function evaluateLanForwardedRequest(
  headers: IncomingHttpHeaders,
  security: LanApiSecurity,
): LanRequestDecision {
  const forwardedHostRaw = headers['x-forwarded-host']
  const forwardedProtoRaw = headers['x-forwarded-proto']
  const hasForwardedHeaders = forwardedHostRaw !== undefined || forwardedProtoRaw !== undefined
  // On loopback-only mode, forged forwarding headers are left to the OAuth/MCP
  // route-specific exact-origin guards. A real external proxy preserves the
  // external Host in the supported Vite/Caddy configurations and is rejected.
  const isExternalPath = !isLoopbackAuthority(headers.host) || (security.enabled && hasForwardedHeaders)
  if (!isExternalPath) return { allowed: true }
  if (!security.enabled) {
    return { allowed: false, statusCode: 503, code: 'LAN_EXPOSURE_DISABLED' }
  }

  const forwardedHost = exactHeader(forwardedHostRaw)
  const forwardedProto = exactHeader(forwardedProtoRaw)
  if (!forwardedHost || forwardedProto !== 'https') {
    return { allowed: false, statusCode: 421, code: 'LAN_HTTPS_FORWARDING_REQUIRED' }
  }

  let externalOrigin: string
  try {
    const url = new URL(`https://${forwardedHost}`)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error()
    externalOrigin = url.origin
  } catch {
    return { allowed: false, statusCode: 421, code: 'LAN_HOST_REJECTED' }
  }
  if (!security.allowedOrigins.has(externalOrigin)) {
    return { allowed: false, statusCode: 421, code: 'LAN_HOST_REJECTED' }
  }

  const requestOrigin = exactHeader(headers.origin)
  if (headers.origin !== undefined && (!requestOrigin || !security.allowedOrigins.has(requestOrigin))) {
    return { allowed: false, statusCode: 403, code: 'LAN_ORIGIN_REJECTED' }
  }
  return { allowed: true }
}
