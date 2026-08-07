import { inflateSync, strFromU8 } from 'fflate'
import { XMLParser } from 'fast-xml-parser'

import {
  createImportCompatibilityReport,
  type ImportCompatibilityIssue,
  type ImportResult,
} from '../scene/compatibility-report.js'
import {
  INTEROP_SCENE_FORMAT_VERSION,
  parseInteropScene,
  type ConnectorEndpoint,
  type InteropElement,
  type InteropGeometry,
  type InteropScene,
} from '../scene/schema.js'
import { drawioShapeName, parseDrawioStyle } from './style-map.js'

const MAX_XML_LENGTH = 8 * 1024 * 1024
const MAX_COMPRESSED_DIAGRAM_BYTES = 2 * 1024 * 1024
const MAX_INFLATED_DIAGRAM_BYTES = MAX_XML_LENGTH
const MAX_NODE_COUNT = 10_000
const MAX_CELL_STRING_LENGTH = 1_000_000
const MAX_NESTED_TAGS = 128

export type DrawioImportErrorCode =
  | 'DRAWIO_INVALID'
  | 'DRAWIO_UNSAFE_XML'
  | 'DRAWIO_LIMIT_EXCEEDED'

export class DrawioImportError extends Error {
  readonly code: DrawioImportErrorCode

  constructor(code: DrawioImportErrorCode, message: string) {
    super(message)
    this.name = 'DrawioImportError'
    this.code = code
  }
}

export interface DrawioImportBoard {
  id: string
  projectId: string
}

export interface DrawioImportOptions {
  projectId?: string
  boards?: readonly DrawioImportBoard[]
}

type XmlObject = Record<string, unknown>

interface ParsedCell {
  id: string
  parent?: string
  source?: string
  target?: string
  value: string
  style: Record<string, string>
  geometry: InteropGeometry
  raw: XmlObject
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  processEntities: false,
  maxNestedTags: MAX_NESTED_TAGS,
  isArray: (tagName) => tagName === 'diagram' || tagName === 'mxCell' || tagName === 'mxPoint',
})

function objectValue(value: unknown): XmlObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as XmlObject
    : {}
}

function arrayValue(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

function textValue(value: unknown): string {
  return decodeXmlEntities(stringValue(value))
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\u00a0/g, ' ')
    .trim()
}

