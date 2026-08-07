export const DEFAULT_FEISHU_MOCK_SCOPES = [
  'board:whiteboard:node:read',
  'docx:document:readonly',
  'wiki:node:retrieve',
  'docs:document.media:download',
  'offline_access',
] as const

export type FeishuMockScope = (typeof DEFAULT_FEISHU_MOCK_SCOPES)[number]

export interface FeishuMockToken {
  accessToken: string
  refreshToken: string
  scopes: readonly string[]
}

export interface FeishuMockNode {
  id: string
  type: 'text' | 'sticky'
  text: string
}

export interface FeishuMockTheme {
  background: string
  grid: string
}

export interface FeishuMockBinary {
  mime: 'image/png'
  bytes: Uint8Array
}

export class FeishuMockError extends Error {
  readonly code: string
  readonly statusCode: number
  readonly missingScopes?: readonly string[]

  constructor(input: { code: string; statusCode: number; missingScopes?: readonly string[] }) {
    super(input.code)
    this.name = 'FeishuMockError'
    this.code = input.code
    this.statusCode = input.statusCode

    if (input.missingScopes) {
      this.missingScopes = input.missingScopes
    }
  }
}

export interface CreateMockFeishuProviderOptions {
  issuedTokens?: readonly FeishuMockToken[]
  expiredAccessTokens?: readonly string[]
}

const authorizedToken: FeishuMockToken = {
  accessToken: 'mock-user-access-token',
  refreshToken: 'mock-user-refresh-token',
  scopes: DEFAULT_FEISHU_MOCK_SCOPES,
}

const nodes: readonly FeishuMockNode[] = [
  { id: 'mock-node-1', type: 'text', text: 'Welcome to the mock whiteboard' },
  { id: 'mock-node-2', type: 'sticky', text: 'Mock sticky note' },
]

const theme: FeishuMockTheme = {
  background: '#ffffff',
  grid: '#e5e7eb',
}

const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

export interface MockFeishuProvider {
  createAuthorizationUrl(input: { state: string; codeChallenge?: string; redirectUri: string }): string
  exchangeAuthorizationCode(code: string, input?: { codeVerifier?: string; redirectUri: string }): Promise<FeishuMockToken>
  refreshToken(refreshToken: string): Promise<FeishuMockToken>
  listWhiteboardNodes(accessToken: string): Promise<readonly FeishuMockNode[]>
  getWhiteboardTheme(accessToken: string): Promise<FeishuMockTheme>
  downloadWhiteboardPreview(accessToken: string): Promise<FeishuMockBinary>
  downloadMedia(accessToken: string, mediaToken: string): Promise<FeishuMockBinary>
}

export function createMockFeishuProvider(
  options: CreateMockFeishuProviderOptions = {},
): MockFeishuProvider {
  const tokens = new Map<string, FeishuMockToken>([
    [authorizedToken.accessToken, authorizedToken],
    ...(options.issuedTokens ?? []).map((token) => [token.accessToken, token] as const),
  ])
  const expiredAccessTokens = new Set(options.expiredAccessTokens)

  function requireScope(accessToken: string, scope: FeishuMockScope): FeishuMockToken {
    if (expiredAccessTokens.has(accessToken)) {
      throw new FeishuMockError({
        code: 'FEISHU_ACCESS_TOKEN_EXPIRED',
        statusCode: 401,
      })
    }

    const token = tokens.get(accessToken)
    if (!token) {
      throw new FeishuMockError({
        code: 'FEISHU_ACCESS_TOKEN_EXPIRED',
        statusCode: 401,
      })
    }

    if (!token.scopes.includes(scope)) {
      throw new FeishuMockError({
        code: 'FEISHU_SCOPE_MISSING',
        statusCode: 403,
        missingScopes: [scope],
      })
    }

    return token
  }

  return {
    createAuthorizationUrl({ state, codeChallenge, redirectUri }) {
      const url = new URL('mock-feishu://authorize')
      url.search = new URLSearchParams({
        response_type: 'code', state, redirect_uri: redirectUri,
        ...(codeChallenge ? { code_challenge: codeChallenge, code_challenge_method: 'S256' } : {}),
      }).toString()
      return url.toString()
    },
    async exchangeAuthorizationCode(code, _input) {
      if (code !== 'mock-authorized-code') {
        throw new FeishuMockError({
          code: 'FEISHU_AUTHORIZATION_DENIED',
          statusCode: 401,
        })
      }

      return authorizedToken
    },

    async refreshToken(refreshToken) {
      if (refreshToken !== authorizedToken.refreshToken) {
        throw new FeishuMockError({
          code: 'FEISHU_REFRESH_TOKEN_INVALID',
          statusCode: 401,
        })
      }
      return {
        accessToken: 'mock-user-access-token-rotated',
        refreshToken: 'mock-user-refresh-token-rotated',
        scopes: DEFAULT_FEISHU_MOCK_SCOPES,
      }
    },

    async listWhiteboardNodes(accessToken) {
      requireScope(accessToken, 'board:whiteboard:node:read')
      return nodes
    },

    async getWhiteboardTheme(accessToken) {
      requireScope(accessToken, 'board:whiteboard:node:read')
      return theme
    },

    async downloadWhiteboardPreview(accessToken) {
      requireScope(accessToken, 'board:whiteboard:node:read')
      return { mime: 'image/png', bytes: pngSignature }
    },

    async downloadMedia(accessToken, mediaToken) {
      requireScope(accessToken, 'docs:document.media:download')

      if (mediaToken !== 'mock-media-1') {
        throw new FeishuMockError({
          code: 'FEISHU_MEDIA_NOT_FOUND',
          statusCode: 404,
        })
      }

      return { mime: 'image/png', bytes: pngSignature }
    },
  }
}
