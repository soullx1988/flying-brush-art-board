import { describe, expect, it } from 'vitest'
import type { Editor, TLShapeId } from 'tldraw'

import {
  clipboardHasTldrawContent,
  clipboardRootShapeIds,
  selectionNeedsNativeClipboard,
  structuredClipboardPlainText,
  writeTldrawClipboardData,
} from './clipboard-routing'
import type { BoardClipboardPayload } from '@infinite-board/board-core'

function routingEditor(shapes: Record<string, { props: Record<string, unknown> }>): Editor {
  return {
    getShapeAndDescendantIds: () => new Set(Object.keys(shapes) as TLShapeId[]),
    getShape: (shapeId: TLShapeId) => shapes[shapeId] as never,
    getAsset: (assetId: string) => ({
      id: assetId,
      typeName: 'asset',
      type: 'image',
      props: { mimeType: 'image/png', fileSize: 12, src: '/api/assets/' + 'a'.repeat(64) },
      meta: {},
    }) as never,
  } as unknown as Editor
}

describe('clipboard routing', () => {
  it('keeps server-backed assets on the structured clipboard path', () => {
    const editor = routingEditor({
      'shape:group': { props: {} },
      'shape:image': { props: { assetId: 'asset:image' } },
      'shape:caption': { props: { richText: { type: 'doc' } } },
    })

    expect(selectionNeedsNativeClipboard(editor, ['shape:group' as TLShapeId])).toBe(false)
  })

  it('uses the native tldraw clipboard for assets without a persistent server hash', () => {
    const editor = {
      ...routingEditor({ 'shape:image': { props: { assetId: 'asset:image' } } }),
      getAsset: () => ({
        id: 'asset:image', typeName: 'asset', type: 'image',
        props: { mimeType: 'image/svg+xml', src: 'data:image/svg+xml;base64,AA==' }, meta: {},
      }),
    } as unknown as Editor

    expect(selectionNeedsNativeClipboard(editor, ['shape:image' as TLShapeId])).toBe(true)
  })

  it('keeps arbitrary non-asset shape types on the structured clipboard path', () => {
    const editor = routingEditor({
      'shape:table': { props: { rows: [] } },
      'shape:mind-map': { props: { nodes: [] } },
      'shape:board-reference': { props: { referenceId: 'reference:one' } },
    })

    expect(selectionNeedsNativeClipboard(editor, ['shape:table' as TLShapeId])).toBe(false)
  })

  it('recognizes native tldraw clipboard HTML without matching unrelated HTML', () => {
    const clipboardData = (html: string) => ({
      getData: (type: string) => type === 'text/html' ? html : '',
    }) as DataTransfer

    expect(clipboardHasTldrawContent(clipboardData('<div data-tldraw>{}</div>'))).toBe(true)
    expect(clipboardHasTldrawContent(clipboardData('<div data-tldrawing>{}</div>'))).toBe(false)
  })

  it('writes native tldraw content for selections with temporary assets', () => {
    const editor = routingEditor({})
    ;(editor as unknown as { getContentFromCurrentPage: () => unknown }).getContentFromCurrentPage = () => ({
      shapes: [{ id: 'shape:image', typeName: 'shape', type: 'image', props: {} }],
      bindings: [],
      assets: [{ id: 'asset:image', typeName: 'asset', type: 'image', props: {} }],
    })
    ;(editor as unknown as { getShapeUtil: () => unknown }).getShapeUtil = () => ({
      getText: () => '',
    })
    const values: Record<string, string> = {}

    expect(writeTldrawClipboardData(
      editor,
      ['shape:image' as TLShapeId],
      { setData: (type, value) => { values[type] = value } },
    )).toBe(true)
    expect(values['text/html']).toContain('<div data-tldraw>')
    expect(values['text/html']).toContain('"type":"application/tldraw"')
    expect(values['text/plain']).toBe(' ')
  })

  it('extracts plain text from a copied rich-text shape', () => {
    const editor = routingEditor({})
    ;(editor as unknown as { getTextOptions: () => unknown }).getTextOptions = () => ({})
    const payload: BoardClipboardPayload = {
      version: 1,
      sourceProjectId: 'project:one',
      sourceBoardId: 'board:one',
      shapes: [{
        id: 'shape:text', typeName: 'shape', type: 'text',
        props: { richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plain copied text' }] }] } },
      }],
      bindings: [], references: [], assets: [], copiedAt: '2026-08-04T00:00:00.000Z',
    }

    expect(structuredClipboardPlainText(editor, payload)).toBe('Plain copied text')
  })

  it('selects only copied roots after a grouped payload is pasted', () => {
    const payload = {
      version: 1,
      sourceProjectId: 'project:one', sourceBoardId: 'board:one',
      shapes: [
        { id: 'shape:group', typeName: 'shape', type: 'group', parentId: 'page:page' },
        { id: 'shape:child', typeName: 'shape', type: 'geo', parentId: 'shape:group' },
      ], bindings: [], references: [], assets: [], copiedAt: '2026-08-04T00:00:00.000Z',
    } satisfies BoardClipboardPayload

    expect(clipboardRootShapeIds(payload)).toEqual(['shape:group'])
  })
})
