import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { EncryptedCredentialStore, type FeishuCredentials } from './credential-store.js'

describe('EncryptedCredentialStore', () => {
  const directories: string[] = []
  const credentials: FeishuCredentials = {
    accessToken: 'private-access-token',
    refreshToken: 'private-refresh-token',
    scopes: ['offline_access', 'board:board'],
  }

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  function createStore() {
    const directory = mkdtempSync(join(tmpdir(), 'infinite-board-feishu-credentials-'))
    directories.push(directory)
    return { directory, store: new EncryptedCredentialStore({ directory }) }
  }

  it('persists only DPAPI-protected key material and decrypts it for the current Windows user', () => {
    const { directory, store } = createStore()
    store.replace(credentials)

    const keyEnvelope = JSON.parse(readFileSync(join(directory, 'feishu-import-credentials.key'), 'utf8')) as {
      version: number
      protection: string
      protectedKey: string
    }
    expect(keyEnvelope).toMatchObject({ version: 1, protection: 'windows-dpapi-current-user' })
    expect(Buffer.from(keyEnvelope.protectedKey, 'base64url')).not.toHaveLength(32)
    expect(JSON.stringify(keyEnvelope)).not.toContain(credentials.accessToken)
    expect(new EncryptedCredentialStore({ directory }).read()).toEqual(credentials)
  })

  it('supports encrypted replace, read, and clear without persisting token plaintext', () => {
    const { directory, store } = createStore()
    expect(store.read()).toBeUndefined()

    store.replace(credentials)
    expect(store.read()).toEqual(credentials)
    expect(readFileSync(join(directory, 'feishu-import-credentials.json'), 'utf8')).not.toContain('private-')

    store.clear()
    expect(store.read()).toBeUndefined()
  })
})
