export interface CurrentUser {
  openId: string
  name: string
  department?: string
  position?: string
  realtimeEnabled?: boolean
}

export interface AuthClient {
  getMe(): Promise<CurrentUser | undefined>
  logout(): Promise<void>
  loginUrl(returnTo: string): string
}

export class LocalAuthClient implements AuthClient {
  async getMe(): Promise<CurrentUser | undefined> {
    const response = await fetch('/api/me')
    if (response.status === 401) return undefined
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { code?: unknown }
      throw Object.assign(new Error(typeof body.code === 'string' ? body.code : `HTTP_${response.status}`), body)
    }
    return response.json() as Promise<CurrentUser>
  }

  async logout(): Promise<void> {
    const response = await fetch('/api/auth/logout', { method: 'POST' })
    if (!response.ok && response.status !== 401) throw new Error(`HTTP_${response.status}`)
  }

  loginUrl(returnTo: string): string {
    const query = new URLSearchParams({ returnTo, origin: window.location.origin })
    return `/auth/feishu/start?${query.toString()}`
  }
}
