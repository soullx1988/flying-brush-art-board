import { describe, expect, it } from 'vitest'

import { createTldrawUserIdentity } from './tldraw-user'

describe('createTldrawUserIdentity', () => {
  it('keeps the authenticated account id and display name', () => {
    expect(createTldrawUserIdentity({ openId: 'ou_ada', name: 'Ada Lovelace' })).toMatchObject({
      id: 'ou_ada',
      name: 'Ada Lovelace',
    })
  })

  it('assigns a stable tldraw presence color from the account id', () => {
    const first = createTldrawUserIdentity({ openId: 'ou_stable', name: 'First name' })
    const renamed = createTldrawUserIdentity({ openId: 'ou_stable', name: 'Renamed account' })

    expect(first.color).toMatch(/^#[0-9A-F]{6}$/)
    expect(renamed.color).toBe(first.color)
  })
})
