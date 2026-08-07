import { zipSync, type Zippable } from 'fflate'

export interface IboardArchiveEntry {
  path: string
  bytes: Uint8Array
}

const ZIP_EPOCH = new Date('1980-01-01T00:00:00.000Z')

export function encodeIboardJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, undefined, 2)}\n`)
}

export function writeIboardArchive(entries: readonly IboardArchiveEntry[]): Uint8Array {
  const paths = new Set<string>()
  const zippable: Zippable = {}
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    if (paths.has(entry.path)) throw new Error(`IBOARD_ARCHIVE_DUPLICATE_PATH: ${entry.path}`)
    paths.add(entry.path)
    zippable[entry.path] = [entry.bytes, { mtime: ZIP_EPOCH }]
  }
  return zipSync(zippable, { level: 6, mtime: ZIP_EPOCH })
}
