import type {
  TableCell,
  TableCellBackground,
  TableCellBorder,
  TableCellTextColor,
  TableColumn,
  TableRow,
  TableShapeProps,
  TableTextAlign,
} from './schema.js'
import {
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  MIN_TABLE_CELL_WIDTH,
  MIN_TABLE_ROW_HEIGHT,
} from './schema.js'

export type InternalIdFactory = (prefix: string) => string

let fallbackId = 0
export const createInternalId: InternalIdFactory = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.()
  return `${prefix}-${uuid ?? `${Date.now().toString(36)}-${(fallbackId++).toString(36)}`}`
}

function equalWeights(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count)
}

function normalizedWeights(values: readonly number[]): number[] {
  const safe = values.map((value) => Number.isFinite(value) && value > 0 ? value : 1)
  const total = safe.reduce((sum, value) => sum + value, 0) || 1
  return safe.map((value) => value / total)
}

function uniqueFactory(props: TableShapeProps, id: InternalIdFactory): InternalIdFactory {
  const used = new Set([
    ...props.columns.map((column) => column.id),
    ...props.rows.flatMap((row) => [row.id, ...row.cells.map((cell) => cell.id)]),
  ])
  return (prefix) => {
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const candidate = id(prefix)
      if (!used.has(candidate)) {
        used.add(candidate)
        return candidate
      }
    }
    return createInternalId(prefix)
  }
}

export function createTableProps(
  rowCount = 3,
  columnCount = 3,
  id: InternalIdFactory = createInternalId,
): TableShapeProps {
  const safeRows = Math.max(1, Math.min(MAX_TABLE_ROWS, Math.floor(rowCount)))
  const safeColumns = Math.max(1, Math.min(MAX_TABLE_COLUMNS, Math.floor(columnCount)))
  const columnWeights = equalWeights(safeColumns)
  const rowWeights = equalWeights(safeRows)
  const columns: TableColumn[] = columnWeights.map((width) => ({ id: id('column'), width }))
  const rows: TableRow[] = rowWeights.map((height) => ({
    id: id('row'),
    height,
    cells: columns.map(() => ({
      id: id('cell'), text: '', align: 'left', background: 'none', border: 'light',
      header: false, fontSize: 14, textColor: 'default',
    })),
  }))
  return {
    w: safeColumns * 120,
    h: safeRows * 44,
    columns,
    rows,
  }
}

export function normalizeTableProps(
  props: TableShapeProps,
  id: InternalIdFactory = createInternalId,
): TableShapeProps {
  const columnCount = Math.max(1, Math.min(MAX_TABLE_COLUMNS, props.columns.length || 1))
  const rowCount = Math.max(1, Math.min(MAX_TABLE_ROWS, props.rows.length || 1))
  const columnWeights = normalizedWeights(props.columns.slice(0, columnCount).map((column) => column.width))
  const rowWeights = normalizedWeights(props.rows.slice(0, rowCount).map((row) => row.height))
  const columns = Array.from({ length: columnCount }, (_, index) => ({
    id: props.columns[index]?.id || id('column'),
    width: columnWeights[index]!,
  }))
  const rows = Array.from({ length: rowCount }, (_, rowIndex) => ({
    id: props.rows[rowIndex]?.id || id('row'),
    height: rowWeights[rowIndex]!,
    cells: Array.from({ length: columnCount }, (_, columnIndex) => ({
      id: props.rows[rowIndex]?.cells[columnIndex]?.id || id('cell'),
      text: props.rows[rowIndex]?.cells[columnIndex]?.text ?? '',
      align: props.rows[rowIndex]?.cells[columnIndex]?.align ?? 'left',
      background: props.rows[rowIndex]?.cells[columnIndex]?.background ?? 'none',
      border: props.rows[rowIndex]?.cells[columnIndex]?.border ?? 'light',
      header: Boolean(props.rows[rowIndex]?.cells[columnIndex]?.header),
      fontSize: Math.max(10, Math.min(32, props.rows[rowIndex]?.cells[columnIndex]?.fontSize ?? 14)),
      textColor: props.rows[rowIndex]?.cells[columnIndex]?.textColor ?? 'default',
    })),
  }))
  return {
    w: Math.max(columnCount * MIN_TABLE_CELL_WIDTH, Number.isFinite(props.w) ? props.w : columnCount * 120),
    h: Math.max(rowCount * MIN_TABLE_ROW_HEIGHT, Number.isFinite(props.h) ? props.h : rowCount * 44),
    columns,
    rows,
  }
}

