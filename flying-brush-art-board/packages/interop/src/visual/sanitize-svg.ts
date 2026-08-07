import { XMLBuilder, XMLParser } from 'fast-xml-parser'

export const DEFAULT_SVG_MAX_BYTES = 5 * 1024 * 1024
export const DEFAULT_SVG_MAX_ELEMENTS = 20_000
export const DEFAULT_SVG_MAX_ATTRIBUTES = 100_000

export interface SanitizeSvgOptions {
  maxBytes?: number
  maxElements?: number
  maxAttributes?: number
}

export interface SanitizedSvg {
  svg: string
  removedNodeCount: number
  removedAttributeCount: number
}

export class SvgSafetyError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'SvgSafetyError'
  }
}

const REMOVED_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'style',
  'set',
  'animate',
  'animatetransform',
  'animatemotion',
])

const RESOURCE_ELEMENTS = new Set(['image', 'use', 'feimage'])
const URL_ATTRIBUTES = new Set(['href', 'xlink:href', 'src'])

function localName(name: string): string {
  const separator = name.indexOf(':')
  return (separator >= 0 ? name.slice(separator + 1) : name).toLowerCase()
}

function safeResourceUrl(value: string): boolean {
  const normalized = value.trim().replace(/[\u0000-\u0020]+/g, '')
  if (normalized.startsWith('#')) return true
  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(normalized)
}

function dangerousAttributeValue(value: string): boolean {
  const normalized = value.trim().replace(/[\u0000-\u0020]+/g, '').toLowerCase()
  return (
    normalized.startsWith('javascript:')
    || normalized.startsWith('vbscript:')
    || normalized.startsWith('file:')
    || normalized.startsWith('blob:')
    || normalized.startsWith('data:text/html')
    || normalized.startsWith('data:image/svg+xml')
    || /(?:expression|behavior)\s*\(/i.test(value)
  )
}

function hasUnsafePresentationUrl(value: string): boolean {
  const urls = [...value.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)]
  return urls.some((match) => !(match[2] ?? '').trim().startsWith('#'))
}

function sanitizeStyle(value: string): string | undefined {
  const declarations = value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/(?:url\s*\(|@import|expression\s*\(|behavior\s*:)/i.test(part))
  return declarations.length > 0 ? declarations.join(';') : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

interface SanitizeCounters {
  elements: number
  attributes: number
  removedNodes: number
  removedAttributes: number
}

function sanitizeElement(
  name: string,
  value: unknown,
  counters: SanitizeCounters,
  limits: Required<Pick<SanitizeSvgOptions, 'maxElements' | 'maxAttributes'>>,
): unknown | undefined {
  const normalizedName = localName(name)
  if (REMOVED_ELEMENTS.has(normalizedName)) {
    counters.removedNodes += Array.isArray(value) ? value.length : 1
    return undefined
  }

  const values = Array.isArray(value) ? value : [value]
  const sanitizedValues = values.flatMap((item) => {
    counters.elements += 1
    if (counters.elements > limits.maxElements) {
      throw new SvgSafetyError('SVG_ELEMENT_LIMIT_EXCEEDED')
    }
    if (!isRecord(item)) return [{}]
    const next: Record<string, unknown> = {}
    let resourceUrlUnsafe = false

    for (const [key, child] of Object.entries(item)) {
      if (key.startsWith('@_')) {
        counters.attributes += 1
        if (counters.attributes > limits.maxAttributes) {
          throw new SvgSafetyError('SVG_ATTRIBUTE_LIMIT_EXCEEDED')
        }
        const attributeName = key.slice(2)
        const normalizedAttribute = attributeName.toLowerCase()
        const stringValue = String(child)
        if (normalizedAttribute.startsWith('on')) {
          counters.removedAttributes += 1
          continue
        }
        if (normalizedAttribute === 'style') {
          const style = sanitizeStyle(stringValue)
          if (style) next[key] = style
          else counters.removedAttributes += 1
          continue
        }
        if (URL_ATTRIBUTES.has(normalizedAttribute)) {
          if (!safeResourceUrl(stringValue)) {
            counters.removedAttributes += 1
            resourceUrlUnsafe = RESOURCE_ELEMENTS.has(normalizedName)
            continue
          }
        } else if (dangerousAttributeValue(stringValue) || hasUnsafePresentationUrl(stringValue)) {
          counters.removedAttributes += 1
          continue
        }
        next[key] = child
        continue
      }

      if (key === '#text' || key === '#cdata') {
        next[key] = child
        continue
      }

      const sanitizedChild = sanitizeElement(key, child, counters, limits)
      if (sanitizedChild !== undefined) next[key] = sanitizedChild
    }

    if (resourceUrlUnsafe) {
      counters.removedNodes += 1
      return []
    }
    return [next]
  })

  if (sanitizedValues.length === 0) return undefined
  return Array.isArray(value) ? sanitizedValues : sanitizedValues[0]
}

export function sanitizeSvg(input: string, options: SanitizeSvgOptions = {}): SanitizedSvg {
  const maxBytes = options.maxBytes ?? DEFAULT_SVG_MAX_BYTES
  const byteLength = new TextEncoder().encode(input).byteLength
  if (byteLength > maxBytes) throw new SvgSafetyError('SVG_BYTE_LIMIT_EXCEEDED')
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) throw new SvgSafetyError('SVG_DTD_FORBIDDEN')

  let parsed: unknown
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: false,
      processEntities: false,
      parseAttributeValue: false,
      trimValues: false,
    }).parse(input)
  } catch {
    throw new SvgSafetyError('SVG_XML_INVALID')
  }
  if (!isRecord(parsed)) throw new SvgSafetyError('SVG_XML_INVALID')
  const svgEntry = Object.entries(parsed).find(([name]) => localName(name) === 'svg')
  if (!svgEntry) throw new SvgSafetyError('SVG_ROOT_REQUIRED')

  const counters: SanitizeCounters = {
    elements: 0,
    attributes: 0,
    removedNodes: 0,
    removedAttributes: 0,
  }
  const sanitizedRoot = sanitizeElement(svgEntry[0], svgEntry[1], counters, {
    maxElements: options.maxElements ?? DEFAULT_SVG_MAX_ELEMENTS,
    maxAttributes: options.maxAttributes ?? DEFAULT_SVG_MAX_ATTRIBUTES,
  })
  if (sanitizedRoot === undefined) throw new SvgSafetyError('SVG_ROOT_REQUIRED')

  const svg = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    suppressEmptyNode: false,
    format: false,
  }).build({ [svgEntry[0]]: sanitizedRoot })
  return {
    svg,
    removedNodeCount: counters.removedNodes,
    removedAttributeCount: counters.removedAttributes,
  }
}
