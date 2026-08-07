import { join } from 'node:path'

export interface RuntimeConfig {
  dataDirectory: string; feishu: { appId: string; appSecret: string }; sessionSecret: string
  auditRetentionDays: number
}
function required(env: NodeJS.ProcessEnv, key: string): string { const value = env[key]; if (!value) throw new Error(`${key} is required`); return value }
export function loadRuntimeConfig(environment: NodeJS.ProcessEnv): RuntimeConfig {
  const sessionSecret = required(environment, 'SESSION_SECRET'); if (Buffer.byteLength(sessionSecret) < 32) throw new Error('SESSION_SECRET must be at least 32 bytes')
  const auditRetentionDays = Number(environment.AUDIT_RETENTION_DAYS ?? 80)
  if (!Number.isInteger(auditRetentionDays) || auditRetentionDays < 1) throw new Error('AUDIT_RETENTION_DAYS is invalid')
  return { dataDirectory: environment.INFINITE_BOARD_DATA_DIR ?? join(environment.LOCALAPPDATA ?? process.cwd(), 'InfiniteBoard'), feishu: { appId: required(environment, 'FEISHU_APP_ID'), appSecret: required(environment, 'FEISHU_APP_SECRET') }, sessionSecret, auditRetentionDays }
}
