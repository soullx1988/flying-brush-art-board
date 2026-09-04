import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  isAllowedLanHost,
  isAllowedLanOrigin,
  resolveLanEntrySecurity,
} from '../../scripts/lan-entry-security.js'
import {
  evaluateLanForwardedRequest,
  resolveLanApiSecurity,
} from '../../apps/local-api/src/security/lan-forwarded-request.js'

const validEnvironment = {
  LAN_EXPOSURE_ENABLED: 'true',
  FEISHU_AUTH_ENABLED: 'true',
  FEISHU_WHITELIST_ENABLED: 'true',
  FEISHU_ALLOWED_OPEN_IDS: 'ou_owner',
  FEISHU_APP_ID: 'cli_test',
  FEISHU_APP_SECRET: 'secret',
  SESSION_SECRET: 'x'.repeat(32),
  LAN_HTTPS_PFX: 'certificates/board.pfx',
  LAN_ALLOWED_HOSTS: 'board.example.internal,192.168.65.48',
  LAN_ALLOWED_ORIGINS: 'https://board.example.internal:4173,https://192.168.65.48:4173',
}

const windowsDeployment = readFileSync(
  new URL('../../docs/deployment/windows-machine-deployment.md', import.meta.url),
  'utf8',
)
const lanDeployment = readFileSync(
  new URL('../../docs/deployment/lan-collaboration-server.md', import.meta.url),
  'utf8',
)

