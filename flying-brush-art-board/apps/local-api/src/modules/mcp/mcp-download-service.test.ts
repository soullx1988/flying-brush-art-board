import { describe, expect, it, vi } from 'vitest'

import { McpDownloadService } from './mcp-download-service.js'

describe('McpDownloadService', () => {
  it('single-flights concurrent readers and consumes the ticket after the first production', async () => {
    const service = new McpDownloadService()
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const produce = vi.fn(async () => {
      await blocked
      return { bytes: new Uint8Array([1, 2, 3]), fileName: 'board.pdf', mimeType: 'application/pdf' }
    })
    const { ticket } = service.create({ actorOpenId: 'user-a', clientId: 'client-a', produce })

    const first = service.read(ticket, 'user-a', 'client-a')
    const second = service.read(ticket, 'user-a', 'client-a')
    release()

    await expect(first).resolves.toMatchObject({ fileName: 'board.pdf' })
    await expect(second).resolves.toMatchObject({ fileName: 'board.pdf' })
    expect(produce).toHaveBeenCalledTimes(1)
    await expect(service.read(ticket, 'user-a', 'client-a')).resolves.toBeUndefined()
  })

  it('does not expose a ticket to another actor or client', async () => {
    const service = new McpDownloadService()
    const produce = vi.fn(() => ({ bytes: new Uint8Array([1]), fileName: 'x', mimeType: 'application/octet-stream' }))
    const { ticket } = service.create({ actorOpenId: 'user-a', clientId: 'client-a', produce })

    await expect(service.read(ticket, 'user-b', 'client-a')).resolves.toBeUndefined()
    await expect(service.read(ticket, 'user-a', 'client-b')).resolves.toBeUndefined()
    expect(produce).not.toHaveBeenCalled()
    await expect(service.read(ticket, 'user-a', 'client-a')).resolves.toMatchObject({ fileName: 'x' })
  })
})
