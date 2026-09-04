import { z } from 'zod'

const tokenSchema = z.string().trim().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/)
const allowedHost = /(^|\.)(feishu\.cn|larksuite\.com)$/i

export interface FeishuDocumentReference {
  kind: 'wiki' | 'docx'
  token: string
  url: URL
}

export interface WikiDocxClient {
  resolveWhiteboardToken(reference: FeishuDocumentReference, options?: { signal?: AbortSignal; actorOpenId?: string }): Promise<string>
}

function validToken(value: string, errorCode: string): string {
  const parsed = tokenSchema.safeParse(value)
  if (!parsed.success) throw new Error(errorCode)
  return parsed.data
}

export async function resolveWhiteboardToken(input: string, client: WikiDocxClient, options: { signal?: AbortSignal; actorOpenId?: string } = {}): Promise<string> {
  const value = input.trim()
  if (!value.includes('://')) return validToken(value, 'FEISHU_WHITEBOARD_TOKEN_INVALID')

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('FEISHU_URL_INVALID')
  }
  if (url.protocol !== 'https:' || !allowedHost.test(url.hostname)) throw new Error('FEISHU_URL_UNSUPPORTED')

  const blockToken = url.searchParams.get('blockToken') ?? url.searchParams.get('block_token')
  if (blockToken) return validToken(blockToken, 'FEISHU_WHITEBOARD_TOKEN_INVALID')

  const parts = url.pathname.split('/').filter(Boolean)
  const boardIndex = parts.findIndex((part) => part === 'board' || part === 'whiteboard')
  if (boardIndex >= 0 && parts[boardIndex + 1]) {
    return validToken(parts[boardIndex + 1]!, 'FEISHU_WHITEBOARD_TOKEN_INVALID')
  }

  const kindIndex = parts.findIndex((part) => part === 'wiki' || part === 'docx')
  const kind = parts[kindIndex] as 'wiki' | 'docx' | undefined
  const token = parts[kindIndex + 1]
  if (!kind || !token) throw new Error('FEISHU_URL_UNSUPPORTED')
  const reference = { kind, token: validToken(token, 'FEISHU_DOCUMENT_TOKEN_INVALID'), url }
  const resolved = options.signal
    ? await client.resolveWhiteboardToken(reference, options)
    : await client.resolveWhiteboardToken(reference)
  return validToken(resolved, 'FEISHU_WHITEBOARD_TOKEN_INVALID')
}