export function updateTableCell(
  props: TableShapeProps,
  rowId: string,
  cellId: string,
  text: string,
): TableShapeProps {
  return {
    ...props,
    rows: props.rows.map((row) => row.id === rowId
      ? { ...row, cells: row.cells.map((cell) => cell.id === cellId ? { ...cell, text } : cell) }
      : row),
  }
}

export function insertTableRow(
  props: TableShapeProps,
  index: number,
  id: InternalIdFactory = createInternalId,
): TableShapeProps {
  if (props.rows.length >= MAX_TABLE_ROWS) return props
  const nextId = uniqueFactory(props, id)
  const rows = [...props.rows]
  rows.splice(Math.max(0, Math.min(rows.length, index)), 0, {
    id: nextId('row'),
    height: 1,
    cells: props.columns.map(() => ({
      id: nextId('cell'), text: '', align: 'left', background: 'none', border: 'light',
      header: false, fontSize: 14, textColor: 'default',
    })),
  })
  const heights = equalWeights(rows.length)
  return {
    ...props,
    h: Math.max(props.h, rows.length * MIN_TABLE_ROW_HEIGHT),
    rows: rows.map((row, rowIndex) => ({ ...row, height: heights[rowIndex]! })),
  }
}

export function duplicateTableRow(
  props: TableShapeProps,
  rowIndex: number,
  id: InternalIdFactory = createInternalId,
): TableShapeProps {
  const source = props.rows[rowIndex]
  if (!source || props.rows.length >= MAX_TABLE_ROWS) return props
  const nextId = uniqueFactory(props, id)
  const rows = [...props.rows]
  rows.splice(rowIndex + 1, 0, {
    ...source,
    id: nextId('row'),
    cells: source.cells.map((cell) => ({ ...cell, id: nextId('cell') })),
  })
  const heights = equalWeights(rows.length)
  return {
    ...props,
    h: Math.max(props.h, rows.length * MIN_TABLE_ROW_HEIGHT),
    rows: rows.map((row, index) => ({ ...row, height: heights[index]! })),
  }
}

export function deleteTableRow(props: TableShapeProps, rowId: string): TableShapeProps {
  if (props.rows.length <= 1) return props
  const rows = props.rows.filter((row) => row.id !== rowId)
  if (rows.length === props.rows.length) return props
  const heights = normalizedWeights(rows.map((row) => row.height))
  return { ...props, rows: rows.map((row, index) => ({ ...row, height: heights[index]! })) }
}

export function insertTableColumn(
  props: TableShapeProps,
  index: number,
  id: InternalIdFactory = createInternalId,
): TableShapeProps {
  if (props.columns.length >= MAX_TABLE_COLUMNS) return props
  const nextId = uniqueFactory(props, id)
  const columns = [...props.columns]
  const safeIndex = Math.max(0, Math.min(columns.length, index))
  columns.splice(safeIndex, 0, { id: nextId('column'), width: 1 })
  const widths = equalWeights(columns.length)
  return {
    ...props,
    w: Math.max(props.w, columns.length * MIN_TABLE_CELL_WIDTH),
    columns: columns.map((column, columnIndex) => ({ ...column, width: widths[columnIndex]! })),
    rows: props.rows.map((row) => {
      const cells = [...row.cells]
      cells.splice(safeIndex, 0, {
        id: nextId('cell'), text: '', align: 'left', background: 'none', border: 'light',
        header: false, fontSize: 14, textColor: 'default',
      })
      return { ...row, cells }
    }),
  }
}

export function duplicateTableColumn(
  props: TableShapeProps,
  columnIndex: number,
  id: InternalIdFactory = createInternalId,
): TableShapeProps {
  const source = props.columns[columnIndex]
  if (!source || props.columns.length >= MAX_TABLE_COLUMNS) return props
  const nextId = uniqueFactory(props, id)
  const columns = [...props.columns]
  columns.splice(columnIndex + 1, 0, { ...source, id: nextId('column') })
  const widths = equalWeights(columns.length)
  return {
    ...props,
    w: Math.max(props.w, columns.length * MIN_TABLE_CELL_WIDTH),
    columns: columns.map((column, index) => ({ ...column, width: widths[index]! })),
    rows: props.rows.map((row) => {
      const cells = [...row.cells]
      cells.splice(columnIndex + 1, 0, { ...row.cells[columnIndex]!, id: nextId('cell') })
      return { ...row, cells }
    }),
  }
}

export function deleteTableColumn(props: TableShapeProps, columnId: string): TableShapeProps {
  if (props.columns.length <= 1) return props
  const columnIndex = props.columns.findIndex((column) => column.id === columnId)
  if (columnIndex < 0) return props
  const columns = props.columns.filter((column) => column.id !== columnId)
  const widths = normalizedWeights(columns.map((column) => column.width))
  return {
    ...props,
    columns: columns.map((column, index) => ({ ...column, width: widths[index]! })),
    rows: props.rows.map((row) => ({
      ...row,
      cells: row.cells.filter((_, index) => index !== columnIndex),
    })),
  }
}

