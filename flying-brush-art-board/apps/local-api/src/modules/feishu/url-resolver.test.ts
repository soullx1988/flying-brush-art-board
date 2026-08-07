import { describe, expect, it, vi } from 'vitest'

import { resolveWhiteboardToken, type WikiDocxClient } from './url-resolver.js'

const client: WikiDocxClient = {
  resolveWhiteboardToken: vi.fn(async () => 'resolved-board-token'),
}

describe('resolveWhiteboardToken', () => {
  it('accepts a bare whiteboard token', async () => {
    await expect(resolveWhiteboardToken('board_token-123', client)).resolves.toBe('board_token-123')
  })

  it('extracts a token from a documented Board URL', async () => {
    await expect(resolveWhiteboardToken('https://example.feishu.cn/board/board_token-123', client))
      .resolves.toBe('board_token-123')
  })

  it('uses blockToken from Wiki and Docx links without a network lookup', async () => {
    await expect(resolveWhiteboardToken('https://example.feishu.cn/wiki/wiki-token?blockType=whiteboard&blockToken=wiki-board-1', client))
      .resolves.toBe('wiki-board-1')
    await expect(resolveWhiteboardToken('https://example.feishu.cn/docx/doc-token?blockToken=docx-board-1', client))
      .resolves.toBe('docx-board-1')
    expect(client.resolveWhiteboardToken).not.toHaveBeenCalled()
  })

  it('delegates documented Wiki/Docx resolution when no blockToken is present', async () => {
    await expect(resolveWhiteboardToken('https://example.feishu.cn/wiki/wiki-token', client))
      .resolves.toBe('resolved-board-token')
    expect(client.resolveWhiteboardToken).toHaveBeenCalledWith(expect.objectContaining({ kind: 'wiki', token: 'wiki-token' }))
  })

  it('forwards caller cancellation to document resolution', async () => {
    const controller = new AbortController()
    await resolveWhiteboardToken('https://example.feishu.cn/wiki/wiki-token', client, { signal: controller.signal })
    expect(client.resolveWhiteboardToken).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'wiki', token: 'wiki-token' }),
      { signal: controller.signal },
    )
  })

  it('rejects unsupported hosts and malformed input', async () => {
    await expect(resolveWhiteboardToken('https://attacker.example/board/stolen', client)).rejects.toThrow('FEISHU_URL_UNSUPPORTED')
    await expect(resolveWhiteboardToken('not a token!', client)).rejects.toThrow('FEISHU_WHITEBOARD_TOKEN_INVALID')
  })
})
