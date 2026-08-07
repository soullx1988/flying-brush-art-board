import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const root = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { devDependencies: Record<string, string> }
const localApi = JSON.parse(readFileSync(new URL('../../apps/local-api/package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> }
const web = JSON.parse(readFileSync(new URL('../../apps/web/package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> }

describe('phase-two collaboration dependencies', () => {
  it('pins server collaboration dependencies', () => expect(localApi.dependencies).toMatchObject({ '@fastify/cookie': '11.1.2', '@fastify/websocket': '11.3.0', '@tldraw/sync': '5.2.5', '@tldraw/sync-core': '5.2.5' }))
  it('pins browser sync without an external user database client', () => {
    expect(web.dependencies).toMatchObject({ '@tldraw/sync': '5.2.5' })
    expect(root.devDependencies).not.toHaveProperty('@types/pg')
  })
})
