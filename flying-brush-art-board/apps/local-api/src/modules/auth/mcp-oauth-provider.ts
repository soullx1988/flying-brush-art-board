import type { Response } from 'express'

import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { InvalidGrantError, InvalidRequestError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'

import { MCP_SCOPES, type McpOAuthRepository } from './mcp-oauth-repository.js'

export class InfiniteBoardOAuthProvider implements OAuthServerProvider {
  readonly skipLocalPkceValidation = false

  constructor(
    readonly clientsStore: McpOAuthRepository,
    private readonly publicOrigin: URL,
    private readonly ensureUserAllowed: (openId: string) => Promise<void>,
  ) {}

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, response: Response): Promise<void> {
    if (params.scopes && (params.scopes.length !== MCP_SCOPES.length || MCP_SCOPES.some((scope) => !params.scopes!.includes(scope)))) {
      throw new InvalidRequestError('Infinite Board MCP requires its fixed scope set')
    }
    const resource = new URL('/mcp', this.publicOrigin)
    if (params.resource && params.resource.href !== resource.href) throw new InvalidRequestError('Invalid resource')
    const requestToken = this.clientsStore.createAuthorizationRequest({
      client,
      redirectUri: params.redirectUri,
      ...(params.state ? { state: params.state } : {}),
      codeChallenge: params.codeChallenge,
      resource: resource.href,
    })
    response.redirect(302, new URL(`/oauth/consent?request=${encodeURIComponent(requestToken)}`, this.publicOrigin).href)
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const challenge = this.clientsStore.challengeForAuthorizationCode(client.client_id, authorizationCode)
    if (!challenge) throw new InvalidGrantError('Authorization code is invalid or expired')
    return challenge
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const identity = this.clientsStore.authorizationCodeIdentity(client.client_id, authorizationCode)
    if (!identity) throw new InvalidGrantError('Authorization code is invalid or expired')
    await this.ensureUserAllowed(identity.openId)
    try {
      return this.clientsStore.exchangeAuthorizationCode({
        clientId: client.client_id,
        code: authorizationCode,
        ...(redirectUri ? { redirectUri } : {}),
        ...(resource ? { resource: resource.href } : {}),
      })
    } catch {
      throw new InvalidGrantError('Authorization code is invalid or expired')
    }
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    if (scopes && (scopes.length !== MCP_SCOPES.length || MCP_SCOPES.some((scope) => !scopes.includes(scope)))) {
      throw new InvalidRequestError('Infinite Board MCP requires its fixed scope set')
    }
    const identity = this.clientsStore.refreshTokenIdentity(client.client_id, refreshToken)
    if (!identity) throw new InvalidGrantError('Refresh token is invalid or expired')
    await this.ensureUserAllowed(identity.openId)
    try {
      return this.clientsStore.rotateRefreshToken({
        clientId: client.client_id,
        refreshToken,
        ...(resource ? { resource: resource.href } : {}),
      })
    } catch {
      throw new InvalidGrantError('Refresh token is invalid or expired')
    }
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const access = this.clientsStore.verifyAccessToken(token)
    if (!access) throw new InvalidGrantError('Access token is invalid or expired')
    return {
      token,
      clientId: access.oauthClientId,
      scopes: access.scopes,
      expiresAt: Math.floor(Date.parse(access.accessTokenExpiresAt) / 1000),
      resource: new URL('/mcp', this.publicOrigin),
      extra: { access },
    }
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    this.clientsStore.revokeToken(request, client.client_id)
  }
}
