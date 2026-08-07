import { describe, expect, it } from 'vitest'

import { LocalAuthClient } from './auth-client'

describe('LocalAuthClient', () => {
  it('includes the current webpage origin in the Feishu login URL', () => {
    window.history.replaceState(null, '', '/projects/p1')
    const url = new URL(new LocalAuthClient().loginUrl('/projects/p1'), window.location.origin)
    expect(url.pathname).toBe('/auth/feishu/start')
    expect(url.searchParams.get('returnTo')).toBe('/projects/p1')
    expect(url.searchParams.get('origin')).toBe(window.location.origin)
  })
})
