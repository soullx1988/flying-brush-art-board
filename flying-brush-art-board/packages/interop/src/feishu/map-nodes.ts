import { createImportCompatibilityReport, type ImportCompatibilityIssue, type ImportResult } from '../scene/compatibility-report.js'
import {
  INTEROP_SCENE_FORMAT_VERSION,
  parseInteropScene,
  type InteropElement,
  type InteropScene,
  type MindMapBranch,
  type MindMapNodeStyle,
} from '../scene/schema.js'
import { sanitizeSvg } from '../visual/sanitize-svg.js'
import { extractFeishuNodes, feishuKnownNodeSchema, type FeishuKnownNode } from './node-schema.js'

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as UnknownRecord : undefined
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function finiteValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function textStyle(value: unknown): UnknownRecord {
  const text = record(value)
  if (!text) return {}
  const style: UnknownRecord = {}
  const color = textValue(text.text_color)
  const fontSize = finiteValue(text.font_size)
  if (color) style.color = color
  if (fontSize !== undefined) style.fontSize = fontSize
  return style
}

function boardStyle(value: unknown, text: unknown): UnknownRecord {
  const source = record(value) ?? {}
  const style: UnknownRecord = { ...source, ...textStyle(text) }
  const fill = textValue(source.fill_color)
  const stroke = textValue(source.border_color)
  const strokeWidth = Number(source.border_width)
  if (fill) style.fill = fill
  if (stroke) style.stroke = stroke
  if (Number.isFinite(strokeWidth)) style.strokeWidth = strokeWidth
  return style
}

function connectorEndpoint(value: unknown): UnknownRecord {
  const endpoint = record(value) ?? {}
  const position = record(endpoint.position)
  const id = textValue(endpoint.id)
  const x = finiteValue(position?.x)
  const y = finiteValue(position?.y)
  return {
    ...(id ? { elementId: id } : {}),
    ...(x === undefined ? {} : { x }),
    ...(y === undefined ? {} : { y }),
  }
}

/**
 * The Board OpenAPI names several standard shapes differently from the
 * project IR. Normalize only those documented API envelopes before validating
 * them, retaining the unmodified provider node for future fidelity upgrades.
 */
function normalizeBoardNode(raw: unknown): unknown {
  const source = record(raw)
  if (!source) return raw
  const type = textValue(source.type)
  const normalizedBase = {
    ...source,
    ...(finiteValue(source.angle) === undefined ? {} : { rotation: finiteValue(source.angle) }),
    ...(source.z_index === undefined ? {} : { zIndex: source.z_index }),
    rawFeishuNode: raw,
  }

  if (type === 'composite_shape') {
    const composite = record(source.composite_shape)
    const shape = textValue(composite?.type)
    const text = record(source.text)
    return {
      ...normalizedBase,
      type: 'shape',
      shape: shape ?? 'rectangle',
      ...(textValue(text?.text) === undefined ? {} : { text: textValue(text?.text) }),
      style: boardStyle(source.style, source.text),
    }
  }

  if (type === 'text_shape') {
    const text = record(source.text)
    return {
      ...normalizedBase,
      type: 'text',
      text: textValue(text?.text) ?? '',
      style: boardStyle(source.style, source.text),
    }
  }

  if (type === 'image' && textValue(source.mediaToken) === undefined) {
    const image = record(source.image)
    const mediaToken = textValue(image?.token)
    return {
      ...normalizedBase,
      ...(mediaToken ? { mediaToken } : {}),
      style: boardStyle(source.style, undefined),
    }
  }

  if (type === 'connector' && source.start === undefined && source.end === undefined) {
    const connector = record(source.connector)
    return {
      ...normalizedBase,
      start: connectorEndpoint(connector?.start_object),
      end: connectorEndpoint(connector?.end_object),
      style: boardStyle(source.style, undefined),
    }
  }

  return raw
}

function common(node: FeishuKnownNode) {
  const raw = 'rawFeishuNode' in node ? node.rawFeishuNode : node
  return {
    id: node.id,
    geometry: { x: node.x, y: node.y, width: node.width, height: node.height, ...(node.rotation === undefined ? {} : { rotation: node.rotation }) },
    ...(node.parentId ? { parentElementId: node.parentId } : {}),
    zIndex: String(node.zIndex ?? 'a1'),
    style: structuredClone(node.style ?? {}),
    sourcePayload: structuredClone(raw),
  }
}

