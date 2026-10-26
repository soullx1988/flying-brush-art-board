export type CanvasToolStyleKind = 'arrow' | 'text'

export interface TextBackgroundPreference {
  color: string
  fill: 'none' | 'semi' | 'solid' | 'pattern'
}

export interface TextFormatPreference {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
}

export interface CanvasToolStylePreference {
  styles: Record<string, unknown>
  opacity: number
  background?: TextBackgroundPreference
  formats?: TextFormatPreference
}

const STORAGE_KEY_PREFIX = 'infinite-board.canvas-tool-style-preferences.v1.'
const TEXT_BACKGROUND_FILLS = new Set<TextBackgroundPreference['fill']>([
  'none',
  'semi',
  'solid',
  'pattern',
])

interface StoredCanvasToolStylePreferences {
  arrow?: CanvasToolStylePreference
  text?: CanvasToolStylePreference
}

function storageKey(accountId: string): string {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(accountId)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isJsonPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
}

function normalizeStyles(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string | number | boolean | null] => (
      isJsonPrimitive(entry[1])
    )),
  )
}

function normalizeOpacity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.max(0, Math.min(1, value))
}

function normalizeTextBackground(value: unknown): TextBackgroundPreference | undefined {
  if (!isRecord(value)) return undefined

  const color = typeof value.color === 'string' ? value.color.trim() : ''
  const fill = value.fill
  if (!color || typeof fill !== 'string' || !TEXT_BACKGROUND_FILLS.has(fill as TextBackgroundPreference['fill'])) {
    return undefined
  }

  return {
    color,
    fill: fill as TextBackgroundPreference['fill'],
  }
}

function normalizeTextFormats(value: unknown): TextFormatPreference | undefined {
  if (!isRecord(value)) return undefined

  return {
    bold: value.bold === true,
    italic: value.italic === true,
    underline: value.underline === true,
    strike: value.strike === true,
  }
}

function normalizePreference(value: unknown): CanvasToolStylePreference | undefined {
  if (!isRecord(value)) return undefined

  const background = normalizeTextBackground(value.background)
  const formats = normalizeTextFormats(value.formats)
  return {
    styles: normalizeStyles(value.styles),
    opacity: normalizeOpacity(value.opacity),
    ...(background ? { background } : {}),
    ...(formats ? { formats } : {}),
  }
}

function readStoredPreferences(accountId: string): StoredCanvasToolStylePreferences {
  try {
    const stored = window.localStorage.getItem(storageKey(accountId))
    if (!stored) return {}

    const parsed = JSON.parse(stored) as unknown
    if (!isRecord(parsed)) return {}

    const arrow = normalizePreference(parsed.arrow)
    const text = normalizePreference(parsed.text)
    return {
      ...(arrow ? { arrow } : {}),
      ...(text ? { text } : {}),
    }
  } catch {
    return {}
  }
}

function writeStoredPreferences(accountId: string, preferences: StoredCanvasToolStylePreferences): void {
  try {
    window.localStorage.setItem(storageKey(accountId), JSON.stringify(preferences))
  } catch {
    // A restricted browser storage context should not prevent canvas editing.
  }
}

export function readCanvasToolStylePreference(
  accountId: string,
  kind: CanvasToolStyleKind,
): CanvasToolStylePreference | undefined {
  return readStoredPreferences(accountId)[kind]
}

export function writeCanvasToolStylePreference(
  accountId: string,
  kind: CanvasToolStyleKind,
  preference: CanvasToolStylePreference,
): CanvasToolStylePreference {
  const normalized = normalizePreference(preference) ?? { styles: {}, opacity: 1 }
  const current = readStoredPreferences(accountId)
  writeStoredPreferences(accountId, { ...current, [kind]: normalized })
  return normalized
}

export function writeTextBackgroundPreference(
  accountId: string,
  background: TextBackgroundPreference,
): TextBackgroundPreference {
  const normalized = normalizeTextBackground(background)
  if (!normalized) throw new TypeError('Invalid text background preference')

  const current = readCanvasToolStylePreference(accountId, 'text') ?? { styles: {}, opacity: 1 }
  writeCanvasToolStylePreference(accountId, 'text', { ...current, background: normalized })
  return normalized
}