export function resizeTableColumns(
  props: TableShapeProps,
  boundaryIndex: number,
  deltaPx: number,
): TableShapeProps {
  const left = props.columns[boundaryIndex]
  const right = props.columns[boundaryIndex + 1]
  if (!left || !right) return props
  const pairWidth = (left.width + right.width) * props.w
  const minimum = Math.min(MIN_TABLE_CELL_WIDTH, pairWidth / 2)
  const nextLeftPx = Math.max(minimum, Math.min(pairWidth - minimum, left.width * props.w + deltaPx))
  const next = props.columns.map((column, index) => index === boundaryIndex
    ? { ...column, width: nextLeftPx / props.w }
    : index === boundaryIndex + 1
      ? { ...column, width: (pairWidth - nextLeftPx) / props.w }
      : column)
  return { ...props, columns: next }
}

export function resizeTableRows(
  props: TableShapeProps,
  boundaryIndex: number,
  deltaPx: number,
): TableShapeProps {
  const top = props.rows[boundaryIndex]
  const bottom = props.rows[boundaryIndex + 1]
  if (!top || !bottom) return props
  const pairHeight = (top.height + bottom.height) * props.h
  const minimum = Math.min(MIN_TABLE_ROW_HEIGHT, pairHeight / 2)
  const nextTopPx = Math.max(minimum, Math.min(pairHeight - minimum, top.height * props.h + deltaPx))
  const next = props.rows.map((row, index) => index === boundaryIndex
    ? { ...row, height: nextTopPx / props.h }
    : index === boundaryIndex + 1
      ? { ...row, height: (pairHeight - nextTopPx) / props.h }
      : row)
  return { ...props, rows: next }
}

function parseTsv(text: string): string[][] {
  return text.replace(/\r\n?/g, '\n').split('\n').map((row) => row.split('\t'))
}

export function pasteTableTsv(
  props: TableShapeProps,
  startRow: number,
  startColumn: number,
  text: string,
  id: InternalIdFactory = createInternalId,
): TableShapeProps {
  const values = parseTsv(text)
  const requiredRows = Math.min(MAX_TABLE_ROWS, Math.max(props.rows.length, startRow + values.length))
  const requiredColumns = Math.min(
    MAX_TABLE_COLUMNS,
    Math.max(props.columns.length, startColumn + Math.max(0, ...values.map((row) => row.length))),
  )
  let next = props
  while (next.rows.length < requiredRows) next = insertTableRow(next, next.rows.length, id)
  while (next.columns.length < requiredColumns) next = insertTableColumn(next, next.columns.length, id)
  const rows = next.rows.map((row, rowIndex) => ({
    ...row,
    cells: row.cells.map((cell, columnIndex) => {
      const value = values[rowIndex - startRow]?.[columnIndex - startColumn]
      return value === undefined ? cell : { ...cell, text: value }
    }),
  }))
  return { ...next, rows }
}

export interface TableCellRange {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
}

export function normalizeTableRange(props: TableShapeProps, range: TableCellRange): TableCellRange {
  const lastRow = Math.max(0, props.rows.length - 1)
  const lastColumn = Math.max(0, props.columns.length - 1)
  const firstRow = Math.max(0, Math.min(lastRow, Math.min(range.startRow, range.endRow)))
  const finalRow = Math.max(0, Math.min(lastRow, Math.max(range.startRow, range.endRow)))
  const firstColumn = Math.max(0, Math.min(lastColumn, Math.min(range.startColumn, range.endColumn)))
  const finalColumn = Math.max(0, Math.min(lastColumn, Math.max(range.startColumn, range.endColumn)))
  return { startRow: firstRow, endRow: finalRow, startColumn: firstColumn, endColumn: finalColumn }
}

export function tableCellIdsInRange(props: TableShapeProps, range: TableCellRange): string[] {
  const normalized = normalizeTableRange(props, range)
  const ids: string[] = []
  for (let rowIndex = normalized.startRow; rowIndex <= normalized.endRow; rowIndex += 1) {
    for (let columnIndex = normalized.startColumn; columnIndex <= normalized.endColumn; columnIndex += 1) {
      const cell = props.rows[rowIndex]?.cells[columnIndex]
      if (cell) ids.push(cell.id)
    }
  }
  return ids
}

export function clearTableCells(props: TableShapeProps, cellIds: readonly string[]): TableShapeProps {
  const selected = new Set(cellIds)
  if (selected.size === 0) return props
  return {
    ...props,
    rows: props.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => selected.has(cell.id) ? { ...cell, text: '' } : cell),
    })),
  }
}

