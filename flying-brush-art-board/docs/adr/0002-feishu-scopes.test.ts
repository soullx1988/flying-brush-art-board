import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const adr = readFileSync(new URL('./0002-feishu-scopes.md', import.meta.url), 'utf8')

describe('ADR 0002: Feishu scopes and deferred authorization', () => {
  it('records the pending mock-first contract and expected scopes', () => {
    expect(adr).toContain('`pending-user-authorization`')
    for (const value of ['mock token', 'nodes', 'theme', 'preview', 'media download', 'board:whiteboard:node:read', 'docx:document:readonly', 'wiki:node:retrieve', 'docs:document.media:download', 'offline_access']) expect(adr).toContain(value)
  })

  it('keeps real authorization gated and sensitive data outside Git', () => {
    expect(adr).toContain('.env.local')
    expect(adr).toContain('FEISHU_REAL_SMOKE=1')
    expect(adr).toContain('SKIPPED: awaiting user authorization')
    expect(adr).toContain('anonymized')
    expect(adr).toContain('do not enter Git')
  })

  it('records zero-write inspect and one-board commit semantics', () => {
    expect(adr).toContain('zero-write')
    expect(adr).toContain('exactly one Board')
    expect(adr).toContain('never derive local `board_references`')
    expect(adr).toContain('@feishu-real')
  })
})
