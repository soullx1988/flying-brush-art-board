import { T, type RecordProps, type TLShape } from 'tldraw'

export const MIND_MAP_SHAPE_TYPE = 'mind-map' as const
export const MAX_MIND_MAP_NODES = 500

export type MindMapLayout = 'right' | 'bilateral'
export type MindMapSide = 'left' | 'right'
export type MindMapNodeColor = 'blue' | 'violet' | 'green' | 'orange' | 'red' | 'gray'
export type MindMapNodeShape = 'rounded' | 'pill' | 'underline'
export type MindMapTheme = 'classic' | 'colorful' | 'minimal'
export const MIND_MAP_PALETTE = [
  'black', 'gray', 'purple', 'violet', 'indigo', 'blue',
  'amber', 'orange', 'teal', 'green', 'coral', 'red',
] as const
export type MindMapPaletteColor = typeof MIND_MAP_PALETTE[number]
export type MindMapFontSize = 's' | 'm' | 'l' | 'xl'
export type MindMapFontFamily = 'draw' | 'sans' | 'serif' | 'mono'
export type MindMapTextAlign = 'left' | 'center' | 'right'
export type MindMapEdgeDash = 'solid' | 'dashed' | 'dotted'
export type MindMapEdgeWidth = 1 | 2 | 3 | 4

export interface MindMapNodeStyle {
  fillColor?: MindMapPaletteColor | undefined
  fillOpacity?: number | undefined
  borderColor?: MindMapPaletteColor | undefined
  borderOpacity?: number | undefined
  textColor?: MindMapPaletteColor | undefined
  textOpacity?: number | undefined
  fontSize?: MindMapFontSize | undefined
  fontFamily?: MindMapFontFamily | undefined
  textAlign?: MindMapTextAlign | undefined
  bold?: boolean | undefined
  italic?: boolean | undefined
  underline?: boolean | undefined
  strike?: boolean | undefined
  edgeColor?: MindMapPaletteColor | undefined
  edgeOpacity?: number | undefined
  edgeDash?: MindMapEdgeDash | undefined
  edgeWidth?: MindMapEdgeWidth | undefined
}

export interface MindMapNode {
  id: string
  parentId: string | null
  text: string
  order: number
  side: MindMapSide
  collapsed: boolean
  color?: MindMapNodeColor | undefined
  shape?: MindMapNodeShape | undefined
  style?: MindMapNodeStyle | undefined
}

export interface MindMapShapeProps {
  w: number
  h: number
  layout: MindMapLayout
  nodes: MindMapNode[]
  theme?: MindMapTheme | undefined
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    [MIND_MAP_SHAPE_TYPE]: MindMapShapeProps
  }
}

export type MindMapShape = TLShape<typeof MIND_MAP_SHAPE_TYPE>

const mindMapNodeValidator = T.object({
  id: T.string,
  parentId: T.string.nullable(),
  text: T.string,
  order: T.number,
  side: T.literalEnum('left', 'right'),
  collapsed: T.boolean,
  color: T.literalEnum('blue', 'violet', 'green', 'orange', 'red', 'gray').optional(),
  shape: T.literalEnum('rounded', 'pill', 'underline').optional(),
  style: T.object({
    fillColor: T.literalEnum(...MIND_MAP_PALETTE).optional(),
    fillOpacity: T.number.optional(),
    borderColor: T.literalEnum(...MIND_MAP_PALETTE).optional(),
    borderOpacity: T.number.optional(),
    textColor: T.literalEnum(...MIND_MAP_PALETTE).optional(),
    textOpacity: T.number.optional(),
    fontSize: T.literalEnum('s', 'm', 'l', 'xl').optional(),
    fontFamily: T.literalEnum('draw', 'sans', 'serif', 'mono').optional(),
    textAlign: T.literalEnum('left', 'center', 'right').optional(),
    bold: T.boolean.optional(),
    italic: T.boolean.optional(),
    underline: T.boolean.optional(),
    strike: T.boolean.optional(),
    edgeColor: T.literalEnum(...MIND_MAP_PALETTE).optional(),
    edgeOpacity: T.number.optional(),
    edgeDash: T.literalEnum('solid', 'dashed', 'dotted').optional(),
    edgeWidth: T.literalEnum(1, 2, 3, 4).optional(),
  }).optional(),
})

export const mindMapShapeProps: RecordProps<MindMapShape> = {
  w: T.number,
  h: T.number,
  layout: T.literalEnum('right', 'bilateral'),
  nodes: T.arrayOf(mindMapNodeValidator),
  theme: T.literalEnum('classic', 'colorful', 'minimal').optional(),
}

export const mindMapShapeMigrations = { sequence: [] }