const MIND_MAP_PALETTE_HEX = {
  black: '#1f2329', gray: '#8f959e', purple: '#d46bfa', violet: '#9333ea',
  indigo: '#4e6ef2', blue: '#3b82f6', amber: '#f3a83b', orange: '#e76a24',
  teal: '#0f9f75', green: '#42b55d', coral: '#f87171', red: '#e53935',
} as const

type MindMapPalette = keyof typeof MIND_MAP_PALETTE_HEX

function firstValue(source: UnknownRecord, ...keys: string[]): unknown {
  for (const key of keys) if (source[key] !== undefined) return source[key]
  return undefined
}

function paletteColor(value: unknown): MindMapPalette | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized in MIND_MAP_PALETTE_HEX) return normalized as MindMapPalette
  const hex = normalized.match(/^#([0-9a-f]{6})$/i)?.[1]
  if (!hex) return undefined
  const rgb = Number.parseInt(hex, 16)
  const target = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255]
  let closest: MindMapPalette = 'gray'
  let distance = Number.POSITIVE_INFINITY
  for (const [name, candidateHex] of Object.entries(MIND_MAP_PALETTE_HEX) as Array<[MindMapPalette, string]>) {
    const candidate = Number.parseInt(candidateHex.slice(1), 16)
    const delta = target.reduce((sum, channel, index) => {
      const candidateChannel = index === 0 ? (candidate >> 16) & 255 : index === 1 ? (candidate >> 8) & 255 : candidate & 255
      return sum + (channel - candidateChannel) ** 2
    }, 0)
    if (delta < distance) {
      distance = delta
      closest = name
    }
  }
  return closest
}

function unitOpacity(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(0, Math.min(1, parsed > 1 ? parsed / 100 : parsed))
}

