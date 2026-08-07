import type {
  ConnectorElement,
  InteropElement,
  InteropScene,
} from '../scene/schema.js'
import { serializeDrawioStyle, styleForInteropShape } from './style-map.js'

export interface DrawioExportOptions {
  projectId?: string
}

function escapeXml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function attributes(values: Readonly<Record<string, unknown>>): string {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join('')
}

function styleAndLink(element: InteropElement): {
  style: Record<string, unknown>
  link?: string
} {
  const style = structuredClone(element.style)
  const link = typeof style.url === 'string' ? style.url : undefined
  delete style.url
  switch (element.type) {
    case 'shape':
      return { style: styleForInteropShape(element.shape, style), ...(link ? { link } : {}) }
    case 'text':
      return { style: { ...style, text: '1', html: style.html ?? '1' }, ...(link ? { link } : {}) }
    case 'sticky':
      return { style: { ...style, shape: 'note' }, ...(link ? { link } : {}) }
    case 'section':
      return {
        style: style.group === '1' ? { ...style, group: '1' } : { ...style, swimlane: '1' },
        ...(link ? { link } : {}),
      }
    case 'image':
      return { style: { ...style, shape: 'image', image: element.src }, ...(link ? { link } : {}) }
    case 'svg':
      return {
        style: { ...style, shape: 'image', image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(element.svg)}` },
        ...(link ? { link } : {}),
      }
    case 'board-reference':
      return {
        style: {
          rounded: '1', whiteSpace: 'wrap', html: '1', ...style,
        },
        ...(link ? { link } : {}),
      }
    case 'connector':
      return { style: { edgeStyle: 'orthogonalEdgeStyle', ...style }, ...(link ? { link } : {}) }
    case 'table':
    case 'mind-map':
    case 'paint':
    case 'unsupported':
      return { style, ...(link ? { link } : {}) }
  }
}

function cellValue(element: InteropElement): string {
  switch (element.type) {
    case 'shape': return element.text ?? ''
    case 'text':
    case 'sticky':
    case 'mind-map': return element.text
    case 'connector': return element.text ?? ''
    case 'section': return element.title
    case 'table': return element.cells.map((row) => row.join(' | ')).join('\n')
    case 'image': return element.name ?? ''
    case 'board-reference': return element.titleFallback
    case 'unsupported': return `Unsupported: ${element.sourceType}`
    case 'paint':
    case 'svg': return ''
  }
}

function pointXml(name: 'sourcePoint' | 'targetPoint', point: { x?: number; y?: number }): string {
  if (point.x === undefined || point.y === undefined) return ''
  return `<mxPoint${attributes({ x: point.x, y: point.y, as: name })}/>`
}

function geometryXml(element: InteropElement): string {
  const geometry = element.geometry
  if (element.type !== 'connector') {
    return `<mxGeometry${attributes({
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      as: 'geometry',
    })}/>`
  }
  const points = [
    pointXml('sourcePoint', element.start),
    pointXml('targetPoint', element.end),
  ].join('')
  return points
    ? `<mxGeometry relative="1" as="geometry">${points}</mxGeometry>`
    : '<mxGeometry relative="1" as="geometry"/>'
}

function referenceAttributes(
  element: Extract<InteropElement, { type: 'board-reference' }>,
  projectId: string,
): Record<string, unknown> {
  return {
    iboardReferenceId: element.referenceId,
    iboardTargetBoardId: element.targetBoardId,
    iboardReferenceKind: element.kind,
    iboardProjectId: projectId,
    link: `/projects/${encodeURIComponent(projectId)}/boards/${encodeURIComponent(element.targetBoardId)}`,
  }
}

function elementCell(element: InteropElement, options: DrawioExportOptions): string {
  const mapped = styleAndLink(element)
  const connector = element.type === 'connector' ? element as ConnectorElement : undefined
  const projectId = options.projectId
    ?? (typeof element.style.iboardProjectId === 'string' ? element.style.iboardProjectId : '')
  const extra = element.type === 'board-reference'
    ? referenceAttributes(element, projectId)
    : mapped.link ? { link: mapped.link } : {}
  const common = {
    id: element.id,
    value: cellValue(element),
    style: serializeDrawioStyle(mapped.style),
    parent: element.parentElementId ?? '1',
    ...(connector ? {
      edge: '1',
      ...(connector.start.elementId ? { source: connector.start.elementId } : {}),
      ...(connector.end.elementId ? { target: connector.end.elementId } : {}),
    } : { vertex: '1' }),
    ...extra,
  }
  return `<mxCell${attributes(common)}>${geometryXml(element)}</mxCell>`
}

export function exportDrawio(scene: InteropScene, options: DrawioExportOptions = {}): string {
  const cells = [...scene.elements]
    .sort((left, right) => left.zIndex.localeCompare(right.zIndex))
    .map((element) => elementCell(element, options))
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>`+
    `<mxfile host="app.diagrams.net" modified="${new Date(0).toISOString()}">`+
    `<diagram id="iboard" name="Board"><mxGraphModel><root>`+
    `<mxCell id="0"/><mxCell id="1" parent="0"/>${cells}`+
    `</root></mxGraphModel></diagram></mxfile>`
}
