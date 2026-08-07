import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface FeishuCredentials {
  accessToken: string
  refreshToken: string
  scopes: readonly string[]
}

interface EncryptedPayload {
  version: 1
  iv: string
  tag: string
  ciphertext: string
}

interface ProtectedKeyEnvelope {
  version: 1
  protection: 'windows-dpapi-current-user'
  protectedKey: string
}

const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

function encodedPowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function runDpapi(operation: 'Protect' | 'Unprotect', value: Buffer): Buffer {
  if (process.platform !== 'win32') throw new Error('FEISHU_CREDENTIAL_PROTECTION_REQUIRES_WINDOWS')
  const script = [
    '$ErrorActionPreference = "Stop"',
    'try {',
    '  Add-Type -AssemblyName System.Security',
    '  $value = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())',
    `  $result = [Security.Cryptography.ProtectedData]::${operation}($value, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    '  [Console]::Out.Write([Convert]::ToBase64String($result))',
    '} catch {',
    '  [Console]::Error.Write("Windows credential protection failed")',
    '  exit 1',
    '}',
  ].join('\n')
  const result = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell(script)], {
    input: value.toString('base64'),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  })
  if (result.status !== 0 || !result.stdout) {
    throw new Error(operation === 'Protect'
      ? 'FEISHU_CREDENTIAL_KEY_PROTECTION_FAILED'
      : 'FEISHU_CREDENTIAL_KEY_UNPROTECTION_FAILED')
  }
  try {
    return Buffer.from(result.stdout.trim(), 'base64')
  } catch {
    throw new Error('FEISHU_CREDENTIAL_KEY_PROTECTION_RESPONSE_INVALID')
  }
}

export interface EncryptedCredentialStoreOptions {
  directory: string
}

export class EncryptedCredentialStore {
  private readonly credentialPath: string
  private readonly keyPath: string

  constructor({ directory }: EncryptedCredentialStoreOptions) {
    mkdirSync(directory, { recursive: true })
    this.credentialPath = join(directory, 'feishu-import-credentials.json')
    this.keyPath = join(directory, 'feishu-import-credentials.key')
  }

  read(): FeishuCredentials | undefined {
    if (!existsSync(this.credentialPath)) return undefined
    try {
      const payload = JSON.parse(readFileSync(this.credentialPath, 'utf8')) as EncryptedPayload
      if (payload.version !== 1) throw new Error('FEISHU_CREDENTIAL_VERSION_UNSUPPORTED')
      const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(payload.iv, 'base64url'))
      decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'))
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(payload.ciphertext, 'base64url')),
        decipher.final(),
      ])
      return JSON.parse(plaintext.toString('utf8')) as FeishuCredentials
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('FEISHU_CREDENTIAL_')) throw error
      throw new Error('FEISHU_CREDENTIAL_DECRYPTION_FAILED')
    }
  }

  replace(credentials: FeishuCredentials): void {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()])
    const payload: EncryptedPayload = {
      version: 1,
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    }
    const temporaryPath = `${this.credentialPath}.${randomBytes(8).toString('hex')}.tmp`
    try {
      this.atomicWrite(temporaryPath, this.credentialPath, JSON.stringify(payload))
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    }
  }

  clear(): void {
    if (existsSync(this.credentialPath)) unlinkSync(this.credentialPath)
  }

  private key(): Buffer {
    if (existsSync(this.keyPath)) {
      const persisted = readFileSync(this.keyPath)
      try {
        const envelope = JSON.parse(persisted.toString('utf8')) as ProtectedKeyEnvelope
        if (envelope.version !== 1 || envelope.protection !== 'windows-dpapi-current-user' || !envelope.protectedKey) {
          throw new Error('FEISHU_CREDENTIAL_KEY_FORMAT_UNSUPPORTED')
        }
        const key = runDpapi('Unprotect', Buffer.from(envelope.protectedKey, 'base64url'))
        if (key.length !== 32) throw new Error('FEISHU_CREDENTIAL_KEY_INVALID')
        return key
      } catch (error) {
        if (persisted.length !== 32) {
          if (error instanceof Error && error.message.startsWith('FEISHU_CREDENTIAL_')) throw error
          throw new Error('FEISHU_CREDENTIAL_KEY_INVALID')
        }
        this.persistProtectedKey(persisted)
        return persisted
      }
    }
    const key = randomBytes(32)
    this.persistProtectedKey(key)
    return key
  }

  private persistProtectedKey(key: Buffer): void {
    const envelope: ProtectedKeyEnvelope = {
      version: 1,
      protection: 'windows-dpapi-current-user',
      protectedKey: runDpapi('Protect', key).toString('base64url'),
    }
    const temporaryPath = `${this.keyPath}.${randomBytes(8).toString('hex')}.tmp`
    try {
      this.atomicWrite(temporaryPath, this.keyPath, JSON.stringify(envelope))
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    }
  }

  private atomicWrite(temporaryPath: string, destinationPath: string, contents: string): void {
    writeFileSync(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, destinationPath)
  }
}
