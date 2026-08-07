import React from 'react'
import { Tldraw } from 'tldraw'
import { describe, expect, it } from 'vitest'

describe('web dependency compatibility', () => {
  it('loads the pinned React and tldraw packages', () => {
    expect(React.version).toBe('19.2.1')
    expect(Tldraw).toBeTypeOf('function')
  })
})