function mindMapStyle(value: unknown): MindMapNodeStyle | undefined {
  const source = record(value) ?? {}
  const text = record(source.text) ?? record(source.text_style) ?? {}
  const edge = record(source.edge) ?? record(source.branch) ?? record(source.line_style) ?? {}
  const fillColor = paletteColor(firstValue(source, 'fillColor', 'fill_color', 'backgroundColor', 'background_color', 'fill'))
  const borderColor = paletteColor(firstValue(source, 'borderColor', 'border_color', 'strokeColor', 'stroke_color', 'stroke'))
  const textColor = paletteColor(firstValue(text, 'color', 'textColor', 'text_color') ?? firstValue(source, 'textColor', 'text_color', 'fontColor', 'font_color'))
  const edgeColor = paletteColor(firstValue(edge, 'color', 'edgeColor', 'edge_color', 'lineColor', 'line_color') ?? firstValue(source, 'edgeColor', 'edge_color', 'lineColor', 'line_color'))
  const fontSizeValue = Number(firstValue(text, 'fontSize', 'font_size') ?? firstValue(source, 'fontSize', 'font_size'))
  const fontSize = Number.isFinite(fontSizeValue)
    ? fontSizeValue <= 12 ? 's' : fontSizeValue <= 15 ? 'm' : fontSizeValue <= 20 ? 'l' : 'xl'
    : undefined
  const fontName = String(firstValue(text, 'fontFamily', 'font_family', 'font') ?? firstValue(source, 'fontFamily', 'font_family', 'font') ?? '').toLowerCase()
  const fontFamily = fontName.includes('mono') ? 'mono' : fontName.includes('serif') ? 'serif' : fontName.includes('draw') || fontName.includes('hand') ? 'draw' : fontName ? 'sans' : undefined
  const alignValue = String(firstValue(text, 'textAlign', 'text_align', 'align') ?? firstValue(source, 'textAlign', 'text_align', 'align') ?? '').toLowerCase()
  const textAlign = alignValue === 'center' || alignValue === 'right' || alignValue === 'left' ? alignValue : undefined
  const dashValue = String(firstValue(edge, 'dash', 'lineDash', 'line_dash') ?? firstValue(source, 'edgeDash', 'edge_dash', 'lineDash', 'line_dash') ?? '').toLowerCase()
  const edgeDash = dashValue.includes('dot') ? 'dotted' : dashValue.includes('dash') ? 'dashed' : dashValue ? 'solid' : undefined
  const widthValue = Number(firstValue(edge, 'width', 'lineWidth', 'line_width') ?? firstValue(source, 'edgeWidth', 'edge_width', 'lineWidth', 'line_width'))
  const edgeWidth = Number.isFinite(widthValue) ? Math.max(1, Math.min(4, Math.round(widthValue))) as 1 | 2 | 3 | 4 : undefined
  const result: MindMapNodeStyle = {
    ...(fillColor ? { fillColor } : {}),
    ...(unitOpacity(firstValue(source, 'fillOpacity', 'fill_opacity')) === undefined ? {} : { fillOpacity: unitOpacity(firstValue(source, 'fillOpacity', 'fill_opacity')) }),
    ...(borderColor ? { borderColor } : {}),
    ...(unitOpacity(firstValue(source, 'borderOpacity', 'border_opacity', 'strokeOpacity', 'stroke_opacity')) === undefined ? {} : { borderOpacity: unitOpacity(firstValue(source, 'borderOpacity', 'border_opacity', 'strokeOpacity', 'stroke_opacity')) }),
    ...(textColor ? { textColor } : {}),
    ...(unitOpacity(firstValue(text, 'opacity', 'textOpacity', 'text_opacity') ?? firstValue(source, 'textOpacity', 'text_opacity')) === undefined ? {} : { textOpacity: unitOpacity(firstValue(text, 'opacity', 'textOpacity', 'text_opacity') ?? firstValue(source, 'textOpacity', 'text_opacity')) }),
    ...(fontSize ? { fontSize } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    ...(textAlign ? { textAlign } : {}),
    ...(firstValue(text, 'bold', 'fontWeight', 'font_weight') === undefined ? {} : { bold: firstValue(text, 'bold', 'fontWeight', 'font_weight') === true || Number(firstValue(text, 'bold', 'fontWeight', 'font_weight')) >= 600 }),
    ...(firstValue(text, 'italic', 'fontStyle', 'font_style') === undefined ? {} : { italic: firstValue(text, 'italic', 'fontStyle', 'font_style') === true || firstValue(text, 'italic', 'fontStyle', 'font_style') === 'italic' }),
    ...(firstValue(text, 'underline') === undefined ? {} : { underline: Boolean(firstValue(text, 'underline')) }),
    ...(firstValue(text, 'strike', 'strikethrough') === undefined ? {} : { strike: Boolean(firstValue(text, 'strike', 'strikethrough')) }),
    ...(edgeColor ? { edgeColor } : {}),
    ...(unitOpacity(firstValue(edge, 'opacity', 'edgeOpacity', 'edge_opacity') ?? firstValue(source, 'edgeOpacity', 'edge_opacity')) === undefined ? {} : { edgeOpacity: unitOpacity(firstValue(edge, 'opacity', 'edgeOpacity', 'edge_opacity') ?? firstValue(source, 'edgeOpacity', 'edge_opacity')) }),
    ...(edgeDash ? { edgeDash } : {}),
    ...(edgeWidth ? { edgeWidth } : {}),
  }
  return Object.keys(result).length ? result : undefined
}

function mindMapNodeShape(value: unknown): 'rounded' | 'pill' | 'underline' | undefined {
  const source = record(value) ?? {}
  const shape = String(firstValue(source, 'shape', 'nodeShape', 'node_shape') ?? '').toLowerCase()
  return shape === 'pill' || shape === 'underline' || shape === 'rounded' ? shape : undefined
}

function mapKnown(node: FeishuKnownNode): InteropElement {
  const base = common(node)
  switch (node.type) {
    case 'shape': return { ...base, type: 'shape', shape: node.shape, ...(node.text === undefined ? {} : { text: node.text }) }
    case 'text': return { ...base, type: 'text', text: node.text }
    case 'sticky_note': return { ...base, type: 'sticky', text: node.text }
    case 'image': return { ...base, type: 'image', src: `feishu-media://${node.mediaToken}`, mimeType: node.mimeType ?? 'application/octet-stream', ...(node.name ? { name: node.name } : {}) }
    case 'connector': return {
      ...base, type: 'connector',
      start: { ...(node.start.elementId ? { elementId: node.start.elementId } : {}), ...(node.start.x === undefined ? {} : { x: node.start.x }), ...(node.start.y === undefined ? {} : { y: node.start.y }) },
      end: { ...(node.end.elementId ? { elementId: node.end.elementId } : {}), ...(node.end.x === undefined ? {} : { x: node.end.x }), ...(node.end.y === undefined ? {} : { y: node.end.y }) },
      ...(node.text === undefined ? {} : { text: node.text }),
    }
    case 'section': return { ...base, type: 'section', title: node.title }
    case 'table': return { ...base, type: 'table', cells: node.cells.map((row) => row.map((cell) => cell === null ? '' : String(cell))) }
    case 'freehand': return { ...base, type: 'paint', points: node.points.map((point) => ({ x: point.x, y: point.y, ...(point.pressure === undefined ? {} : { pressure: point.pressure }) })) }
    case 'svg': return { ...base, type: 'svg', svg: sanitizeSvg(node.svg).svg }
    case 'mind_map': return {
      ...base,
      type: 'mind-map',
      text: node.text,
      children: mapMindMapChildren(node.children, node.id),
      layout: node.layout === 'bilateral' ? 'bilateral' : 'right',
      ...(mindMapNodeShape(node.style) ? { rootShape: mindMapNodeShape(node.style) } : {}),
      ...(mindMapStyle(node.style) ? { rootStyle: mindMapStyle(node.style) } : {}),
      ...(node.theme === 'colorful' || node.theme === 'minimal' || node.theme === 'classic' ? { theme: node.theme } : {}),
    }
  }
}

function mapMindMapChildren(value: unknown, rootId: string): MindMapBranch[] {
  if (!Array.isArray(value)) return []
  const visit = (candidate: unknown, path: number[]): MindMapBranch | undefined => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined
    const item = candidate as Record<string, unknown>
    if (typeof item.text !== 'string') return undefined
    const id = typeof item.id === 'string' && item.id ? item.id : `${rootId}:node:${path.join('.')}`
    return {
      id,
      text: item.text,
      ...(item.side === 'left' || item.side === 'right' ? { side: item.side } : {}),
      ...(typeof item.collapsed === 'boolean' ? { collapsed: item.collapsed } : {}),
      ...(mindMapNodeShape(item.style ?? item) ? { shape: mindMapNodeShape(item.style ?? item) } : {}),
      ...(mindMapStyle(item.style ?? item) ? { style: mindMapStyle(item.style ?? item) } : {}),
      children: Array.isArray(item.children)
        ? item.children.flatMap((child, index) => {
            const mapped = visit(child, [...path, index])
            return mapped ? [mapped] : []
          })
        : [],
    }
  }
  return value.flatMap((child, index) => {
    const mapped = visit(child, [index])
    return mapped ? [mapped] : []
  })
}

