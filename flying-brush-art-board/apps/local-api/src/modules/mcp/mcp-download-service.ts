import { randomBytes } from 'node:crypto'

export interface McpDownloadPayload {
  bytes: Uint8Array
  fileName: string
  mimeType: string
}

interface Ticket {
  actorOpenId: string
  clientId: string
  expiresAt: number
  produce(): Promise<McpDownloadPayload> | McpDownloadPayload
}

export class McpDownloadService {
  private readonly tickets = new Map<string, Ticket>()

  create(input: Omit<Ticket, 'expiresAt'> & { ttlMs?: number }): { ticket: string; expiresAt: string } {
    this.prune()
    if (this.tickets.size >= 100) throw Object.assign(new Error('MCP_DOWNLOAD_CAPACITY_EXCEEDED'), { code: 'MCP_DOWNLOAD_CAPACITY_EXCEEDED' })
    const ticket = randomBytes(24).toString('base64url')
    const expiresAt = Date.now() + (input.ttlMs ?? 5 * 60_000)
    this.tickets.set(ticket, { actorOpenId: input.actorOpenId, clientId: input.clientId, expiresAt, produce: input.produce })
    return { ticket, expiresAt: new Date(expiresAt).toISOString() }
  }

  async read(ticket: string, actorOpenId: string, clientId: string): Promise<McpDownloadPayload | undefined> {
    this.prune()
    const entry = this.tickets.get(ticket)
    if (!entry || entry.actorOpenId !== actorOpenId || entry.clientId !== clientId) return undefined
    const payload = await entry.produce()
    if (payload.bytes.byteLength > 256 * 1024 * 1024) throw Object.assign(new Error('MCP_EXPORT_TOO_LARGE'), { code: 'MCP_EXPORT_TOO_LARGE' })
    return payload
  }

  prune(): void {
    const now = Date.now()
    for (const [ticket, entry] of this.tickets) if (entry.expiresAt <= now) this.tickets.delete(ticket)
  }
}
