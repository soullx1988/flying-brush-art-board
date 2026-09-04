export type LanEnvironment = Record<string, string | undefined>

export interface LanEntrySecurity {
  pfxPath: string
  pfxPassphrase?: string
  allowedHosts: string[]
  allowedOrigins: string[]
}

function required(environment: LanEnvironment, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`[LAN_SECURITY] ${name} is required`)
  return value
}

function normalizeConfiguredHost(value: string): string {
  const candidate = value.trim().toLocaleLowerCase('en-US').replace(/\.$/, '')
  if (!candidate || candidate === '*' || candidate.startsWith('.') || /[/?#@]/.test(candidate)) {
    throw new Error('[LAN_SECURITY] LAN_ALLOWED_HOSTS must contain exact hostnames or IP addresses; wildcards are forbidden')
  }

  let url: URL
  try {
    url = new URL(`https://${candidate}`)
  } catch {
    throw new Error(`[LAN_SECURITY] Invalid LAN_ALLOWED_HOSTS entry: ${candidate}`)
  }
  if (url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`[LAN_SECURITY] Invalid LAN_ALLOWED_HOSTS entry: ${candidate}`)
  }
  return url.hostname.toLocaleLowerCase('en-US').replace(/\.$/, '')
}

function parseExactHosts(value: string): string[] {
  const hosts = [...new Set(value.split(',').map(normalizeConfiguredHost))]
  if (hosts.length === 0) throw new Error('[LAN_SECURITY] LAN_ALLOWED_HOSTS must not be empty')
  return hosts
}

function parseHttpsOrigins(value: string, allowedHosts: readonly string[]): string[] {
  const origins = value.split(',').map((entry) => {
    const candidate = entry.trim()
    if (!candidate || candidate.includes('*')) {
      throw new Error('[LAN_SECURITY] LAN_ALLOWED_ORIGINS must contain exact HTTPS origins; wildcards are forbidden')
    }

    let url: URL
    try {
      url = new URL(candidate)
    } catch {
      throw new Error(`[LAN_SECURITY] Invalid LAN_ALLOWED_ORIGINS entry: ${candidate}`)
    }
    if (url.protocol !== 'https:' || url.origin !== candidate.replace(/\/$/, '')
      || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      throw new Error(`[LAN_SECURITY] LAN_ALLOWED_ORIGINS entry must be an exact HTTPS origin: ${candidate}`)
    }
    const hostname = url.hostname.toLocaleLowerCase('en-US').replace(/\.$/, '')
    if (!allowedHosts.includes(hostname)) {
      throw new Error(`[LAN_SECURITY] LAN_ALLOWED_ORIGINS host is not in LAN_ALLOWED_HOSTS: ${hostname}`)
    }
    return url.origin
  })

  const uniqueOrigins = [...new Set(origins)]
  if (uniqueOrigins.length === 0) throw new Error('[LAN_SECURITY] LAN_ALLOWED_ORIGINS must not be empty')
  return uniqueOrigins
}

/**
 * Validates every prerequisite before a LAN-facing Vite server is created.
 * This is intentionally separate from local development, which remains loopback-only.
 */
export function resolveLanEntrySecurity(environment: LanEnvironment): LanEntrySecurity {
  if (environment.LAN_EXPOSURE_ENABLED !== 'true') {
    throw new Error('[LAN_SECURITY] LAN_EXPOSURE_ENABLED must be explicitly set to true')
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

  const pfxPath = required(environment, 'LAN_HTTPS_PFX')
  const allowedHosts = parseExactHosts(required(environment, 'LAN_ALLOWED_HOSTS'))
  const allowedOrigins = parseHttpsOrigins(required(environment, 'LAN_ALLOWED_ORIGINS'), allowedHosts)
  const pfxPassphrase = environment.LAN_HTTPS_PFX_PASSPHRASE?.trim()

  return {
    pfxPath,
    ...(pfxPassphrase ? { pfxPassphrase } : {}),
    allowedHosts,
    allowedOrigins,
  }
}

export function isAllowedLanHost(hostHeader: string | undefined, allowedHosts: readonly string[]): boolean {
  if (!hostHeader) return false
  try {
    const url = new URL(`https://${hostHeader}`)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return false
    const hostname = url.hostname.toLocaleLowerCase('en-US').replace(/\.$/, '')
    return allowedHosts.includes(hostname)
  } catch {
    return false
  }
}

export function isAllowedLanOrigin(originHeader: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (originHeader === undefined) return true
  try {
    const url = new URL(originHeader)
    return url.protocol === 'https:' && url.origin === originHeader && allowedOrigins.includes(url.origin)
  } catch {
    return false
  }
}
