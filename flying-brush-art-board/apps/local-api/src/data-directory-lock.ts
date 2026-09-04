import { randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface LockRecord {
  processId: number
  port: number
  startedAt: string
  token: string
}

export interface DataDirectoryLock {
  path: string
  release(): void
}

function running(processId: number): boolean {
  if (!Number.isSafeInteger(processId) || processId <= 0) return false
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EPERM')
  }
}

function readRecord(path: string): LockRecord | undefined {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockRecord>
    return typeof value.processId === 'number'
      && typeof value.port === 'number'
      && typeof value.startedAt === 'string'
      && typeof value.token === 'string'
      ? value as LockRecord
      : undefined
  } catch {
    return undefined
  }
}

export function acquireDataDirectoryLock(dataDirectory: string, port: number): DataDirectoryLock {
  mkdirSync(dataDirectory, { recursive: true })
  const path = join(dataDirectory, '.infinite-board.lock')
  const token = randomUUID()
  const record: LockRecord = { processId: process.pid, port, startedAt: new Date().toISOString(), token }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = openSync(path, 'wx')
      try {
        writeFileSync(descriptor, JSON.stringify(record, null, 2), 'utf8')
      } finally {
        closeSync(descriptor)
      }
      let released = false
      return {
        path,
        release() {
          if (released) return
          released = true
          if (readRecord(path)?.token === token) rmSync(path, { force: true })
        },
      }
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error
      const existing = readRecord(path)
      if (!existing || running(existing.processId)) {
        throw Object.assign(new Error('DATA_DIRECTORY_IN_USE'), {
          code: 'DATA_DIRECTORY_IN_USE',
          details: existing ? { processId: existing.processId, port: existing.port } : undefined,
        })
      }
      rmSync(path, { force: true })
    }
  }
  throw Object.assign(new Error('DATA_DIRECTORY_IN_USE'), { code: 'DATA_DIRECTORY_IN_USE' })
}
