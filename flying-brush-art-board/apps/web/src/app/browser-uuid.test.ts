import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBrowserUuid } from './browser-uuid'

afterEach(() => vi.unstubAllGlobals())

describe('createBrowserUuid', () => {
  it('falls back to getRandomValues when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues<T extends ArrayBufferView>(target: T): T {
        new Uint8Array(target.buffer, target.byteOffset, target.byteLength).fill(0xab)
        return target
      },
    })

    expect(createBrowserUuid()).toBe('abababab-abab-4bab-abab-abababababab')
  })
})
