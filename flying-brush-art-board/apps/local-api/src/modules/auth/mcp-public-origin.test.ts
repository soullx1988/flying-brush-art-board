import { describe, expect, it } from 'vitest'

import { buildApp } from '../../app.js'
import { createDatabase } from '../../db/schema.js'

describe('MCP public origin startup validation', () => {
  it('rejects unsupported schemes, paths and values outside host/origin allowlists', async () => {
    const cases = [
      { url: 'ftp://board.example.internal', hosts: ['board.example.internal'], origins: ['ftp://board.example.internal'] },
      { url: 'https://board.example.internal/projects', hosts: ['board.example.internal'], origins: ['https://board.example.internal'] },
      { url: 'https://board.example.internal', hosts: ['other.example.internal'], origins: ['https://board.example.internal'] },
      { url: 'https://board.example.internal', hosts: ['board.example.internal'], origins: ['https://other.example.internal'] },
    ]
    for (const entry of cases) {
      const database = createDatabase(':memory:')
      await expect(buildApp({
        database,
        environment: { NODE_ENV: 'test', FEISHU_AUTH_ENABLED: 'false', MCP_ENABLED: 'true' },
        enableMcp: true,
        mcpPublicUrl: entry.url,
        mcpAllowedHosts: entry.hosts,
        mcpAllowedOrigins: entry.origins,
      })).rejects.toThrow(/MCP_PUBLIC_URL/)
      database.close()
    }
  })

  it('allows HTTP and HTTPS origins when Host and Origin are explicitly allowed', async () => {
    for (const entry of [
      { url: 'https://board.example.internal', hosts: ['board.example.internal'], origins: ['https://board.example.internal'] },
      { url: 'http://127.0.0.1:4173', hosts: ['127.0.0.1'], origins: ['http://127.0.0.1:4173'] },
      { url: 'http://192.168.65.48:4173', hosts: ['192.168.65.48'], origins: ['http://192.168.65.48:4173'] },
    ]) {
      const database = createDatabase(':memory:')
      const app = await buildApp({
        database,
        environment: { NODE_ENV: 'test', FEISHU_AUTH_ENABLED: 'false', MCP_ENABLED: 'true' },
        enableMcp: true,
        mcpPublicUrl: entry.url,
        mcpAllowedHosts: entry.hosts,
        mcpAllowedOrigins: entry.origins,
      })
      await app.close()
      database.close()
    }
  })

  it('allows an HTTP origin in production when it is explicitly allowed', async () => {
    const productionDatabase = createDatabase(':memory:')
    const app = await buildApp({
      database: productionDatabase,
      environment: { NODE_ENV: 'production', FEISHU_AUTH_ENABLED: 'true', MCP_ENABLED: 'true' },
      enableMcp: true,
      mcpPublicUrl: 'http://192.168.65.48:4173',
      mcpAllowedHosts: ['192.168.65.48'],
      mcpAllowedOrigins: ['http://192.168.65.48:4173'],
    })
    await app.close()
    productionDatabase.close()
  })
})
