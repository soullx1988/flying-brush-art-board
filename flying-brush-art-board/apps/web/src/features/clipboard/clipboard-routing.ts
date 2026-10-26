import type { BoardClipboardPayload, ClipboardAsset } from '@infinite-board/board-core'
import {
  renderPlaintextFromRichText,
  type Editor,
  type TLAsset,
  type TLRichText,
  type TLShapeId,
} from 'tldraw'

const SERVER_ASSET_HASH = /(?:^|\/)api\/assets\/([a-f0-9]{64})(?:[?#].*)?$/

function persistedAssetMetadata(asset: TLAsset): Omit<ClipboardAsset, 'record'> | undefined {
  const props = asset.props as Record<string, unknown>
  const meta = asset.meta as Record<string, unknown>
  const src = typeof props.src === 'string' ? props.src : undefined
  const hashFromMeta = typeof meta.sha256 === 'string' && /^[a-f0-9]{64}$/.test(meta.sha256)
    ? meta.sha256
    : undefined
  const sha256 = hashFromMeta ?? src?.match(SERVER_ASSET_HASH)?.[1]
  if (!sha256) return undefined

  return {
    assetRecordId: asset.id,
    sha256,
    mime: typeof props.mimeType === 'string' && props.mimeType.length > 0
      ? props.mimeType
      : 'application/octet-stream',
    size: typeof props.fileSize === 'number' && Number.isSafeInteger(props.fileSize) && props.fileSize >= 0
      ? props.fileSize
      : 0,
    ...(src ? { sourceUrl: src } : {}),
  }
}

export function structuredClipboardAssets(
  editor: Editor,
  selectedShapeIds: readonly TLShapeId[],
): Omit<ClipboardAsset, 'record'>[] | undefined {
  const copiedShapeIds = editor.getShapeAndDescendantIds([...selectedShapeIds])
  const assetIds = new Set<string>()
  for (const shapeId of copiedShapeIds) {
    const shape = editor.getShape(shapeId)
    const assetId = (shape?.props as { assetId?: unknown } | undefined)?.assetId
    if (typeof assetId === 'string' && assetId.length > 0) assetIds.add(assetId)
  }

  const assets: Omit<ClipboardAsset, 'record'>[] = []
  for (const assetId of assetIds) {
    const asset = editor.getAsset(assetId as never)
    if (!asset) return undefined
    const metadata = persistedAssetMetadata(asset)
    if (!metadata) return undefined
    assets.push(metadata)
  }
  return assets
}

export function selectionNeedsNativeClipboard(
  editor: Editor,
  selectedShapeIds: readonly TLShapeId[],
): boolean {
  return structuredClipboardAssets(editor, selectedShapeIds) === undefined
}

export function structuredClipboardPlainText(
  editor: Editor,
  payload: BoardClipboardPayload,
): string | undefined {
  const text = payload.shapes.flatMap((shape) => {
    const record = shape as { type?: unknown; props?: { richText?: unknown } }
    if (record.type !== 'text' || !record.props?.richText) return []
    try {
      return [renderPlaintextFromRichText(editor, record.props.richText as TLRichText)]
    } catch {
      return []
    }
  }).join('\n')
  return text.trim().length > 0 ? text : undefined
}

export function clipboardRootShapeIds(payload: BoardClipboardPayload): string[] {
  const copiedShapeIds = new Set(payload.shapes.flatMap((shape) => {
    const id = (shape as { id?: unknown }).id
    return typeof id === 'string' ? [id] : []
  }))
  return payload.shapes.flatMap((shape) => {
    const record = shape as { id?: unknown; parentId?: unknown }
    if (typeof record.id !== 'string') return []
    return typeof record.parentId === 'string' && copiedShapeIds.has(record.parentId)
      ? []
      : [record.id]
  })
}

export function writeTldrawClipboardData(
  editor: Editor,
  selectedShapeIds: readonly TLShapeId[],
  data: Pick<DataTransfer, 'setData'>,
): boolean {
  const content = editor.getContentFromCurrentPage([...selectedShapeIds])
  if (!content) return false

  const serialized = JSON.stringify({
    type: 'application/tldraw',
    kind: 'content',
    version: 2,
    data: content,
  })
  const plainText = content.shapes.flatMap((shape) => {
    try {
      const text = editor.getShapeUtil(shape).getText(shape)
      return typeof text === 'string' && text.length > 0 ? [text] : []
    } catch {
      return []
    }
  }).join(' ')

  try {
    data.setData('text/html', `<div data-tldraw>${serialized}</div>`)
    data.setData('text/plain', plainText || ' ')
    return true
  } catch {
    return false
  }
}

export function clipboardHasTldrawContent(data: DataTransfer): boolean {
  let html = ''
  try {
    html = data.getData('text/html')
  } catch {
    return false
  }
  if (!html) return false
  return Boolean(new DOMParser().parseFromString(html, 'text/html').querySelector('[data-tldraw]'))
}