function assertSafeXml(xml: string): void {
  if (xml.length > MAX_XML_LENGTH) {
    throw new DrawioImportError('DRAWIO_LIMIT_EXCEEDED', 'draw.io XML exceeds the maximum size')
  }
  if (
    /<!\s*(?:DOCTYPE|ENTITY|ELEMENT|ATTLIST|NOTATION)\b/i.test(xml)
    || /<\s*xi:include\b/i.test(xml)
    || /<\?(?!xml(?:\s|\?>))/i.test(xml)
  ) {
    throw new DrawioImportError('DRAWIO_UNSAFE_XML', 'draw.io XML contains a disabled XML extension')
  }
  const nodeCount = xml.match(/<[A-Za-z_][\w:.-]*(?:\s|\/?>)/g)?.length ?? 0
  if (nodeCount > MAX_NODE_COUNT) {
    throw new DrawioImportError('DRAWIO_LIMIT_EXCEEDED', 'draw.io XML contains too many nodes')
  }
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/\s/g, '')
  const maximumBase64Length = Math.ceil(MAX_COMPRESSED_DIAGRAM_BYTES / 3) * 4
  if (normalized.length > maximumBase64Length) {
    throw new DrawioImportError('DRAWIO_LIMIT_EXCEEDED', 'Compressed draw.io diagram exceeds the maximum size')
  }
  const binary = globalThis.atob(normalized)
  if (binary.length > MAX_COMPRESSED_DIAGRAM_BYTES) {
    throw new DrawioImportError('DRAWIO_LIMIT_EXCEEDED', 'Compressed draw.io diagram exceeds the maximum size')
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function graphModelFromDiagram(diagram: unknown): XmlObject | undefined {
  const value = objectValue(diagram)
  const direct = objectValue(value.mxGraphModel)
  if (Object.keys(direct).length > 0) return direct
  const compressed = stringValue(value['#text'] ?? diagram).trim()
  if (!compressed) return undefined
  try {
    const inflatedBytes = inflateSync(decodeBase64(compressed), {
      out: new Uint8Array(MAX_INFLATED_DIAGRAM_BYTES + 1),
    })
    if (inflatedBytes.byteLength > MAX_INFLATED_DIAGRAM_BYTES) {
      throw new DrawioImportError('DRAWIO_LIMIT_EXCEEDED', 'Inflated draw.io diagram exceeds the maximum size')
    }
    const inflated = strFromU8(inflatedBytes)
    const decoded = decodeURIComponent(inflated)
    assertSafeXml(decoded)
    const parsed = xmlParser.parse(decoded, true) as XmlObject
    return objectValue(parsed.mxGraphModel)
  } catch (error) {
    if (error instanceof DrawioImportError) throw error
    throw new DrawioImportError('DRAWIO_INVALID', 'Invalid compressed draw.io diagram')
  }
}

function findGraphModel(parsed: XmlObject): XmlObject {
  const direct = objectValue(parsed.mxGraphModel)
  if (Object.keys(direct).length > 0) return direct
  const diagrams = arrayValue(objectValue(parsed.mxfile).diagram)
  for (const diagram of diagrams) {
    const model = graphModelFromDiagram(diagram)
    if (model) return model
  }
  throw new DrawioImportError('DRAWIO_INVALID', 'draw.io XML has no mxGraphModel')
}

function geometryFor(cell: XmlObject): InteropGeometry {
  const geometry = objectValue(cell.mxGeometry)
  return {
    x: finiteNumber(geometry.x),
    y: finiteNumber(geometry.y),
    width: Math.max(0, finiteNumber(geometry.width)),
    height: Math.max(0, finiteNumber(geometry.height)),
  }
}

function assertCellStrings(cell: XmlObject): void {
  for (const field of [
    cell.value,
    cell.style,
    cell.link,
    cell.iboardReferenceId,
    cell.iboardTargetBoardId,
    cell.iboardReferenceKind,
    cell.iboardProjectId,
  ]) {
    if (stringValue(field).length > MAX_CELL_STRING_LENGTH) {
      throw new DrawioImportError('DRAWIO_LIMIT_EXCEEDED', 'draw.io cell string exceeds the maximum size')
    }
  }
}

function parsedCell(rawCell: unknown): ParsedCell | undefined {
  const raw = objectValue(rawCell)
  assertCellStrings(raw)
  const id = stringValue(raw.id).trim()
  if (!id) return undefined
  const style = parseDrawioStyle(stringValue(raw.style))
  const link = stringValue(raw.link).trim()
  if (link) style.url = link
  return {
    id,
    ...(stringValue(raw.parent).trim() ? { parent: stringValue(raw.parent).trim() } : {}),
    ...(stringValue(raw.source).trim() ? { source: stringValue(raw.source).trim() } : {}),
    ...(stringValue(raw.target).trim() ? { target: stringValue(raw.target).trim() } : {}),
    value: textValue(raw.value),
    style,
    geometry: geometryFor(raw),
    raw,
  }
}

function mimeFromSource(src: string): string {
  const match = src.match(/^data:([^;,]+)/i)
  return match?.[1] ?? 'application/octet-stream'
}

function endpointPoint(cell: ParsedCell, terminal: 'source' | 'target'): ConnectorEndpoint | undefined {
  const geometry = objectValue(cell.raw.mxGeometry)
  const pointName = `${terminal}Point`
  const direct = objectValue(geometry[pointName])
  const standalone = arrayValue(geometry.mxPoint)
    .map(objectValue)
    .find((candidate) => stringValue(candidate.as) === pointName)
  const point = Object.keys(direct).length > 0 ? direct : standalone ?? {}
  if (Object.keys(point).length === 0) return undefined
  return { x: finiteNumber(point.x), y: finiteNumber(point.y) }
}

function connectorBounds(cell: ParsedCell): InteropGeometry {
  const geometry = objectValue(cell.raw.mxGeometry)
  const points = arrayValue(objectValue(geometry.Array).mxPoint)
    .map(objectValue)
    .map((point) => ({ x: finiteNumber(point.x), y: finiteNumber(point.y) }))
  const sourcePoint = endpointPoint(cell, 'source')
  const targetPoint = endpointPoint(cell, 'target')
  const coordinates = [sourcePoint, ...points, targetPoint].filter(
    (point): point is { x: number; y: number } => Boolean(point),
  )
  if (coordinates.length === 0) return cell.geometry
  const xs = coordinates.map((point) => point.x)
  const ys = coordinates.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

function base(cell: ParsedCell, index: number, elementIds: ReadonlySet<string>) {
  return {
    id: cell.id,
    geometry: cell.geometry,
    ...(cell.parent && elementIds.has(cell.parent) ? { parentElementId: cell.parent } : {}),
    zIndex: `a${String(index + 1).padStart(6, '0')}`,
    style: structuredClone(cell.style) as Record<string, unknown>,
  }
}

function isReferenceCandidate(cell: ParsedCell): boolean {
  return [
    cell.raw.iboardReferenceId,
    cell.raw.iboardTargetBoardId,
    cell.raw.iboardReferenceKind,
    cell.raw.iboardProjectId,
  ].some((value) => stringValue(value).length > 0)
    || /^\/projects\/[^/]+\/boards\/[^/]+(?:[?#].*)?$/.test(stringValue(cell.raw.link))
}

function referenceElement(
  cell: ParsedCell,
  common: ReturnType<typeof base>,
  options: DrawioImportOptions,
): Extract<InteropElement, { type: 'board-reference' }> | undefined {
  const referenceId = stringValue(cell.raw.iboardReferenceId).trim()
  const targetBoardId = stringValue(cell.raw.iboardTargetBoardId).trim()
  const kind = stringValue(cell.raw.iboardReferenceKind).trim()
  const sourceProjectId = stringValue(cell.raw.iboardProjectId).trim()
  if (!referenceId || !targetBoardId || (kind !== 'embed' && kind !== 'link') || !sourceProjectId) {
    return undefined
  }
  if (!options.projectId || sourceProjectId !== options.projectId) return undefined
  const target = options.boards?.find((board) => board.id === targetBoardId)
  if (!target || target.projectId !== options.projectId) return undefined
  return {
    ...common,
    type: 'board-reference',
    referenceId,
    targetBoardId,
    kind,
    titleFallback: cell.value || 'Linked board',
  }
}

function mapVertex(
  cell: ParsedCell,
  index: number,
  elementIds: ReadonlySet<string>,
  options: DrawioImportOptions,
  issues: ImportCompatibilityIssue[],
): { element: InteropElement; downgraded: boolean; unsupported: boolean } {
  const common = base(cell, index, elementIds)
  if (isReferenceCandidate(cell)) {
    const reference = referenceElement(cell, common, options)
    if (reference) return { element: reference, downgraded: false, unsupported: false }
    issues.push({
      code: 'BOARD_REFERENCE_DOWNGRADED',
      message: 'The draw.io board reference could not be verified in this project and was imported as a visual card.',
      severity: 'warning',
      elementId: cell.id,
      sourceType: 'board-reference',
    })
    return {
      element: {
        ...common,
        type: 'shape',
        shape: 'rectangle',
        text: cell.value || 'Linked board',
      },
      downgraded: true,
      unsupported: false,
    }
  }
  if (cell.style.group === '1' || cell.style.swimlane === '1') {
    return {
      element: { ...common, type: 'section', title: cell.value },
      downgraded: false,
      unsupported: false,
    }
  }
  if (cell.style.text === '1') {
    return {
      element: { ...common, type: 'text', text: cell.value },
      downgraded: false,
      unsupported: false,
    }
  }
  if (cell.style.shape === 'image' || cell.style.image) {
    const src = cell.style.image ?? ''
    return {
      element: { ...common, type: 'image', src, mimeType: mimeFromSource(src), ...(cell.value ? { name: cell.value } : {}) },
      downgraded: false,
      unsupported: false,
    }
  }
  const shape = drawioShapeName(cell.style)
  if (shape.startsWith('mxgraph.')) {
    issues.push({
      code: 'UNSUPPORTED_ELEMENT',
      message: `Unsupported draw.io stencil was retained with its source payload: ${shape}`,
      severity: 'warning',
      elementId: cell.id,
      sourceType: shape,
    })
    return {
      element: { ...common, type: 'unsupported', sourceType: shape, sourcePayload: structuredClone(cell.raw) },
      downgraded: false,
      unsupported: true,
    }
  }
  return {
    element: { ...common, type: 'shape', shape, ...(cell.value ? { text: cell.value } : {}) },
    downgraded: false,
    unsupported: false,
  }
}

function mapEdge(
  cell: ParsedCell,
  index: number,
  elementIds: ReadonlySet<string>,
): InteropElement {
  const common = base(cell, index, elementIds)
  const sourcePoint = endpointPoint(cell, 'source')
  const targetPoint = endpointPoint(cell, 'target')
  const start: ConnectorEndpoint = cell.source && elementIds.has(cell.source)
    ? { elementId: cell.source }
    : sourcePoint ?? { x: cell.geometry.x, y: cell.geometry.y }
  const end: ConnectorEndpoint = cell.target && elementIds.has(cell.target)
    ? { elementId: cell.target }
    : targetPoint ?? {
        x: cell.geometry.x + cell.geometry.width,
        y: cell.geometry.y + cell.geometry.height,
      }
  return {
    ...common,
    geometry: connectorBounds(cell),
    type: 'connector',
    start,
    end,
    ...(cell.value ? { text: cell.value } : {}),
  }
}

export function importDrawio(
  xml: string,
  options: DrawioImportOptions = {},
): ImportResult<InteropScene> {
  assertSafeXml(xml)
  let parsed: XmlObject
  try {
    parsed = xmlParser.parse(xml, true) as XmlObject
  } catch (error) {
    if (error instanceof DrawioImportError) throw error
    throw new DrawioImportError(
      'DRAWIO_INVALID',
      `Invalid draw.io XML: ${error instanceof Error ? error.message : 'parse error'}`,
    )
  }
  const model = findGraphModel(parsed)
  const cells = arrayValue(objectValue(model.root).mxCell)
    .map(parsedCell)
    .filter((cell): cell is ParsedCell => Boolean(cell))
    .filter((cell) => cell.raw.vertex === '1' || cell.raw.edge === '1' || cell.raw.vertex === 1 || cell.raw.edge === 1)
  const elementIds = new Set(cells.map((cell) => cell.id))
  const issues: ImportCompatibilityIssue[] = []
  let downgradedElementCount = 0
  let unsupportedElementCount = 0
  const elements = cells.map((cell, index) => {
    if (cell.raw.edge === '1' || cell.raw.edge === 1) return mapEdge(cell, index, elementIds)
    const mapped = mapVertex(cell, index, elementIds, options, issues)
    if (mapped.downgraded) downgradedElementCount += 1
    if (mapped.unsupported) unsupportedElementCount += 1
    return mapped.element
  })
  const report = createImportCompatibilityReport({
    issues,
    downgradedElementCount,
    unsupportedElementCount,
  })
  const value = parseInteropScene({
    formatVersion: INTEROP_SCENE_FORMAT_VERSION,
    elements,
    ...(issues.length > 0 ? { compatibilityReport: report } : {}),
  })
  return { value, report }
}
