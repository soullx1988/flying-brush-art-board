import type { RuntimeConfig } from '../../config/runtime-config.js'
import type { LocalDatabase } from '../../db/schema.js'
import type { AuthenticationRouteDependencies } from './auth-routes.js'
import { FeishuOAuthHttpProvider } from './feishu-oauth-provider.js'
import { LocalUserDirectory } from './local-user-directory.js'
import { OAuthStateRepository } from './oauth-state-repository.js'
import { SessionRepository } from './session-repository.js'
import { UserDirectoryCache } from './user-directory-cache.js'

export interface ProductionAuthentication extends AuthenticationRouteDependencies {
  close(): Promise<void>
}

export function createProductionAuthentication(config: RuntimeConfig, database: LocalDatabase): ProductionAuthentication {
  const directory = new LocalUserDirectory(database, () => new Date(), config.allowedOpenIds)
  const users = new UserDirectoryCache(directory)
  return {
    oauth: new FeishuOAuthHttpProvider(config.feishu.appId, undefined, config.feishu.appSecret),
    states: new OAuthStateRepository(database, undefined, config.sessionSecret),
    sessions: new SessionRepository(database),
    users,
    allowedOrigins: config.allowedAppOrigins,
    recordLogin: async (identity) => {
      const user = directory.recordLogin(identity)
      users.invalidate(identity.openId)
      return user
    },
    close: () => directory.close(),
  }
}
