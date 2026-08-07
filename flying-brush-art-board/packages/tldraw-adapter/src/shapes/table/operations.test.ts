import { describe, expect, it } from 'vitest'

import {
  autoFitTableRows,
  clearTableCells,
  createTableProps,
  deleteTableColumn,
  deleteTableRow,
  duplicateTableColumn,
  duplicateTableRow,
  distributeTableColumns,
  distributeTableRows,
  fillTableRange,
  insertTableColumn,
  insertTableRow,
  moveTableColumn,
  moveTableRow,
  pasteTableTsv,
  resizeTableColumns,
  tableCellIdsInRange,
  tableRangeToTsv,
  toggleTableHeaderRow,
  updateTableCellStyles,
  updateTableCell,
} from './operations.js'

function ids() {
  let value = 0
  return (prefix: string) => `${prefix}-${value++}`
}

describe('table shape operations', () => {
  it('creates a rectangular 3x3 table and edits a stable cell', () => {
    const props = createTableProps(3, 3, ids())
    const cell = props.rows[1]!.cells[2]!
    const updated = updateTableCell(props, props.rows[1]!.id, cell.id, 'Roadmap')

    expect(props.rows).toHaveLength(3)
    expect(props.rows.every((row) => row.cells.length === 3)).toBe(true)
    expect(updated.rows[1]!.cells[2]).toMatchObject({ id: cell.id, text: 'Roadmap' })
  })

  it('inserts and deletes rows and columns without making the grid ragged', () => {
    const source = createTableProps(2, 2, ids())
    const withRow = insertTableRow(source, 1, ids())
    const withColumn = insertTableColumn(withRow, 1, ids())
    const withoutRow = deleteTableRow(withColumn, withColumn.rows[0]!.id)
    const withoutColumn = deleteTableColumn(withoutRow, withoutRow.columns[0]!.id)

    expect(withColumn.rows).toHaveLength(3)
    expect(withColumn.columns).toHaveLength(3)
    expect(withColumn.rows.every((row) => row.cells.length === 3)).toBe(true)
    expect(withoutRow.rows).toHaveLength(2)
    expect(withoutColumn.columns).toHaveLength(2)
    expect(withoutColumn.rows.every((row) => row.cells.length === 2)).toBe(true)
  })

  it('duplicates rows and columns with content, formatting and fresh stable ids', () => {
    let source = pasteTableTsv(createTableProps(2, 2, ids()), 0, 0, 'A\tB\nC\tD', ids())
    source = updateTableCellStyles(source, [source.rows[0]!.cells[0]!.id], {
      background: 'blue', fontSize: 18, textColor: 'red', header: true,
    })
    const duplicatedRow = duplicateTableRow(source, 0, ids())
    const duplicated = duplicateTableColumn(duplicatedRow, 0, ids())

    expect(duplicated.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ['A', 'A', 'B'],
      ['A', 'A', 'B'],
      ['C', 'C', 'D'],
    ])
    expect(duplicated.rows[1]!.cells[1]).toMatchObject({
      text: 'A', background: 'blue', fontSize: 18, textColor: 'red', header: true,
    })
    expect(new Set(duplicated.columns.map((column) => column.id)).size).toBe(3)
    expect(new Set(duplicated.rows.flatMap((row) => [row.id, ...row.cells.map((cell) => cell.id)])).size).toBe(12)
  })

  it('inserts at the hovered row or column boundary instead of always appending', () => {
    const source = pasteTableTsv(createTableProps(2, 2, ids()), 0, 0, 'A\tB\nC\tD', ids())
    const withMiddleRow = insertTableRow(source, 1, ids())
    const withMiddleColumn = insertTableColumn(withMiddleRow, 1, ids())

    expect(withMiddleColumn.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ['A', '', 'B'],
      ['', '', ''],
      ['C', '', 'D'],
    ])
  })

  it('equalizes all row heights and column widths after insertion', () => {
    const source = createTableProps(2, 2, ids())
    const uneven = {
      ...source,
      rows: [
        { ...source.rows[0]!, height: 0.8 },
        { ...source.rows[1]!, height: 0.2 },
      ],
      columns: [
        { ...source.columns[0]!, width: 0.75 },
        { ...source.columns[1]!, width: 0.25 },
      ],
    }
    const inserted = insertTableColumn(insertTableRow(uneven, 1, ids()), 1, ids())

    expect(inserted.rows.map((row) => row.height)).toEqual([1 / 3, 1 / 3, 1 / 3])
    expect(inserted.columns.map((column) => column.width)).toEqual([1 / 3, 1 / 3, 1 / 3])
  })

  it('expands for TSV paste and preserves the pasted rectangle', () => {
    const source = createTableProps(1, 1, ids())
    const pasted = pasteTableTsv(source, 0, 0, 'A\tB\nC\tD', ids())

    expect(pasted.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ['A', 'B'],
      ['C', 'D'],
    ])
  })

  it('resizes adjacent columns while keeping their combined weight', () => {
    const source = createTableProps(1, 2, ids())
    const combined = source.columns[0]!.width + source.columns[1]!.width
    const resized = resizeTableColumns(source, 0, 30)

    expect(resized.columns[0]!.width).toBeGreaterThan(source.columns[0]!.width)
    expect(resized.columns[0]!.width + resized.columns[1]!.width).toBeCloseTo(combined)
  })

  it('selects rectangular ranges and supports batch copy, fill and clear', () => {
    let props = createTableProps(3, 3, ids())
    props = pasteTableTsv(props, 0, 0, 'A\tB\tC\nD\tE\tF\nG\tH\tI', ids())
    const range = { startRow: 0, endRow: 1, startColumn: 1, endColumn: 2 }
    const selected = tableCellIdsInRange(props, range)

    expect(tableRangeToTsv(props, range)).toBe('B\tC\nE\tF')
    expect(selected).toHaveLength(4)
    expect(tableRangeToTsv(fillTableRange(props, range, 'X'), range)).toBe('X\tX\nX\tX')
    expect(tableRangeToTsv(clearTableCells(props, selected), range)).toBe('\t\n\t')
  })

  it('reorders rows and columns while preserving stable cell ids', () => {
    const props = pasteTableTsv(createTableProps(2, 3, ids()), 0, 0, 'A\tB\tC\nD\tE\tF', ids())
    const originalCellIds = props.rows.flatMap((row) => row.cells.map((cell) => cell.id)).sort()
    const movedRows = moveTableRow(props, 0, 1)
    const movedColumns = moveTableColumn(movedRows, 0, 2)

    expect(movedColumns.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ['E', 'F', 'D'],
      ['B', 'C', 'A'],
    ])
    expect(movedColumns.rows.flatMap((row) => row.cells.map((cell) => cell.id)).sort()).toEqual(originalCellIds)
  })

  it('distributes dimensions, styles ranges and auto-fits wrapped content', () => {
    let props = createTableProps(2, 2, ids())
    const selected = tableCellIdsInRange(props, { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 })
    props = updateTableCellStyles(props, selected, {
      align: 'center', background: 'blue', border: 'strong', fontSize: 18, textColor: 'red',
    })
    props = toggleTableHeaderRow(props, props.rows[0]!.id)
    props = updateTableCell(props, props.rows[1]!.id, props.rows[1]!.cells[0]!.id, 'A long value that should wrap onto several visual lines in a narrow cell')
    const fitted = autoFitTableRows(distributeTableRows(distributeTableColumns(props)))

    expect(fitted.columns.map((column) => column.width)).toEqual([0.5, 0.5])
    expect(fitted.rows[0]!.cells.every((cell) => cell.header && cell.align === 'center')).toBe(true)
    expect(fitted.rows[0]!.cells.every((cell) => cell.fontSize === 18 && cell.textColor === 'red')).toBe(true)
    expect(fitted.rows[1]!.height * fitted.h).toBeGreaterThan(32)
  })

  it('preserves cell formatting when deleting a selected column', () => {
    let props = createTableProps(2, 3, ids())
    const retainedCellIds = props.rows.map((row) => row.cells[2]!.id)
    props = updateTableCellStyles(props, retainedCellIds, { fontSize: 20, textColor: 'purple' })
    const deleted = deleteTableColumn(props, props.columns[1]!.id)

    expect(deleted.columns).toHaveLength(2)
    expect(deleted.rows.map((row) => row.cells[1]!.id)).toEqual(retainedCellIds)
    expect(deleted.rows.every((row) => row.cells[1]!.fontSize === 20 && row.cells[1]!.textColor === 'purple')).toBe(true)
  })

  it('applies text formatting to a selected cell range', () => {
    const source = createTableProps(2, 2, ids())
    const selected = tableCellIdsInRange(source, { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 })
    const formatted = updateTableCellStyles(source, selected, {
      fontFamily: 'serif',
      fontSize: 18,
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      align: 'right',
      textColor: 'purple',
    })
    expect(formatted.rows.flatMap((row) => row.cells).every((cell) =>
      cell.fontFamily === 'serif'
      && cell.fontSize === 18
      && cell.bold === true
      && cell.italic === true
      && cell.underline === true
      && cell.strike === true
      && cell.align === 'right'
      && cell.textColor === 'purple'
    )).toBe(true)
  })

  it('supports the 50 by 50 upper bound without ragged rows', () => {
    const props = createTableProps(50, 50, ids())
    expect(props.rows).toHaveLength(50)
    expect(props.columns).toHaveLength(50)
    expect(props.rows.every((row) => row.cells.length === 50)).toBe(true)
    expect(insertTableRow(props, 50, ids())).toBe(props)
    expect(insertTableColumn(props, 50, ids())).toBe(props)
  })
})
