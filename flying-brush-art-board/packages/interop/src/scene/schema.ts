import { z } from 'zod'

import type { ImportCompatibilityReport } from './compatibility-report.js'

export const INTEROP_SCENE_FORMAT_VERSION = 1 as const

export interface InteropGeometry {
  x: number
  y: number
  width: number
  height: number
  rotation?: number
}

export interface InteropElementBase {
  id: string
  geometry: InteropGeometry
  parentElementId?: string
  zIndex: string
  style: Record<string, unknown>
  sourcePayload?: unknown
}

export interface ShapeElement extends InteropElementBase {
  type: 'shape'
  shape: string
  text?: string
}

export interface TextElement extends InteropElementBase {
  type: 'text'
  text: string
}

export interface StickyElement extends InteropElementBase {
  type: 'sticky'
  text: string
}

export interface ConnectorEndpoint {
  elementId?: string
  x?: number
  y?: number
}

export interface ConnectorElement extends InteropElementBase {
  type: 'connector'
  start: ConnectorEndpoint
  end: ConnectorEndpoint
  text?: string
}

export interface SectionElement extends InteropElementBase {
  type: 'section'
  title: string
}

export interface TableElement extends InteropElementBase {
  type: 'table'
  cells: string[][]
}

export interface PaintElement extends InteropElementBase {
  type: 'paint'
  points: Array<{ x: number; y: number; pressure?: number }>
}

export interface ImageElement extends InteropElementBase {
  type: 'image'
  src: string
  mimeType: string
  name?: string
}

export interface SvgElement extends InteropElementBase {
  type: 'svg'
  svg: string
}

export interface MindMapNodeStyle {
  fillColor?: 'black' | 'gray' | 'purple' | 'violet' | 'indigo' | 'blue' | 'amber' | 'orange' | 'teal' | 'green' | 'coral' | 'red' | undefined
  fillOpacity?: number | undefined
  borderColor?: 'black' | 'gray' | 'purple' | 'violet' | 'indigo' | 'blue' | 'amber' | 'orange' | 'teal' | 'green' | 'coral' | 'red' | undefined
  borderOpacity?: number | undefined
  textColor?: 'black' | 'gray' | 'purple' | 'violet' | 'indigo' | 'blue' | 'amber' | 'orange' | 'teal' | 'green' | 'coral' | 'red' | undefined
  textOpacity?: number | undefined
  fontSize?: 's' | 'm' | 'l' | 'xl' | undefined
  fontFamily?: 'draw' | 'sans' | 'serif' | 'mono' | undefined
  textAlign?: 'left' | 'center' | 'right' | undefined
  bold?: boolean | undefined
  italic?: boolean | undefined
  underline?: boolean | undefined
  strike?: boolean | undefined
  edgeColor?: 'black' | 'gray' | 'purple' | 'violet' | 'indigo' | 'blue' | 'amber' | 'orange' | 'teal' | 'green' | 'coral' | 'red' | undefined
  edgeOpacity?: number | undefined
  edgeDash?: 'solid' | 'dashed' | 'dotted' | undefined
  edgeWidth?: 1 | 2 | 3 | 4 | undefined
}

export interface MindMapBranch {
  id: string
  text: string
  side?: 'left' | 'right' | undefined
  collapsed?: boolean | undefined
  shape?: 'rounded' | 'pill' | 'underline' | undefined
  style?: MindMapNodeStyle | undefined
  children: MindMapBranch[]
}

export interface MindMapElement extends InteropElementBase {
  type: 'mind-map'
  text: string
  children?: MindMapBranch[] | undefined
  layout?: 'right' | 'bilateral' | undefined
  rootShape?: 'rounded' | 'pill' | 'underline' | undefined
  rootStyle?: MindMapNodeStyle | undefined
  theme?: 'classic' | 'colorful' | 'minimal' | undefined
}

export interface BoardReferenceElement extends InteropElementBase {
  type: 'board-reference'
  referenceId: string
  targetBoardId: string
  kind: 'embed' | 'link'
  titleFallback: string
}

export interface UnsupportedElement extends InteropElementBase {
  type: 'unsupported'
  sourceType: string
  sourcePayload: unknown
}

export type InteropElement =
  | ShapeElement
  | TextElement
  | StickyElement
  | ConnectorElement
  | SectionElement
  | TableElement
  | PaintElement
  | ImageElement
  | SvgElement
  | MindMapElement
  | BoardReferenceElement
  | UnsupportedElement

export interface InteropScene {
  formatVersion: typeof INTEROP_SCENE_FORMAT_VERSION
  elements: InteropElement[]
  compatibilityReport?: ImportCompatibilityReport
}

const geometrySchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
  rotation: z.number().finite().optional(),
})

const baseElementFields = {
  id: z.string().min(1),
  geometry: geometrySchema,
  parentElementId: z.string().min(1).optional(),
  zIndex: z.string().min(1),
  style: z.record(z.string(), z.unknown()),
  sourcePayload: z.unknown().optional(),
}

const endpointSchema = z.object({
  elementId: z.string().min(1).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
}).superRefine((endpoint, context) => {
  const hasPoint = endpoint.x !== undefined && endpoint.y !== undefined
  if (!endpoint.elementId && !hasPoint) {
    context.addIssue({ code: 'custom', message: 'Connector endpoint requires an elementId or x/y point' })
  }
})