export function tableRangeToTsv(props: TableShapeProps, range: TableCellRange): string {
  const normalized = normalizeTableRange(props, range)
  return props.rows
    .slice(normalized.startRow, normalized.endRow + 1)
    .map((row) => row.cells
      .slice(normalized.startColumn, normalized.endColumn + 1)
      .map((cell) => cell.text.replaceAll('\t', ' ').replaceAll(/\r?\n/g, ' '))
      .join('\t'))
    .join('\n')
}

export function fillTableRange(props: TableShapeProps, range: TableCellRange, text: string): TableShapeProps {
  const ids = new Set(tableCellIdsInRange(props, range))
  return {
    ...props,
    rows: props.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ids.has(cell.id) ? { ...cell, text } : cell),
    })),
  }
}

export function moveTableRow(props: TableShapeProps, fromIndex: number, toIndex: number): TableShapeProps {
  if (fromIndex < 0 || fromIndex >= props.rows.length) return props
  const safeTarget = Math.max(0, Math.min(props.rows.length - 1, toIndex))
  if (safeTarget === fromIndex) return props
  const rows = [...props.rows]
  const [row] = rows.splice(fromIndex, 1)
  rows.splice(safeTarget, 0, row!)
  return { ...props, rows }
}

export function moveTableColumn(props: TableShapeProps, fromIndex: number, toIndex: number): TableShapeProps {
  if (fromIndex < 0 || fromIndex >= props.columns.length) return props
  const safeTarget = Math.max(0, Math.min(props.columns.length - 1, toIndex))
  if (safeTarget === fromIndex) return props
  const columns = [...props.columns]
  const [column] = columns.splice(fromIndex, 1)
  columns.splice(safeTarget, 0, column!)
  return {
    ...props,
    columns,
    rows: props.rows.map((row) => {
      const cells = [...row.cells]
      const [cell] = cells.splice(fromIndex, 1)
      cells.splice(safeTarget, 0, cell!)
      return { ...row, cells }
    }),
  }
}

export function distributeTableColumns(props: TableShapeProps): TableShapeProps {
  const width = 1 / props.columns.length
  return { ...props, columns: props.columns.map((column) => ({ ...column, width })) }
}

export function distributeTableRows(props: TableShapeProps): TableShapeProps {
  const height = 1 / props.rows.length
  return { ...props, rows: props.rows.map((row) => ({ ...row, height })) }
}

export interface TableCellStylePatch {
  align?: TableTextAlign
  background?: TableCellBackground
  border?: TableCellBorder
  header?: boolean
  fontSize?: number
  fontFamily?: TableCell['fontFamily']
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  textColor?: TableCellTextColor
}

export function updateTableCellStyles(
  props: TableShapeProps,
  cellIds: readonly string[],
  patch: TableCellStylePatch,
): TableShapeProps {
  const selected = new Set(cellIds)
  return {
    ...props,
    rows: props.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => selected.has(cell.id) ? { ...cell, ...patch } : cell),
    })),
  }
}

export function toggleTableHeaderRow(props: TableShapeProps, rowId: string): TableShapeProps {
  const row = props.rows.find((candidate) => candidate.id === rowId)
  if (!row) return props
  const next = !row.cells.every((cell) => cell.header)
  return updateTableCellStyles(props, row.cells.map((cell) => cell.id), {
    header: next,
    align: next ? 'center' : 'left',
    background: next ? 'gray' : 'none',
  })
}

export function autoFitTableRows(props: TableShapeProps, rowIds?: readonly string[]): TableShapeProps {
  const selected = rowIds ? new Set(rowIds) : undefined
  const heights = props.rows.map((row) => {
    const current = row.height * props.h
    if (selected && !selected.has(row.id)) return current
    const estimated = row.cells.reduce((height, cell, columnIndex) => {
      const width = Math.max(MIN_TABLE_CELL_WIDTH, (props.columns[columnIndex]?.width ?? 1) * props.w) - 16
      const fontSize = Math.max(10, Math.min(32, cell.fontSize ?? 14))
      const charactersPerLine = Math.max(4, Math.floor(width / (fontSize * 0.56)))
      const lines = Math.max(1, cell.text.split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0))
      return Math.max(height, 16 + lines * Math.ceil(fontSize * 1.35))
    }, MIN_TABLE_ROW_HEIGHT)
    return Math.max(MIN_TABLE_ROW_HEIGHT, estimated)
  })
  const total = heights.reduce((sum, height) => sum + height, 0)
  return {
    ...props,
    h: total,
    rows: props.rows.map((row, index) => ({ ...row, height: heights[index]! / total })),
  }
}
