import { join } from 'node:path'

export interface RuntimeConfig {
  dataDirectory: string; feishu: { appId: string; appSecret: string }; sessionSecret: string
  auditRetentionDays: number
  allowedOpenIds?: ReadonlySet<string>
  allowedAppOrigins: ReadonlySet<string>
}
function required(env: NodeJS.ProcessEnv, key: string): string { const value = env[key]; if (!value) throw new Error(`${key} is required`); return value }

function exactHttpsOrigins(value: string): ReadonlySet<string> {
  const origins = value.split(',').map((entry) => {
    const candidate = entry.trim()
    let url: URL
    try { url = new URL(candidate) } catch { throw new Error('LAN_ALLOWED_ORIGINS must contain exact HTTPS origins') }
    if (!candidate || candidate.includes('*') || url.protocol !== 'https:' || url.origin !== candidate.replace(/\/$/, '')
      || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      throw new Error('LAN_ALLOWED_ORIGINS must contain exact HTTPS origins')
    }
    return url.origin
  })
  if (origins.length === 0) throw new Error('LAN_ALLOWED_ORIGINS is required')
  return new Set(origins)
}

export function loadRuntimeConfig(environment: NodeJS.ProcessEnv): RuntimeConfig {
  const sessionSecret = required(environment, 'SESSION_SECRET'); if (Buffer.byteLength(sessionSecret) < 32) throw new Error('SESSION_SECRET must be at least 32 bytes')
  const auditRetentionDays = Number(environment.AUDIT_RETENTION_DAYS ?? 80)
  if (!Number.isInteger(auditRetentionDays) || auditRetentionDays < 1) throw new Error('AUDIT_RETENTION_DAYS is invalid')
  const whitelistEnabled = environment.FEISHU_WHITELIST_ENABLED === 'true'
  const configuredOpenIds = environment.FEISHU_ALLOWED_OPEN_IDS?.split(',').map((value) => value.trim()).filter(Boolean) ?? []
  if (whitelistEnabled && configuredOpenIds.length === 0) throw new Error('FEISHU_ALLOWED_OPEN_IDS is required when FEISHU_WHITELIST_ENABLED=true')
  return {
    dataDirectory: environment.INFINITE_BOARD_DATA_DIR ?? join(environment.LOCALAPPDATA ?? process.cwd(), 'InfiniteBoard'),
    feishu: { appId: required(environment, 'FEISHU_APP_ID'), appSecret: required(environment, 'FEISHU_APP_SECRET') },
    sessionSecret,
    auditRetentionDays,
    allowedAppOrigins: exactHttpsOrigins(required(environment, 'LAN_ALLOWED_ORIGINS')),
    ...(whitelistEnabled ? { allowedOpenIds: new Set(configuredOpenIds) } : {}),
  }
}
