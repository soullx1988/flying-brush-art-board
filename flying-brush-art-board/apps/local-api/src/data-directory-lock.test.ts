import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { acquireDataDirectoryLock } from './data-directory-lock.js'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('data directory lock', () => {
  it('blocks a second API process from using the same data directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'infinite-board-lock-'))
    directories.push(directory)
    const first = acquireDataDirectoryLock(directory, 8787)

    expect(() => acquireDataDirectoryLock(directory, 8799)).toThrow(expect.objectContaining({
      code: 'DATA_DIRECTORY_IN_USE',
      details: { processId: process.pid, port: 8787 },
    }))

    first.release()
    const replacement = acquireDataDirectoryLock(directory, 8799)
    replacement.release()
  })

  it('reclaims a stale lock whose process no longer exists', () => {
    const directory = mkdtempSync(join(tmpdir(), 'infinite-board-stale-lock-'))
    directories.push(directory)
    writeFileSync(join(directory, '.infinite-board.lock'), JSON.stringify({
      processId: 2_147_483_647,
      port: 8799,
      startedAt: '2026-08-10T00:00:00.000Z',
      token: 'stale-token',
    }))

    const lock = acquireDataDirectoryLock(directory, 8787)
    lock.release()
  })
})
