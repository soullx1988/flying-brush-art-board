import type { AllowedUser, AllowedUserDirectory } from './allowed-user-directory.js'
import { UserNotAllowedError } from './allowed-user-directory.js'
export class UserDirectoryCache {
  private readonly values = new Map<string, { user: AllowedUser; expiresAt: number }>()
  constructor(private readonly directory: AllowedUserDirectory, private readonly now = () => Date.now(), private readonly ttlMs = 300_000) {}
  async requireAllowed(openId: string): Promise<AllowedUser> { const cached = this.values.get(openId); if (cached && cached.expiresAt > this.now()) return cached.user; const user = await this.directory.findByOpenId(openId); if (!user) throw new UserNotAllowedError('User is not allowed'); this.values.set(openId, { user, expiresAt: this.now() + this.ttlMs }); return user }
  invalidate(openId: string): void { this.values.delete(openId) }
  async checkHealth(): Promise<'ok' | 'error'> { return this.directory.checkHealth() }
}
