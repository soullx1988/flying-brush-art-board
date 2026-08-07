import { useEffect, useMemo, useRef, useState, type CSSProperties, type ClipboardEvent, type KeyboardEvent, type PointerEvent } from 'react'
import {
  BaseBoxShapeTool,
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  TldrawUiButtonIcon,
  TldrawUiDropdownMenuContent,
  TldrawUiDropdownMenuRoot,
  TldrawUiDropdownMenuTrigger,
  TldrawUiIcon,
  TldrawUiMenuContextProvider,
  TldrawUiMenuItem,
  TldrawUiSelect,
  TldrawUiSelectContent,
  TldrawUiSelectItem,
  TldrawUiSelectTrigger,
  TldrawUiSelectValue,
  TldrawUiToolbar,
  TldrawUiToolbarButton,
  resizeBox,
  useEditor,
  useValue,
  type SvgExportContext,
  type TLResizeInfo,
} from 'tldraw'

import { clearCanvasShapeInteractionTarget, setCanvasShapeInteractionTarget } from '../interaction-target.js'
import {
  createTableProps,
  autoFitTableRows,
  clearTableCells,
  deleteTableColumn,
  deleteTableRow,
  distributeTableColumns,
  distributeTableRows,
  duplicateTableColumn,
  duplicateTableRow,
  fillTableRange,
  insertTableColumn,
  insertTableRow,
  moveTableColumn,
  moveTableRow,
  pasteTableTsv,
  resizeTableColumns,
  resizeTableRows,
  tableCellIdsInRange,
  tableRangeToTsv,
  updateTableCell,
  updateTableCellStyles,
  type TableCellRange,
  type TableCellStylePatch,
} from './operations.js'
import {
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  TABLE_SHAPE_TYPE,
  tableShapeMigrations,
  tableShapeProps,
  type TableShape,
  type TableCellBackground,
  type TableCellTextColor,
  type TableFontFamily,
  type TableShapeProps,
  type TableTextAlign,
} from './schema.js'

const TABLE_BACKGROUND_OPTIONS: ReadonlyArray<{
  value: TableCellBackground
  label: string
  color: string
}> = [
  { value: 'none', label: '无填充', color: '#ffffff' },
  { value: 'gray', label: '浅灰', color: '#f2f3f5' },
  { value: 'blue', label: '浅蓝', color: '#e8f1ff' },
  { value: 'yellow', label: '浅黄', color: '#fff6d8' },
  { value: 'green', label: '浅绿', color: '#e8f7ed' },
  { value: 'red', label: '浅红', color: '#feeceb' },
]

const TABLE_TEXT_COLOR_OPTIONS: ReadonlyArray<{
  value: TableCellTextColor
  label: string
  color: string
}> = [
  { value: 'default', label: '默认', color: '#1f2633' },
  { value: 'gray', label: '灰色', color: '#646a73' },
  { value: 'red', label: '红色', color: '#d83931' },
  { value: 'orange', label: '橙色', color: '#d46b08' },
  { value: 'green', label: '绿色', color: '#2b8a3e' },
  { value: 'blue', label: '蓝色', color: '#245bd7' },
  { value: 'purple', label: '紫色', color: '#7a4bc8' },
]

const TABLE_TEXT_COLORS: Record<TableCellTextColor, string> = Object.fromEntries(
  TABLE_TEXT_COLOR_OPTIONS.map((option) => [option.value, option.color]),
) as Record<TableCellTextColor, string>

const TABLE_FONT_SIZES = [12, 14, 16, 18, 20, 24] as const

const TABLE_FONT_FAMILIES: Record<TableFontFamily, string> = {
  draw: 'tldraw_draw, sans-serif',
  sans: 'tldraw_sans, sans-serif',
  serif: 'tldraw_serif, serif',
  mono: 'tldraw_mono, monospace',
}

function tableCellTextStyle(cell: TableShape['props']['rows'][number]['cells'][number]): CSSProperties {
  const decorations = [cell.underline ? 'underline' : '', cell.strike ? 'line-through' : '']
    .filter(Boolean)
    .join(' ')
  return {
    fontFamily: TABLE_FONT_FAMILIES[cell.fontFamily ?? 'sans'],
    fontWeight: cell.bold || cell.header ? 700 : 500,
    fontStyle: cell.italic ? 'italic' : 'normal',
    fontSynthesis: 'weight style',
    textDecoration: decorations || 'none',
  }
}

const TABLE_ALIGN_OPTIONS: ReadonlyArray<{
  value: TableTextAlign
  label: string
  icon: 'text-align-left' | 'text-align-center' | 'text-align-right'
}> = [
  { value: 'left', label: '左对齐', icon: 'text-align-left' },
  { value: 'center', label: '居中对齐', icon: 'text-align-center' },
  { value: 'right', label: '右对齐', icon: 'text-align-right' },
]

function selectedCellCoordinates(shape: TableShape, cellId: string) {
  for (const [rowIndex, row] of shape.props.rows.entries()) {
    const columnIndex = row.cells.findIndex((cell) => cell.id === cellId)
    if (columnIndex >= 0) return { rowIndex, columnIndex, row, cell: row.cells[columnIndex]! }
  }
  return undefined
}

interface TableCoordinate { rowIndex: number; columnIndex: number }

function selectionRange(anchor: TableCoordinate, focus: TableCoordinate): TableCellRange {
  return {
    startRow: Math.min(anchor.rowIndex, focus.rowIndex),
    endRow: Math.max(anchor.rowIndex, focus.rowIndex),
    startColumn: Math.min(anchor.columnIndex, focus.columnIndex),
    endColumn: Math.max(anchor.columnIndex, focus.columnIndex),
  }
}