describe('LAN entry security', () => {
  it('accepts only an explicitly authenticated TLS LAN configuration', () => {
    expect(resolveLanEntrySecurity(validEnvironment)).toEqual({
      pfxPath: 'certificates/board.pfx',
      allowedHosts: ['board.example.internal', '192.168.65.48'],
      allowedOrigins: ['https://board.example.internal:4173', 'https://192.168.65.48:4173'],
    })
  })

  it.each([
    ['LAN_EXPOSURE_ENABLED', 'false', 'LAN_EXPOSURE_ENABLED'],
    ['FEISHU_AUTH_ENABLED', undefined, 'FEISHU_AUTH_ENABLED'],
    ['FEISHU_AUTH_ENABLED', 'false', 'FEISHU_AUTH_ENABLED'],
    ['FEISHU_WHITELIST_ENABLED', 'false', 'FEISHU_WHITELIST_ENABLED'],
    ['FEISHU_ALLOWED_OPEN_IDS', '', 'FEISHU_ALLOWED_OPEN_IDS'],
    ['FEISHU_APP_SECRET', '', 'FEISHU_APP_SECRET'],
    ['SESSION_SECRET', 'short', 'SESSION_SECRET'],
    ['LAN_HTTPS_PFX', '', 'LAN_HTTPS_PFX'],
    ['LAN_ALLOWED_HOSTS', '*', 'wildcards are forbidden'],
    ['LAN_ALLOWED_ORIGINS', '*', 'wildcards are forbidden'],
    ['LAN_ALLOWED_ORIGINS', 'http://board.example.internal:4173', 'exact HTTPS origin'],
    ['LAN_ALLOWED_ORIGINS', 'https://unlisted.example.internal:4173', 'not in LAN_ALLOWED_HOSTS'],
  ])('rejects unsafe %s=%s', (name, value, expected) => {
    expect(() => resolveLanEntrySecurity({ ...validEnvironment, [name]: value })).toThrow(expected)
  })

  it('keeps the API loopback path open but fails closed for unsafe proxy forwarding', () => {
    const allowedOrigins = new Set(validEnvironment.LAN_ALLOWED_ORIGINS.split(','))
    const security = resolveLanApiSecurity(validEnvironment, allowedOrigins)
    expect(evaluateLanForwardedRequest({ host: '127.0.0.1:8787' }, security)).toEqual({ allowed: true })
    expect(evaluateLanForwardedRequest({
      host: '127.0.0.1:8787',
      'x-forwarded-host': 'board.example.internal:4173',
      'x-forwarded-proto': 'http',
    }, security)).toMatchObject({ allowed: false, code: 'LAN_HTTPS_FORWARDING_REQUIRED' })
    expect(evaluateLanForwardedRequest({
      host: '127.0.0.1:8787',
      'x-forwarded-host': 'evil.example.internal:4173',
      'x-forwarded-proto': 'https',
    }, security)).toMatchObject({ allowed: false, code: 'LAN_HOST_REJECTED' })
    expect(evaluateLanForwardedRequest({
      host: '127.0.0.1:8787',
      origin: 'https://evil.example.internal:4173',
      'x-forwarded-host': 'board.example.internal:4173',
      'x-forwarded-proto': 'https',
    }, security)).toMatchObject({ allowed: false, code: 'LAN_ORIGIN_REJECTED' })
  })

  it('rejects forwarded requests entirely unless LAN exposure is explicitly enabled', () => {
    expect(evaluateLanForwardedRequest({
      host: 'board.example.internal:4173',
      'x-forwarded-host': 'board.example.internal:4173',
      'x-forwarded-proto': 'https',
    }, { enabled: false, allowedOrigins: new Set() })).toEqual({
      allowed: false,
      statusCode: 503,
      code: 'LAN_EXPOSURE_DISABLED',
    })
  })

  it('matches request hosts without trusting ports or suffixes', () => {
    const allowed = ['board.example.internal', '192.168.65.48']
    expect(isAllowedLanHost('board.example.internal:4173', allowed)).toBe(true)
    expect(isAllowedLanHost('192.168.65.48:4173', allowed)).toBe(true)
    expect(isAllowedLanHost('evil.board.example.internal:4173', allowed)).toBe(false)
    expect(isAllowedLanHost(undefined, allowed)).toBe(false)
  })

  it('allows absent same-origin Origin headers but rejects every unlisted or insecure Origin', () => {
    const allowed = ['https://board.example.internal:4173']
    expect(isAllowedLanOrigin(undefined, allowed)).toBe(true)
    expect(isAllowedLanOrigin('https://board.example.internal:4173', allowed)).toBe(true)
    expect(isAllowedLanOrigin('http://board.example.internal:4173', allowed)).toBe(false)
    expect(isAllowedLanOrigin('https://evil.example.internal:4173', allowed)).toBe(false)
  })

  it('keeps the formal Windows deployment recipe fail closed and HTTPS only', () => {
    const formalSection = windowsDeployment.match(/## 5\. 正式协作模式([\s\S]*?)## 6\./)?.[1]
    expect(formalSection).toBeDefined()

    for (const setting of [
      'LAN_EXPOSURE_ENABLED=true',
      'FEISHU_AUTH_ENABLED=true',
      'FEISHU_WHITELIST_ENABLED=true',
      'FEISHU_ALLOWED_OPEN_IDS=',
      'LAN_HTTPS_PFX=',
      'LAN_ALLOWED_HOSTS=',
      'LAN_ALLOWED_ORIGINS=https://',
      'MCP_PUBLIC_URL=https://',
      'MCP_ALLOWED_ORIGINS=https://',
    ]) {
      expect(formalSection).toContain(setting)
    }

    expect(formalSection).toContain('https://board.example.internal:4173/auth/feishu/callback')
    expect(formalSection).toContain('https://board.example.internal:4173/auth/feishu/import/callback')
    expect(formalSection).toContain('不要开放 HTTP 端口或 8787')
    expect(formalSection).not.toContain('FEISHU_WHITELIST_ENABLED=false')
    expect(formalSection).not.toMatch(/(?:MCP_PUBLIC_URL|MCP_ALLOWED_ORIGINS)=http:\/\//)
    expect(formalSection).not.toMatch(/http:\/\/(?:board\.example\.internal|192\.168\.65\.48)/)
  })

  it('documents both Feishu callbacks in the canonical LAN deployment guide', () => {
    expect(lanDeployment).toContain('/auth/feishu/callback')
    expect(lanDeployment).toContain('/auth/feishu/import/callback')
  })
})
