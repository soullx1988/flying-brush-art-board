import { T, type RecordProps, type TLShape } from 'tldraw'

export const TABLE_SHAPE_TYPE = 'table' as const
export const MAX_TABLE_ROWS = 50
export const MAX_TABLE_COLUMNS = 50
export const MIN_TABLE_CELL_WIDTH = 72
export const MIN_TABLE_ROW_HEIGHT = 32

export type TableTextAlign = 'left' | 'center' | 'right'
export type TableFontFamily = 'draw' | 'sans' | 'serif' | 'mono'
export type TableCellBackground = 'none' | 'gray' | 'blue' | 'yellow' | 'green' | 'red'
export type TableCellBorder = 'light' | 'strong' | 'none'
export type TableCellTextColor = 'default' | 'gray' | 'red' | 'orange' | 'green' | 'blue' | 'purple'

export interface TableCell {
  id: string
  text: string
  align?: TableTextAlign | undefined
  background?: TableCellBackground | undefined
  border?: TableCellBorder | undefined
  header?: boolean | undefined
  fontSize?: number | undefined
  fontFamily?: TableFontFamily | undefined
  bold?: boolean | undefined
  italic?: boolean | undefined
  underline?: boolean | undefined
  strike?: boolean | undefined
  textColor?: TableCellTextColor | undefined
}

export interface TableColumn {
  id: string
  width: number
}

export interface TableRow {
  id: string
  height: number
  cells: TableCell[]
}

export interface TableShapeProps {
  w: number
  h: number
  columns: TableColumn[]
  rows: TableRow[]
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    [TABLE_SHAPE_TYPE]: TableShapeProps
  }
}

export type TableShape = TLShape<typeof TABLE_SHAPE_TYPE>

const tableCellValidator = T.object({
  id: T.string,
  text: T.string,
  align: T.literalEnum('left', 'center', 'right').optional(),
  background: T.literalEnum('none', 'gray', 'blue', 'yellow', 'green', 'red').optional(),
  border: T.literalEnum('light', 'strong', 'none').optional(),
  header: T.boolean.optional(),
  fontSize: T.number.optional(),
  fontFamily: T.literalEnum('draw', 'sans', 'serif', 'mono').optional(),
  bold: T.boolean.optional(),
  italic: T.boolean.optional(),
  underline: T.boolean.optional(),
  strike: T.boolean.optional(),
  textColor: T.literalEnum('default', 'gray', 'red', 'orange', 'green', 'blue', 'purple').optional(),
})
const tableColumnValidator = T.object({ id: T.string, width: T.number })
const tableRowValidator = T.object({
  id: T.string,
  height: T.number,
  cells: T.arrayOf(tableCellValidator),
})

export const tableShapeProps: RecordProps<TableShape> = {
  w: T.number,
  h: T.number,
  columns: T.arrayOf(tableColumnValidator),
  rows: T.arrayOf(tableRowValidator),
}

export const tableShapeMigrations = { sequence: [] }