function TableShapeComponent({ shape }: { shape: TableShape }) {
  const editor = useEditor()
  const isReadonly = useValue('table readonly', () => editor.getInstanceState().isReadonly, [editor])
  const isSelected = useValue('table selected', () => editor.getOnlySelectedShapeId() === shape.id, [editor, shape.id])
  const zoom = useValue('table zoom', () => editor.getZoomLevel(), [editor])
  const [activeCellId, setActiveCellId] = useState<string>()
  const [selectionAnchor, setSelectionAnchor] = useState<TableCoordinate>({ rowIndex: 0, columnIndex: 0 })
  const [selectionFocus, setSelectionFocus] = useState<TableCoordinate>({ rowIndex: 0, columnIndex: 0 })
  const [editingCellId, setEditingCellId] = useState<string>()
  const [draft, setDraft] = useState('')
  const [draggedAxis, setDraggedAxis] = useState<{ kind: 'row' | 'column'; index: number }>()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const contextToolbarRef = useRef<HTMLDivElement>(null)
  const editSessionMarkedRef = useRef(false)
  const editSessionInitialTextRef = useRef('')

  useEffect(() => {
    if (editingCellId) inputRef.current?.focus()
  }, [editingCellId])

  useEffect(() => {
    if (!activeCellId || editingCellId) return
    const element = document.querySelector<HTMLElement>(`[data-table-shape-id="${shape.id}"] [data-table-cell-id="${activeCellId}"]`)
    element?.focus()
  }, [activeCellId, editingCellId, shape.id])

  useEffect(() => {
    if (!isSelected) {
      setActiveCellId(undefined)
      setEditingCellId(undefined)
      clearCanvasShapeInteractionTarget(editor, shape.id)
    }
  }, [editor, isSelected, shape.id])

  useEffect(() => () => clearCanvasShapeInteractionTarget(editor, shape.id), [editor, shape.id])

  const currentRange = useMemo(
    () => selectionRange(selectionAnchor, selectionFocus),
    [selectionAnchor, selectionFocus],
  )
  const selectedCellIds = useMemo(
    () => tableCellIdsInRange(shape.props, currentRange),
    [currentRange, shape.props],
  )
  const selectedCellIdSet = useMemo(() => new Set(selectedCellIds), [selectedCellIds])
  const activeCell = activeCellId ? selectedCellCoordinates(shape, activeCellId)?.cell : undefined
  const selectedColumnIndex = currentRange.startRow === 0
    && currentRange.endRow === shape.props.rows.length - 1
    && currentRange.startColumn === currentRange.endColumn
    ? currentRange.startColumn
    : undefined
  const selectedRowIndex = currentRange.startColumn === 0
    && currentRange.endColumn === shape.props.columns.length - 1
    && currentRange.startRow === currentRange.endRow
    ? currentRange.startRow
    : undefined

  useEffect(() => {
    if (!activeCellId) return
    const coordinates = selectedCellCoordinates(shape, activeCellId)
    const column = coordinates && shape.props.columns[coordinates.columnIndex]
    if (!coordinates || !column) return
    setCanvasShapeInteractionTarget(editor, {
      type: 'table',
      shapeId: shape.id,
      rowId: coordinates.row.id,
      columnId: column.id,
      cellId: coordinates.cell.id,
      cellIds: selectedCellIds,
      range: currentRange,
    })
  }, [activeCellId, currentRange, editor, selectedCellIds, shape])

  const commit = (cellId = editingCellId, value = draft) => {
    if (!cellId || isReadonly) return
    const current = editor.getShape(shape.id) as TableShape | undefined
    const coordinates = current && selectedCellCoordinates(current, cellId)
    if (!coordinates || coordinates.cell.text === value) return
    editor.markHistoryStoppingPoint(`edit_table_cell:${shape.id}:${cellId}`)
    const props = autoFitTableRows(
      updateTableCell(current!.props, coordinates.row.id, cellId, value),
      [coordinates.row.id],
    )
    editor.updateShape<TableShape>({ id: shape.id, type: shape.type, props })
  }

  const activate = (rowIndex: number, columnIndex: number, edit = false, extend = false) => {
    const row = shape.props.rows[rowIndex]
    const cell = row?.cells[columnIndex]
    const column = shape.props.columns[columnIndex]
    if (!row || !cell || !column) return
    editor.select(shape.id)
    setActiveCellId(cell.id)
    const coordinate = { rowIndex, columnIndex }
    if (!extend) setSelectionAnchor(coordinate)
    setSelectionFocus(coordinate)
    setCanvasShapeInteractionTarget(editor, {
      type: 'table', shapeId: shape.id, rowId: row.id, columnId: column.id, cellId: cell.id,
      cellIds: extend ? tableCellIdsInRange(shape.props, selectionRange(selectionAnchor, coordinate)) : [cell.id],
      range: extend ? selectionRange(selectionAnchor, coordinate) : selectionRange(coordinate, coordinate),
    })
    if (edit && !isReadonly) {
      editSessionMarkedRef.current = false
      editSessionInitialTextRef.current = cell.text
      setDraft(cell.text)
      setEditingCellId(cell.id)
    }
  }

  const updateDraft = (cellId: string, value: string) => {
    if (isReadonly) return
    setDraft(value)
    const current = editor.getShape(shape.id) as TableShape | undefined
    const coordinates = current && selectedCellCoordinates(current, cellId)
    if (!current || !coordinates || coordinates.cell.text === value) return
    if (!editSessionMarkedRef.current) {
      editor.markHistoryStoppingPoint(`edit_table_cell:${shape.id}:${cellId}`)
      editSessionMarkedRef.current = true
    }
    editor.updateShape<TableShape>({
      id: current.id,
      type: current.type,
      props: autoFitTableRows(
        updateTableCell(current.props, coordinates.row.id, cellId, value),
        [coordinates.row.id],
      ),
    })
  }

  const move = (rowIndex: number, columnIndex: number, edit = false, extend = false) => {
    const safeRow = Math.max(0, Math.min(shape.props.rows.length - 1, rowIndex))
    const safeColumn = Math.max(0, Math.min(shape.props.columns.length - 1, columnIndex))
    activate(safeRow, safeColumn, edit, extend)
  }

  const handleEditingKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, rowIndex: number, columnIndex: number) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      const current = editor.getShape(shape.id) as TableShape | undefined
      const cellId = editingCellId
      const coordinates = current && cellId ? selectedCellCoordinates(current, cellId) : undefined
      const initialText = editSessionInitialTextRef.current
      if (!isReadonly && current && cellId && coordinates && coordinates.cell.text !== initialText) {
        editor.updateShape<TableShape>({
          id: current.id,
          type: current.type,
          props: autoFitTableRows(
            updateTableCell(current.props, coordinates.row.id, cellId, initialText),
            [coordinates.row.id],
          ),
        })
      }
      setDraft(initialText)
      setEditingCellId(undefined)
      return
    }
    if (event.key !== 'Tab' && event.key !== 'Enter') return
    if (event.key === 'Enter' && event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    commit()
    setEditingCellId(undefined)
    if (event.key === 'Tab') {
      const flatIndex = rowIndex * shape.props.columns.length + columnIndex + (event.shiftKey ? -1 : 1)
      const next = Math.max(0, Math.min(shape.props.rows.length * shape.props.columns.length - 1, flatIndex))
      move(Math.floor(next / shape.props.columns.length), next % shape.props.columns.length, true)
    } else {
      move(rowIndex + 1, columnIndex, true)
    }
  }

  const handleCellKeyDown = (event: KeyboardEvent<HTMLDivElement>, rowIndex: number, columnIndex: number) => {
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault()
      event.stopPropagation()
      activate(rowIndex, columnIndex, true)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      const flatIndex = rowIndex * shape.props.columns.length + columnIndex + (event.shiftKey ? -1 : 1)
      const next = Math.max(0, Math.min(shape.props.rows.length * shape.props.columns.length - 1, flatIndex))
      move(Math.floor(next / shape.props.columns.length), next % shape.props.columns.length)
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !isReadonly) {
      event.preventDefault()
      event.stopPropagation()
      editor.markHistoryStoppingPoint(`clear_table_cells:${shape.id}`)
      editor.updateShape<TableShape>({ id: shape.id, type: shape.type, props: clearTableCells(shape.props, selectedCellIds) })
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      event.stopPropagation()
      setSelectionAnchor({ rowIndex: 0, columnIndex: 0 })
      setSelectionFocus({ rowIndex: shape.props.rows.length - 1, columnIndex: shape.props.columns.length - 1 })
      return
    }
    const moves: Record<string, [number, number]> = {
      ArrowUp: [rowIndex - 1, columnIndex],
      ArrowDown: [rowIndex + 1, columnIndex],
      ArrowLeft: [rowIndex, columnIndex - 1],
      ArrowRight: [rowIndex, columnIndex + 1],
    }
    const destination = moves[event.key]
    if (!destination) return
    event.preventDefault()
    event.stopPropagation()
    move(destination[0], destination[1], false, event.shiftKey)
  }

  const handlePaste = (event: ClipboardEvent<HTMLElement>, rowIndex: number, columnIndex: number) => {
    if (isReadonly) return
    const text = event.clipboardData.getData('text/plain')
    event.preventDefault()
    event.stopPropagation()
    editor.markHistoryStoppingPoint(`paste_table_cells:${shape.id}`)
    const isMatrix = text.includes('\t') || text.includes('\n') || text.includes('\r')
    const next = !isMatrix && selectedCellIds.length > 1
      ? fillTableRange(shape.props, currentRange, text)
      : pasteTableTsv(shape.props, rowIndex, columnIndex, text)
    editor.updateShape<TableShape>({
      id: shape.id,
      type: shape.type,
      props: autoFitTableRows(next),
    })
    setEditingCellId(undefined)
  }

  const handleCopy = (event: ClipboardEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.clipboardData.setData('text/plain', tableRangeToTsv(shape.props, currentRange))
  }

  const startRangeDrag = (event: PointerEvent<HTMLDivElement>, rowIndex: number, columnIndex: number) => {
    if (event.button === 2) {
      activate(rowIndex, columnIndex)
      return
    }
    if (event.button !== 0) return
    activate(rowIndex, columnIndex, false, event.shiftKey)
    if (event.shiftKey) return
    const moveSelection = (moveEvent: globalThis.PointerEvent) => {
      const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest<HTMLElement>('[data-table-cell-id]')
      if (!element || element.dataset.tableShapeId !== shape.id) return
      const nextRow = Number(element.dataset.rowIndex)
      const nextColumn = Number(element.dataset.columnIndex)
      if (Number.isInteger(nextRow) && Number.isInteger(nextColumn)) {
        setSelectionFocus({ rowIndex: nextRow, columnIndex: nextColumn })
        setActiveCellId(shape.props.rows[nextRow]?.cells[nextColumn]?.id)
      }
    }
    const finish = () => {
      window.removeEventListener('pointermove', moveSelection)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
    window.addEventListener('pointermove', moveSelection)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const insertAtBoundary = (kind: 'row' | 'column', index: number) => {
    if (isReadonly) return
    const current = editor.getShape(shape.id) as TableShape | undefined
    if (!current) return
    editor.markHistoryStoppingPoint(`insert_table_${kind}_at_boundary:${shape.id}:${index}`)
    const props = kind === 'row'
      ? insertTableRow(current.props, index)
      : insertTableColumn(current.props, index)
    if (props === current.props) return
    editor.updateShape<TableShape>({ id: current.id, type: current.type, props })
    setEditingCellId(undefined)
    if (kind === 'row') {
      const rowIndex = Math.min(index, props.rows.length - 1)
      setSelectionAnchor({ rowIndex, columnIndex: 0 })
      setSelectionFocus({ rowIndex, columnIndex: props.columns.length - 1 })
      setActiveCellId(props.rows[rowIndex]?.cells[0]?.id)
    } else {
      const columnIndex = Math.min(index, props.columns.length - 1)
      setSelectionAnchor({ rowIndex: 0, columnIndex })
      setSelectionFocus({ rowIndex: props.rows.length - 1, columnIndex })
      setActiveCellId(props.rows[0]?.cells[columnIndex]?.id)
    }
  }

  const updateSelectedStyles = (patch: TableCellStylePatch, historyId: string) => {
    if (isReadonly) return
    const current = editor.getShape(shape.id) as TableShape | undefined
    if (!current) return
    const cellIds = tableCellIdsInRange(current.props, currentRange)
    editor.markHistoryStoppingPoint(`${historyId}:${shape.id}`)
    const styled = updateTableCellStyles(current.props, cellIds, patch)
    editor.updateShape<TableShape>({
      id: current.id,
      type: current.type,
      props: patch.fontSize === undefined ? styled : autoFitTableRows(styled),
    })
    inputRef.current?.focus()
  }

  const deleteSelectedColumn = () => {
    if (isReadonly || selectedColumnIndex === undefined) return
    const current = editor.getShape(shape.id) as TableShape | undefined
    const column = current?.props.columns[selectedColumnIndex]
    if (!current || !column || current.props.columns.length <= 1) return
    editor.markHistoryStoppingPoint(`delete_table_column:${shape.id}:${column.id}`)
    const props = deleteTableColumn(current.props, column.id)
    editor.updateShape<TableShape>({ id: current.id, type: current.type, props })
    const nextColumnIndex = Math.min(selectedColumnIndex, props.columns.length - 1)
    const nextCoordinate = { rowIndex: 0, columnIndex: nextColumnIndex }
    setSelectionAnchor(nextCoordinate)
    setSelectionFocus({ rowIndex: props.rows.length - 1, columnIndex: nextColumnIndex })
    setActiveCellId(props.rows[0]?.cells[nextColumnIndex]?.id)
    setEditingCellId(undefined)
  }

  const deleteSelectedRow = () => {
    if (isReadonly || selectedRowIndex === undefined) return
    const current = editor.getShape(shape.id) as TableShape | undefined
    const row = current?.props.rows[selectedRowIndex]
    if (!current || !row || current.props.rows.length <= 1) return
    editor.markHistoryStoppingPoint(`delete_table_row:${shape.id}:${row.id}`)
    const props = deleteTableRow(current.props, row.id)
    editor.updateShape<TableShape>({ id: current.id, type: current.type, props })
    const nextRowIndex = Math.min(selectedRowIndex, props.rows.length - 1)
    const nextCoordinate = { rowIndex: nextRowIndex, columnIndex: 0 }
    setSelectionAnchor(nextCoordinate)
    setSelectionFocus({ rowIndex: nextRowIndex, columnIndex: props.columns.length - 1 })
    setActiveCellId(props.rows[nextRowIndex]?.cells[0]?.id)
    setEditingCellId(undefined)
  }

  const insertNextToSelectedColumn = (side: 'before' | 'after') => {
    if (isReadonly || selectedColumnIndex === undefined) return
    const current = editor.getShape(shape.id) as TableShape | undefined
    if (!current) return
    const index = selectedColumnIndex + (side === 'after' ? 1 : 0)
    editor.markHistoryStoppingPoint(`insert_table_column_${side}:${shape.id}`)
    const props = insertTableColumn(current.props, index)
    if (props === current.props) return
    editor.updateShape<TableShape>({ id: current.id, type: current.type, props })
    setSelectionAnchor({ rowIndex: 0, columnIndex: index })
    setSelectionFocus({ rowIndex: props.rows.length - 1, columnIndex: index })
    setActiveCellId(props.rows[0]?.cells[index]?.id)
    setEditingCellId(undefined)
  }

  const insertNextToSelectedRow = (side: 'before' | 'after') => {
    if (isReadonly || selectedRowIndex === undefined) return
    const current = editor.getShape(shape.id) as TableShape | undefined
    if (!current) return
    const index = selectedRowIndex + (side === 'after' ? 1 : 0)
    editor.markHistoryStoppingPoint(`insert_table_row_${side}:${shape.id}`)
    const props = insertTableRow(current.props, index)
    if (props === current.props) return
    editor.updateShape<TableShape>({ id: current.id, type: current.type, props })
    setSelectionAnchor({ rowIndex: index, columnIndex: 0 })
    setSelectionFocus({ rowIndex: index, columnIndex: props.columns.length - 1 })
    setActiveCellId(props.rows[index]?.cells[0]?.id)
    setEditingCellId(undefined)
  }

  const duplicateSelectedColumn = () => {
    if (isReadonly || selectedColumnIndex === undefined) return
    const current = editor.getShape(shape.id) as TableShape | undefined
    if (!current) return
    editor.markHistoryStoppingPoint(`duplicate_table_column:${shape.id}`)
    const props = duplicateTableColumn(current.props, selectedColumnIndex)
    if (props === current.props) return
    editor.updateShape<TableShape>({ id: current.id, type: current.type, props })
    const columnIndex = selectedColumnIndex + 1
    setSelectionAnchor({ rowIndex: 0, columnIndex })
    setSelectionFocus({ rowIndex: props.rows.length - 1, columnIndex })
    setActiveCellId(props.rows[0]?.cells[columnIndex]?.id)
  }

  const duplicateSelectedRow = () => {
    if (isReadonly || selectedRowIndex === undefined) return
    const current = editor.getShape(shape.id) as TableShape | undefined
    if (!current) return
    editor.markHistoryStoppingPoint(`duplicate_table_row:${shape.id}`)
    const props = duplicateTableRow(current.props, selectedRowIndex)
    if (props === current.props) return
    editor.updateShape<TableShape>({ id: current.id, type: current.type, props })
    const rowIndex = selectedRowIndex + 1
    setSelectionAnchor({ rowIndex, columnIndex: 0 })
    setSelectionFocus({ rowIndex, columnIndex: props.columns.length - 1 })
    setActiveCellId(props.rows[rowIndex]?.cells[0]?.id)
  }

  const distributeColumns = () => {
    if (isReadonly) return
    const current = editor.getShape(shape.id) as TableShape | undefined
    if (!current) return
    editor.markHistoryStoppingPoint(`distribute_table_columns:${shape.id}`)
    editor.updateShape<TableShape>({
      id: current.id,
      type: current.type,
      props: distributeTableColumns(current.props),
    })
  }

  const distributeRows = () => {
    if (isReadonly) return
    const current = editor.getShape(shape.id) as TableShape | undefined
    if (!current) return
    editor.markHistoryStoppingPoint(`distribute_table_rows:${shape.id}`)
    editor.updateShape<TableShape>({
      id: current.id,
      type: current.type,
      props: distributeTableRows(current.props),
    })
  }

  const autoFitSelectedRows = () => {
    if (isReadonly) return
    const current = editor.getShape(shape.id) as TableShape | undefined
    if (!current) return
    const rowIds = current.props.rows
      .slice(currentRange.startRow, currentRange.endRow + 1)
      .map((row) => row.id)
    editor.markHistoryStoppingPoint(`auto_fit_table_rows:${shape.id}`)
    editor.updateShape<TableShape>({
      id: current.id,
      type: current.type,
      props: autoFitTableRows(current.props, rowIds),
    })
  }

  const clearSelectedContent = () => {
    if (isReadonly) return
    const current = editor.getShape(shape.id) as TableShape | undefined
    if (!current) return
    const cellIds = tableCellIdsInRange(current.props, currentRange)
    editor.markHistoryStoppingPoint(`clear_table_cells:${shape.id}`)
    editor.updateShape<TableShape>({
      id: current.id,
      type: current.type,
      props: clearTableCells(current.props, cellIds),
    })
    if (editingCellId && cellIds.includes(editingCellId)) setDraft('')
    inputRef.current?.focus()
  }

  const handleMoreAction = (action: string) => {
    if (showColumnToolbar) {
      if (action === 'insert-before') insertNextToSelectedColumn('before')
      else if (action === 'insert-after') insertNextToSelectedColumn('after')
      else if (action === 'duplicate') duplicateSelectedColumn()
      else if (action === 'distribute-columns') distributeColumns()
      else if (action === 'clear') clearSelectedContent()
      else if (action === 'border-light') updateSelectedStyles({ border: 'light' }, 'table_border')
      else if (action === 'border-strong') updateSelectedStyles({ border: 'strong' }, 'table_border')
      else if (action === 'border-none') updateSelectedStyles({ border: 'none' }, 'table_border')
      return
    }
    if (showRowToolbar) {
      if (action === 'insert-before') insertNextToSelectedRow('before')
      else if (action === 'insert-after') insertNextToSelectedRow('after')
      else if (action === 'duplicate') duplicateSelectedRow()
      else if (action === 'distribute-rows') distributeRows()
      else if (action === 'auto-fit-rows') autoFitSelectedRows()
      else if (action === 'clear') clearSelectedContent()
      else if (action === 'toggle-header') updateSelectedStyles({ header: !activeCell?.header }, 'table_header')
      else if (action === 'border-light') updateSelectedStyles({ border: 'light' }, 'table_border')
      else if (action === 'border-strong') updateSelectedStyles({ border: 'strong' }, 'table_border')
      else if (action === 'border-none') updateSelectedStyles({ border: 'none' }, 'table_border')
      return
    }
    if (action === 'clear') clearSelectedContent()
    else if (action === 'toggle-header') updateSelectedStyles({ header: !activeCell?.header }, 'table_header')
    else if (action === 'border-light') updateSelectedStyles({ border: 'light' }, 'table_border')
    else if (action === 'border-strong') updateSelectedStyles({ border: 'strong' }, 'table_border')
    else if (action === 'border-none') updateSelectedStyles({ border: 'none' }, 'table_border')
  }

  const reorderAxis = (kind: 'row' | 'column', targetIndex: number) => {
    if (isReadonly || !draggedAxis || draggedAxis.kind !== kind || draggedAxis.index === targetIndex) return
    editor.markHistoryStoppingPoint(`reorder_table_${kind}:${shape.id}`)
    const props = kind === 'row'
      ? moveTableRow(shape.props, draggedAxis.index, targetIndex)
      : moveTableColumn(shape.props, draggedAxis.index, targetIndex)
    editor.updateShape<TableShape>({ id: shape.id, type: shape.type, props })
    setDraggedAxis(undefined)
  }

  const startBoundaryDrag = (
    event: PointerEvent<HTMLButtonElement>,
    kind: 'column' | 'row',
    index: number,
  ) => {
    if (isReadonly || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const origin = kind === 'column' ? event.clientX : event.clientY
    const initial = shape.props
    editor.markHistoryStoppingPoint(`resize_table_${kind}:${shape.id}`)
    const moveBoundary = (moveEvent: globalThis.PointerEvent) => {
      const delta = (kind === 'column' ? moveEvent.clientX : moveEvent.clientY) - origin
      const props = kind === 'column'
        ? resizeTableColumns(initial, index, delta)
        : resizeTableRows(initial, index, delta)
      editor.updateShape<TableShape>({ id: shape.id, type: shape.type, props })
    }
    const finish = () => {
      window.removeEventListener('pointermove', moveBoundary)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
    window.addEventListener('pointermove', moveBoundary)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const startTableDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (isReadonly || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const current = editor.getShape(shape.id) as TableShape | undefined
    if (!current) return
    editor.select(shape.id)
    setEditingCellId(undefined)
    const pointerId = event.pointerId
    const origin = editor.getPointInParentSpace(
      current,
      editor.screenToPage({ x: event.clientX, y: event.clientY }),
    )
    const initial = { x: current.x, y: current.y }
    const markId = editor.markHistoryStoppingPoint(`move_table:${shape.id}`)
    let moved = false
    const moveTable = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      const point = editor.getPointInParentSpace(
        current,
        editor.screenToPage({ x: moveEvent.clientX, y: moveEvent.clientY }),
      )
      const x = initial.x + point.x - origin.x
      const y = initial.y + point.y - origin.y
      if (Math.abs(x - initial.x) > 0.1 || Math.abs(y - initial.y) > 0.1) moved = true
      editor.updateShape<TableShape>({ id: current.id, type: current.type, x, y })
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', moveTable)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
    }
    const finish = (finishEvent: globalThis.PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) return
      cleanup()
      if (!moved) editor.bailToMark(markId)
    }
    const cancel = (cancelEvent: globalThis.PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return
      cleanup()
      editor.bailToMark(markId)
    }
    window.addEventListener('pointermove', moveTable)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  const columnOffsets = useMemo(() => {
    let offset = 0
    return shape.props.columns.slice(0, -1).map((column) => {
      offset += column.width
      return offset
    })
  }, [shape.props.columns])
  const rowOffsets = useMemo(() => {
    let offset = 0
    return shape.props.rows.slice(0, -1).map((row) => {
      offset += row.height
      return offset
    })
  }, [shape.props.rows])
  const columnBoundaryOffsets = useMemo(() => [0, ...columnOffsets, 1], [columnOffsets])
  const rowBoundaryOffsets = useMemo(() => [0, ...rowOffsets, 1], [rowOffsets])
  const columnMetrics = useMemo(() => {
    let start = 0
    return shape.props.columns.map((column) => {
      const metric = { start, size: column.width }
      start += column.width
      return metric
    })
  }, [shape.props.columns])
  const rowMetrics = useMemo(() => {
    let start = 0
    return shape.props.rows.map((row) => {
      const metric = { start, size: row.height }
      start += row.height
      return metric
    })
  }, [shape.props.rows])
  const selectionBounds = useMemo(() => {
    const firstColumn = columnMetrics[currentRange.startColumn]
    const lastColumn = columnMetrics[currentRange.endColumn]
    const firstRow = rowMetrics[currentRange.startRow]
    const lastRow = rowMetrics[currentRange.endRow]
    if (!firstColumn || !lastColumn || !firstRow || !lastRow) return undefined
    return {
      left: firstColumn.start,
      top: firstRow.start,
      width: lastColumn.start + lastColumn.size - firstColumn.start,
      height: lastRow.start + lastRow.size - firstRow.start,
    }
  }, [columnMetrics, currentRange, rowMetrics])
  const activeAlign = activeCell?.align ?? 'left'
  const activeFontSize = activeCell?.fontSize ?? 14
  const activeTextColor = activeCell?.textColor ?? 'default'
  const activeBackground = activeCell?.background ?? 'none'
  const activeAlignOption = TABLE_ALIGN_OPTIONS.find((option) => option.value === activeAlign) ?? TABLE_ALIGN_OPTIONS[0]!
  const showCellToolbar = Boolean(isSelected && !isReadonly && editingCellId && selectionBounds)
  const showColumnToolbar = Boolean(
    isSelected && !isReadonly && editingCellId === undefined
      && selectedColumnIndex !== undefined && selectedRowIndex === undefined && selectionBounds,
  )
  const showRowToolbar = Boolean(
    isSelected && !isReadonly && editingCellId === undefined && selectedRowIndex !== undefined && selectionBounds,
  )

  return (
    <HTMLContainer>
      <div
        className="canvas-table-shape"
        data-table-shape-id={shape.id}
        data-selection-kind={selectedRowIndex !== undefined ? 'row' : selectedColumnIndex !== undefined ? 'column' : 'cells'}
        role="grid"
        aria-label={`${shape.props.rows.length} 行 ${shape.props.columns.length} 列表格`}
        onCopy={handleCopy}
        style={{
          width: shape.props.w,
          height: shape.props.h,
          gridTemplateColumns: shape.props.columns.map((column) => `${column.width}fr`).join(' '),
          gridTemplateRows: shape.props.rows.map((row) => `${row.height}fr`).join(' '),
        }}
      >
        {isSelected && !isReadonly ? (
          <button
            type="button"
            className="canvas-table-drag-handle"
            data-testid="table-drag-handle"
            aria-label="拖动整个表格"
            title="拖动表格"
            style={{
              top: -34 / Math.max(zoom, 0.1),
              left: 0,
              transform: `scale(${1 / Math.max(zoom, 0.1)})`,
            }}
            onPointerDown={startTableDrag}
          >
            <TldrawUiIcon icon="drag-handle-dots" label="" small />
          </button>
        ) : null}
        {shape.props.rows.flatMap((row, rowIndex) => row.cells.map((cell, columnIndex) => (
          <div
            key={cell.id}
            className="canvas-table-cell"
            data-active={activeCellId === cell.id ? 'true' : 'false'}
            data-selected={selectedCellIdSet.has(cell.id) ? 'true' : 'false'}
            data-table-shape-id={shape.id}
            data-table-cell-id={cell.id}
            data-row-index={rowIndex}
            data-column-index={columnIndex}
            data-align={cell.align ?? 'left'}
            data-background={cell.background ?? 'none'}
            data-border={cell.border ?? 'light'}
            data-header={cell.header ? 'true' : 'false'}
            data-text-color={cell.textColor ?? 'default'}
            role="gridcell"
            tabIndex={activeCellId === cell.id ? 0 : -1}
            style={{ ...tableCellTextStyle(cell), fontSize: cell.fontSize ?? 14 }}
            onPointerDown={(event) => {
              event.stopPropagation()
              startRangeDrag(event, rowIndex, columnIndex)
            }}
            onContextMenu={() => activate(rowIndex, columnIndex)}
            onDoubleClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              activate(rowIndex, columnIndex, true)
            }}
            onKeyDown={(event) => handleCellKeyDown(event, rowIndex, columnIndex)}
            onCopy={handleCopy}
            onPaste={(event) => handlePaste(event, currentRange.startRow, currentRange.startColumn)}
          >
            {editingCellId === cell.id ? (
              <textarea
                ref={inputRef}
                className="canvas-table-cell__editor"
                aria-label={`编辑第 ${rowIndex + 1} 行第 ${columnIndex + 1} 列`}
                placeholder="输入文本"
                value={draft}
                onChange={(event) => updateDraft(cell.id, event.currentTarget.value)}
                onBlur={(event) => {
                  if (event.relatedTarget instanceof Node && contextToolbarRef.current?.contains(event.relatedTarget)) return
                  commit()
                  setEditingCellId(undefined)
                }}
                onKeyDown={(event) => handleEditingKeyDown(event, rowIndex, columnIndex)}
                onPaste={(event) => handlePaste(event, rowIndex, columnIndex)}
              />
            ) : <span>{cell.text}</span>}
          </div>
        )))}
        {isSelected && selectedColumnIndex !== undefined && selectedRowIndex === undefined && selectionBounds ? <>
          <div
            className="canvas-table-column-selection"
            aria-hidden="true"
            style={{
              left: `${selectionBounds.left * 100}%`,
              top: `${selectionBounds.top * 100}%`,
              width: `${selectionBounds.width * 100}%`,
              height: `${selectionBounds.height * 100}%`,
            }}
          />
          <button
            type="button"
            className="canvas-table-column-selection__handle"
            aria-label={`第 ${selectedColumnIndex + 1} 列操作`}
            style={{
              left: `${selectionBounds.left * 100}%`,
              width: `${selectionBounds.width * 100}%`,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setEditingCellId(undefined)}
          >
            <TldrawUiIcon icon="drag-handle-dots" label="" small />
          </button>
        </> : null}
        {isSelected && selectedRowIndex !== undefined && selectionBounds ? <>
          <div
            className="canvas-table-row-selection"
            aria-hidden="true"
            style={{
              left: `${selectionBounds.left * 100}%`,
              top: `${selectionBounds.top * 100}%`,
              width: `${selectionBounds.width * 100}%`,
              height: `${selectionBounds.height * 100}%`,
            }}
          />
          <button
            type="button"
            className="canvas-table-row-selection__handle"
            aria-label={`第 ${selectedRowIndex + 1} 行操作`}
            style={{
              top: `${selectionBounds.top * 100}%`,
              height: `${selectionBounds.height * 100}%`,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setEditingCellId(undefined)}
          >
            <TldrawUiIcon icon="drag-handle-dots" label="" small />
          </button>
        </> : null}
        {selectionBounds && (showCellToolbar || showColumnToolbar || showRowToolbar) ? (
          <div
            className="canvas-table-context-anchor"
            style={{
              left: `${(selectionBounds.left + selectionBounds.width / 2) * 100}%`,
              top: `${(showRowToolbar || showColumnToolbar ? 0 : selectionBounds.top) * 100}%`,
            }}
          >
            <div
              ref={contextToolbarRef}
              className="canvas-table-context-toolbar-scale"
              style={{
                bottom: (showCellToolbar ? 12 : 42) / Math.max(zoom, 0.1),
                transform: `scale(${1 / Math.max(zoom, 0.1)})`,
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.stopPropagation()}
            >
              <TldrawUiToolbar
                className="canvas-table-context-toolbar"
                label={showColumnToolbar
                  ? `第 ${selectedColumnIndex! + 1} 列操作`
                  : showRowToolbar ? `第 ${selectedRowIndex! + 1} 行操作` : '单元格格式'}
                orientation="horizontal"
              >
                {showColumnToolbar ? <>
                  <TldrawUiToolbarButton
                    type="icon"
                    title="在左侧插入列"
                    disabled={shape.props.columns.length >= MAX_TABLE_COLUMNS}
                    onClick={() => insertNextToSelectedColumn('before')}
                  >
                    <TldrawUiButtonIcon icon="plus" />
                  </TldrawUiToolbarButton>
                  <TldrawUiToolbarButton
                    type="icon"
                    title="复制列"
                    disabled={shape.props.columns.length >= MAX_TABLE_COLUMNS}
                    onClick={duplicateSelectedColumn}
                  >
                    <TldrawUiButtonIcon icon="duplicate" />
                  </TldrawUiToolbarButton>
                  <TldrawUiToolbarButton
                    type="icon"
                    title="在右侧插入列"
                    disabled={shape.props.columns.length >= MAX_TABLE_COLUMNS}
                    onClick={() => insertNextToSelectedColumn('after')}
                  >
                    <TldrawUiButtonIcon icon="plus" />
                  </TldrawUiToolbarButton>
                  <TldrawUiToolbarButton type="icon" title="平均分布列宽" onClick={distributeColumns}>
                    <TldrawUiButtonIcon icon="distribute-horizontal" />
                  </TldrawUiToolbarButton>
                </> : null}
                {showRowToolbar ? <>
                  <TldrawUiToolbarButton
                    type="icon"
                    title="在上方插入行"
                    disabled={shape.props.rows.length >= MAX_TABLE_ROWS}
                    onClick={() => insertNextToSelectedRow('before')}
                  >
                    <TldrawUiButtonIcon icon="plus" />
                  </TldrawUiToolbarButton>
                  <TldrawUiToolbarButton
                    type="icon"
                    title="复制行"
                    disabled={shape.props.rows.length >= MAX_TABLE_ROWS}
                    onClick={duplicateSelectedRow}
                  >
                    <TldrawUiButtonIcon icon="duplicate" />
                  </TldrawUiToolbarButton>
                  <TldrawUiToolbarButton
                    type="icon"
                    title="在下方插入行"
                    disabled={shape.props.rows.length >= MAX_TABLE_ROWS}
                    onClick={() => insertNextToSelectedRow('after')}
                  >
                    <TldrawUiButtonIcon icon="plus" />
                  </TldrawUiToolbarButton>
                  <TldrawUiToolbarButton type="icon" title="平均分布行高" onClick={distributeRows}>
                    <TldrawUiButtonIcon icon="distribute-vertical" />
                  </TldrawUiToolbarButton>
                </> : null}

                <TldrawUiSelect
                  id={`table-fill-${shape.id}`}
                  value={activeBackground}
                  onValueChange={(value) => updateSelectedStyles({ background: value as TableCellBackground }, 'table_background')}
                  className={`canvas-table-icon-select${showColumnToolbar || showRowToolbar ? ' canvas-table-context-toolbar__section-start' : ''}`}
                  aria-label="单元格背景"
                >
                  <TldrawUiSelectTrigger className="canvas-table-icon-select__trigger">
                    <TldrawUiSelectValue icon={activeBackground === 'none' ? 'fill-none' : 'fill-solid'} />
                  </TldrawUiSelectTrigger>
                  <TldrawUiSelectContent side="top" align="center">
                    {TABLE_BACKGROUND_OPTIONS.map((option) => (
                      <TldrawUiSelectItem
                        key={option.value}
                        value={option.value}
                        label={option.label}
                        icon={option.value === 'none' ? 'fill-none' : 'fill-solid'}
                      />
                    ))}
                  </TldrawUiSelectContent>
                </TldrawUiSelect>

                {showCellToolbar ? <>
                  <TldrawUiSelect
                    id={`table-text-color-${shape.id}`}
                    value={activeTextColor}
                    onValueChange={(value) => updateSelectedStyles({ textColor: value as TableCellTextColor }, 'table_text_color')}
                    className="canvas-table-icon-select canvas-table-text-color-select"
                    aria-label="文字颜色"
                  >
                    <TldrawUiSelectTrigger className="canvas-table-icon-select__trigger canvas-table-text-color-button">
                      <TldrawUiSelectValue>
                        <span
                          className="canvas-table-text-color-button__label"
                          style={{ borderBottomColor: TABLE_TEXT_COLORS[activeTextColor] }}
                        >A</span>
                      </TldrawUiSelectValue>
                    </TldrawUiSelectTrigger>
                    <TldrawUiSelectContent side="top" align="center">
                      {TABLE_TEXT_COLOR_OPTIONS.map((option) => (
                        <TldrawUiSelectItem key={option.value} value={option.value} label={option.label} icon="color" />
                      ))}
                    </TldrawUiSelectContent>
                  </TldrawUiSelect>

                  <TldrawUiSelect
                    id={`table-font-size-${shape.id}`}
                    value={String(activeFontSize)}
                    onValueChange={(value) => updateSelectedStyles({ fontSize: Number(value) }, 'table_font_size')}
                    className="canvas-table-font-size-select"
                    aria-label="字号"
                  >
                    <TldrawUiSelectTrigger className="canvas-table-font-size-select__trigger">
                      <TldrawUiSelectValue>{activeFontSize}</TldrawUiSelectValue>
                    </TldrawUiSelectTrigger>
                    <TldrawUiSelectContent side="top" align="center">
                      {TABLE_FONT_SIZES.map((fontSize) => (
                        <TldrawUiSelectItem key={fontSize} value={String(fontSize)} label={String(fontSize)} />
                      ))}
                    </TldrawUiSelectContent>
                  </TldrawUiSelect>

                  <TldrawUiSelect
                    id={`table-align-${shape.id}`}
                    value={activeAlign}
                    onValueChange={(value) => updateSelectedStyles({ align: value as TableTextAlign }, 'table_align')}
                    className="canvas-table-icon-select"
                    aria-label="文字对齐"
                  >
                    <TldrawUiSelectTrigger className="canvas-table-icon-select__trigger">
                      <TldrawUiSelectValue icon={activeAlignOption.icon} />
                    </TldrawUiSelectTrigger>
                    <TldrawUiSelectContent side="top" align="center">
                      {TABLE_ALIGN_OPTIONS.map((option) => (
                        <TldrawUiSelectItem key={option.value} value={option.value} label={option.label} icon={option.icon} />
                      ))}
                    </TldrawUiSelectContent>
                  </TldrawUiSelect>
                </> : null}

                {showColumnToolbar || showRowToolbar ? (
                  <TldrawUiToolbarButton
                    type="icon"
                    title={showColumnToolbar
                      ? shape.props.columns.length <= 1 ? '至少保留一列' : '删除列'
                      : shape.props.rows.length <= 1 ? '至少保留一行' : '删除行'}
                    disabled={showColumnToolbar ? shape.props.columns.length <= 1 : shape.props.rows.length <= 1}
                    className="canvas-table-context-toolbar__delete canvas-table-context-toolbar__section-start"
                    onClick={showColumnToolbar ? deleteSelectedColumn : deleteSelectedRow}
                  >
                    <TldrawUiButtonIcon icon="trash" />
                  </TldrawUiToolbarButton>
                ) : null}

                <TldrawUiDropdownMenuRoot id={`table-more-${shape.id}`}>
                  <TldrawUiDropdownMenuTrigger>
                    <TldrawUiToolbarButton
                      type="icon"
                      title="更多操作"
                      className={showCellToolbar ? 'canvas-table-context-toolbar__section-start' : ''}
                    >
                      <TldrawUiButtonIcon icon="dots-horizontal" />
                    </TldrawUiToolbarButton>
                  </TldrawUiDropdownMenuTrigger>
                  <TldrawUiDropdownMenuContent side="top" align="end" alignOffset={0}>
                    <TldrawUiMenuContextProvider type="menu" sourceId="toolbar">
                    {showColumnToolbar ? <>
                      <TldrawUiMenuItem id="insert-before" label="在左侧插入列" iconLeft="plus" onSelect={() => handleMoreAction('insert-before')} />
                      <TldrawUiMenuItem id="insert-after" label="在右侧插入列" iconLeft="plus" onSelect={() => handleMoreAction('insert-after')} />
                      <TldrawUiMenuItem id="duplicate" label="复制列" iconLeft="duplicate" onSelect={() => handleMoreAction('duplicate')} />
                      <TldrawUiMenuItem id="distribute-columns" label="平均分布列宽" iconLeft="distribute-horizontal" onSelect={() => handleMoreAction('distribute-columns')} />
                      <TldrawUiMenuItem id="clear" label="清空此列" iconLeft="trash" onSelect={() => handleMoreAction('clear')} />
                      <TldrawUiMenuItem id="border-light" label="细边框" iconLeft="spline-line" onSelect={() => handleMoreAction('border-light')} />
                      <TldrawUiMenuItem id="border-strong" label="粗边框" iconLeft="spline-line" onSelect={() => handleMoreAction('border-strong')} />
                      <TldrawUiMenuItem id="border-none" label="无边框" iconLeft="spline-line" onSelect={() => handleMoreAction('border-none')} />
                    </> : showRowToolbar ? <>
                      <TldrawUiMenuItem id="insert-before" label="在上方插入行" iconLeft="plus" onSelect={() => handleMoreAction('insert-before')} />
                      <TldrawUiMenuItem id="insert-after" label="在下方插入行" iconLeft="plus" onSelect={() => handleMoreAction('insert-after')} />
                      <TldrawUiMenuItem id="duplicate" label="复制行" iconLeft="duplicate" onSelect={() => handleMoreAction('duplicate')} />
                      <TldrawUiMenuItem id="distribute-rows" label="平均分布行高" iconLeft="distribute-vertical" onSelect={() => handleMoreAction('distribute-rows')} />
                      <TldrawUiMenuItem id="auto-fit-rows" label="自适应行高" iconLeft="vertical-align-middle" onSelect={() => handleMoreAction('auto-fit-rows')} />
                      <TldrawUiMenuItem id="clear" label="清空此行" iconLeft="trash" onSelect={() => handleMoreAction('clear')} />
                      <TldrawUiMenuItem id="toggle-header" label={activeCell?.header ? '设为普通文本' : '设为表头文本'} iconLeft="heading" onSelect={() => handleMoreAction('toggle-header')} />
                      <TldrawUiMenuItem id="border-light" label="细边框" iconLeft="spline-line" onSelect={() => handleMoreAction('border-light')} />
                      <TldrawUiMenuItem id="border-strong" label="粗边框" iconLeft="spline-line" onSelect={() => handleMoreAction('border-strong')} />
                      <TldrawUiMenuItem id="border-none" label="无边框" iconLeft="spline-line" onSelect={() => handleMoreAction('border-none')} />
                    </> : <>
                      <TldrawUiMenuItem id="clear" label="清空内容" iconLeft="trash" onSelect={() => handleMoreAction('clear')} />
                      <TldrawUiMenuItem id="toggle-header" label={activeCell?.header ? '设为普通文本' : '设为表头文本'} iconLeft="heading" onSelect={() => handleMoreAction('toggle-header')} />
                      <TldrawUiMenuItem id="border-light" label="细边框" iconLeft="spline-line" onSelect={() => handleMoreAction('border-light')} />
                      <TldrawUiMenuItem id="border-strong" label="粗边框" iconLeft="spline-line" onSelect={() => handleMoreAction('border-strong')} />
                      <TldrawUiMenuItem id="border-none" label="无边框" iconLeft="spline-line" onSelect={() => handleMoreAction('border-none')} />
                    </>}
                    </TldrawUiMenuContextProvider>
                  </TldrawUiDropdownMenuContent>
                </TldrawUiDropdownMenuRoot>
              </TldrawUiToolbar>
            </div>
          </div>
        ) : null}
        {isSelected ? columnMetrics.map((metric, index) => (
          <button
            key={`select-column-${shape.props.columns[index]!.id}`}
            type="button"
            className="canvas-table-axis-selector canvas-table-axis-selector--column"
            draggable={!isReadonly}
            style={{ left: `${metric.start * 100}%`, width: `${metric.size * 100}%` }}
            aria-label={`选择第 ${index + 1} 列`}
            onPointerDown={(event) => event.stopPropagation()}
            onDragStart={() => setDraggedAxis({ kind: 'column', index })}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => reorderAxis('column', index)}
            onClick={() => {
              setSelectionAnchor({ rowIndex: 0, columnIndex: index })
              setSelectionFocus({ rowIndex: shape.props.rows.length - 1, columnIndex: index })
              setActiveCellId(shape.props.rows[0]?.cells[index]?.id)
            }}
          >
            <TldrawUiIcon icon="drag-handle-dots" label="" small />
          </button>
        )) : null}
        {isSelected ? rowMetrics.map((metric, index) => (
          <button
            key={`select-row-${shape.props.rows[index]!.id}`}
            type="button"
            className="canvas-table-axis-selector canvas-table-axis-selector--row"
            draggable={!isReadonly}
            style={{ top: `${metric.start * 100}%`, height: `${metric.size * 100}%` }}
            aria-label={`选择第 ${index + 1} 行`}
            onPointerDown={(event) => event.stopPropagation()}
            onDragStart={() => setDraggedAxis({ kind: 'row', index })}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => reorderAxis('row', index)}
            onClick={() => {
              setSelectionAnchor({ rowIndex: index, columnIndex: 0 })
              setSelectionFocus({ rowIndex: index, columnIndex: shape.props.columns.length - 1 })
              setActiveCellId(shape.props.rows[index]?.cells[0]?.id)
            }}
          >
            <TldrawUiIcon icon="drag-handle-dots" label="" small />
          </button>
        )) : null}
        {isSelected && !isReadonly ? columnOffsets.map((offset, index) => (
          <button
            key={`column-${index}`}
            type="button"
            className="canvas-table-resize-handle canvas-table-resize-handle--column"
            style={{ left: `${offset * 100}%` }}
            aria-label={`调整第 ${index + 1} 列宽度`}
            onPointerDown={(event) => startBoundaryDrag(event, 'column', index)}
          />
        )) : null}
        {isSelected && !isReadonly ? rowOffsets.map((offset, index) => (
          <button
            key={`row-${index}`}
            type="button"
            className="canvas-table-resize-handle canvas-table-resize-handle--row"
            style={{ top: `${offset * 100}%` }}
            aria-label={`调整第 ${index + 1} 行高度`}
            onPointerDown={(event) => startBoundaryDrag(event, 'row', index)}
          />
        )) : null}
        {isSelected && !isReadonly && shape.props.rows.length < 50
          ? rowBoundaryOffsets.map((offset, index) => (
            <div
              key={`insert-row-${index}`}
              className="canvas-table-insert-boundary canvas-table-insert-boundary--row"
              style={{ top: `${offset * 100}%` }}
            >
              <button
                type="button"
                className="canvas-table-insert-button canvas-table-insert-button--row"
                data-terminal={index === shape.props.rows.length ? 'true' : 'false'}
                aria-label={index === shape.props.rows.length ? '在末尾插入行' : `在第 ${index + 1} 行前插入行`}
                title="插入行"
                style={{
                  left: index === shape.props.rows.length ? '75%' : -28 / Math.max(zoom, 0.1),
                  transform: `translate(-50%, -50%) scale(${1 / Math.max(zoom, 0.1)})`,
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => insertAtBoundary('row', index)}
              >
                <TldrawUiIcon icon="plus" label="" small />
              </button>
              <span className="canvas-table-insert-boundary__line" aria-hidden="true" />
            </div>
          ))
          : null}
        {isSelected && !isReadonly && shape.props.columns.length < 50
          ? columnBoundaryOffsets.map((offset, index) => (
            <div
              key={`insert-column-${index}`}
              className="canvas-table-insert-boundary canvas-table-insert-boundary--column"
              style={{ left: `${offset * 100}%` }}
            >
              <button
                type="button"
                className="canvas-table-insert-button canvas-table-insert-button--column"
                data-terminal={index === shape.props.columns.length ? 'true' : 'false'}
                aria-label={index === shape.props.columns.length ? '在末尾插入列' : `在第 ${index + 1} 列前插入列`}
                title="插入列"
                style={{
                  top: index === shape.props.columns.length ? '75%' : -28 / Math.max(zoom, 0.1),
                  transform: `translate(-50%, -50%) scale(${1 / Math.max(zoom, 0.1)})`,
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => insertAtBoundary('column', index)}
              >
                <TldrawUiIcon icon="plus" label="" small />
              </button>
              <span className="canvas-table-insert-boundary__line" aria-hidden="true" />
            </div>
          ))
          : null}
      </div>
    </HTMLContainer>
  )
}

export class TableShapeUtil extends BaseBoxShapeUtil<TableShape> {
  static override type = TABLE_SHAPE_TYPE
  static override props = tableShapeProps
  static override migrations = tableShapeMigrations

  override getDefaultProps(): TableShapeProps {
    return createTableProps()
  }

  override getGeometry(shape: TableShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  override canEdit() { return false }

  override component(shape: TableShape) {
    return <TableShapeComponent shape={shape} />
  }

  override getIndicatorPath() { return undefined }

  override onResize(shape: TableShape, info: TLResizeInfo<TableShape>) {
    const resized = resizeBox(shape, info)
    return {
      ...resized,
      props: {
        ...resized.props,
        w: Math.max(shape.props.columns.length * 72, resized.props?.w ?? shape.props.w),
        h: Math.max(shape.props.rows.length * 32, resized.props?.h ?? shape.props.h),
      },
    }
  }

  override toSvg(shape: TableShape, _ctx: SvgExportContext) {
    let y = 0
    const backgrounds = { none: '#ffffff', gray: '#f2f3f5', blue: '#e8f1ff', yellow: '#fff6d8', green: '#e8f7ed', red: '#feeceb' }
    return <>
      <rect width={shape.props.w} height={shape.props.h} fill="#ffffff" stroke="#8f98a8" />
      {shape.props.rows.flatMap((row) => {
        let x = 0
        const rowHeight = row.height * shape.props.h
        const result = row.cells.map((cell, columnIndex) => {
          const width = shape.props.columns[columnIndex]!.width * shape.props.w
          const align = cell.align ?? 'left'
          const textX = align === 'left' ? x + 8 : align === 'right' ? x + width - 8 : x + width / 2
          const element = <g key={cell.id}>
            <rect
              x={x}
              y={y}
              width={width}
              height={rowHeight}
              fill={backgrounds[cell.background ?? 'none']}
              stroke={cell.border === 'none' ? 'none' : cell.border === 'strong' ? '#7d8797' : '#d7dce3'}
              strokeWidth={cell.border === 'strong' ? 2 : 1}
            />
            <text
              x={textX}
              y={y + Math.min(rowHeight - 8, 22)}
              fill={TABLE_TEXT_COLORS[cell.textColor ?? 'default']}
              fontFamily={TABLE_FONT_FAMILIES[cell.fontFamily ?? 'sans']}
              fontSize={cell.fontSize ?? 14}
              fontWeight={cell.bold || cell.header ? 700 : 500}
              fontStyle={cell.italic ? 'italic' : 'normal'}
              textDecoration={[cell.underline ? 'underline' : '', cell.strike ? 'line-through' : ''].filter(Boolean).join(' ') || undefined}
              textAnchor={align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'}
            >
              {cell.text.replace(/\s+/g, ' ').slice(0, 80)}
            </text>
          </g>
          x += width
          return element
        })
        y += rowHeight
        return result
      })}
    </>
  }
}

export class TableShapeTool extends BaseBoxShapeTool {
  static override id = TABLE_SHAPE_TYPE
  override shapeType = TABLE_SHAPE_TYPE
}

export const tableShapeUtils = [TableShapeUtil] as const
export const tableShapeTools = [TableShapeTool] as const
