import { T, type RecordProps, type TLShape } from 'tldraw'

import type { BoardReferenceKind } from '@infinite-board/board-core'

export const BOARD_REFERENCE_SHAPE_TYPE = 'board-reference' as const

export interface BoardReferenceShapeProps {
  w: number
  h: number
  referenceId: string
  targetBoardId: string
  kind: BoardReferenceKind
  titleFallback: string
  thumbnailAssetId?: string
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    [BOARD_REFERENCE_SHAPE_TYPE]: BoardReferenceShapeProps
  }
}

export type BoardReferenceShape = TLShape<typeof BOARD_REFERENCE_SHAPE_TYPE>

export const boardReferenceShapeProps: RecordProps<BoardReferenceShape> = {
  w: T.number,
  h: T.number,
  referenceId: T.string,
  targetBoardId: T.string,
  kind: T.literalEnum('embed', 'link'),
  titleFallback: T.string,
  thumbnailAssetId: T.string.optional(),
}

export function isBoardReferenceShapeRecord(
  value: unknown,
): value is BoardReferenceShape & Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const record = value as { typeName?: unknown; type?: unknown; props?: unknown }
  if (record.typeName !== 'shape' || record.type !== BOARD_REFERENCE_SHAPE_TYPE) return false
  if (!record.props || typeof record.props !== 'object') return false
  const props = record.props as Partial<BoardReferenceShapeProps>
  return (
    typeof props.referenceId === 'string' &&
    typeof props.targetBoardId === 'string' &&
    (props.kind === 'embed' || props.kind === 'link') &&
    typeof props.titleFallback === 'string'
  )
}
