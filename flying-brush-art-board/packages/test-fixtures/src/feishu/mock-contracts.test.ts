import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_FEISHU_MOCK_SCOPES,
  FeishuMockError,
  createMockFeishuProvider,
} from './mock-provider.js'

describe('Feishu mock provider contracts', () => {
  it('returns token, nodes, theme, preview and media without network access', async () => {
    const provider = createMockFeishuProvider()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    try {
      const token = await provider.exchangeAuthorizationCode('mock-authorized-code')
      const nodes = await provider.listWhiteboardNodes(token.accessToken)
      const theme = await provider.getWhiteboardTheme(token.accessToken)
      const preview = await provider.downloadWhiteboardPreview(token.accessToken)
      const media = await provider.downloadMedia(token.accessToken, 'mock-media-1')

      expect(token.scopes).toEqual(DEFAULT_FEISHU_MOCK_SCOPES)
      expect(nodes).toHaveLength(2)
      expect(theme.background).toBe('#ffffff')
      expect(preview.mime).toBe('image/png')
      expect(media.mime).toBe('image/png')
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('rejects an invalid authorization code', async () => {
    const provider = createMockFeishuProvider()

    await expect(provider.exchangeAuthorizationCode('invalid-code')).rejects.toMatchObject({
      code: 'FEISHU_AUTHORIZATION_DENIED',
      statusCode: 401,
    } satisfies Partial<FeishuMockError>)
  })

  it('rejects a token that has expired', async () => {
    const provider = createMockFeishuProvider({ expiredAccessTokens: ['expired-token'] })

    await expect(provider.listWhiteboardNodes('expired-token')).rejects.toMatchObject({
      code: 'FEISHU_ACCESS_TOKEN_EXPIRED',
      statusCode: 401,
    } satisfies Partial<FeishuMockError>)
  })

  it('returns a scope diagnostic without silently expanding permissions', async () => {
    const provider = createMockFeishuProvider({
      issuedTokens: [
        {
          accessToken: 'limited-token',
          refreshToken: 'limited-refresh-token',
          scopes: ['offline_access'],
        },
      ],
    })

    await expect(provider.listWhiteboardNodes('limited-token')).rejects.toMatchObject({
      code: 'FEISHU_SCOPE_MISSING',
      statusCode: 403,
      missingScopes: ['board:whiteboard:node:read'],
    } satisfies Partial<FeishuMockError>)
  })

  it('reports a failed media download without changing board data', async () => {
    const provider = createMockFeishuProvider()
    const token = await provider.exchangeAuthorizationCode('mock-authorized-code')

    await expect(provider.downloadMedia(token.accessToken, 'missing-media')).rejects.toMatchObject({
      code: 'FEISHU_MEDIA_NOT_FOUND',
      statusCode: 404,
    } satisfies Partial<FeishuMockError>)
  })
})