function rawDetails(raw: unknown, index: number) {
  const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const id = typeof record.id === 'string' && record.id ? record.id : `invalid-${index + 1}`
  const sourceType = typeof record.type === 'string' && record.type ? record.type : 'invalid'
  const finite = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return { id, sourceType, geometry: { x: finite(record.x), y: finite(record.y), width: Math.max(0, finite(record.width)), height: Math.max(0, finite(record.height)) } }
}

export function mapFeishuNodes(nodes: unknown): ImportResult<InteropScene> {
  const elements: InteropElement[] = []
  const issues: ImportCompatibilityIssue[] = []
  let unsupportedElementCount = 0
  let downgradedElementCount = 0

  for (const [index, raw] of extractFeishuNodes(nodes).entries()) {
    const parsed = feishuKnownNodeSchema.safeParse(normalizeBoardNode(raw))
    if (parsed.success) {
      try {
        elements.push(mapKnown(parsed.data))
        if (parsed.data.type === 'image' || parsed.data.type === 'svg') {
          issues.push({ code: `FEISHU_${parsed.data.type.toUpperCase()}_RASTERIZED`, message: 'This visual is preserved as a localized image and is not shape-editable.', severity: 'warning', elementId: parsed.data.id, sourceType: parsed.data.type })
        }
        continue
      } catch {
        // Safety validation (notably SVG sanitization) is reported below as an invalid node.
      }
    }

    const detail = rawDetails(raw, index)
    const isKnownType = typeof raw === 'object' && raw !== null && ['shape', 'text', 'sticky_note', 'image', 'connector', 'section', 'table', 'freehand', 'svg', 'mind_map'].includes(String((raw as Record<string, unknown>).type))
    unsupportedElementCount += 1
    elements.push({ id: detail.id, type: 'unsupported', sourceType: detail.sourceType, sourcePayload: structuredClone(raw), geometry: detail.geometry, zIndex: `z${index}`, style: {} })
    issues.push({
      code: isKnownType ? 'FEISHU_NODE_INVALID' : 'FEISHU_NODE_UNSUPPORTED',
      message: isKnownType ? 'This node failed validation. Fix or export it as an image in Feishu, then retry.' : 'This Feishu node type is not supported. Export it as an image or recreate it locally.',
      severity: isKnownType ? 'error' : 'warning', elementId: detail.id, sourceType: detail.sourceType,
    })
  }

  const report = createImportCompatibilityReport({ issues, unsupportedElementCount, downgradedElementCount })
  const value = parseInteropScene({ formatVersion: INTEROP_SCENE_FORMAT_VERSION, elements, compatibilityReport: report })
  return { value, report }
}
