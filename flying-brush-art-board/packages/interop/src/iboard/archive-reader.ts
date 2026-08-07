import { unzipSync } from 'fflate'

export interface IboardArchiveReadLimits {
  maxArchiveBytes?: number
  maxFileCount?: number
  maxEntryBytes?: number
  maxUncompressedBytes?: number
}

export const DEFAULT_IBOARD_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
export const DEFAULT_IBOARD_MAX_FILE_COUNT = 1_000
export const DEFAULT_IBOARD_MAX_ENTRY_BYTES = 100 * 1024 * 1024
export const DEFAULT_IBOARD_MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024

export interface IboardArchiveFootprint {
  archiveBytes: number
  uncompressedBytes: number
  retainedBytes: number
}

type IboardArchiveLimitErrorCode =
  | 'IBOARD_ARCHIVE_FILE_LIMIT_EXCEEDED'
  | 'IBOARD_ARCHIVE_ENTRY_SIZE_LIMIT_EXCEEDED'
  | 'IBOARD_ARCHIVE_SIZE_LIMIT_EXCEEDED'

class IboardArchiveLimitError extends Error {
  constructor(readonly code: IboardArchiveLimitErrorCode) {
    super(code)
    this.name = 'IboardArchiveLimitError'
  }
}

function archiveLimits(limits: IboardArchiveReadLimits) {
  return {
    maxArchiveBytes: limits.maxArchiveBytes ?? DEFAULT_IBOARD_MAX_ARCHIVE_BYTES,
    maxFileCount: limits.maxFileCount ?? DEFAULT_IBOARD_MAX_FILE_COUNT,
    maxEntryBytes: limits.maxEntryBytes ?? DEFAULT_IBOARD_MAX_ENTRY_BYTES,
    maxUncompressedBytes: limits.maxUncompressedBytes ?? DEFAULT_IBOARD_MAX_UNCOMPRESSED_BYTES,
  }
}

function scanIboardArchive(
  archive: Uint8Array,
  limits: IboardArchiveReadLimits,
  retainEntries: boolean,
): { entries: Record<string, Uint8Array>; uncompressedBytes: number } {
  const resolved = archiveLimits(limits)
  if (archive.byteLength > resolved.maxArchiveBytes) throw new Error('IBOARD_ARCHIVE_TOO_LARGE')

  let fileCount = 0
  let uncompressedBytes = 0
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(archive, {
      filter: (entry) => {
        fileCount += 1
        if (fileCount > resolved.maxFileCount) {
          throw new IboardArchiveLimitError('IBOARD_ARCHIVE_FILE_LIMIT_EXCEEDED')
        }
        if (!Number.isSafeInteger(entry.originalSize) || entry.originalSize < 0) {
          throw new Error('IBOARD_ARCHIVE_INVALID')
        }
        if (entry.originalSize > resolved.maxEntryBytes) {
          throw new IboardArchiveLimitError('IBOARD_ARCHIVE_ENTRY_SIZE_LIMIT_EXCEEDED')
        }
        uncompressedBytes += entry.originalSize
        if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes > resolved.maxUncompressedBytes) {
          throw new IboardArchiveLimitError('IBOARD_ARCHIVE_SIZE_LIMIT_EXCEEDED')
        }
        return retainEntries
      },
    })
  } catch (error) {
    if (error instanceof IboardArchiveLimitError) throw error
    throw new Error('IBOARD_ARCHIVE_INVALID')
  }
  return { entries, uncompressedBytes }
}

export function measureIboardArchive(
  archive: Uint8Array,
  limits: IboardArchiveReadLimits = {},
): IboardArchiveFootprint {
  const resolved = archiveLimits(limits)
  if (archive.byteLength > resolved.maxArchiveBytes) throw new Error('IBOARD_ARCHIVE_TOO_LARGE')
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const minimumEocdOffset = Math.max(0, archive.byteLength - 65_557)
  let eocdOffset = -1
  for (let offset = archive.byteLength - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue
    const commentLength = view.getUint16(offset + 20, true)
    if (offset + 22 + commentLength === archive.byteLength) {
      eocdOffset = offset
      break
    }
  }
  if (eocdOffset < 0) throw new Error('IBOARD_ARCHIVE_INVALID')

  const fileCount = view.getUint16(eocdOffset + 10, true)
  const centralDirectoryBytes = view.getUint32(eocdOffset + 12, true)
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true)
  if (fileCount === 0xffff || centralDirectoryBytes === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    throw new Error('IBOARD_ARCHIVE_INVALID')
  }
  if (fileCount > resolved.maxFileCount) {
    throw new IboardArchiveLimitError('IBOARD_ARCHIVE_FILE_LIMIT_EXCEEDED')
  }
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectoryBytes
  if (!Number.isSafeInteger(centralDirectoryEnd) || centralDirectoryEnd > eocdOffset) {
    throw new Error('IBOARD_ARCHIVE_INVALID')
  }

  let offset = centralDirectoryOffset
  let uncompressedBytes = 0
  for (let index = 0; index < fileCount; index += 1) {
    if (offset + 46 > centralDirectoryEnd || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('IBOARD_ARCHIVE_INVALID')
    }
    const entryBytes = view.getUint32(offset + 24, true)
    if (entryBytes === 0xffffffff) throw new Error('IBOARD_ARCHIVE_INVALID')
    if (entryBytes > resolved.maxEntryBytes) {
      throw new IboardArchiveLimitError('IBOARD_ARCHIVE_ENTRY_SIZE_LIMIT_EXCEEDED')
    }
    uncompressedBytes += entryBytes
    if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes > resolved.maxUncompressedBytes) {
      throw new IboardArchiveLimitError('IBOARD_ARCHIVE_SIZE_LIMIT_EXCEEDED')
    }
    const nameBytes = view.getUint16(offset + 28, true)
    const extraBytes = view.getUint16(offset + 30, true)
    const commentBytes = view.getUint16(offset + 32, true)
    offset += 46 + nameBytes + extraBytes + commentBytes
  }
  if (offset !== centralDirectoryEnd) throw new Error('IBOARD_ARCHIVE_INVALID')
  return {
    archiveBytes: archive.byteLength,
    uncompressedBytes,
    retainedBytes: archive.byteLength + uncompressedBytes,
  }
}

export function assertSafeIboardArchivePath(path: string): void {
  if (
    path.length === 0 ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('IBOARD_ARCHIVE_PATH_UNSAFE')
  }
}

export function readIboardArchive(
  archive: Uint8Array,
  limits: IboardArchiveReadLimits = {},
): Record<string, Uint8Array> {
  const { entries } = scanIboardArchive(archive, limits, true)

  for (const path of Object.keys(entries)) assertSafeIboardArchivePath(path)
  return entries
}

export function requireIboardArchiveEntry(
  entries: Record<string, Uint8Array>,
  path: string,
): Uint8Array {
  assertSafeIboardArchivePath(path)
  const entry = entries[path]
  if (!entry) throw new Error(`IBOARD_ARCHIVE_ENTRY_MISSING: ${path}`)
  return entry
}

export function parseIboardJson(bytes: Uint8Array, errorCode: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new Error(errorCode)
  }
}
