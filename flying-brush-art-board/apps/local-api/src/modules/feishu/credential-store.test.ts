import { createHash } from 'node:crypto'
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

  const credentialPath = (directory: string, openId: string) => join(
    directory,
    `feishu-import-credentials-${createHash('sha256').update(openId).digest('hex')}.json`,
  )

  it('persists only DPAPI-protected key material and decrypts it for the current Windows user', () => {
    const { directory, store } = createStore()
    store.replace('user-a', credentials)

    const keyEnvelope = JSON.parse(readFileSync(join(directory, 'feishu-import-credentials.key'), 'utf8')) as {
      version: number
      protection: string
      protectedKey: string
    }
    expect(keyEnvelope).toMatchObject({ version: 1, protection: 'windows-dpapi-current-user' })
    expect(Buffer.from(keyEnvelope.protectedKey, 'base64url')).not.toHaveLength(32)
    expect(JSON.stringify(keyEnvelope)).not.toContain(credentials.accessToken)
    expect(new EncryptedCredentialStore({ directory }).read('user-a')).toEqual(credentials)
  })

  it('partitions encrypted replace, read, and clear by openId without persisting token plaintext', () => {
    const { directory, store } = createStore()
    const other = { ...credentials, accessToken: 'user-b-access', refreshToken: 'user-b-refresh' }
    expect(store.read('user-a')).toBeUndefined()
    expect(store.read('user-b')).toBeUndefined()

    store.replace('user-a', credentials)
    store.replace('user-b', other)
    expect(store.read('user-a')).toEqual(credentials)
    expect(store.read('user-b')).toEqual(other)
    expect(readFileSync(credentialPath(directory, 'user-a'), 'utf8')).not.toContain('private-')
    expect(readFileSync(credentialPath(directory, 'user-b'), 'utf8')).not.toContain('user-b-')

    store.clear('user-a')
    expect(store.read('user-a')).toBeUndefined()
    expect(store.read('user-b')).toEqual(other)
  })
})
