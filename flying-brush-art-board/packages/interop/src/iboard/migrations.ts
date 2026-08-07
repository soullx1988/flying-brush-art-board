import { parseIboardJson, requireIboardArchiveEntry } from './archive-reader.js'
import { IBOARD_FORMAT, IBOARD_FORMAT_VERSION } from './schema-v1.js'

export function assertPublishedIboardVersion(entries: Record<string, Uint8Array>): void {
  const value = parseIboardJson(
    requireIboardArchiveEntry(entries, 'manifest.json'),
    'IBOARD_MANIFEST_JSON_INVALID',
  )
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('IBOARD_MANIFEST_INVALID')
  }
  const manifest = value as { format?: unknown; formatVersion?: unknown }
  if (manifest.format !== IBOARD_FORMAT) throw new Error('IBOARD_MANIFEST_INVALID')
  if (manifest.formatVersion !== IBOARD_FORMAT_VERSION) {
    throw new Error('IBOARD_FORMAT_VERSION_UNSUPPORTED')
  }
}
