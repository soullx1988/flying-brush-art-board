import type { CurrentUser } from './auth-client'

export interface TldrawUserIdentity {
  id: string
  name: string
  color: string
}

const TLDRAW_PRESENCE_COLORS = [
  '#FF802B',
  '#EC5E41',
  '#F2555A',
  '#F04F88',
  '#E34BA9',
  '#BD54C6',
  '#9D5BD2',
  '#7B66DC',
  '#02B1CC',
  '#11B3A3',
  '#39B178',
  '#55B467',
] as const

function stableStringHash(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function createTldrawUserIdentity(
  user: Pick<CurrentUser, 'openId' | 'name'>,
): TldrawUserIdentity {
  return {
    id: user.openId,
    name: user.name,
    color: TLDRAW_PRESENCE_COLORS[stableStringHash(user.openId) % TLDRAW_PRESENCE_COLORS.length]!,
  }
}
