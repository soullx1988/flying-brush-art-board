import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const adr = readFileSync(new URL('./0001-canvas-engine-and-license.md', import.meta.url), 'utf8')
const environmentExample = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8')

describe('ADR 0001: canvas engine and license', () => {
  it('records the selected tldraw version, official license source, and pending decision', () => {
    expect(adr).toContain('# ADR 0001: 画布内核与许可证')
    expect(adr).toContain('`pending-user-license`')
    expect(adr).toContain('tldraw `5.2.5`')
    expect(adr).toContain('https://github.com/tldraw/tldraw/blob/main/LICENSE.md')
  })

  it('keeps localhost development separate from formal daily-use permission', () => {
    expect(adr).toContain('localhost')
    expect(adr).toContain('正式日常使用')
    expect(adr).toContain('VITE_TLDRAW_LICENSE_KEY')
  })

  it('documents user-owned license choices, branding, expiry, and fallback', () => {
    expect(adr).toContain('Hobby License')
    expect(adr).toContain('Trial License')
    expect(adr).toContain('Commercial License')
    expect(adr).toContain('made with tldraw')
    expect(adr).toContain('Excalidraw')
    expect(adr).toContain('到期')
  })

  it('keeps the license key variable in the checked-in environment template without a key value', () => {
    expect(environmentExample).toContain('VITE_TLDRAW_LICENSE_KEY=')
    expect(environmentExample).not.toMatch(/VITE_TLDRAW_LICENSE_KEY=.+/)
  })
})
