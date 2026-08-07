import type { FeishuCredentials } from './credential-store.js'
import { FeishuOAuthError, type FeishuOAuthProvider } from './oauth-service.js'

const scopes = [
  'board:whiteboard:node:read',
  'docx:document:readonly',
  'wiki:node:retrieve',
  'docs:document.media:download',
  'offline_access',
] as const

const initialCredentials: FeishuCredentials = {
  accessToken: 'mock-user-access-token',
  refreshToken: 'mock-user-refresh-token',
  scopes,
}

export function createMockFeishuOAuthProvider(): FeishuOAuthProvider {
  return {
    createAuthorizationUrl({ state, codeChallenge, redirectUri }) {
      const url = new URL('mock-feishu://authorize')
      url.search = new URLSearchParams({
        response_type: 'code', state, redirect_uri: redirectUri,
        ...(codeChallenge ? { code_challenge: codeChallenge, code_challenge_method: 'S256' } : {}),
      }).toString()
      return url.toString()
    },
    async exchangeAuthorizationCode(code) {
      if (code !== 'mock-authorized-code') throw new FeishuOAuthError('FEISHU_AUTHORIZATION_DENIED', 401)
      return initialCredentials
    },
    async refreshToken(refreshToken) {
      if (refreshToken !== initialCredentials.refreshToken) {
        throw new FeishuOAuthError('FEISHU_REFRESH_TOKEN_INVALID', 401)
      }
      return {
        accessToken: 'mock-user-access-token-rotated',
        refreshToken: 'mock-user-refresh-token-rotated',
        scopes,
      }
    },
  }
}