const mindMapPaletteSchema = z.enum(['black', 'gray', 'purple', 'violet', 'indigo', 'blue', 'amber', 'orange', 'teal', 'green', 'coral', 'red'])
const mindMapNodeStyleSchema = z.object({
  fillColor: mindMapPaletteSchema.optional(),
  fillOpacity: z.number().finite().min(0).max(1).optional(),
  borderColor: mindMapPaletteSchema.optional(),
  borderOpacity: z.number().finite().min(0).max(1).optional(),
  textColor: mindMapPaletteSchema.optional(),
  textOpacity: z.number().finite().min(0).max(1).optional(),
  fontSize: z.enum(['s', 'm', 'l', 'xl']).optional(),
  fontFamily: z.enum(['draw', 'sans', 'serif', 'mono']).optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  edgeColor: mindMapPaletteSchema.optional(),
  edgeOpacity: z.number().finite().min(0).max(1).optional(),
  edgeDash: z.enum(['solid', 'dashed', 'dotted']).optional(),
  edgeWidth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
})

const mindMapBranchSchema: z.ZodType<MindMapBranch> = z.lazy(() => z.object({
  id: z.string().min(1),
  text: z.string(),
  side: z.enum(['left', 'right']).optional(),
  collapsed: z.boolean().optional(),
  shape: z.enum(['rounded', 'pill', 'underline']).optional(),
  style: mindMapNodeStyleSchema.optional(),
  children: z.array(mindMapBranchSchema),
}))

const elementSchema = z.discriminatedUnion('type', [
  z.object({ ...baseElementFields, type: z.literal('shape'), shape: z.string().min(1), text: z.string().optional() }),
  z.object({ ...baseElementFields, type: z.literal('text'), text: z.string() }),
  z.object({ ...baseElementFields, type: z.literal('sticky'), text: z.string() }),
  z.object({ ...baseElementFields, type: z.literal('connector'), start: endpointSchema, end: endpointSchema, text: z.string().optional() }),
  z.object({ ...baseElementFields, type: z.literal('section'), title: z.string() }),
  z.object({ ...baseElementFields, type: z.literal('table'), cells: z.array(z.array(z.string())) }),
  z.object({ ...baseElementFields, type: z.literal('paint'), points: z.array(z.object({ x: z.number().finite(), y: z.number().finite(), pressure: z.number().finite().optional() })) }),
  z.object({ ...baseElementFields, type: z.literal('image'), src: z.string(), mimeType: z.string().min(1), name: z.string().optional() }),
  z.object({ ...baseElementFields, type: z.literal('svg'), svg: z.string() }),
  z.object({
    ...baseElementFields,
    type: z.literal('mind-map'),
    text: z.string(),
    children: z.array(mindMapBranchSchema).optional(),
    layout: z.enum(['right', 'bilateral']).optional(),
    rootShape: z.enum(['rounded', 'pill', 'underline']).optional(),
    rootStyle: mindMapNodeStyleSchema.optional(),
    theme: z.enum(['classic', 'colorful', 'minimal']).optional(),
  }),
  z.object({
    ...baseElementFields,
    type: z.literal('board-reference'),
    referenceId: z.string().min(1),
    targetBoardId: z.string().min(1),
    kind: z.enum(['embed', 'link']),
    titleFallback: z.string(),
  }),
  z.object({ ...baseElementFields, type: z.literal('unsupported'), sourceType: z.string().min(1), sourcePayload: z.unknown() }),
])

const compatibilityIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  severity: z.enum(['warning', 'error']),
  elementId: z.string().optional(),
  sourceType: z.string().optional(),
})

const compatibilityReportSchema = z.object({
  issues: z.array(compatibilityIssueSchema),
  unsupportedElementCount: z.number().int().nonnegative(),
  downgradedElementCount: z.number().int().nonnegative(),
  migrations: z.array(z.string()),
})

export const interopSceneSchema = z.object({
  formatVersion: z.literal(INTEROP_SCENE_FORMAT_VERSION),
  elements: z.array(elementSchema),
  compatibilityReport: compatibilityReportSchema.optional(),
}).superRefine((scene, context) => {
  const ids = new Set<string>()
  for (const [index, element] of scene.elements.entries()) {
    if (ids.has(element.id)) {
      context.addIssue({ code: 'custom', path: ['elements', index, 'id'], message: `Duplicate element id: ${element.id}` })
    }
    ids.add(element.id)
  }

  const parents = new Map<string, string>()
  for (const [index, element] of scene.elements.entries()) {
    if (element.parentElementId) {
      if (!ids.has(element.parentElementId)) {
        context.addIssue({ code: 'custom', path: ['elements', index, 'parentElementId'], message: `Unknown parent element: ${element.parentElementId}` })
      }
      parents.set(element.id, element.parentElementId)
    }
    if (element.type === 'connector') {
      for (const [terminal, endpoint] of [['start', element.start], ['end', element.end]] as const) {
        if (endpoint.elementId && !ids.has(endpoint.elementId)) {
          context.addIssue({ code: 'custom', path: ['elements', index, terminal, 'elementId'], message: `Unknown connector element: ${endpoint.elementId}` })
        }
      }
    }
  }

  for (const element of scene.elements) {
    const visited = new Set<string>([element.id])
    let parent = parents.get(element.id)
    while (parent) {
      if (visited.has(parent)) {
        context.addIssue({ code: 'custom', message: `Element container cycle at ${element.id}` })
        break
      }
      visited.add(parent)
      parent = parents.get(parent)
    }
  }
})

export function parseInteropScene(value: unknown): InteropScene {
  return interopSceneSchema.parse(value) as InteropScene
}
